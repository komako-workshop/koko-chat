# Tavern Roleplay Prototype

Local web prototype for testing "click a recommended card → open a roleplay
chat" without touching React Native UI.

The frontend is intentionally plain HTML/CSS/JS. The backend uses the same
building blocks the future mobile mini-app will use:

- `fetch-card.mjs` to fetch a full Character Tavern card
- `buildRoleplayBootstrapPrompt` to convert the card into a SillyTavern-style
  bootstrap prompt
- OpenClaw Gateway `sessions.create` / `sessions.send` / `agent.wait` /
  `chat.history` for the actual model call

## Run

Prerequisite: OpenClaw gateway running and a `tavern-roleplay` agent exists.

```bash
node miniapps/tavern/prototype/server.mjs
```

Open:

```text
http://127.0.0.1:8787
```

## Smoke Test

In one terminal:

```bash
node miniapps/tavern/prototype/server.mjs
```

In another:

```bash
node miniapps/tavern/scripts/spike-roleplay-prototype.mjs
```

The spike loads Juniper Harlow, starts a roleplay session, sends one user
message, waits for an assistant reply, then deletes the temporary OpenClaw
session.

## Scope

Implemented:

- roleplay bootstrap prompt
- first message as visible assistant opener
- lorebook v0 evaluator (constant + keyword + simple secondary-key matching)

Not implemented:

- React Native UI
- complete SillyTavern lorebook parity
- alternate greeting selection UI
- PNG metadata parsing
