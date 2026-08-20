#!/usr/bin/env bash
# Ensure the shared TNR local service stack (docker compose) is up.
# Idempotent and safe to run in parallel across worktrees: every worktree
# resolves to the same compose project, and only the services that are actually
# missing are started, so a run from one worktree never disturbs containers
# another worktree is using. The compose call is serialized with a lock so
# concurrent worktrees do not race on container creation.
set -euo pipefail

COMPOSE_FILE="$(git rev-parse --show-toplevel)/.devcontainer/docker-compose.yml"
LOCK="/tmp/tnr-dev-services.lock.d"
# A holder keeps its lock's mtime fresh while it works, so a lock that stops
# being touched really has lost its owner. `ps` cannot answer this on its own:
# a pid recorded by a process in another pid namespace is readable here but not
# resolvable, and treating that as dead would reclaim a lock whose compose is
# still running.
HEARTBEAT_SECONDS=10
STALE_SECONDS=60
# ~20 minutes at 0.5s intervals: long enough for a cold first start (image pulls
# plus database init). Every iteration re-checks the stack, so waiters exit as
# soon as the services are up.
WAIT_TRIES=2400
# Bound `--wait` so a service that never comes up cannot hold the lock forever.
COMPOSE_WAIT_TIMEOUT=300

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

# `--status running` excludes created and exited containers, so a service that
# died counts as missing rather than as a healthy stack.
missing_services() {
  local running s
  running="$(docker compose -f "$COMPOSE_FILE" ps --services --status running 2>/dev/null || true)"
  while IFS= read -r s; do
    [ -n "$s" ] || continue
    printf '%s\n' "$running" | grep -qx "$s" || printf '%s\n' "$s"
  done <<<"$expected_services"
}

services_up() {
  [ -z "$(missing_services)" ]
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

lock_pid() {
  [ -f "$LOCK/pid" ] || return 1
  local pid
  pid="$(cat "$LOCK/pid" 2>/dev/null || true)"
  case "$pid" in
    '' | *[!0-9]*) return 1 ;;
  esac
  printf '%s' "$pid"
}

# Only ever used to refuse a reclaim, never to trigger one: a visible owner is
# proof the lock is held, while an invisible one proves nothing (it may live in
# another pid namespace) and is left to the heartbeat age check.
# `ps -p` is used instead of `kill -0` because kill reports "no such process"
# for PIDs owned by other users even when they are alive.
lock_owner_alive() {
  local pid
  pid="$(lock_pid)" || return 1
  ps -p "$pid" >/dev/null 2>&1
}

# Reclaiming a lock happens behind a second lock, and the owner is re-checked
# once that is held. Without this, two waiters can both decide the same lock is
# stale, and the second one removes the lock the first has just legitimately
# recreated, leaving both convinced they hold it.
try_steal() {
  local steal="$LOCK.steal" now
  if ! mkdir "$steal" 2>/dev/null; then
    # Reclaim a reclaim-lock that outlived its owner; a real steal is instant.
    now="$(date +%s)"
    if [ -d "$steal" ] && [ $((now - $(mtime_of "$steal"))) -gt 60 ]; then
      rm -rf "$steal"
    fi
    return 1
  fi
  # Re-check while holding the reclaim lock: the holder may have been replaced,
  # or a heartbeat may have landed, since this waiter decided.
  if lock_owner_alive ||
    [ $(($(date +%s) - $(mtime_of "$LOCK"))) -le "$STALE_SECONDS" ]; then
    rmdir "$steal" 2>/dev/null || true
    return 1
  fi
  rm -rf "$LOCK"
  # A plain waiter may win the freed path here; then this mkdir fails and it
  # keeps the lock, which is correct.
  if mkdir "$LOCK" 2>/dev/null; then
    printf '%s\n' "$$" >"$LOCK/pid"
    rmdir "$steal" 2>/dev/null || true
    return 0
  fi
  rmdir "$steal" 2>/dev/null || true
  return 1
}

# Take the lock (mkdir is atomic). While another worktree holds it, re-check the
# stack every iteration and reclaim only once the lock has gone STALE_SECONDS
# without a heartbeat.
acquired=0
mkdir_fail_streak=0
for _ in $(seq 1 "$WAIT_TRIES"); do
  if services_up; then
    echo "dev-services: services were started by a concurrent worktree"
    exit 0
  fi
  if mkdir_err="$(mkdir "$LOCK" 2>&1)"; then
    printf '%s\n' "$$" >"$LOCK/pid"
    acquired=1
    break
  elif [ -d "$LOCK" ]; then
    # Normal contention.
    mkdir_fail_streak=0
  else
    # mkdir failed and the directory is not there: either the holder released it
    # in the gap, or the path is unusable (read-only or full /tmp). Only treat a
    # run of failures as fatal, so a released lock is retried rather than
    # reported as a broken filesystem.
    mkdir_fail_streak=$((mkdir_fail_streak + 1))
    if [ "$mkdir_fail_streak" -ge 3 ]; then
      echo "dev-services: ERROR: cannot create lock $LOCK: $mkdir_err" >&2
      exit 1
    fi
  fi
  if ! lock_owner_alive && try_steal; then
    acquired=1
    break
  fi
  sleep 0.5
done
[ "$acquired" -eq 1 ] || {
  echo "dev-services: ERROR: could not acquire lock $LOCK. If a previous holder crashed, remove it and retry." >&2
  exit 1
}

cleanup() {
  # Releasing the lock must not depend on the heartbeat still being killable:
  # under `set -e` a failing kill would abort the trap before `rm -rf`, leaking
  # the lock and turning a successful run into a non-zero exit.
  if [ -n "${heartbeat_pid:-}" ]; then
    kill "$heartbeat_pid" 2>/dev/null || true
  fi
  rm -rf "$LOCK"
}
trap cleanup EXIT

# Keep the lock's mtime fresh for as long as this run holds it, so waiters can
# tell a slow holder from a dead one without needing to resolve its pid.
(
  while sleep "$HEARTBEAT_SECONDS"; do
    touch "$LOCK" 2>/dev/null || exit 0
  done
) &
heartbeat_pid=$!

# Re-check under the lock: a concurrent worktree may have started the stack
# while we waited.
missing=()
while IFS= read -r service; do
  [ -n "$service" ] && missing+=("$service")
done <<<"$(missing_services)"
if [ "${#missing[@]}" -eq 0 ]; then
  echo "dev-services: services were started by a concurrent worktree"
  exit 0
fi

# Name only the missing services. Compose resolves relative paths (the proxy's
# ./nginx.conf bind, env_file) against the worktree it runs from, so an
# unscoped `up` would recreate healthy containers under another worktree's dev
# server; naming the missing ones leaves those untouched while still recreating
# a broken container against this worktree's paths. --no-deps keeps compose from
# touching healthy dependencies — anything genuinely missing is already listed.
echo "dev-services: starting ${missing[*]}"
if ! docker compose -f "$COMPOSE_FILE" up -d --wait \
  --wait-timeout "$COMPOSE_WAIT_TIMEOUT" --no-deps "${missing[@]}"; then
  # A starter this lock cannot see (another mount namespace, e.g. a container
  # sharing the host docker socket) can win the race to create a container and
  # fail this compose with a name conflict. Sample twice so a container that is
  # merely flapping is not mistaken for a healthy stack.
  if services_up && sleep 2 && services_up; then
    echo "dev-services: stack was completed by a concurrent starter"
    exit 0
  fi
  echo "dev-services: ERROR: docker compose up failed for ${missing[*]}." >&2
  echo "dev-services: to rebuild the stack against this worktree, run:" >&2
  echo "  docker compose -f $COMPOSE_FILE up -d --wait" >&2
  exit 1
fi
echo "dev-services: shared service stack is up"
