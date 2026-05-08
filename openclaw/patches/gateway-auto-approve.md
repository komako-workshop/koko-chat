# Gateway Auto-Approve Patch For KokoChat

KokoChat uses OpenClaw setup codes as a private, single-user pairing flow. The
default OpenClaw gateway accepts the bootstrap token, creates a pending pairing
request, and then waits for an existing operator to approve that request.

For KokoChat, that extra approval step is intentionally skipped. A fresh setup
code should be enough for the phone to connect.

## Current Local Patch

Installed OpenClaw version when this was written:

```text
OpenClaw CLI: 2026.5.5 (b1abf9d)
Installed dist root: ~/.npm-global/lib/node_modules/openclaw/dist/
Patched file: message-handler-DZdD0nqB.js
```

The installed file name is content-hashed and may change after an OpenClaw
upgrade. Locate it with:

```bash
ls ~/.npm-global/lib/node_modules/openclaw/dist/message-handler-*.js
```

## Diff

Change both bootstrap-pairing checks from "node-only, empty scopes" to "any
bootstrap-token role/scopes allowed by the issued bootstrap profile".

```diff
--- a/message-handler-DZdD0nqB.js
+++ b/message-handler-DZdD0nqB.js
@@
- if (boundBootstrapProfile === null && authMethod === "bootstrap-token" && reason === "not-paired" && role === "node" && scopes.length === 0 && !existingPairedDevice && bootstrapTokenCandidate) boundBootstrapProfile = await getBoundDeviceBootstrapProfile({
+ if (boundBootstrapProfile === null && authMethod === "bootstrap-token" && reason === "not-paired" && !existingPairedDevice && bootstrapTokenCandidate) boundBootstrapProfile = await getBoundDeviceBootstrapProfile({
@@
- const allowSilentBootstrapPairing = authMethod === "bootstrap-token" && reason === "not-paired" && role === "node" && scopes.length === 0 && !existingPairedDevice && boundBootstrapProfile !== null;
+ const allowSilentBootstrapPairing = authMethod === "bootstrap-token" && reason === "not-paired" && !existingPairedDevice && boundBootstrapProfile !== null;
```

The rest of OpenClaw's bootstrap profile checks remain in force. The gateway
still calls `approveBootstrapDevicePairing(...)`, which verifies that the
pending device's requested role and scopes are allowed by the bootstrap profile.

## Verification

After applying the patch:

```bash
openclaw gateway restart
openclaw status
openclaw skills list
```

Expected behavior:

- KokoChat asks OpenClaw for a setup code through `kokochat-pairing`.
- The user pastes the setup code into the KokoChat pair screen.
- The gateway silently approves the bootstrap-token device handoff.
- `openclaw devices list --json` should not show a new pending request for that
  phone.

If a future OpenClaw release adds an official config flag for this behavior,
delete this patch and use the upstream config instead.
