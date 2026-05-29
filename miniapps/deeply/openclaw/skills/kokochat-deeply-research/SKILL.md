---
name: kokochat-deeply-research
version: 0.5.0
description: "Deep-research course generator for the KokoChat Deeply mini-app. Phase A side of a two-phase pipeline: do light exploratory web search via `web_fetch`, narrate the planning in Chinese prose, and emit one `koko.deeply.research.plan` fenced block (courseTitle + introduction + sections with title and searchHint). Phase B runs as a separate inference that searches per-section and turns the plan into the course outline. Fires when the user message looks like '请围绕「<topic>」做一份深度调研课程'."
author: komako-workshop
license: Apache-2.0
tags: [latest, kokochat, deeply, research, course, web-search, two-phase]
triggers:
  - 请围绕「
  - 深度调研课程
  - kokochat deeply research course
  - koko.deeply.research.notes
metadata:
  openclaw:
    emoji: "🔍"
    requires:
      capabilities:
        - network
      platforms:
        - linux
        - darwin
        - windows
---

# kokochat-deeply-research

OpenClaw side of the KokoChat **Deeply** mini-app's deep-research course path.
The user is in a `deeply-course` conversation created from the "定制课程" sheet
with `kind = "research"`.

## Two-phase pipeline (this skill is Phase A)

KokoChat splits research course generation into two model passes:

- **Phase A — this turn (the agent run you are in now)**: explore + design
  the course outline. Do light web search to calibrate your read of the
  topic (especially when it's time-sensitive — "2026 ...", named people,
  recent events), narrate your thinking in Chinese prose, then emit one
  `koko.deeply.research.plan` fenced block: `courseTitle`, `introduction`,
  and `sections` where each section has a `title` and a `searchHint`. You do
  **not** cite per-section URLs here — your attention is on *what's worth
  teaching and how to break it up*.

- **Phase B — separate `inferOnce` the client triggers right after you
  finish**: the same agent, still with `web_fetch`. Phase B reads your plan,
  runs hosted search once per section using each `searchHint`, attaches real
  sources, and emits the final `koko.deeply.research.outline` JSON. You will
  never see Phase B run; just hand off a clean plan.

This split exists because letting raw search results drive the section shape
made outlines collapse into whatever the articles happened to cover (e.g. a
"viewpoints by famous investor" topic came out as generic "bulls vs bears").
Designing the teaching structure first, then finding evidence per section,
keeps the outline aligned with what the user actually asked.

## When this skill fires

The first user message in the conversation looks exactly like:

> 请围绕「<topic>」做一份深度调研课程

(or with an explicit `N` 节 between `做一份` and `深度调研课程` when the user
chose a non-auto length in the sheet). When you see this shape, run the
procedure below. For any later user message in the same conversation, just
respond to the host's mainline prompt — KokoChat re-injects a fresh prompt on
every turn.

## What the host sends with the kickoff

KokoChat injects a Phase A kickoff prompt right before the visible user line.
That prompt is the authoritative source of truth for this turn's output
schema (`koko.deeply.research.plan`) and the prose sentinel `〔KP〕`
requirement. **Always follow what the kickoff prompt says.** Do not produce a
`koko.deeply.research.outline` block from this turn — that schema belongs to
Phase B and emitting it here will be ignored.

This skill file only adds background you need across all such turns: what
the search/fetch tools can / cannot do, and how to plan the research itself.

## Tools

The deeply agent only uses OpenClaw's built-in `web_fetch`. There is no
separate search skill or local exec wrapper to install.

### KokoChat hosted search via `web_fetch`

Run a web search by GETting the KokoChat hosted endpoint:

```
web_fetch({
  url: "https://deeply.plus/deeply/search?q=<EN keywords, urlencoded>&count=<1-10>",
  maxChars: 60000
})
```

The response body is JSON of shape
`{ ok: true, provider: "brave", query, count, results: [{ title, url, snippet }] }`.
Parse `results` and cite the real `url` values. The hosted endpoint runs on
KokoChat's `deeply.plus` server (Brave-backed in production); users do not
need any search API key in their own OpenClaw.

Args:

- `q` (string, required): EN keywords. Translate Chinese topics into English
  search keywords; keep user-facing prose Chinese.
- `count` (int 1–10, optional): default ~5; lower for targeted lookups,
  higher when scoping broadly.

Pass **only** `q` and `count`. The server ignores any other query parameter.

Quirks:

- If the JSON has `ok: false` (e.g. `search_not_configured`, `rate_limited`,
  upstream Brave 429), narrate that honestly and cite fewer sources rather
  than fabricating URLs.
- Don't batch multiple `web_fetch` searches in one assistant turn — issue
  them sequentially across narration steps.

### `web_fetch` for page content

Pull one URL's main content as readable text. Useful when a search hit
looks unusually authoritative and you want the actual body instead of just
the snippet.

Args:

- `url` (string, required).
- `maxChars` (int, optional): prefer `60000` so the model sees enough body.
  The Gateway may cap this lower.

Only fetch `http://` / `https://` URLs that came from a successful KokoChat
search. Never fetch `file://`, skill files, workspace docs, or URLs you
invented. If a fetch fails (network block, private-IP guard, challenge,
timeout), don't retry many other URLs — continue from search snippets.

## Research Planning (generic; no hard-coded domain templates)

Before searching, infer a small research plan **from the user's topic
itself**. Don't insert fixed people, organisations, industries, or examples
that the user didn't mention.

Identify:

1. **Key subjects**: people / organisations / works / events / markets /
   technologies / concepts named or implied by the topic.
2. **Time and scope**: year, geography, stage, version, comparison target,
   or other limits.
3. **Controversy structure**: mainstream view, counter-view, boundary
   conditions, common misreadings likely relevant.
4. **Best evidence types**: primary text, interview, transcript, filing,
   paper, policy document, official data, high-quality secondary synthesis.

Queries should start with the exact topic and key subjects, then expand to
counterpoints / background / more authoritative original evidence. Avoid
filling sources with broad trend pages when narrower material exists. If a
topic is very narrow, **prefer fewer real sources over more weak ones**.

## What is NOT in this skill any more

Schema, field rules, prose sentinel marker (`〔KP〕`), exact step-by-step
narration order, and the "3 hard rules" all live in the host-injected
Phase A kickoff prompt now. Treating those as the source of truth keeps this
file small and stops the model from being overwhelmed by duplicated, slightly
divergent instructions across two layers (which is exactly what caused the
2026-05-28 regression where the model emitted plausible-looking sources
without ever calling search).

The `koko.deeply.research.outline` schema (per-section sources, course
introduction, outline markdown) lives entirely in the Phase B prompt and is
**not** part of Phase A's output.
