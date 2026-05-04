#!/usr/bin/env bash
# Install the τ-mux ↔ Claude Code bridge.
#
# Symlinks two paths into the user's Claude Code config:
#   1. `ht-bridge/`        → ~/.claude/scripts/ht-bridge   (runtime hooks)
#   2. `skills/tau-mux/`   → ~/.claude/skills/tau-mux       (instructional skill)
#
# Edits in either source land live with no rebuild — Bun re-reads the
# hook script on every invocation, and Claude Code re-reads the skill on
# every session.
#
# Run from anywhere:
#   ./claude-integration/install.sh
#
# Environment overrides:
#   CLAUDE_HOME     Root of your Claude Code config.   Default: ~/.claude
#   FORCE=1         Replace existing targets without prompting.
#   COPY=1          Copy instead of symlink (e.g. for read-only checkouts
#                   mounted on a different filesystem).
#   SKIP_HOOKS=1    Only install the skill, not the runtime hook bridge.
#   SKIP_SKILL=1    Only install the runtime hook bridge, not the skill.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
claude_home="${CLAUDE_HOME:-$HOME/.claude}"

# Generic install routine — used for both the hook bridge and the skill.
install_link() {
  local src="$1"
  local target="$2"
  local label="$3"

  if [[ ! -d "$src" ]]; then
    echo "error: $src missing — is this script in claude-integration/?" >&2
    exit 1
  fi

  mkdir -p "$(dirname "$target")"

  if [[ -e "$target" || -L "$target" ]]; then
    if [[ "${FORCE:-0}" != "1" ]]; then
      echo "warning: $target already exists."
      printf "replace? [y/N] "
      read -r reply
      case "$reply" in
        [yY]*) ;;
        *) echo "skipped: $label"; return 0 ;;
      esac
    fi
    rm -rf "$target"
  fi

  if [[ "${COPY:-0}" == "1" ]]; then
    cp -R "$src" "$target"
    echo "installed $label (copy): $target"
  else
    ln -s "$src" "$target"
    echo "installed $label (symlink): $target -> $src"
  fi
}

if [[ "${SKIP_HOOKS:-0}" != "1" ]]; then
  install_link "$here/ht-bridge" "$claude_home/scripts/ht-bridge" "hook bridge"
fi

if [[ "${SKIP_SKILL:-0}" != "1" ]]; then
  install_link "$here/skills/tau-mux" "$claude_home/skills/tau-mux" "tau-mux skill"
fi

cat <<EOF

Next step — merge the hook blocks from
  $here/settings.snippet.jsonc
into
  $claude_home/settings.json

Then restart Claude Code (or start a fresh session) to pick up the new
hooks. The tau-mux skill loads automatically — no settings.json edit needed.

Manual smoke test (with τ-mux running and HT_SURFACE exported):
  echo '{"session_id":"manual-test","prompt":"Hello"}' | \\
    bun $claude_home/scripts/ht-bridge/src/index.ts prompt
EOF
