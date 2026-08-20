#!/usr/bin/env bash
# Ensure the current worktree has an app/.env. If missing, symlink it to the
# env of the first worktree that has one, so every worktree shares one source
# of truth (and therefore one database).
#
# The link is shared, not a copy: editing app/.env from any worktree changes it
# for all of them. Point a single worktree at a different database by replacing
# its link with a real file.
#
# Best effort by design: a checkout with no env anywhere still needs to run
# `make bun add <pkg>` and friends, so a missing source warns instead of
# failing the build. Commands that need the env fail on their own with a
# message about what they were missing.
set -euo pipefail

to_root="$(git rev-parse --show-toplevel)"
target="$to_root/app/.env"

if [ -e "$target" ]; then
  echo "dev-env: app/.env present"
  exit 0
fi

# A dangling symlink does not resolve (fails -e) but still occupies the path,
# so `ln -s` below would fail with "File exists". Remove it first.
if [ -L "$target" ]; then
  echo "dev-env: removing broken app/.env symlink"
  rm "$target"
fi

# Link to the env's ultimate location rather than to another worktree's link,
# so the result keeps working when that worktree is removed. Falls back to the
# path itself where realpath is unavailable.
resolve() {
  realpath "$1" 2>/dev/null || printf '%s\n' "$1"
}

# Read the porcelain records line by line and strip the literal prefix: the
# path runs to the end of the line, so this keeps paths containing spaces
# intact (awk field-splitting would truncate them) without needing `-z`, which
# only exists in Git 2.36+.
src=""
while IFS= read -r record; do
  case "$record" in
    "worktree "*) ;;
    *) continue ;;
  esac
  candidate="${record#worktree }/app/.env"
  # -e follows symlinks: a worktree whose env is itself a link to a real file
  # elsewhere (e.g. a secrets store) is a valid source, a dangling one is not.
  if [ -e "$candidate" ]; then
    src="$(resolve "$candidate")"
    break
  fi
done < <(git worktree list --porcelain)

if [ -z "$src" ]; then
  echo "dev-env: WARNING: no app/.env found in any worktree." >&2
  echo "dev-env: copy app/.env.example to app/.env and fill it in before running the server." >&2
  exit 0
fi

mkdir -p "$(dirname "$target")"
ln -s "$src" "$target"
echo "dev-env: linked app/.env -> $src (shared: edits affect every worktree)"
