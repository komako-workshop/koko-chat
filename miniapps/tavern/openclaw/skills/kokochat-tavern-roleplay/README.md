# kokochat-tavern-roleplay

OpenClaw skill for KokoChat Tavern roleplay sessions.

The skill teaches the `tavern-roleplay` agent how to read a bound Character
Tavern card JSON file from its workspace and then reply as that character.

## Install

```bash
bash miniapps/tavern/openclaw/skills/kokochat-tavern-roleplay/install.sh
```

Prerequisite: the `tavern-roleplay` agent exists and its `skills` allowlist in
`~/.openclaw/openclaw.json` includes `kokochat-tavern-roleplay`.

## Runtime convention

Card files live under the agent workspace:

```text
~/.openclaw/agents/tavern-roleplay/workspace/cards/<safe-card-id>.json
```

Session bootstrap message tells the agent which file to read and requires an
exact `READY:<character name>` reply. The KokoChat client displays `first_mes`
locally and then sends normal user messages to the same OpenClaw session.
