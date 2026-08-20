#!/usr/bin/env bash
# Ensure the shared TNR local service stack (docker compose) is up.
#
# Safe to run from several worktrees at once. There is deliberately no lock:
# concurrent runs can only collide by trying to create the same container, and
# docker resolves that itself — one wins, the loser gets a name conflict. So
# this retries and judges by whether the stack is actually up, which is both
# simpler and more robust than coordinating the runs.
#
# The two rules that keep concurrent runs from hurting each other:
#   - only services that are not running are ever passed to `up`, so a container
#     another worktree is using is never named and so never recreated;
#   - a service that exists but is not ready yet is waited on, never started.
set -euo pipefail

# Pinned rather than inferred: compose would otherwise derive the project from
# the compose file's parent directory, which an ambient COMPOSE_PROJECT_NAME can
# silently override, splitting the "shared" stack in two. This is the name the
# existing containers already carry, so pinning it changes nothing today.
COMPOSE_PROJECT=devcontainer
COMPOSE_FILE="$(git rev-parse --show-toplevel)/.devcontainer/docker-compose.yml"
# Bound `--wait` so a service that never comes up cannot stall a run forever.
COMPOSE_WAIT_TIMEOUT=300
# ~5 minutes at 2s intervals, for a stack that is running but still starting up.
READY_WAIT_TRIES=150
# Retries exist for losing a container-creation race to another worktree, which
# resolves as soon as the winner's container exists.
START_ATTEMPTS=3

compose() {
  docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" "$@"
}

if ! docker ps --format '{{.Names}}' >/dev/null 2>&1; then
  echo "dev-services: ERROR: docker daemon not reachable. Start Docker and retry." >&2
  exit 1
fi

# Take the expected service set from the compose file itself: a hardcoded list
# silently stops covering services that are added or renamed later.
expected_services="$(compose config --services)"
if [ -z "$expected_services" ]; then
  echo "dev-services: ERROR: no services defined in $COMPOSE_FILE" >&2
  exit 1
fi

# Errors are reported, never swallowed: "I could not determine the state" must
# not be read as "nothing is running", which would make the caller recreate
# containers other worktrees are using.
running_services() {
  local out
  if ! out="$(compose ps --services --status running 2>&1)"; then
    echo "dev-services: ERROR: could not query service state:" >&2
    printf '%s\n' "$out" >&2
    return 1
  fi
  printf '%s\n' "$out"
}

missing_services() {
  local running s
  running="$(running_services)" || return 1
  while IFS= read -r s; do
    [ -n "$s" ] || continue
    printf '%s\n' "$running" | grep -qx "$s" || printf '%s\n' "$s"
  done <<<"$expected_services"
}

# Running is not the same as ready: `--status running` reports container state
# and ignores health, so a database that is up but still initialising would
# pass. Services without a healthcheck have nothing to report and count as ready.
unready_services() {
  local ids out
  ids="$(compose ps -q --status running 2>/dev/null || true)"
  [ -n "$ids" ] || return 0
  if ! out="$(printf '%s\n' "$ids" | xargs docker inspect \
    -f '{{index .Config.Labels "com.docker.compose.service"}} {{if .State.Health}}{{.State.Health.Status}}{{else}}healthy{{end}}' 2>&1)"; then
    echo "dev-services: ERROR: could not inspect service health:" >&2
    printf '%s\n' "$out" >&2
    return 1
  fi
  printf '%s\n' "$out" | awk '$2 != "healthy" { print $1 }'
}

wait_for_ready() {
  local i unready
  for i in $(seq 1 "$READY_WAIT_TRIES"); do
    unready="$(unready_services)" || return 1
    [ -z "$unready" ] && return 0
    sleep 2
  done
  return 1
}

report_stuck() {
  echo "dev-services: ERROR: services never became ready: $1" >&2
  echo "dev-services: inspect with: docker compose -p $COMPOSE_PROJECT -f $COMPOSE_FILE ps" >&2
  echo "dev-services: to rebuild the stack from the current compose file: make docker-apply" >&2
}

for attempt in $(seq 1 "$START_ATTEMPTS"); do
  missing="$(missing_services)" || exit 1
  unready="$(unready_services)" || exit 1

  if [ -z "$missing" ] && [ -z "$unready" ]; then
    echo "dev-services: all shared services already running"
    exit 0
  fi

  # Everything exists, it is just not ready yet: wait rather than start, so this
  # run never disturbs a container another worktree is using.
  if [ -z "$missing" ]; then
    echo "dev-services: waiting for $(printf '%s' "$unready" | tr '\n' ' ')to become ready"
    if wait_for_ready; then
      echo "dev-services: all shared services ready"
      exit 0
    fi
    report_stuck "$(unready_services | tr '\n' ' ')"
    exit 1
  fi

  # Name only the missing services. Compose resolves relative paths (the proxy's
  # ./nginx.conf bind, env_file) against the worktree it runs from, so an
  # unscoped `up` would recreate healthy containers under another worktree's dev
  # server; naming the missing ones leaves those untouched while still
  # recreating a broken container against this worktree's paths. --no-deps keeps
  # compose from touching healthy dependencies — anything genuinely missing is
  # already listed.
  missing_list=()
  while IFS= read -r service; do
    [ -n "$service" ] && missing_list+=("$service")
  done <<<"$missing"
  echo "dev-services: starting ${missing_list[*]}"

  if compose up -d --wait --wait-timeout "$COMPOSE_WAIT_TIMEOUT" --no-deps "${missing_list[@]}"; then
    continue # re-evaluate at the top; readiness is judged there, not here
  fi

  # A concurrent worktree may have created the same container first, which fails
  # this run with a name conflict. That is benign, so long as the stack ends up
  # running; the loop re-checks and only the last attempt reports failure.
  if [ "$attempt" -lt "$START_ATTEMPTS" ]; then
    echo "dev-services: start attempt $attempt failed, re-checking (a concurrent worktree may have won)"
    sleep 3
    continue
  fi
  echo "dev-services: ERROR: could not start: ${missing_list[*]}" >&2
  report_stuck "${missing_list[*]}"
  exit 1
done

# Fell out of the loop: the last attempt started things but they still are not
# ready, which the top of the loop would have reported had it run again.
if missing="$(missing_services)" && [ -z "$missing" ] && wait_for_ready; then
  echo "dev-services: shared service stack is up"
  exit 0
fi
report_stuck "$(missing_services | tr '\n' ' ')"
exit 1
