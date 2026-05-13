# kokochat-tavern-search

OpenClaw skill for the KokoChat **Tavern** mini-app. Helps the agent recommend
real Character Tavern character cards to the user.

## Layout

```text
SKILL.md                     agent-facing instructions and output contract
bin/
  search-cards.mjs           Node CLI that hits Character Tavern's catalog
                             endpoint and returns a normalized JSON envelope
  fetch-card.mjs             Node CLI that fetches one full Character Tavern
                             detail record for roleplay session bootstrapping
README.md                    this file
```

## Why a bin script

Discovery against character-tavern.com is deterministic: a single GET request
to the public catalog endpoint returns a Meilisearch-shaped JSON payload with
all the fields KokoChat needs. Letting the agent improvise that fetch through
generic `web_fetch` would be slower, less reliable, and harder to maintain when
the upstream shape changes. Putting it in a tiny Node script keeps the protocol
between agent and skill at the JSON-in / JSON-out level and lets us upgrade the
implementation without touching the prompt.

## Install

The repository copy is the source of truth. The skill must live in the
`tavern` agent's OpenClaw workspace before the agent can see it. The included
installer script handles the rsync + readiness check:

```bash
bash miniapps/tavern/openclaw/skills/kokochat-tavern-search/install.sh
```

Prerequisite: an OpenClaw `tavern` agent must already exist. Create it once
with:

```bash
openclaw agents add tavern \
  --workspace ~/.openclaw/agents/tavern/workspace \
  --non-interactive
```

Then add `"skills": ["kokochat-tavern-search"]` to the tavern agent entry in
`~/.openclaw/openclaw.json`. After the next gateway restart, the skill should
be visible to the tavern agent.

## Tool contract

### search-cards

Input (single-line JSON, via argv or stdin):

```json
{
  "query": "detective female",
  "tags": ["detective"],
  "excludeTags": [],
  "limit": 20,
  "sort": "most_popular",
  "includeNsfw": false
}
```

Output (single-line JSON on stdout):

```json
{
  "ok": true,
  "query": "detective female",
  "totalHits": 180,
  "candidates": [{ "pageUrl": "...", "imageUrl": "...", "name": "...", "...": "..." }]
}
```

On failure, `{ "ok": false, "error": "..." }` and exit code 1.

## Manual smoke test

```bash
node miniapps/tavern/openclaw/skills/kokochat-tavern-search/bin/search-cards.mjs \
  '{"query":"cold detective","limit":3}' | jq .
```

Expect `ok: true` and 3 candidates with non-empty `pageUrl` / `imageUrl`.

### fetch-card

Input:

```json
{ "path": "corbinbear/juniper_harlow__detective" }
```

or:

```json
{ "pageUrl": "https://character-tavern.com/character/corbinbear/juniper_harlow__detective" }
```

Output:

```json
{
  "ok": true,
  "card": {
    "path": "author/slug",
    "imageUrl": "https://cards.character-tavern.com/author/slug.png",
    "data": {
      "name": "...",
      "description": "...",
      "personality": "...",
      "scenario": "...",
      "first_mes": "...",
      "mes_example": "...",
      "system_prompt": "...",
      "post_history_instructions": "...",
      "alternate_greetings": [],
      "character_book": null
    }
  }
}
```

Manual smoke test:

```bash
node miniapps/tavern/openclaw/skills/kokochat-tavern-search/bin/fetch-card.mjs \
  '{"path":"corbinbear/juniper_harlow__detective"}' | jq .
```
