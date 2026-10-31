# Proxe wisp server (Deno Deploy)

A small Wisp v1 server for Proxe's built-in proxy, made to run on Deno Deploy's free tier.

**Deploy:** in Deno Deploy, create an app from this repo with the entrypoint `deno-wisp/main.ts`
(no framework, no install or build command). Opening the app's URL should show
"Proxe wisp server is running".

**Use it in Proxe:** Edit site → Wisp servers → `wss://<your-app-url>/wisp/` first, backups after it,
separated by spaces.

**Optional environment variables**
- `ALLOWED_ORIGINS`: sites allowed to use the server (default `https://proxegames.com,https://www.proxegames.com`)
- `ALLOWED_PORTS`: ports websites may be reached on (default `80,443,8080,8443`)

Private and local addresses are always blocked.
