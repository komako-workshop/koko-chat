---
name: kokochat-pairing
version: 0.1.0
description: "Generate a connection code so the user can connect KokoChat (the mobile mini-app runtime) to this OpenClaw instance. Use when the user asks to 'pair KokoChat', '生成 KokoChat 配对码/连接码', '把手机连上 KokoChat', or similar. KokoChat is a mobile client like WeChat but for OpenClaw, and it needs a setup code to reach this gateway."
metadata: { "openclaw": { "emoji": "📱", "requires": { "bins": ["openclaw"] } } }
---

# kokochat-pairing

KokoChat is a mobile mini-app runtime that talks to this OpenClaw instance over
the Gateway WebSocket. To add a phone (or reconnect one whose local connection
identity was cleared), KokoChat needs a **connection code** containing:

- the Gateway WebSocket URL, usually `ws://<mac-lan-ip>:18789`
- the Gateway token from `~/.openclaw/openclaw.json`

KokoChat intentionally does **not** use `openclaw devices approve`. The phone
connects with the Gateway token directly, so the mobile flow is one step:
paste the connection code and connect.

## The one command

```bash
python3 - <<'PY'
import base64
import json
import os
import subprocess

config_path = os.path.expanduser("~/.openclaw/openclaw.json")
with open(config_path, "r", encoding="utf-8") as f:
    config = json.load(f)

token = config["gateway"]["auth"]["token"]
port = config.get("gateway", {}).get("port", 18789)

def lan_ip():
    for iface in ("en0", "en1"):
        try:
            out = subprocess.check_output(["ipconfig", "getifaddr", iface], text=True).strip()
            if out:
                return out
        except Exception:
            pass
    return "127.0.0.1"

payload = {
    "url": f"ws://{lan_ip()}:{port}",
    "token": token,
}
raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
print(base64.b64encode(raw).decode("ascii").rstrip("="))
PY
```

- **Connection code lifetime:** this token-based code does not expire on the
  10-minute bootstrap timer, but generate it on demand and do not post it
  publicly.
- **Remote gateway:** this command is for same-Wi-Fi local testing. For remote
  use, the user needs a secure `wss://` / Tailscale / tunnel URL and the code's
  `url` field should be changed accordingly.

## What to hand back

Return **exactly** this shape, nothing more:

````markdown
这是新的 KokoChat 连接码：

```
<paste the raw setup code from the command output>
```

在 KokoChat 的配对页面粘贴这段文字即可连接，不需要再手动 approve。
````

## Why no QR code

KokoChat pairing deliberately goes through **plain text**, not QR. Do not
generate ASCII QR codes, PNG QR codes, or any other visual pairing payload —
even if the user asks. If the user explicitly requests a QR code, explain that
KokoChat expects the raw connection code and ask them to paste it as text.

## Don't do these

- Don't cache or reuse an old connection code in public channels. If the user
  says "the last one didn't work", just generate a new one.
- Don't run `openclaw qr` for KokoChat unless explicitly debugging legacy
  bootstrap-token behavior. `openclaw qr` creates a bootstrap token and may
  require device approval; KokoChat's default flow is token-based.
- Don't print the raw gateway token by itself. It is only surfaced inside the
  base64 connection code that KokoChat can parse.
- Don't ask the user to run `openclaw devices approve <requestId>` for KokoChat.
  KokoChat should not create pending device approval requests in the default
  token-based flow.

## Troubleshooting

If the user reports `pairing required: device is not approved yet`:

1. Confirm they did not paste an `openclaw qr` / bootstrap-token setup code.
2. Generate a fresh token-based connection code using the Python command above.
3. Ask them to clear the old pairing input and paste only the new code.
