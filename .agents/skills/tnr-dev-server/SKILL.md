---
name: tnr-dev-server
description: Run a TheNinjaRPG dev server locally from any git worktree, provision disposable test users, and call tRPC endpoints as those users. Use whenever a task needs a running local server, a fresh test account, or impersonated API calls — "start the dev server", "give me a test user", "call an endpoint as a user", "reproduce this in the browser", "test this against a real stack".
---

# TNR dev server + test-user provisioning

Run a full local dev server from any git worktree, in parallel with other worktrees, and drive it
headlessly (tRPC as a provisioned user) or in a browser (Clerk sign-in ticket).

Environment and service handling live in the Makefile. `make start` is the only entry point —
never source `app/.env` into your own shell or export secrets by hand to "fix" a boot error.

## 1. Start the server

From the root of any worktree:

```bash
PORT=3100  # pick a free port — check first; 3000 is usually the main worktree
nohup make start PORT=$PORT > /tmp/tnr-dev-$PORT.log 2>&1 &
```

`make start` is idempotent and safe to run from several worktrees at once. It links `app/.env`
from a worktree that has one (`ensure-env`) and starts whatever part of the shared Docker stack is
missing, lock-protected (`ensure-services`). `make bun`, `make dbpush` and `make seed` run both
guards too; `make makemigrations` only needs the env, since it diffs the schema without a database.

**Judge readiness by HTTP, never by the log.** `make start` pipes through `grep`, which
block-buffers when redirected — the log looks empty until the server exits.

```bash
for i in $(seq 1 60); do
  curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT" | grep -q 200 && break
  sleep 2
done
curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:$PORT"   # expect 200
```

Warm start (deps installed, services up) is ~30s. A cold worktree adds a `bun install`. If you
never reach 200, the server exited — `cat /tmp/tnr-dev-$PORT.log` (output flushes on exit).

## 2. Get the broker token

Provisioning is gated by `AI_TEST_USER_BROKER_TOKEN`. It is a real secret that must be set in the
env file — the checked-in `app/.env.example` ships it empty, and an unset token disables the broker
with a 500 ("not configured"). `app/.env` is usually a symlink, so resolve it:

```bash
# tr strips surrounding quotes: dotenv accepts them, a curl header does not.
TOKEN=$(grep '^AI_TEST_USER_BROKER_TOKEN=' "$(realpath app/.env)" | cut -d= -f2- | tr -d "\"'")
: "${TOKEN:?set AI_TEST_USER_BROKER_TOKEN in the real app/.env}"
```

## 3. Provision test users

Creates real users in the shared dev database, visible to every worktree's server at once.

```bash
curl -s -X POST "http://127.0.0.1:$PORT/api/ai-test-user" \
  -H "Content-Type: application/json" \
  -H "x-tnr-reviewer-token: $TOKEN" \
  -d '{"runId":"<short-unique-id>","users":[
    {"key":"hero","level":50,"rank":"JONIN","villageName":"Akikaze"},
    {"key":"foe","level":10,"rank":"GENIN","villageName":"Akasumi"}
  ]}'
```

Returns `{success, users:[{key, userId, username, email, password, level, rank, villageId,
villageName, signInToken, ...}]}`.

- `rank`: `STUDENT`, `GENIN`, `CHUNIN`, `JONIN`, `ELITE JONIN`, `ELDER`, `NONE`.
- `villageName` must match a seeded village exactly (`app/data/villages.sql`) — e.g. `Akikaze`,
  `Akasumi`, `City of Mei`. Pass `villageId` instead to skip the lookup.
- Up to 4 users per request; keys must stay unique after normalisation (`Red Team` == `red_team`).
- `signInToken` is a one-time Clerk ticket valid ~300s.

## 4. Call tRPC as a user

```bash
curl -s -X POST "http://127.0.0.1:$PORT/api/ai-test-user/call-endpoint" \
  -H "Content-Type: application/json" \
  -H "x-tnr-reviewer-token: $TOKEN" \
  -d '{"userId":"<userId>","endpointName":"profile.getUser","input":{}}'
```

- `endpointName` is the exact `router.procedure` path from `app/src/server/api/root.ts`. It is
  matched against the router's own procedure map, so anything else — a typo, a nested router on its
  own, or a JS property like `toString` — is a 400, never a partial success.
- Omit `input` for procedures that take none.
- `result` is the procedure's own return value, so the shape varies: `profile.getUser` returns
  `{userData, notifications, serverTime, ...}` (username is `result.userData.username`).
- Any worktree's server can act on a user provisioned through any other — one shared database.

## 5. Browser login

Open `http://127.0.0.1:$PORT/login?__clerk_ticket=<signInToken>`. Clerk consumes the ticket and the
session is signed in as that user. Single-use — provision a fresh user for another login.

## 6. Cleanup

`next dev` is a descendant of `make`, so killing the make pid leaves the server running. Kill the
listener:

```bash
lsof -ti tcp:$PORT | xargs kill 2>/dev/null
lsof -i :$PORT   # expect no output
rm -f /tmp/tnr-dev-$PORT.log
```

Leave the Docker stack alone — every other worktree shares it. Test users are disposable and can
stay; re-provisioning is always safe.

## Pitfalls

- **Port collisions** — check `lsof -i :$PORT` before choosing.
- **Empty log with a live 200** — normal (buffering), not a failure.
- **`Invalid environment variables` at boot** — a key in the shared env file is missing or invalid
  (`app/src/env/schema.mjs` lists what is required). The link itself is fine: `make start` already
  ran `ensure-env`. Fix the value in the real file (`realpath app/.env`); do not export vars by hand.
- **`app/.env` is shared** — it is a symlink to one canonical file, so editing it repoints *every*
  worktree. To give one worktree its own database, replace its link with a real file.
- **Docker config changes are not auto-applied** — `ensure-services` only starts services that are
  missing, so it never restarts a container another worktree is using. After editing
  `.devcontainer/docker-compose.yml`, apply it deliberately with `make docker-apply` (this does
  recreate containers, so expect other worktrees' servers to reconnect).
- **`Village not found`** — village name typo; grep `app/data/villages.sql`.
