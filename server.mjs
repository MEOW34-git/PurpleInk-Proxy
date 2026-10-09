import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";
import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";

const workspacePath = fileURLToPath(new URL("./", import.meta.url));
const mainPage = await readFile(new URL("./main.html", import.meta.url));
const appsPage = await readFile(new URL("./apps.html", import.meta.url));
const favicon = await readFile(new URL("./favicon.ico", import.meta.url));
const serviceWorker = await readFile(new URL("./sw.js", import.meta.url));

logging.set_level(logging.NONE);
Object.assign(wisp.options, {
	allow_udp_streams: false,
	dns_servers: ["1.1.1.3", "1.0.0.3"],
});

const app = Fastify({
	serverFactory: handler => createServer()
		.on("request", (request, response) => {
			response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
			response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
			handler(request, response);
		})
		.on("upgrade", (request, socket, head) => {
			if (request.url?.endsWith("/wisp/")) {
				wisp.routeRequest(request, socket, head);
			} else {
				socket.destroy();
			}
		}),
});

app.get("/", async (_request, reply) => reply.type("text/html; charset=utf-8").send(mainPage));
app.get("/main.html", async (_request, reply) => reply.type("text/html; charset=utf-8").send(mainPage));
app.get("/apps.html", async (_request, reply) => reply.type("text/html; charset=utf-8").send(appsPage));
app.get("/favicon.ico", async (_request, reply) => reply.type("image/x-icon").send(favicon));
app.get("/sw.js", async (_request, reply) => reply.type("application/javascript").send(serviceWorker));

app.register(fastifyStatic, { root: scramjetPath, prefix: "/scram/", decorateReply: false });
app.register(fastifyStatic, { root: libcurlPath, prefix: "/libcurl/", decorateReply: false });
app.register(fastifyStatic, { root: baremuxPath, prefix: "/baremux/", decorateReply: false });

app.setNotFoundHandler((_request, reply) => reply.code(404).type("text/plain").send("Not found"));

const port = Number.parseInt(process.env.PORT ?? "8000", 10);
await app.listen({ port, host: "0.0.0.0" });
console.log(`Blittio Browse is available at http://localhost:${port}`);