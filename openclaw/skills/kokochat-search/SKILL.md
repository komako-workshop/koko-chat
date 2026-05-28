---
name: kokochat-search
version: 0.2.0
description: "KokoChat-hosted web search wrapper. Any KokoChat mini-app (Deeply, Koko, …) can route web search through this skill instead of using OpenClaw's built-in `web_search`. It POSTs to KokoChat's hosted search proxy, so users do not need to configure Brave or any other search API key in their own OpenClaw."
metadata: { "openclaw": { "emoji": "🔎" } }
---

# kokochat-search

This skill provides a local exec wrapper around KokoChat's hosted search API.
The user's OpenClaw does **not** store Brave (or any other search) API
credentials; it only runs `bin/search.mjs`, which POSTs `{ query, count }` to
the KokoChat search endpoint (default `https://deeply.plus/deeply/search`,
override via `KOKO_SEARCH_API_BASE`).

The host prompt (Deeply, Koko, etc.) tells you exactly when to use it. Do not
browse this skill file during normal work; just run the command shape the
host prompt gives you.

## Tool command

```bash
{{KOKOCHAT_SEARCH_BIN}} '{"query":"EN keywords","count":5}'
```

Input:

- `query` (string, required): concise English keywords.
- `count` (number, optional): 1-10, default 5.

Output:

```json
{
  "ok": true,
  "provider": "brave",
  "query": "...",
  "requestedCount": 5,
  "count": 5,
  "results": [
    { "title": "...", "url": "https://...", "snippet": "..." }
  ]
}
```

If `ok` is false, be honest in the visible narration and do not invent URLs.
