---
name: kokochat-deeply-search
version: 0.1.0
description: "KokoChat-hosted web search wrapper for the Deeply mini-app. Use only when a KokoChat Deeply prompt explicitly asks you to run the local `search.mjs` tool. It calls KokoChat's hosted search proxy, so users do not need to configure Brave or any other search API key in their own OpenClaw."
metadata: { "openclaw": { "emoji": "🔎" } }
---

# kokochat-deeply-search

This skill provides a local exec wrapper around KokoChat's hosted Deeply
search API. The user's OpenClaw does **not** store Brave API credentials; it
only runs `bin/search.mjs`, which POSTs `{ query, count }` to
`https://deeply.plus/deeply/search`.

The Deeply prompt will tell you exactly when to use it. Do not browse this
skill file during normal work; just run the command shape provided by the
host prompt.

## Tool command

```bash
{{DEEPLY_SEARCH_BIN}} '{"query":"EN keywords","count":5}'
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
