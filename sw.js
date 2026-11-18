const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// 1. Spoof navigator properties BEFORE importing scramjet.all.js
Object.defineProperties(self.navigator, {
	userAgent: { get: () => CHROME_UA },
	vendor: { get: () => "Google Inc." },
	platform: { get: () => "Win32" },
	appVersion: { get: () => "5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" }
});

importScripts("/scram/scramjet.all.js");

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();

self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", event => {
	event.respondWith((async () => {
		await scramjet.loadConfig();

		// 2. Rewrite incoming request headers to include Chrome identity & Client Hints
		const headers = new Headers(event.request.headers);
		headers.set("User-Agent", CHROME_UA);
		headers.set("Sec-CH-UA", '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"');
		headers.set("Sec-CH-UA-Mobile", "?0");
		headers.set("Sec-CH-UA-Platform", '"Windows"');

		const spoofedRequest = new Request(event.request, { headers });
		const spoofedEvent = new Proxy(event, {
			get(target, prop) {
				return prop === "request" ? spoofedRequest : target[prop];
			}
		});

		if (scramjet.route(spoofedEvent)) return scramjet.fetch(spoofedEvent);
		return fetch(spoofedRequest);
	})());
});
