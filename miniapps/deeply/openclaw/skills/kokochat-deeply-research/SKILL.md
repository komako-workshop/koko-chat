---
name: kokochat-deeply-research
version: 0.3.0
description: "Deep-research course generator for the KokoChat Deeply mini-app. Use when the user asks to build a deep-research course on a specific topic (KokoChat sends a kickoff message of the shape '请围绕「...」做一份深度调研课程'). Use the OpenClaw built-in `web_search` and `web_fetch` tools to gather real sources, narrate the research process to the user in flowing Chinese prose, and finally emit one fenced block containing the structured outline + cited sources."
metadata: { "openclaw": { "emoji": "🔍" } }
---

# kokochat-deeply-research

OpenClaw side of the KokoChat **Deeply** mini-app's deep-research course path.
The user is in a `deeply-course` conversation created from the "定制课程" sheet
with `kind = "research"`. They want a **structured, source-cited course outline
on a possibly time-sensitive or contested topic** — anchored in real web
sources, not your training priors.

## When this skill fires

The first user message in the conversation looks exactly like:

> 请围绕「<topic>」做一份深度调研课程

(or with an explicit `N` 节 between `做一份` and `深度调研课程` when the user
chose a non-auto length in the sheet). When you see this shape, run the
procedure below. For any later user message in the same conversation, just
respond to the host's mainline prompt — KokoChat re-injects a fresh prompt on
every turn.

## What the host sends with the kickoff

KokoChat injects a kickoff prompt right before the visible user line. That
prompt is the authoritative source of truth for **this turn's hard
constraints** (5 numbered rules), the JSON output schema, and the prose
sentinel `〔KP〕` requirement. **Always follow what the kickoff prompt says.**

This skill file only adds background you need across all such turns: what
the two web tools can / cannot do, and how to plan the research itself.

## Tools

Two OpenClaw built-in web tools, both already allowed for the deeply agent.

### `web_search`

Run a web search via the gateway's configured provider. KokoChat's installer
defaults this to key-free DuckDuckGo when no provider is configured.
Returns title / url / snippet per result.

Args:

- `query` (string, required): EN keywords. Translate Chinese topics into
  English search keywords; keep user-facing prose Chinese.
- `count` (int 1–10, optional): default ~5; lower for targeted lookups,
  higher when scoping broadly.

Pass **only** `query` and `count`. Provider-specific args like
`domain_filter`, `date_after`, `freshness`, `country`, `language`,
`max_tokens` will be rejected.

Tool quirks worth knowing:

- DuckDuckGo is key-free but anti-bot sensitive. Batched / very rapid
  searches can hit a challenge page. If a search clearly returns
  bot-detection garbage instead of results, **stop searching** and synthesise
  from what you already have honestly, rather than retrying forever.
- Don't batch multiple `web_search` calls in one assistant turn — issue
  them sequentially across narration steps.

### `web_fetch`

Pull one URL's main content as readable text. Useful when a search hit
looks unusually authoritative and you want the actual body instead of just
the snippet.

Args:

- `url` (string, required).
- `maxChars` (int, optional): prefer `60000` so the model sees enough body.
  The Gateway may cap this lower.

Only fetch `http://` / `https://` URLs that came from a successful
`web_search`. Never fetch `file://`, skill files, workspace docs, or URLs
you invented. If a fetch fails (network block, private-IP guard, challenge,
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
narration order, and the "5 hard rules" all live in the host-injected
kickoff prompt now. Treating those as the source of truth keeps this file
small and stops the model from being overwhelmed by duplicated, slightly
divergent instructions across two layers (which is exactly what caused the
2026-05-28 regression where the model emitted plausible-looking sources
without ever calling `web_search`).
