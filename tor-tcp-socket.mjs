import { Socket } from "node:net";
import { lookup } from "node:dns/promises";

const torHost = process.env.TOR_SOCKS_HOST ?? "127.0.0.1";
const torPort = Number(process.env.TOR_SOCKS_PORT ?? "9050");
if (!Number.isInteger(torPort) || torPort < 1 || torPort > 65535) {
	throw new Error("TOR_SOCKS_PORT must be an integer between 1 and 65535");
}

function isOnionHost(hostname) {
	return hostname.toLowerCase().endsWith(".onion");
}

function readExactly(socket, length, buffered = Buffer.alloc(0)) {
	return new Promise((resolve, reject) => {
		let received = buffered;
		const cleanup = () => {
			socket.off("data", onData);
			socket.off("error", onError);
			socket.off("close", onClose);
		};
		const onData = data => {
			received = Buffer.concat([received, data]);
			completeIfReady();
		};
		const onError = error => {
			cleanup();
			reject(error);
		};
		const onClose = () => {
			cleanup();
			reject(new Error("Tor SOCKS connection closed during negotiation"));
		};
		const completeIfReady = () => {
			if (received.length < length) return;
			cleanup();
			resolve([received.subarray(0, length), received.subarray(length)]);
		};
		completeIfReady();
		if (received.length >= length) return;
		socket.on("data", onData);
		socket.once("error", onError);
		socket.once("close", onClose);
	});
}

async function connectThroughTor(socket, hostname, port) {
	await connectSocket(socket, torPort, torHost);

	socket.write(Buffer.from([5, 1, 0]));
	let [greeting, buffered] = await readExactly(socket, 2);
	if (greeting[0] !== 5 || greeting[1] !== 0) {
		throw new Error("Tor SOCKS proxy rejected unauthenticated access");
	}

	const domain = Buffer.from(hostname);
	if (domain.length > 255) throw new Error("The onion hostname is too long");
	const request = Buffer.alloc(7 + domain.length);
	request.set([5, 1, 0, 3, domain.length], 0);
	domain.copy(request, 5);
	request.writeUInt16BE(port, 5 + domain.length);
	socket.write(request);

	let [reply, nextBuffer] = await readExactly(socket, 4, buffered);
	buffered = nextBuffer;
	if (reply[0] !== 5 || reply[1] !== 0) {
		throw new Error(`Tor SOCKS connection failed (code ${reply[1]})`);
	}
	let addressLength;
	if (reply[3] === 1) addressLength = 4;
	else if (reply[3] === 4) addressLength = 16;
	else if (reply[3] === 3) {
		[[addressLength], buffered] = await readExactly(socket, 1, buffered);
	} else addressLength = null;
	if (addressLength === null) throw new Error("Tor SOCKS proxy returned an invalid address");
	const remaining = addressLength + 2;
	if (buffered.length < remaining) {
		[, buffered] = await readExactly(socket, remaining, buffered);
	}
	return buffered.subarray(remaining);
}

function connectSocket(socket, port, host) {
	return new Promise((resolve, reject) => {
		const onConnect = () => {
			socket.off("error", onError);
			resolve();
		};
		const onError = error => {
			socket.off("connect", onConnect);
			reject(error);
		};
		socket.once("connect", onConnect);
		socket.once("error", onError);
		socket.connect(port, host);
	});
}

export class TorAwareTCPSocket {
	constructor(hostname, port) {
		this.hostname = hostname;
		this.port = port;
		this.socket = null;
		this.pendingData = [];
		this.waiters = [];
		this.closed = false;
		this.socketError = null;
	}

	async connect() {
		const socket = new Socket();
		this.socket = socket;
		let buffered = Buffer.alloc(0);
		try {
			if (isOnionHost(this.hostname)) {
				buffered = await connectThroughTor(socket, this.hostname, this.port);
			} else {
				const { address } = await lookup(this.hostname);
				await connectSocket(socket, this.port, address);
			}
		} catch (error) {
			socket.destroy();
			throw new Error(
				isOnionHost(this.hostname)
					? `Could not reach the Tor SOCKS proxy at ${torHost}:${torPort}: ${error.message}`
					: `Could not connect to ${this.hostname}:${this.port}: ${error.message}`,
				{ cause: error },
			);
		}

		if (buffered.length) this.pendingData.push(buffered);
		socket.on("data", data => {
			const waiter = this.waiters.shift();
			if (waiter) waiter.resolve(data);
			else this.pendingData.push(data);
		});
		socket.on("close", () => {
			this.closed = true;
			for (const waiter of this.waiters.splice(0)) waiter.resolve(null);
		});
		socket.on("error", error => {
			this.socketError = error;
			for (const waiter of this.waiters.splice(0)) waiter.reject(error);
		});
	}

	async recv() {
		if (this.socketError) throw this.socketError;
		if (this.pendingData.length) return this.pendingData.shift();
		if (this.closed) return null;
		return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
	}

	async send(data) {
		await new Promise((resolve, reject) => {
			this.socket.write(data, error => error ? reject(error) : resolve());
		});
	}

	async close() {
		if (this.socket && !this.socket.destroyed) this.socket.end();
	}

	pause() {
		this.socket?.pause();
	}

	resume() {
		this.socket?.resume();
	}
}
