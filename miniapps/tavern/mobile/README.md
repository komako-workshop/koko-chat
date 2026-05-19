# Tavern Mini-App

The KokoChat Tavern mini-app — "酒馆助手". Helps the user discover real
Character Tavern character cards through a chat-driven recommendation loop.

## Files

- `index.ts` — registers the mini-app, the outbound builder, and the
  agent-response transformer plus the single-card block renderer.
- `parseRecommendations.ts` — strict parser/validator for the
  `koko.tavern.recommendations` fenced block produced by the OpenClaw skill.
- `RecommendationsBlock.tsx` — UI for the validated recommendation list.
- `package.json` / `tsconfig.json` — declares this folder as a workspace
  package so it can be type-checked on its own. Path alias `@/*` points at the
  KokoChat host's `sources/` while the mini-app still ships inside the
  KokoChat repo; when this folder moves to a standalone repo, that alias
  becomes a thin published interface.
- `README.md` — this file.

## Where the work lives

```text
KokoChat (this folder)        OpenClaw (~/.openclaw/agents/tavern/...)
─────────────────────         ──────────────────────────────────────────
user input + UI         ─►    persistent tavern agent session
                                  └─► kokochat-tavern-search skill
                                          └─► bin/search-cards.mjs
                                                  └─► character-tavern.com
agent response           ◄─    fenced recommendations block
parse + validate
expand into chat bubbles + character cards
```

KokoChat stays UI-shaped. Searching, fetching, parsing the upstream catalog,
ranking and translating live in the OpenClaw skill. The mini-app only knows
about the fenced block contract.

## Prerequisites on the OpenClaw side

A one-time setup creates the dedicated `tavern` agent and installs the skill:

```bash
openclaw agents add tavern \
  --workspace ~/.openclaw/agents/tavern/workspace \
  --non-interactive

# Add `"skills": ["kokochat-tavern-search"]` to the tavern entry in
# ~/.openclaw/openclaw.json, then sync the skill files:

bash miniapps/tavern/openclaw/skills/kokochat-tavern-search/install.sh
```

The mini-app declares both `requiredSkills` and `requiredCoreTools` in its
descriptor so a future host-side self-test can detect missing prerequisites.

## End-to-end smoke test (no app launch)

Run the spike script against the live Gateway:

```bash
node miniapps/tavern/scripts/spike-tavern-skill.mjs
```

It opens a fresh `agent:tavern:kokochat:tavern:spike-...` session, sends a
canned user prompt, waits for the run, parses the recommendations block, and
prints the picked cards. The same parser/validator is used in production via
`parseTavernRecommendations`.

## Parser unit tests

Pure-string tests for `parseTavernRecommendations`, no Gateway needed:

```bash
bash miniapps/tavern/scripts/test-tavern-parse.sh
```

## What this mini-app intentionally does not do

- It does not call `character-tavern.com` from the phone.
- It does not parse SillyTavern PNG metadata.
- It does not seed roleplay sessions from picked cards. That is the next
  feature; it needs a separate "import card" skill before it can land cleanly.
- It does not customize the chat input bar, scroll behavior, or system prompt
  shown to the user. The host conversation surface renders the messages and
  blocks straight.
