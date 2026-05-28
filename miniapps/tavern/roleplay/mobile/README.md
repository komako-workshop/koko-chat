# Tavern Roleplay Mini-App

Open a long-running roleplay chat with a real Character Tavern card. The user
never opens this mini-app directly — the only entry is tapping a recommended
card inside the Tavern (酒馆助手) conversation.

## Files

- `index.ts` — registers the mini-app, the outbound builder, and exposes
  `startTavernRoleplaySession(card)` for the Tavern recommendations renderer.
- `package.json` / `tsconfig.json` — workspace package wiring.
- `README.md` — this file.

## Where the work lives

```text
KokoChat (this folder)         OpenClaw (~/.openclaw/agents/tavern-roleplay/...)
─────────────────────          ─────────────────────────────────────────────────
recommendation tap       ─►    nothing yet
fetch full card via            
  character-tavern.com         
translate first_mes      ─►    inferOnce -> tavern-roleplay agent
create conversation      
insert localized first_mes
locally
user sends turn 1        ─►    chat.send (bootstrap-prefixed) -> tavern-roleplay
                                  └─► kokochat-tavern-roleplay skill
                                  └─► reply in character (Chinese)
user sends turn 2+       ─►    chat.send (visibleText only)
```

The agent reads the inlined card JSON on the very first user message and is
expected to keep that binding for the rest of the conversation. The bootstrap
prefix is hidden from the chat UI: it lives only inside the Gateway transcript.

## Prerequisites on the OpenClaw side

```bash
openclaw agents add tavern-roleplay \
  --workspace ~/.openclaw/agents/tavern-roleplay/workspace \
  --non-interactive

# Add `"skills": ["kokochat-tavern-roleplay"]` to the tavern-roleplay agent
# entry in ~/.openclaw/openclaw.json, then:

bash miniapps/tavern/openclaw/skills/kokochat-tavern-roleplay/install.sh
```

The mini-app declares both `requiredSkills` and `requiredCoreTools` in its
descriptor so a future host-side self-test can detect missing prerequisites.

## What this mini-app does not do (yet)

- It does not parse SillyTavern PNG metadata. Only the public Character Tavern
  detail endpoint is consumed.
- It does not implement full SillyTavern Lorebook activation. The `character_book`
  field is forwarded to the agent inside the bootstrap JSON, and the
  `kokochat-tavern-roleplay` skill is responsible for any in-the-loop
  behaviour. KokoChat does not run a deterministic lorebook evaluator yet.
- It does not surface alternate greetings, swipe regeneration, or scenario
  overrides in the UI.
- It does not show in the launcher. The Tavern recommendations renderer is the
  only way in.
