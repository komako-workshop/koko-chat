# OpenClaw integration archive

This folder is the **single source of truth** for KokoChat-side OpenClaw
customization that lives outside `node_modules` on your Mac.

Everything here is versioned so we can:

- restore after reinstalling OpenClaw
- re-apply the same setup on another machine
- audit what KokoChat expects from the gateway / agent

## Layout

```text
openclaw/
  README.md                         ← this file
  skills/
    kokochat-pairing/
      SKILL.md                      ← canonical source; ~/.openclaw/workspace/skills/kokochat-pairing/SKILL.md
                                      should mirror this file
  patches/
    gateway-auto-approve.md         ← documented patch against the installed
                                      openclaw dist so KokoChat bootstrap-token
                                      pairing is silent auto-approve
```

## Installing on a fresh machine

1. Install OpenClaw (`pnpm add -g openclaw@^2026.5.5` or equivalent).
2. Copy `openclaw/skills/kokochat-pairing/SKILL.md` into
   `~/.openclaw/workspace/skills/kokochat-pairing/SKILL.md`.
3. Add `"kokochat-pairing"` to `agents.defaults.skills` in `~/.openclaw/openclaw.json`.
4. Apply `openclaw/patches/gateway-auto-approve.md` against the installed
   `message-handler-*.js` dist file. The filename suffix is content-hashed, so
   locate the right file with:

   ```bash
   ls ~/.npm-global/lib/node_modules/openclaw/dist/message-handler-*.js
   ```

5. `openclaw gateway restart`.
6. Sanity-check: `openclaw skills list` should show `✓ ready` for
   `kokochat-pairing`.

## Why these files are here

- **skills/kokochat-pairing/SKILL.md** is what tells the OpenClaw agent how
  to respond when the user asks "生成一个新的 KokoChat 配对码". It must stay
  in lock-step with the KokoChat pair screen UX.
- **patches/gateway-auto-approve.md** captures a two-line change to the
  bootstrap pairing handler. Without it, a newly pasted setup code sits as a
  pending request until an operator explicitly runs `openclaw devices approve
  <id>`. KokoChat is a private, single-user runtime, so this handshake is
  cognitive overhead we intentionally skip.

If you upgrade OpenClaw and the patch location / wording changes, update the
patch doc and re-apply; this directory is the only place to track that drift.
