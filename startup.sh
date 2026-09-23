#!/bin/sh
set -eu
cd /workspace

if ! curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8790/health; then
  node /workspace/hub/vps.mjs >> /workspace/hub/vps.stdout.log 2>&1 &
fi

CLOUDFLARED_BIN="${CLOUDFLARED_BIN:-/tmp/bin/cloudflared}"
if [ -x "$CLOUDFLARED_BIN" ] && ! pgrep -x cloudflared >/dev/null 2>&1; then
  CLOUDFLARED_BIN="$CLOUDFLARED_BIN" node /workspace/hub/tunnel.mjs >> /workspace/hub/tunnel.stdout.log 2>&1 &
fi

if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  exit 0
fi

npm run dev >> /tmp/omega-vite.log 2>&1 &
exit 0
