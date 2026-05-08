---
name: kokochat-pairing
version: 0.1.0
description: "Generate a fresh pairing code so the user can connect KokoChat (the mobile mini-app runtime) to this OpenClaw instance. Use when the user asks to 'pair KokoChat', '生成 KokoChat 配对码', '把手机连上 KokoChat', or similar. KokoChat is a mobile client like WeChat but for OpenClaw, and it needs a setup code to trust this gateway."
metadata: { "openclaw": { "emoji": "📱", "requires": { "bins": ["openclaw"] } } }
---

# kokochat-pairing

KokoChat is a mobile mini-app runtime that talks to this OpenClaw instance over
the Gateway WebSocket. To add a new phone (or re-add one whose identity was
cleared), KokoChat needs a **setup code** — a short-lived, one-time-use token
issued by `openclaw qr`.

Your job: when the user asks for a KokoChat pairing code, run `openclaw qr`
and return the setup code as plain text. KokoChat pairing is intentionally
single-step for this private setup: once the phone submits the fresh setup code,
the gateway auto-approves the device token handoff.

## The one command

```bash
openclaw qr --setup-code-only
```

- **Setup code lifetime:** ~10 minutes. Generate on demand; never cache or reuse.
- **Remote gateway:** if the user says the phone is outside their home network,
  add `--remote`.

## What to hand back

Return **exactly** this shape, nothing more:

````markdown
这是新的 KokoChat 配对码，有效期约 10 分钟：

```
<paste the raw setup code from the command output>
```

在 KokoChat 的配对页面粘贴这段文字即可连接，不需要再手动 approve。
````

## Why no QR code

KokoChat pairing deliberately goes through **plain text**, not QR. Do not run
`openclaw qr` without `--setup-code-only`, and do not generate ASCII QR codes,
PNG QR codes, or any other visual pairing payload — even if the user asks.
If the user explicitly requests a QR code, explain that KokoChat expects the
raw setup code and ask them to paste it as text.

## Don't do these

- Don't cache or reuse an old setup code. If the user says "the last one didn't
  work", just generate a new one.
- Don't invent flags. Only `--url`, `--remote`, `--password`, `--token`,
  `--setup-code-only`, `--no-ascii`, `--public-url`, `--json` exist. Run
  `openclaw qr --help` if unsure.
- Don't echo the raw gateway token anywhere; the setup code is a different,
  scoped, one-time bootstrap token and is safe to surface. The gateway token
  itself lives in `openclaw.json` and should never be quoted back to the user.
- Don't ask the user to run `openclaw devices approve <requestId>` for KokoChat.
  This local setup auto-approves bootstrap-token device handoff.

## Troubleshooting

If the user reports `pairing required: device is not approved yet`:

1. Confirm the gateway is running: `openclaw status` (look for `gateway: running`).
2. If a pending approval is sitting in `openclaw devices list`, the gateway
   process probably has not picked up the local KokoChat auto-approve patch.
   Restart the gateway and generate a fresh setup code.
3. If the setup code has expired (>10 minutes since generation), generate a
   new one.
