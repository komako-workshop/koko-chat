# kokochat-search

OpenClaw-side wrapper for KokoChat's hosted search API. This is an optional
standalone skill for agents that want hosted web search without shipping a
Brave / Tavily / Serper key on the user's machine. KokoChat's built-in Deeply
agent now calls the same hosted API directly through OpenClaw's built-in
`web_fetch`, so the main KokoChat installer does not install this wrapper.

Also published on ClawHub so any OpenClaw user can install it standalone:

```bash
openclaw skills install kokochat-search --agent <your-agent>
```

After install, allowlist `bin/search.mjs` via `openclaw approvals` so the agent
is allowed to exec it.

The wrapper lives in `bin/search.mjs` and calls:

```text
POST https://deeply.plus/deeply/search
```

with:

```json
{ "query": "AI investor outlook 2026", "count": 5 }
```

The Brave API key is configured only on the `deeply.plus` server.

Optional env for development / private deployments:

- `KOKO_SEARCH_API_BASE` (preferred) — override API base, e.g.
  `http://127.0.0.1:8788`.
- `KOKO_DEEPLY_SEARCH_BASE` — legacy alias kept for backwards compat.
- `KOKO_SEARCH_TOKEN` (preferred) or `KOKO_DEEPLY_SEARCH_TOKEN` — Bearer
  token if the hosted endpoint requires one.
