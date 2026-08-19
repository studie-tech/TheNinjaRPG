#!/usr/bin/env bash
# Ensure the shared TNR local service stack (docker compose) is up.
# Idempotent and safe to run in parallel across worktrees: only services that
# are not running get started, and the actual `compose up` is serialized with
# a lock so concurrent worktrees cannot race on container (re)creation.
set -euo pipefail

SERVICES=(tnr_mysql tnr_phpmyadmin tnr_planetscale tnr_redis tnr_redis_http tnr_socketi tnr_nginx)
COMPOSE_FILE="$(git rev-parse --show-toplevel)/.devcontainer/docker-compose.yml"
LOCK="/tmp/tnr-dev-services.lock.d"
STALE_SECONDS=300
WAIT_TRIES=240 # ~2 minutes at 0.5s intervals

if ! running="$(docker ps --format '{{.Names}}' 2>/dev/null)"; then
  echo "dev-services: ERROR: docker daemon not reachable. Start Docker and retry." >&2
  exit 1
fi

missing=()
for s in "${SERVICES[@]}"; do
  if ! printf '%s\n' "$running" | grep -qx "$s"; then
    missing+=("$s")
  fi
done

if [ "${#missing[@]}" -eq 0 ]; then
  echo "dev-services: all shared services already running"
  exit 0
fi

echo "dev-services: starting missing services: ${missing[*]}"

# Acquire an exclusive lock (mkdir is atomic). Steal it if stale.
acquired=0
for _ in $(seq 1 "$WAIT_TRIES"); do
  if mkdir "$LOCK" 2>/dev/null; then
    acquired=1
    break
  fi
  mtime="$(stat -f %m "$LOCK" 2>/dev/null || echo 0)"
  now="$(date +%s)"
  if [ $((now - mtime)) -gt "$STALE_SECONDS" ]; then
    rm -rf "$LOCK"
    if mkdir "$LOCK" 2>/dev/null; then
      acquired=1
      break
    fi
  fi
  sleep 0.5
done
[ "$acquired" -eq 1 ] || { echo "dev-services: ERROR: could not acquire lock $LOCK" >&2; exit 1; }

cleanup() {
  rm -rf "$LOCK"
}
trap cleanup EXIT

# Re-check under the lock: a concurrent worktree may have started the stack while we waited.
running="$(docker ps --format '{{.Names}}')"
still_missing=()
for s in "${SERVICES[@]}"; do
  if ! printf '%s\n' "$running" | grep -qx "$s"; then
    still_missing+=("$s")
  fi
done
if [ "${#still_missing[@]}" -eq 0 ]; then
  echo "dev-services: services were started by a concurrent worktree"
  exit 0
fi

docker compose -f "$COMPOSE_FILE" up -d --wait
echo "dev-services: shared service stack is up"
