#!/usr/bin/env bash
# Ensure the current worktree has an app/.env. If missing, symlink it to the
# env of the first worktree that has one, so every worktree shares one source
# of truth (and therefore one database).
#
# The link is shared, not a copy: editing app/.env from any worktree changes it
# for all of them. Point a single worktree at a different database by replacing
# its link with a real file.
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

# Parse NUL-delimited porcelain records so worktree paths containing
# whitespace are preserved (awk field-splitting would truncate them).
src="$(git worktree list --porcelain -z |
  while IFS= read -r -d '' record; do
    case "$record" in
      "worktree "*)
        wt="${record#worktree }"
        wt="${wt%%$'\n'*}"
        f="$wt/app/.env"
        # -e follows symlinks: a worktree whose env is itself a link to a real
        # file elsewhere (e.g. a secrets store) is a valid source, a dangling
        # one is not.
        if [ -e "$f" ]; then
          resolve "$f"
          break
        fi
        ;;
    esac
  done)"

if [ -z "$src" ]; then
  echo "dev-env: ERROR: no app/.env found in any worktree. Create one in the main worktree first." >&2
  exit 1
fi

mkdir -p "$(dirname "$target")"
ln -s "$src" "$target"
echo "dev-env: linked app/.env -> $src (shared: edits affect every worktree)"
