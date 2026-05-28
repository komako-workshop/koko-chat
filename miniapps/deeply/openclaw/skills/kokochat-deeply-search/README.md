# kokochat-deeply-search

OpenClaw-side wrapper for KokoChat's hosted Deeply search API.

The wrapper lives in `bin/search.mjs` and calls:

```text
POST https://deeply.plus/deeply/search
```

with:

```json
{ "query": "AI investor outlook 2026", "count": 5 }
```

The Brave API key is configured only on the `deeply.plus` server. User
OpenClaw installs this wrapper via `scripts/install-openclaw-support.mjs`.

Optional env for development:

- `KOKO_DEEPLY_SEARCH_BASE`: override API base, e.g. `http://127.0.0.1:8788`.
- `KOKO_DEEPLY_SEARCH_TOKEN`: Bearer token if the server requires one.
