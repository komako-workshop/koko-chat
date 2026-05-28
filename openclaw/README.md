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

### Let OpenClaw install KokoChat support itself

If you are already inside an OpenClaw chat/CLI session on the target machine,
you can paste this request to the agent:

> Please install or update KokoChat OpenClaw support by following
> <https://github.com/komako-workshop/koko-chat/blob/main/openclaw/README.md>.
> Run the installer from the repository. Do not ask for API keys. Do not edit
> model/provider credentials. After it finishes, report the installed KokoChat
> skills and whether the deeply agent has the allowlisted
> `kokochat-search` exec tool.

The command the agent should end up running is:

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

Important: KokoChat's hosted Deeply search uses the `deeply.plus` API. Users do
**not** need a Brave Search API key in their own OpenClaw config; the installer
only installs a local `kokochat-search` wrapper (shared across mini-apps) and
an exec allowlist for it.

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
- `openclaw/skills/kokochat-search` →
  `~/.openclaw/agents/deeply/workspace/skills/kokochat-search`
  (shared skill; other mini-apps can opt in via the installer's SKILLS list,
  also published as [`kokochat-search` on ClawHub](https://clawhub.ai/komako-workshop/kokochat-search)
  so any OpenClaw user can install it standalone via
  `openclaw skills install kokochat-search`)

Deeply research search is routed through KokoChat's hosted search proxy via the
local `kokochat-search` wrapper. The user's OpenClaw does **not** need a
Brave Search API key. The installer also raises `tools.web.fetch.maxChars` and
`tools.web.fetch.maxCharsCap` to at least `60000` so Deeply can read more page
body text when it calls `web_fetch({ url, maxChars: 60000 })`.

Sanity-check manually on OpenClaw versions that support `--agent`:

```bash
openclaw skills info kokochat-pairing --agent main
openclaw skills info kokochat-tavern-search --agent tavern
openclaw skills info kokochat-tavern-roleplay --agent tavern-roleplay
openclaw skills info kokochat-deeply-research --agent deeply
openclaw skills info kokochat-search --agent deeply
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
