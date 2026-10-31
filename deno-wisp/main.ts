// Proxe wisp server for Deno Deploy.
// A small Wisp v1 server: Proxe's browser (Scramjet + libcurl) opens one WebSocket to /wisp/
// and asks this server to open TCP connections to websites on its behalf.
//
// Routes:
//   wss://<host>/wisp/   the proxy (any path ending in /wisp or /wisp/ works)
//   https://<host>/      "Proxe wisp server is running" (handy for status checks)
//
// Settings (Deno Deploy > your project > Settings > Environment variables), all optional:
//   ALLOWED_ORIGINS  comma-separated sites allowed to use this server.
//                    Default: https://proxegames.com,https://www.proxegames.com
//                    Set to * to allow any site (not recommended: others could use your bandwidth).
//   ALLOWED_PORTS    comma-separated ports websites may be reached on. Default: 80,443,8080,8443

const PKT_CONNECT = 0x01, PKT_DATA = 0x02, PKT_CONTINUE = 0x03, PKT_CLOSE = 0x04;
const CLOSE_VOLUNTARY = 0x01, CLOSE_NETWORK_ERROR = 0x02, CLOSE_INVALID = 0x41,
  CLOSE_UNREACHABLE = 0x42, CLOSE_BLOCKED = 0x48;
const BUFFER = 256; // packets the client may send per stream before waiting for a CONTINUE

const env = (k: string) => { try { return Deno.env.get(k) ?? ""; } catch { return ""; } };
const ORIGINS = (env("ALLOWED_ORIGINS") || "https://proxegames.com,https://www.proxegames.com")
  .split(",").map((s) => s.trim().replace(/\/+$/, "").toLowerCase()).filter(Boolean);
const PORTS = new Set((env("ALLOWED_PORTS") || "80,443,8080,8443")
  .split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => n > 0 && n < 65536));
const ALLOW_LOCAL = env("ALLOW_LOCAL") === "1"; // testing only

function originOk(origin: string | null): boolean {
  if (ORIGINS.includes("*")) return true;
  if (!origin) return false;
  return ORIGINS.includes(origin.toLowerCase());
}

// Never let the proxy reach the server's own network or private addresses.
function hostBlocked(host: string): boolean {
  if (ALLOW_LOCAL) return false;
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [+v4[1], +v4[2]];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (h.includes(":")) return h === "::" || h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80");
  return false;
}

function packet(type: number, id: number, payload?: Uint8Array): Uint8Array {
  const p = new Uint8Array(5 + (payload?.length ?? 0));
  p[0] = type;
  new DataView(p.buffer).setUint32(1, id, true);
  if (payload) p.set(payload, 5);
  return p;
}
const u32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };

type Stream = { conn: Deno.TcpConn | null; queue: Promise<void>; got: number; closed: boolean };

function serveWisp(ws: WebSocket) {
  ws.binaryType = "arraybuffer";
  const streams = new Map<number, Stream>();
  const send = (p: Uint8Array) => { if (ws.readyState === WebSocket.OPEN) ws.send(p); };

  function close(id: number, reason: number, tell: boolean) {
    const s = streams.get(id);
    if (!s || s.closed) return;
    s.closed = true;
    streams.delete(id);
    try { s.conn?.close(); } catch { /* already closed */ }
    if (tell) send(packet(PKT_CLOSE, id, new Uint8Array([reason])));
  }

  async function pump(id: number, s: Stream) {
    const buf = new Uint8Array(128 * 1024);
    try {
      while (!s.closed) {
        const n = await s.conn!.read(buf);
        if (n === null) break;
        send(packet(PKT_DATA, id, buf.slice(0, n)));
      }
      close(id, CLOSE_VOLUNTARY, true);
    } catch {
      close(id, CLOSE_NETWORK_ERROR, true);
    }
  }

  function onConnect(id: number, body: Uint8Array) {
    if (body.length < 3 || streams.has(id)) return;
    const type = body[0];
    const port = new DataView(body.buffer, body.byteOffset).getUint16(1, true);
    const host = new TextDecoder().decode(body.subarray(3)).trim();
    const s: Stream = { conn: null, queue: Promise.resolve(), got: 0, closed: false };
    streams.set(id, s);
    if (type !== 0x01) return close(id, CLOSE_INVALID, true); // TCP only
    if (!PORTS.has(port) || hostBlocked(host)) return close(id, CLOSE_BLOCKED, true);
    // queue the connect so DATA that arrives meanwhile waits for it
    s.queue = (async () => {
      try {
        s.conn = await Deno.connect({ hostname: host, port, transport: "tcp" });
        if (s.closed) { try { s.conn.close(); } catch { /* */ } return; }
        // send small packets (TLS handshakes, requests) immediately instead of batching them
        try { s.conn.setNoDelay(true); s.conn.setKeepAlive(true); } catch { /* not supported */ }
        pump(id, s);
      } catch {
        close(id, CLOSE_UNREACHABLE, true);
      }
    })();
  }

  function onData(id: number, data: Uint8Array) {
    const s = streams.get(id);
    if (!s) return;
    const copy = data.slice();
    s.queue = s.queue.then(async () => {
      if (s.closed || !s.conn) return;
      try {
        let off = 0;
        while (off < copy.length) off += await s.conn.write(copy.subarray(off));
      } catch {
        close(id, CLOSE_NETWORK_ERROR, true);
        return;
      }
      // let the client send more once half the buffer has been written out
      if (++s.got >= BUFFER / 2) { s.got = 0; send(packet(PKT_CONTINUE, id, u32(BUFFER))); }
    });
  }

  ws.onopen = () => send(packet(PKT_CONTINUE, 0, u32(BUFFER)));
  ws.onmessage = (ev) => {
    if (!(ev.data instanceof ArrayBuffer)) return;
    const f = new Uint8Array(ev.data);
    if (f.length < 5) return;
    const id = new DataView(f.buffer).getUint32(1, true);
    const body = f.subarray(5);
    if (f[0] === PKT_CONNECT) onConnect(id, body);
    else if (f[0] === PKT_DATA) onData(id, body);
    else if (f[0] === PKT_CLOSE) close(id, CLOSE_VOLUNTARY, false);
  };
  ws.onclose = ws.onerror = () => { for (const id of [...streams.keys()]) close(id, CLOSE_VOLUNTARY, false); };
}

Deno.serve((req) => {
  const url = new URL(req.url);
  const isWs = (req.headers.get("upgrade") || "").toLowerCase() === "websocket";
  if (isWs && /\/wisp\/?$/.test(url.pathname)) {
    if (!originOk(req.headers.get("origin"))) return new Response("Forbidden", { status: 403 });
    const { socket, response } = Deno.upgradeWebSocket(req);
    serveWisp(socket);
    return response;
  }
  return new Response("Proxe wisp server is running\n", {
    headers: { "content-type": "text/plain; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "no-store" },
  });
});
