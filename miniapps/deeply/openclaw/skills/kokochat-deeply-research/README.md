# kokochat-deeply-research

OpenClaw skill for the KokoChat **Deeply** mini-app's "深度调研课程" entry.
When the user fills in a topic from the "定制课程" sheet, the deeply agent
runs this skill in a single pass: a real research pass to ground the design,
then a `koko.deeply.research.plan` fenced block (the course outline). KokoChat
lands that plan straight into the course — there is no separate outline pass;
each section's material is searched live during its own lecture turn.

The skill is **prompt-only** — it has no `bin/`. Search goes through
OpenClaw's built-in `web_fetch` by fetching KokoChat's hosted search proxy
(`https://deeply.plus/deeply/search`). Fetching result pages also uses
`web_fetch`.

## Install / update

Run from the repo root:

```bash
pnpm openclaw:install
```

This copies `kokochat-deeply-research` into
`~/.openclaw/agents/deeply/workspace/skills/`, adds it to the deeply agent's
allowlist, and writes the deeply agent's tool config (`profile=minimal` and
`web_fetch`). Then restart the gateway so config + skill text get reloaded:

```bash
launchctl kickstart -k "gui/$(id -u)/ai.openclaw.gateway"
```

## Search provider

Deeply research does not depend on the user's `tools.web.search.provider`.
KokoChat-hosted search is configured on the `deeply.plus` server (Brave-backed
in production), so users do not need to store a Brave API key in their own
OpenClaw config.

If hosted search returns no results or errors out, the agent is instructed
to be honest with the user in its narration — it won't hallucinate URLs
to fill the `sources` array.

## Output schema

The agent's job per `SKILL.md` is to:

1. Search the web first via `web_fetch` on the hosted search endpoint
   (`https://deeply.plus/deeply/search?q=...`), then optionally `web_fetch`
   key result URLs — enough to understand the topic's current shape.
2. Narrate the planning in flowing Chinese (with `〔KP〕` sentinel at the end
   of each prose paragraph — see SKILL.md for why).
3. End the reply with exactly one fenced block tagged
   `koko.deeply.research.plan` containing a JSON `{ version, topic,
   courseTitle, introduction, sections: [{ index, title }] }`. No `sources`
   and no `searchHint` — those are not part of the plan.

The KokoChat client parses that plan block, lands it directly into the course
(`applyResearchPlanToCourse`), flips bootstrap to `ready`, and the user flows
into normal mainline lecture mode. Each section's sources are gathered live
when the user enters that section, governed by the lecture prompt.
