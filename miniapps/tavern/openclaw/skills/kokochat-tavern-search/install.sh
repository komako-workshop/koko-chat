#!/usr/bin/env bash
# install-tavern-skill.sh
#
# Sync this repository's tavern skill into the local OpenClaw tavern agent
# workspace and verify that the agent can see it. Idempotent.
#
# Usage:
#   bash miniapps/tavern/openclaw/skills/kokochat-tavern-search/install.sh
#
# Prerequisite: an OpenClaw `tavern` agent already exists. Create it once with:
#   openclaw agents add tavern \
#     --workspace ~/.openclaw/agents/tavern/workspace \
#     --non-interactive
# and add `"skills": ["kokochat-tavern-search"]` to the tavern agent entry in
# ~/.openclaw/openclaw.json.

set -euo pipefail

SKILL_ID="kokochat-tavern-search"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="$HOME/.openclaw/agents/tavern/workspace/skills/$SKILL_ID"

if [ ! -d "$HOME/.openclaw/agents/tavern/workspace" ]; then
  echo "tavern agent workspace not found at ~/.openclaw/agents/tavern/workspace" >&2
  echo "create the agent first: openclaw agents add tavern --workspace ~/.openclaw/agents/tavern/workspace --non-interactive" >&2
  exit 1
fi

mkdir -p "$(dirname "$TARGET_DIR")"
rsync -a --delete "$REPO_DIR/" "$TARGET_DIR/"
echo "synced $REPO_DIR -> $TARGET_DIR"

# Surface readiness so callers get an early signal if frontmatter / bins are
# wrong without having to dig into the agent's logs.
openclaw skills info "$SKILL_ID" --agent tavern
