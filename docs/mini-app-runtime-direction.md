# KokoChat Mini-App Runtime Direction

> Date: 2026-05-11
> Status: architecture note, not a stable SDK contract
> Audience: KokoChat host / built-in mini-app developers

This note records the current direction for KokoChat mini-app development before
we build more mini-apps. It intentionally avoids over-defining a public plugin
SDK. The first version remains built-in mini-apps shipped by us with the mobile
app package.

## Product Position

KokoChat is a mobile conversation host for OpenClaw-backed mini-apps.

For v1, a mini-app is not a dynamically loaded React Native module. A mini-app
is a built-in product surface that can:

- create and open KokoChat conversations
- call OpenClaw for one-shot inference
- open long-lived OpenClaw agent sessions
- store its own data outside shared conversation metadata
- render its own UI inside the mobile app package

The host should not over-abstract UI. A future mini-app might look like
Character.AI, Codex, Manus, a reader, or a feed. Those products need very
different interfaces. The first stable host surface should be the OpenClaw
runtime bridge and conversation lifecycle, not a component library.

## Core Runtime Primitives

The two OpenClaw primitives we need first are:

### 1. One-Shot Inference

One-shot inference is a short-lived OpenClaw agent call.

Product meaning:

```text
mini-app provides a prompt -> OpenClaw returns a result -> mini-app decides how to use it
```

Typical uses:

- recommendation
- classification
- summarization
- rewriting
- planning
- extracting structured-ish data
- validating imported content

Current OpenClaw does not expose a clean `llm.complete` / `infer.once` RPC. We
can implement v0 on top of existing Gateway methods:

```text
chat.send temporary session
agent.wait runId
chat.history temporary session
sessions.delete temporary session
```

This is not a pure LLM API. It is a temporary OpenClaw agent session. The agent
may use any tool or memory available to that agent. Deleting the session removes
the visible OpenClaw session entry and archives its transcript, but it does not
rollback side effects such as memory writes, files, plugin calls, or external
actions.

Therefore v0 docs should describe it as:

```text
temporary OpenClaw agent call
```

not:

```text
stateless LLM API call
```

### 2. Stateful Agent Session

A stateful agent session is a long-lived OpenClaw session attached to a
KokoChat conversation or mini-app surface.

Product meaning:

```text
one sessionKey -> persistent agent transcript -> repeated send / wait / history
```

Current validation shows `sessionKey` isolates OpenClaw history correctly. The
agent id is encoded in the session key:

```text
agent:<agentId>:kokochat:<miniAppId>:<scope>
```

The runtime should provide helpers for:

- creating a session
- sending a message
- waiting for a run
- reading history
- aborting a run
- deleting a session

## What We Are Not Defining Yet

### No Context Bridge Yet

Mini-app developers should compose their own context strings for now. This is
more flexible while product shapes are still unknown.

For example, a roleplay mini-app can decide how to combine:

- character card
- world state
- user preference
- previous summary
- visible user message

The host should not introduce a rigid context segment model until multiple
mini-apps prove the repeated shape.

### No Dynamic React Native Mini-Apps

We should not load arbitrary React Native bundles at runtime.

Reasons:

- native app review risk
- weak sandboxing
- React Native / Expo version compatibility risk
- crash isolation risk
- unclear permission and signing model

Built-in mini-apps remain the v1 path.

### No UI Component SDK Yet

The host should expose minimal bridge capabilities, not a full UI toolkit.

Mini-app UI can be custom-built in the app package for v1. Shared UI primitives
can emerge later only when repeated use is clear.

## Future Dynamic Mini-App Direction

If KokoChat later supports installing new mini-apps without rebuilding the
mobile app, the most realistic path is a WebView mini-app runtime, inspired by
WeChat Mini Programs.

WeChat's relevant ideas:

- host app owns the runtime
- mini-app package is interpreted resources, not native code
- package has a manifest and pages
- host exposes APIs through a controlled bridge
- resources can be loaded on demand
- permissions and lifecycle are host-controlled

For KokoChat, the future equivalent could be:

```text
KokoChat native shell
  - conversation list
  - base chat UI
  - settings / pairing
  - MiniApp WebView Runtime
  - KokoChat bridge

OpenClaw
  - installs mini-app repo
  - serves web bundle
  - installs skills
  - owns mini-app data folders
  - runs agent sessions / one-shot calls
```

A future mini-app repo might contain:

```text
kokochat-miniapp.json
web/
  index.html
  assets/
skills/
  kokochat-example/
    SKILL.md
data/
scripts/
```

The WebView page must not receive the OpenClaw Gateway token directly. It should
only call a narrow native bridge such as:

```text
KokoChat.invoke("inferOnce", ...)
KokoChat.invoke("agentSession.send", ...)
KokoChat.invoke("conversation.create", ...)
KokoChat.invoke("storage.get", ...)
```

This is a future direction only. The current v1 remains built-in mini-apps.

## OpenClaw Skill Installation Direction

It is reasonable for KokoChat to install OpenClaw-side mini-app capabilities by
asking OpenClaw to clone an open-source Git repository and place files into
known directories.

The installable part should be OpenClaw-side capability, not mobile native UI:

- skills
- prompts
- parsers
- data folders
- schemas
- install / verify scripts
- manifest

First-party v1 can ship mobile UI in KokoChat while installing OpenClaw skills
and data from repo or bundled source.

Longer term, a mini-app manifest can declare:

- mini-app id
- display name
- required OpenClaw version
- required KokoChat version
- required skills
- preferred agent id
- storage namespace
- built-in UI id or web entry

## Design Guardrails

- Keep OpenClaw runtime helpers independent from any specific mini-app.
- Do not bake `tavern`, `roleplay`, or any product-specific context rules into
  runtime helpers.
- Keep prompt construction in mini-app code for now.
- Keep UI dynamic-loading out of v1.
- Keep conversation metadata small: pointers and list snapshots only.
- Do not expose OpenClaw Gateway tokens to future WebView mini-apps.
- Treat one-shot inference as an agent call with possible side effects, not as a
  pure stateless LLM API.

## Immediate Implementation Plan

Add an internal KokoChat OpenClaw runtime wrapper with these primitives:

```text
inferOnce
createAgentSession
sendAgentMessage
waitForAgentRun
readAgentHistory
abortAgentRun
deleteAgentSession
buildKokoChatSessionKey
```

This wrapper is an internal runtime contract for built-in mini-apps. It is not a
public SDK boundary yet.
