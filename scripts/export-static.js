// Builds a folder of static files so Scramjet can run natively inside
// another website (e.g. the Proxe site on Cloudflare Pages).
// Output: ./static -> upload its contents next to your site's index.html.
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";

const out = "static";
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "scramjet"), { recursive: true });

const skip = (src) => !src.endsWith(".map") && !src.includes(`${"/"}types`);
cpSync(scramjetPath, join(out, "scram"), { recursive: true, filter: skip });
cpSync(libcurlPath, join(out, "libcurl"), { recursive: true, filter: skip });
cpSync(baremuxPath, join(out, "baremux"), { recursive: true, filter: skip });

// Service worker lives in /scramjet/ so it only handles proxied pages
// and never touches the rest of the site.
writeFileSync(
	join(out, "scramjet", "sw.js"),
	`importScripts("/scram/scramjet.all.js");

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();

async function handleRequest(event) {
	await scramjet.loadConfig();
	if (scramjet.route(event)) return scramjet.fetch(event);
	return fetch(event.request);
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => event.respondWith(handleRequest(event)));
`
);

writeFileSync(
	join(out, "README.txt"),
	`Proxe proxy files
=================
Upload these folders to the ROOT of your site, next to index.html:

  scram/      Scramjet engine
  baremux/    connection manager
  libcurl/    encrypted transport
  scramjet/   service worker (only handles /scramjet/ pages)

Then in Proxe: Edit site -> Wisp server -> wss://YOUR-PROXY-SERVER/wisp/
`
);
console.log("Static proxy files written to ./static");
