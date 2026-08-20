#!/usr/bin/env bash
# Ensure the shared TNR local service stack (docker compose) is up.
# Idempotent and safe to run in parallel across worktrees: every worktree
# resolves to the same compose project, so a worktree only starts what is
# missing and never recreates containers another worktree is using. The compose
# call is serialized with a lock so concurrent worktrees do not race on
# container creation.
set -euo pipefail

COMPOSE_FILE="$(git rev-parse --show-toplevel)/.devcontainer/docker-compose.yml"
LOCK="/tmp/tnr-dev-services.lock.d"
# Steal delay for locks with an unknown owner (no pid file, i.e. created by an
# older version of this script). When a pid file is present, owner liveness is
# checked directly and no age is needed.
STALE_SECONDS=300
# ~20 minutes at 0.5s intervals: long enough for a cold first
# `docker compose up --wait` (image pulls + MySQL init). Every iteration
# re-checks the stack, so waiters exit as soon as the services are up.
WAIT_TRIES=2400

if ! docker ps --format '{{.Names}}' >/dev/null 2>&1; then
  echo "dev-services: ERROR: docker daemon not reachable. Start Docker and retry." >&2
  exit 1
fi

# Take the expected service set from the compose file itself: a hardcoded list
# silently stops covering services that are added or renamed later.
expected_services="$(docker compose -f "$COMPOSE_FILE" config --services)"
if [ -z "$expected_services" ]; then
  echo "dev-services: ERROR: no services defined in $COMPOSE_FILE" >&2
  exit 1
fi

# `--status running` excludes created/restarting/exited containers, so a
# crash-looping service counts as missing rather than as a healthy stack.
services_up() {
  local up s
  up="$(docker compose -f "$COMPOSE_FILE" ps --services --status running 2>/dev/null || true)"
  while IFS= read -r s; do
    [ -n "$s" ] || continue
    printf '%s\n' "$up" | grep -qx "$s" || return 1
  done <<<"$expected_services"
  return 0
}

if services_up; then
  echo "dev-services: all shared services already running"
  exit 0
fi

echo "dev-services: starting shared service stack"

# Portable mtime in seconds. BSD `stat -f %m` prints the mtime, but GNU
# `stat -f %m` prints filesystem info, so verify digits before trusting it and
# fall back to GNU `stat -c %Y`.
mtime_of() {
  local v
  v="$(stat -f %m "$1" 2>/dev/null || true)"
  case "$v" in
    '' | *[!0-9]*) v="$(stat -c %Y "$1" 2>/dev/null || true)" ;;
  esac
  printf '%s' "${v:-0}"
}

# True when the work that took the lock is still in flight: the owning process
# (pid file) is alive, or a `compose up` for this stack is still running (covers
# the owner being SIGKILLed while its compose child continues, from this
# worktree or any other). The pattern matches `up` only: waiters run
# `compose ... ps` every iteration, and matching that would make each waiter
# read the others as a live owner and never recover a stale lock.
# `ps -p` is used instead of `kill -0` because kill reports "no such process"
# for PIDs owned by other users even when they are alive.
lock_owner_alive() {
  local pid
  if [ -f "$LOCK/pid" ]; then
    pid="$(cat "$LOCK/pid" 2>/dev/null || true)"
    case "$pid" in
      '' | *[!0-9]*) : ;;
      *) ps -p "$pid" >/dev/null 2>&1 && return 0 ;;
    esac
  fi
  pgrep -f 'compose -f .*\.devcontainer/docker-compose\.yml up' >/dev/null 2>&1
}

# Take the lock (mkdir is atomic). If another worktree holds it, re-check the
# stack on every iteration and steal it only when its owner is provably gone:
# immediately when a recorded owner pid is dead, and after STALE_SECONDS for
# legacy locks without a pid file (mtime is the only signal there).
acquired=0
for _ in $(seq 1 "$WAIT_TRIES"); do
  if services_up; then
    echo "dev-services: services were started by a concurrent worktree"
    exit 0
  fi
  if mkdir_err="$(mkdir "$LOCK" 2>&1)"; then
    echo "$$" >"$LOCK/pid"
    acquired=1
    break
  elif [ ! -d "$LOCK" ]; then
    # Not "already exists" — e.g. a read-only or full /tmp. Waiting cannot fix
    # that, and silently spinning would report a misleading lock timeout.
    echo "dev-services: ERROR: cannot create lock $LOCK: $mkdir_err" >&2
    exit 1
  fi
  if ! lock_owner_alive; then
    steal=0
    if [ -f "$LOCK/pid" ]; then
      steal=1
    elif [ $(($(date +%s) - $(mtime_of "$LOCK"))) -gt "$STALE_SECONDS" ]; then
      steal=1
    fi
    if [ "$steal" -eq 1 ]; then
      # Claim the old lock atomically (rename), then take the path fresh.
      # Only one racing waiter can rename successfully, so two waiters can
      # never both steal the same lock.
      if mv "$LOCK" "$LOCK.stale.$$" 2>/dev/null && mkdir "$LOCK" 2>/dev/null; then
        echo "$$" >"$LOCK/pid"
        rm -rf "$LOCK.stale.$$"
        acquired=1
        break
      fi
      [ -d "$LOCK.stale.$$" ] && rm -rf "$LOCK.stale.$$"
    fi
  fi
  sleep 0.5
done
[ "$acquired" -eq 1 ] || {
  echo "dev-services: ERROR: could not acquire lock $LOCK. If a previous holder crashed, remove it and retry." >&2
  exit 1
}

cleanup() {
  rm -rf "$LOCK"
}
trap cleanup EXIT

# Re-check under the lock: a concurrent worktree may have started the stack
# while we waited.
if services_up; then
  echo "dev-services: services were started by a concurrent worktree"
  exit 0
fi

# `--no-recreate` keeps containers other worktrees are using. Compose resolves
# relative paths (the proxy's ./nginx.conf bind mount, env_file) against the
# worktree it runs from, so this worktree's config hash differs from the one
# that created the stack and a plain `up` would recreate healthy containers
# underneath a running dev server. Applying compose-file changes is therefore
# a deliberate `docker compose -f .devcontainer/docker-compose.yml up -d`.
if ! docker compose -f "$COMPOSE_FILE" up -d --wait --no-recreate; then
  # A starter this lock cannot see (another mount namespace, e.g. a container
  # sharing the host docker socket) can win the race to create a container and
  # fail this compose with a name conflict. That only matters if the stack is
  # still not up.
  if services_up; then
    echo "dev-services: stack was completed by a concurrent starter"
    exit 0
  fi
  echo "dev-services: ERROR: docker compose up failed for $COMPOSE_FILE" >&2
  exit 1
fi
echo "dev-services: shared service stack is up"
