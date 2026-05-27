# OpenClaw integration

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
      SKILL.md                      ← pairing approval skill
      generate-kokochat-code.mjs    ← device-token setup-code generator
  patches/
    gateway-auto-approve.md         ← documented patch against the installed
                                      openclaw dist so KokoChat bootstrap-token
                                      pairing is silent auto-approve
```

## Installing on a fresh machine

Use the repo-level installer instead of copying files by hand. The machine needs
`git`, `node`, and the `openclaw` CLI. KokoChat requires OpenClaw `2026.4.15`
or newer; older installs are upgraded to the fixed target `2026.5.22` before
KokoChat writes agent / skill config. On a fresh OpenClaw machine:

```bash
KOKOCHAT_REPO="${HOME}/.kokochat/koko-chat"
mkdir -p "$(dirname "$KOKOCHAT_REPO")"
if [ -d "$KOKOCHAT_REPO/.git" ]; then
  git -C "$KOKOCHAT_REPO" pull --ff-only
else
  git clone https://github.com/komako-workshop/koko-chat.git "$KOKOCHAT_REPO"
fi
node "$KOKOCHAT_REPO/scripts/install-openclaw-support.mjs"
```

When the installer upgrades OpenClaw, Gateway can briefly disconnect. Let the
script finish, then retry the same phone pairing request if the first attempt
was interrupted.

From a development checkout, the same installer is exposed as:

```bash
pnpm openclaw:install
```

The installer creates the KokoChat agents if needed and syncs:

- `openclaw/skills/kokochat-pairing` →
  `~/.openclaw/workspace/skills/kokochat-pairing`
- `miniapps/tavern/openclaw/skills/kokochat-tavern-search` →
  `~/.openclaw/agents/tavern/workspace/skills/kokochat-tavern-search`
- `miniapps/tavern/openclaw/skills/kokochat-tavern-roleplay` →
  `~/.openclaw/agents/tavern-roleplay/workspace/skills/kokochat-tavern-roleplay`
- `miniapps/deeply/openclaw/skills/kokochat-deeply-research` →
  `~/.openclaw/agents/deeply/workspace/skills/kokochat-deeply-research`

If `tools.web.search.provider` is not already configured, the installer sets it
to key-free `duckduckgo` so Deeply research works for users without search API
keys. Existing provider choices such as Brave, Tavily, or Exa are preserved.

Sanity-check manually on OpenClaw versions that support `--agent`:

```bash
openclaw skills info kokochat-pairing --agent main
openclaw skills info kokochat-tavern-search --agent tavern
openclaw skills info kokochat-tavern-roleplay --agent tavern-roleplay
openclaw skills info kokochat-deeply-research --agent deeply
```

## Why these files are here

- **skills/kokochat-pairing/SKILL.md** is what tells the OpenClaw agent how
  to approve the `kokochat.pairingRequest` payload copied from the phone.
- **skills/kokochat-pairing/generate-kokochat-code.mjs** is the deterministic
  local command that validates the pairing request, approves the device, and
  returns a device-token setup code.
- **patches/gateway-auto-approve.md** is historical context for the old
  bootstrap-token flow. New KokoChat pairing uses explicit device-token approval
  and should not need patching OpenClaw dist files.

If the device-pairing protocol changes in OpenClaw, update this directory and
the installer together. The pairing screen, pairing skill, and setup-code
generator must stay in lock-step.
