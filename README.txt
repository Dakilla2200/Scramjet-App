Proxe proxy files
=================
Upload these folders to the ROOT of your site, next to index.html:

  scram/      Scramjet engine
  baremux/    connection manager
  libcurl/    encrypted transport
  scramjet/   service worker (only handles /scramjet/ pages)

Then in Proxe: Edit site -> Wisp server -> wss://YOUR-PROXY-SERVER/wisp/
