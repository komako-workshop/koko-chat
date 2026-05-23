# kokochat-deeply-research

OpenClaw skill for the KokoChat **Deeply** mini-app's "深度调研课程" entry.
When the user fills in a topic from the "定制课程" sheet, the deeply agent
runs this skill to do a real research pass + emit a structured outline that
becomes the new course.

The skill is **prompt-only** — it has no `bin/`. All search and fetch goes
through OpenClaw's built-in `web_search` and `web_fetch` tools (configured
globally via `tools.web.search.provider`, default Brave). The deeply agent
gets these tools enabled via `alsoAllow: ["web_search", "web_fetch"]` in
`install-openclaw-support.mjs`.

## Install / update

Run from the repo root:

```bash
pnpm openclaw:install
```

This copies `SKILL.md` into `~/.openclaw/agents/deeply/workspace/skills/
kokochat-deeply-research/`, adds the skill to the deeply agent's allowlist,
and writes the deeply agent's tool config (profile=minimal + alsoAllow web
tools). Then restart the gateway so config + skill text get reloaded:

```bash
launchctl kickstart -k "gui/$(id -u)/ai.openclaw.gateway"
```

## Search provider

Web search runs against whatever `tools.web.search.provider` is set to in
`~/.openclaw/openclaw.json` — the default is **Brave Search**. To change
the provider (e.g. to Tavily, Exa, etc.), edit that file's `tools.web`
section per the OpenClaw docs. The skill itself stays neutral; it just
calls `web_search` and lets the gateway pick the provider.

If `web_search` returns no results or errors out, the agent is instructed
to be honest with the user in its narration — it won't hallucinate URLs
to fill the `sources` array.

## Output schema

The agent's job per `SKILL.md` is to:

1. Narrate the research process in flowing Chinese (with `〔KP〕` sentinel
   at the end of each prose paragraph — see SKILL.md for why).
2. Call `web_search` 1–3 times (and optionally `web_fetch` on key URLs)
   to gather real sources.
3. End the reply with exactly one fenced block tagged
   `koko.deeply.research.outline` containing a JSON `{ courseTitle,
   introduction, sections, outlineMarkdown, sources }`. Every `url` in
   `sources` must come from a real `web_search` / `web_fetch` result.

The KokoChat client (`miniapps/deeply/mobile/parseResearchOutline.ts`)
parses that fenced block, writes the outline + sources to mini-app storage,
flips the conversation bootstrap to `ready`, and the user flows into normal
mainline lecture mode — where each lecture can cite back to the sources
via markdown links.
