"use strict";
/**
 * @type {HTMLFormElement}
 */
const form = document.getElementById("sj-form");
/**
 * @type {HTMLInputElement}
 */
const address = document.getElementById("sj-address");
/**
 * @type {HTMLInputElement}
 */
const searchEngine = document.getElementById("sj-search-engine");
/**
 * @type {HTMLParagraphElement}
 */
const error = document.getElementById("sj-error");
/**
 * @type {HTMLPreElement}
 */
const errorCode = document.getElementById("sj-error-code");

const { ScramjetController } = $scramjetLoadController();

const scramjet = new ScramjetController({
	files: {
		wasm: "/scram/scramjet.wasm.wasm",
		all: "/scram/scramjet.all.js",
		sync: "/scram/scramjet.sync.js",
	},
});

scramjet.init();

const connection = new BareMux.BareMuxConnection("/baremux/worker.js");

const loading = document.getElementById("sj-loading");

async function openUrl(input) {
	error.textContent = "";
	errorCode.textContent = "";
	loading.hidden = false;

	try {
		await registerSW();
	} catch (err) {
		error.textContent = "Failed to register service worker.";
		errorCode.textContent = err.toString();
		loading.hidden = true;
		throw err;
	}

	const url = search(input, searchEngine.value);

	let wispUrl =
		(location.protocol === "https:" ? "wss" : "ws") +
		"://" +
		location.host +
		"/wisp/";
	if ((await connection.getTransport()) !== "/libcurl/index.mjs") {
		await connection.setTransport("/libcurl/index.mjs", [
			{ websocket: wispUrl },
		]);
	}
	const old = document.getElementById("sj-frame");
	if (old) old.remove();
	const frame = scramjet.createFrame();
	frame.frame.id = "sj-frame";
	frame.frame.title = "Proxe";
	document.body.appendChild(frame.frame);
	frame.go(url);
	loading.hidden = true;
}

form.addEventListener("submit", (event) => {
	event.preventDefault();
	const value = address.value.trim();
	if (value) openUrl(value);
});

// Opened from the Proxe site as ?url=https://example.com
const startUrl = new URLSearchParams(location.search).get("url");
if (startUrl) {
	form.hidden = true;
	address.value = startUrl;
	openUrl(startUrl).catch(() => {
		form.hidden = false;
		loading.hidden = true;
	});
}
