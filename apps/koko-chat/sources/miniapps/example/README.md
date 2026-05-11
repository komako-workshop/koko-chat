# Example Mini-App

The smallest realistic KokoChat mini-app. It exists as a reference for
developers building new mini-apps inside the KokoChat app package.

## What It Does

When the user sends a message in an "Example" conversation, the mini-app:

1. Skips the default Gateway send via `localOnly: true`.
2. Calls `inferOnce` against the connected OpenClaw Gateway.
3. Writes the agent's reply back into the conversation as a normal agent
   message.

There is no custom UI. The existing `/chat/[id]` screen is reused.

## Files

- `index.ts` — registers the outbound builder for `mode: "example"`.
- `README.md` — this file.

## How to Try It

1. Pair KokoChat with OpenClaw and confirm Settings → "OpenClaw Runtime
   Self-Test" passes.
2. On the conversation list, tap `+` and choose **Example** to create a new
   conversation in this mode.
3. Send any message. The mini-app calls `inferOnce` and writes the agent's
   reply back into the chat.

## What to Copy When Starting a New Mini-App

1. Duplicate this folder under `sources/miniapps/<your-id>/`.
2. Add the new mode to `MiniAppId` in `sources/state/conversations.ts`.
3. Add a `defaultTitleFor` branch for the new mode.
4. Add the new id to `KNOWN_MINI_APP_IDS`.
5. Register your `register<Pascal>MiniApp()` in
   `sources/miniapps/index.ts`.
6. Add a `+` entry in the conversation list if your mini-app needs one.

## What to Read Next

- `docs/mini-app-runtime.md` for the full developer-facing API.
- `docs/mini-app-runtime-direction.md` for the architectural background.
- `sources/runtime/openclaw.ts` for the runtime helpers.
