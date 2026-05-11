# OpenClaw Core Tools For KokoChat Mini-Apps

> Date: 2026-05-11
> Status: developer reference for choosing mini-app agent capabilities

This document describes the **core tools** that OpenClaw exposes independently
of optional skills. Optional skills vary by user installation; core tools are
the more stable baseline to consider when designing a KokoChat mini-app agent.

Important distinction:

```text
Core tools = OpenClaw built-in tool surfaces such as files, web, sessions, media.
Skills     = optional capability packages described by SKILL.md and config.
```

For KokoChat mini-apps, prefer a narrow per-agent capability set. Do not give a
mini-app every tool by default just because OpenClaw supports it.

## How To Use This Document

When designing a mini-app agent, choose:

1. A mini-app-specific agent id, usually the mini-app id.
2. A small set of OpenClaw skills, if any.
3. A small core tool profile or individual core tool set, once KokoChat supports
   configuring that side.

Today KokoChat already supports per-mini-app `defaultAgentId` and
`requiredSkills` metadata. It does not yet configure core tool profiles for an
agent. This document is still useful for deciding what each future mini-app
agent should be allowed to use.

## Profiles Reported By OpenClaw

The current Gateway exposes these default core tool profiles:

| Profile | Meaning |
| --- | --- |
| `minimal` | Smallest baseline. Currently includes session status. |
| `coding` | File, shell, web, memory, sessions, planning, and media tools useful for work agents. |
| `messaging` | Cross-session / messaging surfaces. |
| `full` | Broad profile. Avoid as a default for mini-app agents. |

The profile names are OpenClaw-defined. Treat them as runtime capability groups,
not as KokoChat mini-app modes.

## Files

| Tool | Description | Default Profiles | Mini-App Guidance |
| --- | --- | --- | --- |
| `read` | Read file contents | `coding` | Useful for mini-apps that inspect local documents, project files, imported cards, or cached artifacts. Avoid for pure chat/recommendation mini-apps unless needed. |
| `write` | Create or overwrite files | `coding` | Use only for mini-apps that intentionally create local artifacts. Prefer mini-app storage or OpenClaw data folders over arbitrary workspace writes. |
| `edit` | Make precise edits | `coding` | Mostly for coding/document mini-apps. Not needed for discovery/chat surfaces. |
| `apply_patch` | Patch files | `coding` | Coding-agent style workflows only. Do not expose to normal content mini-apps. |

## Runtime

| Tool | Description | Default Profiles | Mini-App Guidance |
| --- | --- | --- | --- |
| `exec` | Run shell commands that start now | `coding` | Powerful and risky. Use for mini-apps that need local CLIs or custom scripts. Prefer wrapping product logic in a dedicated skill/tool so the agent does not improvise shell commands. |
| `process` | Inspect and control running exec sessions | `coding` | Only needed when the mini-app starts long-running shell jobs. |
| `code_execution` | Run sandboxed remote analysis | `coding` | Useful for analysis/code mini-apps. Usually not needed for product discovery flows. |

## Web

| Tool | Description | Default Profiles | Mini-App Guidance |
| --- | --- | --- | --- |
| `web_search` | Search the web | `coding` | Useful for discovery mini-apps. Prefer a domain-specific skill when output structure matters. |
| `web_fetch` | Fetch web content | `coding` | Useful when the Mac/OpenClaw network should fetch pages instead of the phone. For stable product flows, hide fetch/parse details inside a skill. |
| `x_search` | Search X posts | `coding` | Only expose for social/current-events mini-apps that explicitly need X. |

For Tavern-style roleplay discovery, the agent should use a business skill such
as `kokochat-tavern-search`. That skill may depend on `web_search` / `web_fetch`
internally or expect those core tools in the Tavern agent policy, but KokoChat
UI code should not ask a generic agent to manually browse from prompt text.

## Memory

| Tool | Description | Default Profiles | Mini-App Guidance |
| --- | --- | --- | --- |
| `memory_search` | Semantic search | `coding` | Useful if the mini-app intentionally consults user memory. Avoid by default to reduce cross-product leakage from the main assistant. |
| `memory_get` | Read memory files | `coding` | Same caution as `memory_search`. Prefer explicit user consent or a future context bridge. |

Memory tools are powerful but blur product boundaries. A roleplay/tavern agent
should not automatically read the user's main-agent memory unless that is an
explicit product feature.

## Sessions

| Tool | Description | Default Profiles | Mini-App Guidance |
| --- | --- | --- | --- |
| `sessions_list` | List visible sessions with mailbox filters and optional previews | `coding`, `messaging` | Useful for orchestration or inbox-style products. Not needed for normal mini-app conversations. |
| `sessions_history` | Read sanitized message history for a visible session | `coding`, `messaging` | Use only when a mini-app intentionally references other conversations. |
| `sessions_send` | Send a message to another visible session | `coding`, `messaging` | Orchestration only. Avoid for ordinary mini-apps to prevent accidental cross-conversation actions. |
| `sessions_spawn` | Spawn sub-agent or ACP sessions | `coding` | Advanced multi-agent workflows. Useful for Manus/Codex-like apps, not for simple mini-apps. |
| `sessions_yield` | End turn to receive sub-agent results | `coding` | Pair with `sessions_spawn`. |
| `subagents` | Manage sub-agents | `coding` | Advanced workflows only. |
| `session_status` | Show session status, usage, and model state | `minimal`, `coding`, `messaging` | Safe baseline diagnostic capability. |

KokoChat itself already manages mini-app conversation sessions. Do not expose
cross-session tools unless the mini-app is explicitly an orchestrator.

## UI

| Tool | Description | Default Profiles | Mini-App Guidance |
| --- | --- | --- | --- |
| `browser` | Control web browser | none | Useful for browser automation / visual scraping. Prefer `web_fetch` for simple fetching. |
| `canvas` | Control canvases | none | Use only for mini-apps that produce or manage canvas artifacts. |

## Messaging

| Tool | Description | Default Profiles | Mini-App Guidance |
| --- | --- | --- | --- |
| `message` | Send messages | `messaging` | Only for communication/channel mini-apps. Do not expose to discovery or content mini-apps by default. |

## Automation

| Tool | Description | Default Profiles | Mini-App Guidance |
| --- | --- | --- | --- |
| `heartbeat_respond` | Record heartbeat outcomes | none | Internal/automation. Not a normal mini-app tool. |
| `cron` | Schedule cron jobs, reminders, and wake events | `coding` | Use only for mini-apps with scheduled background behavior. |
| `gateway` | Gateway control | none | Admin-level. Avoid exposing to product mini-app agents unless the mini-app is an admin tool. |

## Nodes

| Tool | Description | Default Profiles | Mini-App Guidance |
| --- | --- | --- | --- |
| `nodes` | Nodes + devices | none | Device management mini-apps only. |

## Agents

| Tool | Description | Default Profiles | Mini-App Guidance |
| --- | --- | --- | --- |
| `agents_list` | List agents | none | Useful for dev/admin mini-apps. Not needed for product mini-apps. |
| `update_plan` | Track a short structured work plan | `coding` | Useful for multi-step task mini-apps. Not needed for simple chat/recommendation flows. |

## Media

| Tool | Description | Default Profiles | Mini-App Guidance |
| --- | --- | --- | --- |
| `image` | Image understanding | `coding` | Useful for image-based mini-apps or card/image import flows. |
| `image_generate` | Image generation | `coding` | Creative mini-apps only. |
| `music_generate` | Music generation | `coding` | Creative/music mini-apps only. |
| `video_generate` | Video generation | `coding` | Creative/video mini-apps only. |
| `tts` | Text-to-speech conversion | none | Voice/story/roleplay mini-apps may opt in. |

## Recommended Baselines

### Pure Chat Mini-App

```text
Core tools: session_status only, or none if OpenClaw supports no-tool agents.
Skills: mini-app-specific prompt/skill only.
```

### Discovery / Search Mini-App

```text
Core tools: web_search, web_fetch
Skills: one domain-specific skill that defines output contract
```

Example: Tavern should expose `kokochat-tavern-search` to the Tavern agent. If
that skill needs live web access, include `web_search` + `web_fetch` in the
agent's expected core tool set. The KokoChat prompt should express the user's
intent, not page-fetching instructions.

### Local File / Import Mini-App

```text
Core tools: read, maybe image
Skills: parser/import skill
```

Avoid `write` unless the mini-app intentionally persists artifacts on the Mac.

### Coding / Manus-Style Mini-App

```text
Core tools: read, write, edit, apply_patch, exec, process, web_search, web_fetch,
sessions_spawn, sessions_yield, update_plan
Skills: coding/product-specific skills
```

This is the broadest class and should not be used as the default pattern for all
mini-apps.

### Scheduled / Background Mini-App

```text
Core tools: cron, session_status
Skills: product-specific task skill
```

Use carefully. Background behavior should be explicit and user-visible.

## Practical Rule

For each mini-app agent, start from the smallest possible capability set:

```text
1. one mini-app-specific skill
2. add one or two core tools only when the skill cannot hide that complexity
3. avoid memory, sessions, shell, and messaging unless they are central to the product
```

This keeps prompts smaller, reduces tool-selection mistakes, and protects the
main assistant from product-specific behavior.
