# KokoChat Public Beta QA Report

## Summary

- Overall verdict: IN PROGRESS
- Test date: 2026-05-26 17:54 CST
- Tester agent: Codex
- App commit recorded by EAS: `757dd80d6a213b8077710a00bdc377e0b3c5e655`
- Local working tree included in build archive: yes, with uncommitted changes in:
  - `apps/koko-chat/sources/state/gateway.ts`
  - `miniapps/deeply/mobile/persona.ts`
  - `miniapps/tavern-roleplay/mobile/index.ts`
- Latest TestFlight build:
  - EAS build id: `76b006b5-762f-4514-9825-1c1898e7ed8e`
  - App version: `0.0.1`
  - Build number: `16`
  - IPA: `https://expo.dev/artifacts/eas/fE3Xs2emCbEnHcG6mxnNLE.ipa`
  - App Store Connect/TestFlight: `https://appstoreconnect.apple.com/apps/6769439117/testflight/ios`

## Environment Matrix

| ID | App mode | Device | OpenClaw version | OS | Gateway URL shape | Result |
| --- | --- | --- | --- | --- | --- | --- |
| E1 | TestFlight/EAS production | App Store Connect upload | n/a | n/a | n/a | PASS: build `16` uploaded; Apple processing pending |
| E2 | Expo Go/dev bundle | iPhone 17 Pro Simulator, iOS 26.4 | OpenClaw 2026.5.5 | macOS 26.4.1, Node v25.8.1 | `ws://LAN:18789`, then relay setup code | PASS with manual pairing |
| E3 | CLI regression | local pairing relay script | n/a | macOS 26.4.1 | relay config generation only | PASS |
| E4 | CLI regression | Aliyun ECS configured in script | expected OpenClaw 2026.5.18 | remote Linux | relay tunnel | FAIL: script points at stopped ECS |
| E5 | Aliyun ECS inventory | running replacement instance | OpenClaw 2026.4.15 | Ubuntu 24.04 | `43.98.171.176` | PARTIAL: local health OK via Cloud Assistant; not wired into regression |

## Blocking Findings

None confirmed yet in the tested smoke paths.

## High Findings

None confirmed yet.

## Medium Findings

### M1. Dev auto-connect loops before manual pairing

- Environment: E2, Expo Go/dev bundle on iOS Simulator.
- Steps:
  1. Start dev bundle via `pnpm exec node scripts/dev-start.mjs --port 8082`.
  2. Open `exp://192.168.71.208:8082` in Simulator.
  3. Let app attempt local gateway auto-connect.
- Expected: dev auto-connect either succeeds or fails once and leaves user on pairing UI.
- Actual: Metro repeatedly logged `ws closed` with `1008 pairing required: device is not approved yet` until manual pairing completed.
- Evidence:
  - Metro: `[koko-dev] auto-connect failed: pairing required: device is not approved yet`
  - Gateway: repeated closed-before-connect entries during 17:43-17:45.
- Suspected layer: App dev bootstrap / gateway pairing state.
- Notes: Manual pairing via copied request and generated setup code succeeded afterward; this is dev-flow noise, not a public TestFlight blocker.

### M2. Aliyun OpenClaw regression script cannot obtain setup code

- Environment: E4, `pnpm regression:openclaw`.
- Steps:
  1. Run `pnpm regression:openclaw`.
  2. Script checks relay health.
  3. Script attempts remote fresh device pairing.
- Expected: remote pairing script returns a KokoChat setup code.
- Actual: relay health passed, then `pairFreshDevice` received empty/invalid output and failed JSON decode.
- Evidence:
  - `[ok] relay health`
  - `SyntaxError: Unexpected end of JSON input`
  - Stack: `decodeJson -> pairFreshDevice -> regression-openclaw-kokochat.mjs`
- Confirmed root cause:
  - `scripts/regression-openclaw-kokochat.mjs` defaults to `47.237.5.255`.
  - Alibaba Cloud API reports the documented instance `i-t4n0481v1pkop5imukas` / `kokochat-openclaw-20260519` is `Stopped` and has no current `PublicIpAddress`.
  - SSH to `47.237.5.255:22` can establish TCP but times out during SSH banner exchange, so the remote pairing command never executes.
  - `http://47.237.5.255:18789/healthz` also times out.
  - Relay health still passes because it checks the separate relay host `47.84.141.40:8787`, not the OpenClaw ECS.
- Related environment finding:
  - The running OpenClaw candidate is `i-t4n683u9ip19ixdln0ll` / `kokochat-openclaw-oc415-20260520070824` at `43.98.171.176`.
  - Cloud Assistant on that instance reports OpenClaw `2026.4.15 (041266a)`, `openclaw-gateway.service` active, and local `curl http://127.0.0.1:18789/healthz` returns `{"ok":true,"status":"live"}`.
  - The stored SSH password for the old ECS does not authenticate to `43.98.171.176`, so the current SSH-based regression cannot use this replacement instance as-is.
- Notes: This is environment drift/stale regression target, not evidence that the recent KokoChat client changes broke pairing or relay logic.

### M3. Tavern role bootstrap latency is high but recovers

- Environment: E2.
- Steps:
  1. Create Tavern conversation.
  2. Ask for non-NSFW light chat roles.
  3. Tap first role card.
  4. When "正在加载角色卡" appears, background app for 5 seconds.
  5. Return foreground and wait.
- Expected: no `disconnect`, no permanent loading, role eventually ready.
- Actual: PASS functionally, but opening-message translation took roughly 115 seconds from model start to completion.
- Evidence:
  - UI stayed in loading state after foreground.
  - OpenClaw trajectory `3ecd3017-c531-4b1d-91c2-7e487ad7169c` completed successfully at `2026-05-26T09:50:53.189Z`.
  - UI updated to translated first message and input unlocked around 17:51 CST.
- Suspected layer: model latency / first-message translation path.

## Passed Core Flows

### A1. Manual pairing

- Environment: E2.
- Result: PASS.
- Notes:
  - Copied pairing request from Simulator UI.
  - Generated setup code locally with `kokochat-pairing`.
  - Pasted setup code back into app.
  - Metro logged `gateway handshake complete`.
  - No setup code, token, or deviceToken is included in this report.

### B1. Koko basic chat

- Environment: E2.
- Prompt: `Kiki smoke test ok` (typed through Simulator keyboard).
- Result: PASS.
- Observed:
  - User message sent.
  - Input locked while generating.
  - Assistant returned: `好耶，smoke test 通过`.
  - Input unlocked afterward.

### D1. Tavern recommendation search with 5-second background restore

- Environment: E2.
- Prompt: `找一个适合轻松聊天的非 NSFW 角色`.
- Result: PASS.
- Observed:
  - App was backgrounded during generation for 5 seconds.
  - On foreground, structured cards were present.
  - Cards included name, English/original name, description, tags, and images.
  - No raw JSON, no permanent loading.

### D2/D3. Tavern role card load with 5-second background restore

- Environment: E2.
- Character: `Isabella Shiraishi - The Charming Florist`.
- Result: PASS with latency note M3.
- Observed:
  - Loading banner shown.
  - App backgrounded during role-card loading.
  - Foreground did not produce `disconnect`.
  - OpenClaw completed translation successfully.
  - App rendered translated opening message and input unlocked.

### C. Deeply basic explore chat

- Environment: E2.
- Prompt: `Procrastination course ideas`.
- Result: PASS.
- Observed:
  - Deeply conversation created from `+` mini-app menu.
  - Response rendered as Chinese explanatory prose.
  - Input unlocked afterward.

## OpenClaw Compatibility Notes

- Local OpenClaw:
  - Version: `OpenClaw 2026.5.5 (b1abf9d)`
  - Node: `v25.8.1`
  - OS: macOS 26.4.1 arm64
- Local agent skill status:
  - `main`: `kokochat-pairing` ready.
  - `deeply`: `kokochat-deeply-research` ready.
  - `tavern`: `kokochat-tavern-search` ready.
  - `tavern-roleplay`: `kokochat-tavern-roleplay` ready.
- `openclaw status` could not check npm latest due registry fetch timeout, but local gateway was reachable.

## Background / Reconnect Notes

- Koko basic chat was not yet background-tested.
- Tavern recommendation search passed 5-second background test.
- Tavern role-card loading passed 5-second background test.
- 30-second and 2-minute background windows still need to be run.
- Deeply long-running outline/course generation background tests still need to be run.

## Raw Evidence Index

- TestFlight/EAS build: `76b006b5-762f-4514-9825-1c1898e7ed8e`
- EAS submission: `0e2db8ed-89f4-452d-9796-2aab0ec7ef45`
- Tavern roleplay trajectory:
  - `~/.openclaw/agents/tavern-roleplay/sessions/3ecd3017-c531-4b1d-91c2-7e487ad7169c.trajectory.jsonl`
- Gateway logs:
  - `~/.openclaw/logs/gateway.err.log`
- Dev server:
  - Metro on `http://localhost:8082`

## Next Test Queue

1. TestFlight true-device smoke after Apple processing completes.
2. Koko background restore: 5s / 30s / 2min.
3. Tavern role-card load: repeat 30s / 2min and 3 attempts.
4. Deeply custom course auto section count: research / link / book.
5. Deeply course outline and first section generation with background restore.
6. Investigate Aliyun ECS regression pairing failure without exposing secrets.
