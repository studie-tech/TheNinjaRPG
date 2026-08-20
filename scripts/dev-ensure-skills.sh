#!/usr/bin/env bash
# Expose the repo's agent skills to Claude Code.
#
# `.agents/skills/` is the canonical, committed location: Codex, Cursor, Copilot,
# Gemini CLI, opencode and Amp all read it directly. Claude Code only discovers
# skills under `.claude/skills/`, but it does follow a symlinked skill entry, so
# link each skill into the (gitignored) `.claude/skills/` directory.
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
src_dir="$root/.agents/skills"
dst_dir="$root/.claude/skills"

[ -d "$src_dir" ] || exit 0

linked=0
for skill_path in "$src_dir"/*/; do
  [ -d "$skill_path" ] || continue
  name="$(basename "$skill_path")"
  link="$dst_dir/$name"
  target="../../.agents/skills/$name"

  if [ -L "$link" ] && [ "$(readlink "$link")" = "$target" ]; then
    continue
  fi
  # A real directory here is someone's own Claude-only skill: leave it alone.
  if [ -e "$link" ] && [ ! -L "$link" ]; then
    echo "dev-skills: WARNING: $link exists and is not a symlink, skipping" >&2
    continue
  fi

  mkdir -p "$dst_dir"
  rm -f "$link"
  ln -s "$target" "$link"
  linked=$((linked + 1))
done

[ "$linked" -eq 0 ] || echo "dev-skills: linked $linked skill(s) into .claude/skills"
