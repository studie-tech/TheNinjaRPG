#!/usr/bin/env bash
# Ensure the current worktree has an app/.env. If missing, symlink it to the
# first worktree that has a real (non-symlink) app/.env, so every worktree
# shares one source of truth (and therefore one database).
set -euo pipefail

to_root="$(git rev-parse --show-toplevel)"
target="$to_root/app/.env"

if [ -e "$target" ]; then
  echo "dev-env: app/.env present"
  exit 0
fi

src="$(git worktree list --porcelain \
  | awk '/^worktree /{print $2}' \
  | while IFS= read -r wt; do
      f="$wt/app/.env"
      if [ -e "$f" ] && [ ! -L "$f" ]; then
        echo "$f"
        break
      fi
    done)"

if [ -z "$src" ]; then
  echo "dev-env: ERROR: no app/.env found in any worktree. Create one in the main worktree first." >&2
  exit 1
fi

ln -s "$src" "$target"
echo "dev-env: linked app/.env -> $src"
