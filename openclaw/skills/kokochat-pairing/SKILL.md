---
name: kokochat-pairing
version: 0.2.1
description: "Approve a KokoChat device pairing request and return a device-token connection code. Use when the user asks to pair KokoChat, generate a KokoChat connection code, or sends a KokoChat `kokochat.pairingRequest` payload. The script writes the approved device into `~/.openclaw/devices/paired.json` and prints a relay-tunnel setup code the phone can paste back into KokoChat."
author: komako-workshop
license: Apache-2.0
tags: [latest, kokochat, pairing, device, gateway, relay]
triggers:
  - kokochat pairing
  - pair kokochat
  - generate kokochat connection code
  - kokochat 配对
  - KokoChat 连接码
  - kokochat.pairingRequest
metadata:
  openclaw:
    emoji: "📱"
    requires:
      bins: [node]
      capabilities:
        - network
        - filesystem_write
      platforms:
        - linux
        - darwin
        - windows
---

# kokochat-pairing

KokoChat is a mobile client for this OpenClaw Gateway. KokoChat now pairs as a
real Gateway device: the phone generates a device identity locally, sends this
OpenClaw a pairing request, and this skill approves that device with operator
scopes before returning a connection code.

Generated KokoChat connection codes must use the KokoChat relay tunnel. Do not
return LAN, public Gateway, or `openclaw qr` direct Gateway URLs for normal
KokoChat pairing.

Do not return the shared `gateway.auth.token` for KokoChat. Shared-token
device-less clients may connect without `operator.write`; KokoChat needs a
device token tied to its public key. Newer KokoChat builds also request
`operator.admin` because current OpenClaw protects `sessions.delete` with that
scope, and the mobile runtime uses it to clean up temporary `inferOnce`
sessions. Older builds without that scope can still pair, but cleanup remains
best-effort.

## If The User Included A Pairing Request

Run this command from the skill directory, replacing `<request>` with the raw
KokoChat pairing request code or the whole user message:

```bash
KOKOCHAT_PAIRING_REQUEST='<request>' node ./generate-kokochat-code.mjs
```

Return only the generated KokoChat connection code in a fenced code block.

## If The User Did Not Include A Pairing Request

Ask them to open KokoChat's pairing page, copy the generated pairing request,
send that request here, and then paste the connection code you return back into
KokoChat.

## Output Format

````markdown
这是新的 KokoChat 连接码：

```
<raw setup code from generate-kokochat-code.mjs>
```
````

## Do Not

- Do not run `openclaw qr` for KokoChat unless explicitly debugging legacy QR
  pairing.
- Do not print the raw gateway auth token.
- Do not generate a token-only setup code.
- Do not approve arbitrary scopes outside the request; the script validates and
  normalizes the KokoChat operator scope set.
