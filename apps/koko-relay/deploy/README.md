# koko-relay deployment (deeply.plus)

The relay is a stateless WebSocket forwarder. KokoChat devices connect to it as
the *gateway* side (`/v1/gateway/<relayId>`) and each user's OpenClaw box
connects as the *connector* side (`/v1/connector/<relayId>`); the relay just
pipes bytes between a matched pair. No persistence, so deployment is "run the
process + expose it over TLS".

In production it runs on the **deeply.plus** host (same box as the Deeply
library API), bound to loopback, with Caddy terminating TLS and reverse-proxying
to it. Clients use `wss://deeply.plus/relay` (see `DEFAULT_RELAY_URL` in
`openclaw/skills/kokochat-pairing/generate-kokochat-code.mjs`).

## Service

`kokochat-relay.service` runs `server.mjs` bound to `127.0.0.1:8787`
(`KOKO_RELAY_HOST` / `KOKO_RELAY_PORT`).

```bash
cd /opt/koko-chat/apps/koko-relay && npm install   # installs `ws`
sudo cp deploy/kokochat-relay.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kokochat-relay
curl -sS http://127.0.0.1:8787/healthz   # {"ok":true,"status":"live",...}
```

## Caddy

Add a route inside the existing `deeply.plus { ... }` block (before the
catch-all `handle { ... }`). `handle_path` strips the `/relay` prefix so the
relay sees `/v1/gateway/*` and `/v1/connector/*`:

```caddy
  # KokoChat relay tunnel (koko-relay on 127.0.0.1:8787). WebSocket reverse
  # proxy; handle_path strips /relay so the relay sees /v1/gateway/* + /v1/connector/*.
  handle_path /relay/* {
    reverse_proxy 127.0.0.1:8787
  }
```

```bash
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
curl -sS https://deeply.plus/relay/healthz   # same JSON, now over TLS
```

## Why wss + a domain (not the old `ws://<ip>:8787`)

The earlier default was `ws://47.84.141.40:8787` — plaintext over a bare IP, so
chat/agent traffic was unencrypted and there was no server identity to verify.
Fronting the relay with deeply.plus's Caddy gives TLS (`wss://`) and a stable
domain in one move, and lets dev dogfood the exact path real users take.
