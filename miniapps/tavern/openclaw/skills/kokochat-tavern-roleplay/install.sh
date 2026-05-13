#!/usr/bin/env bash
set -euo pipefail

SKILL_ID="kokochat-tavern-roleplay"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="$HOME/.openclaw/agents/tavern-roleplay/workspace/skills/$SKILL_ID"

if [ ! -d "$HOME/.openclaw/agents/tavern-roleplay/workspace" ]; then
  echo "tavern-roleplay agent workspace not found" >&2
  echo "create it: openclaw agents add tavern-roleplay --workspace ~/.openclaw/agents/tavern-roleplay/workspace --non-interactive" >&2
  exit 1
fi

mkdir -p "$(dirname "$TARGET_DIR")"
rsync -a --delete "$REPO_DIR/" "$TARGET_DIR/"
echo "synced $REPO_DIR -> $TARGET_DIR"
openclaw skills info "$SKILL_ID" --agent tavern-roleplay
