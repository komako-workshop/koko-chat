# KokoChat Mini-Apps And OpenClaw Skills

> Date: 2026-05-11
> Status: v0 integration note. This documents the current expected shape; it is
> not a stable public plugin contract.

This document explains how a KokoChat mini-app should get product-specific
OpenClaw capability, such as "search Character Tavern cards" or "inspect a
workspace".

Short version:

```text
KokoChat owns mobile UI and conversation lifecycle.
OpenClaw owns network/tool/file/agent capability.
Mini-apps declare which OpenClaw agent + skills they expect.
```

For OpenClaw built-in **core tools** such as web fetch, file read, shell exec,
sessions, memory, and media, see `docs/openclaw-core-tools-for-mini-apps.md`.
Those are separate from optional skills and are usually the more stable baseline
when designing a mini-app agent.

## Boundary

KokoChat mobile code should not implement capability that naturally belongs on
the Mac / OpenClaw side.

Examples that belong on OpenClaw:

- web search / fetch / scraping
- calling local CLIs
- reading or writing files
- parsing large external artifacts
- long-running tool workflows
- anything that needs the Mac network environment

Examples that belong in KokoChat:

- mobile navigation
- conversation creation
- rendering cards / forms / custom UI
- turning validated OpenClaw output into local UI state
- storing mobile-side mini-app state

This matters for a mini-app like Tavern: searching character-tavern.com should
be an OpenClaw-side skill/tool, while KokoChat should render the results and
manage the conversation.

## Skills Are Agent-Visible, Not Request-Visible

Current OpenClaw Gateway methods used by KokoChat do not expose a request-level
`skills` parameter.

That means this is **not** the current model:

```ts
inferOnce({ miniAppId: "tavern", skills: ["kokochat-tavern-search"], prompt })
```

The current model is:

```text
agent has skills available -> mini-app sends prompt to that agent -> agent may use those skills
```

So a mini-app declares its OpenClaw expectations in its descriptor:

```ts
registerMiniApp({
  id: "tavern",
  displayName: "Tavern",
  openclaw: {
    defaultAgentId: "tavern",
    requiredSkills: ["kokochat-tavern-search"],
    requiredCoreTools: ["web_search", "web_fetch"],
    localSkillDirs: ["openclaw/skills/kokochat-tavern-search"]
  }
});
```

The descriptor is documentation + future readiness metadata. It does not yet
install the agent or skill automatically.

Field meaning:

- `requiredSkills`: optional OpenClaw skills expected in the agent allowlist.
- `requiredCoreTools`: built-in OpenClaw tools expected for this mini-app agent.
- `localSkillDirs`: skill folders shipped with the mini-app repo. These still
  need to be copied/synced into an OpenClaw skill discovery path before the
  agent can see them.

## Agent ID Rules

Default rule:

- `claw` uses OpenClaw agent `main`.
- every other mini-app defaults to an OpenClaw agent with the same id as the
  mini-app.
- `openclaw.defaultAgentId` overrides that default.
- an explicit `agentId` passed to `inferOnce` or `createAgentSession` wins.

Examples:

```text
claw    -> agent:main:kokochat:claw:<scope>
tavern  -> agent:tavern:kokochat:tavern:<scope>
book    -> agent:book:kokochat:book:<scope>
```

This keeps product-specific prompts, transcripts, and tool use out of the
user's main assistant by default. A mini-app that intentionally augments the
main assistant can explicitly set `defaultAgentId: "main"`.

## Product Capabilities Should Be Agent Skills

Do not implement a real mini-app capability by asking a generic agent to "try to
use the web" from prompt text alone. That is not the KokoChat integration model.

For Tavern, the correct shape is:

```text
KokoChat Tavern UI
  -> inferOnce({ miniAppId: "tavern", prompt })
  -> agent:tavern:kokochat:tavern:<scope>
  -> tavern agent
  -> kokochat-tavern-search skill/tool
  -> validated structured result
  -> KokoChat renders cards
```

Prompt text should describe the user's product intent and desired output shape;
the actual product capability should live in the OpenClaw skill/tool package.

Risks of prompt-only capability:

- the agent may not have the required web/fetch tool
- the agent may refuse or hallucinate results
- output can drift
- retry / parsing behavior is prompt-dependent
- the ability cannot be reused cleanly by another mini-app
- the product may accidentally run through the user's main agent

For first-party mini-apps, start with the agent + skill shape rather than
building a prompt-only demo that will need to be replaced.

## First-Party Skill Location

First-party KokoChat skills should live in this repository first:

```text
openclaw/skills/kokochat-<miniAppId>-<capability>/
```

Examples:

```text
openclaw/skills/kokochat-tavern-search/
openclaw/skills/kokochat-book-summary/
openclaw/skills/kokochat-codex-workspace/
```

The repository copy is the source of truth. Installing currently means copying
the skill folder into the OpenClaw workspace, usually:

```text
~/.openclaw/workspace/skills/<skill-id>/
```

and enabling it for the intended agent in OpenClaw config.

Future KokoChat installer work may automate clone / copy / config patch /
verification. That is not implemented yet.

## Tool Skill Shape

We do not yet have a blessed OpenClaw tool-registration template in this repo.
Until that is verified, use the simplest useful shape:

```text
openclaw/skills/kokochat-tavern-search/
  SKILL.md
  bin/
    tavern-search.mjs
  README.md
```

`SKILL.md` should tell the agent when and how to call the executable. The
executable should expose a small business-level JSON interface, not page-level
scraping details.

Example tool contract for Tavern search:

```text
Input:
  query: string
  tags?: string[]
  limit?: number
  safety?: "sfw" | "unknown" | "nsfw" | "any"
  locale?: "zh-CN" | "en-US"

Output:
  cards: Array<{
    id: string
    name: string
    pageUrl: string
    imageUrl?: string
    reason: string
    tags: string[]
    safety: "sfw" | "unknown" | "nsfw"
  }>
```

The KokoChat mini-app should not need to know whether this tool used a public
website, unofficial endpoint, cache file, browser automation, or another source.

## Agent / Skill Visibility

Because skills are agent-visible, check three things when a mini-app fails to
use a skill:

1. The skill folder exists in the OpenClaw workspace.
2. `openclaw skills list` / `skills.status` shows it as ready and visible.
3. The target agent is configured to see it.
4. The expected core tools are available in the agent's tool profile or policy.

Current KokoChat runtime does not yet run this readiness check automatically.
For now, use the OpenClaw CLI while developing. A future host-side self-test can
read `descriptor.openclaw.requiredSkills` / `requiredCoreTools` and report
missing capabilities.

## Local Development Loop

The reliable development loop today is:

1. Edit the repository copy of the skill.
2. Copy/sync it into `~/.openclaw/workspace/skills/<skill-id>/`.
3. Verify `openclaw skills list` shows the expected state.
4. If behavior does not change, restart the Gateway:
   ```bash
   openclaw gateway restart
   ```
5. Run KokoChat self-test or the mini-app flow.

Whether a restart is required depends on how OpenClaw reloads skill metadata in
the installed version. Treat restart as the safe path until we document a faster
reload.

## Framework Feedback From Tavern

Building the first real Tavern mini-app exposed several OpenClaw-side gaps that
KokoChat should not paper over in React Native code:

- **Agent workspaces do not share skills.** A skill installed under the main
  workspace is not automatically visible to a separate mini-app agent workspace.
  Today the practical workaround is to sync the skill folder into each agent
  workspace that needs it. Preferred OpenClaw-side fix: a CLI such as
  `openclaw skills install --to-agent <id> <skill-id>` that copies/syncs the
  skill and records what was installed.
- **Agent creation should accept skills.** Creating a mini-app agent currently
  requires a second config edit to set `agents.list[].skills`. Preferred shape:
  `openclaw agents add tavern --workspace ... --skills kokochat-tavern-search --non-interactive`.
- **Skill scripts need a portable path.** SKILL.md files should not need to hard
  code `/Users/.../.openclaw/.../skills/<id>/bin/tool.mjs`. Preferred
  OpenClaw-side fix: inject `OPENCLAW_SKILL_DIR` when a skill tells the agent to
  execute a bundled script.
- **Installer belongs on OpenClaw side.** The future installer should be an
  OpenClaw skill such as `kokochat-installer`, not a KokoChat mobile function.
  It should read mini-app descriptors, create agents, sync local skill folders,
  patch skill allowlists, run readiness checks, and report back to the user.

Until these exist, first-party mini-apps may include a repo-local install script
for their OpenClaw-side setup, but that is a workaround rather than the target
developer experience.

## What KokoChat Should Not Do

- Do not expose OpenClaw Gateway tokens to mini-app code or future WebView
  mini-apps.
- Do not add request-level `skills` until OpenClaw Gateway actually supports it.
- Do not put scraping logic in React Native just because it is faster to demo.
- Do not default product mini-apps to the `main` agent unless that is the
  explicit product intent.

## Current Gap List

These are known framework gaps to fill after the first real mini-app proves the
shape:

- automatic agent readiness check from `MiniAppDescriptor.openclaw`
- automatic skill install / sync from repository to OpenClaw workspace
- `kokochat-installer` OpenClaw skill to perform mini-app OpenClaw-side setup
- a verified executable-tool skill template
- portable skill script path support such as `OPENCLAW_SKILL_DIR`
- faster skill reload guidance
- optional helper to create per-mini-app OpenClaw agents
- optional helper to configure per-agent core tool profiles / allowlists
