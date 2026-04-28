# scripts

One-off smoke and ops scripts. Not published.

Run from repo root:

```bash
node scripts/smoke-echo.mjs
```

## `smoke-echo.mjs`

End-to-end echo smoke verifying:

- `@koko/protocol` pairing QR codec, box anonymous encrypt/decrypt, XChaCha20 symmetric AEAD, envelope codec
- `@koko/relay` pairing HTTP endpoints + room WebSocket + envelope forwarding

It spins up relay on a random loopback port, simulates CLI and APP as two
local scripts that do the real pairing + hello + encrypted envelope round-trip.

**Deliberately out of scope**:

- key exchange protocol (uses a hardcoded shared test key for simplicity).
  The real flow will have CLI generate a machineKey and box-encrypt it to
  APP's pubkey during first connect — see [`../DECISIONS.md`](../DECISIONS.md)
  and Task 03b.
- OpenClaw integration (`@koko/openclaw-client` is not wired yet) — will come
  in Task 03c.

If this script breaks, something regressed in the cross-package contract.
