#!/usr/bin/env bash
# Install the τ-mux ↔ Claude Code bridge.
#
# Symlinks this repo's `ht-bridge/` directory into
# `~/.claude/scripts/ht-bridge` so edits to the source here land live
# without any bundling / copying step (Bun reads the file each hook
# invocation).
#
# Run from anywhere:
#   ./claude-integration/install.sh
#
# Environment overrides:
#   CLAUDE_HOME     Root of your Claude Code config.   Default: ~/.claude
#   FORCE=1         Replace an existing target without prompting.
#   COPY=1          Copy instead of symlink (e.g. for read-only checkouts
#                   mounted on a different filesystem).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src="$here/ht-bridge"
claude_home="${CLAUDE_HOME:-$HOME/.claude}"
scripts_dir="$claude_home/scripts"
target="$scripts_dir/ht-bridge"

if [[ ! -d "$src" ]]; then
  echo "error: $src missing — is this script in claude-integration/?" >&2
  exit 1
fi

mkdir -p "$scripts_dir"

if [[ -e "$target" || -L "$target" ]]; then
  if [[ "${FORCE:-0}" != "1" ]]; then
    echo "warning: $target already exists."
    printf "replace? [y/N] "
    read -r reply
    case "$reply" in
      [yY]*) ;;
      *) echo "aborted."; exit 1 ;;
    esac
  fi
  rm -rf "$target"
fi

if [[ "${COPY:-0}" == "1" ]]; then
  cp -R "$src" "$target"
  echo "installed (copy): $target"
else
  ln -s "$src" "$target"
  echo "installed (symlink): $target -> $src"
fi

cat <<EOF

Next step — merge the hook blocks from
  $here/settings.snippet.jsonc
into
  $claude_home/settings.json

Then restart Claude Code (or start a fresh session) to pick up the new hooks.

Manual smoke test (with τ-mux running and HT_SURFACE exported):
  echo '{"session_id":"manual-test","prompt":"Hello"}' | \\
    bun $target/src/index.ts prompt
EOF
