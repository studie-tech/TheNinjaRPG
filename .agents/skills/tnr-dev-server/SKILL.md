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
missing, leaving containers other worktrees are using alone (`ensure-services`). `make bun`, `make dbpush` and `make seed` run both
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

Warm start (deps installed, services up) is ~30s. It can legitimately take far longer: a cold
worktree adds a `bun install`, and `ensure-services` waits for a service that another worktree
started but that is not ready yet. So a poll that runs out is not proof the server died — check
`cat /tmp/tnr-dev-$PORT.log` (which flushes on exit, so content there means it exited) and
`docker compose -f .devcontainer/docker-compose.yml ps` before restarting anything.

## 2. Get the broker token

Provisioning is gated by `AI_TEST_USER_BROKER_TOKEN`. It is a real secret that must be set in the
env file — the checked-in `app/.env.example` ships it empty, and an unset token disables the broker
with a 500 ("not configured"). `app/.env` is usually a symlink, so resolve it:

```bash
# tr strips surrounding quotes: dotenv accepts them, a curl header does not.
TOKEN=$(grep '^AI_TEST_USER_BROKER_TOKEN=' "$(realpath app/.env)" | cut -d= -f2- | tr -d "\"'")
: "${TOKEN:?set AI_TEST_USER_BROKER_TOKEN in the real app/.env}"
```

This quote-stripping applies to EVERY value read out of `app/.env`, not just this one — several
keys (e.g. `OPENAI_API_KEY`) are stored single-quoted. A key extracted with quotes attached
authenticates as garbage and produces misleading 401s ("the key is dead") when the key is fine.

## 3. Provision test users

Creates real users in the shared dev database, visible to every worktree's server at once.

```bash
curl -s -X POST "http://127.0.0.1:$PORT/api/ai-test-user" \
  -H "Content-Type: application/json" \
  -H "x-tnr-reviewer-token: $TOKEN" \
  -d '{"runId":"<short-unique-id>","users":[
    {"key":"hero","level":50,"rank":"JONIN","villageName":"Akikaze"},
    {"key":"foe","level":10,"rank":"GENIN","villageName":"Hyorin"}
  ]}'
```

Returns `{success, users:[{key, userId, username, email, password, level, rank, villageId,
villageName, signInToken, ...}]}`.

- `rank`: `STUDENT`, `GENIN`, `CHUNIN`, `JONIN`, `ELITE JONIN`, `ELDER`, `NONE`.
- `villageName` must match a village's `name` exactly. The seeded names are `Akikaze`,
  `Wake Island`, `Hyorin`, `Tsukimori`, `Akasumi`, `Iron Shield`, `Shirohana`, `Syndicate`,
  `Freedom State`, `Horizon`. Pass `villageId` instead to skip the lookup.
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

Open `http://localhost:$PORT/login?__clerk_ticket=<signInToken>`. Clerk consumes the ticket and the
session is signed in as that user. Single-use — provision a fresh user for another login.

**Browser pages MUST use `localhost`, never `127.0.0.1`.** On a `127.0.0.1` origin the Next dev
server 403s its own chunks ("Blocked cross-origin request to Next.js dev resource … from
\"127.0.0.1\"" in the server log), so React never hydrates and clerk-js sits at
`Clerk.status === "loading"` forever without ever calling its Frontend API — the login page stays
blank and reloads just burn the single-use (~300 s) ticket. The symptom looks identical in the
in-app pane, the Chrome extension, and headless drivers. Plain `curl` calls to API routes are
unaffected (no hydration involved), which is why the earlier sections work with either host.

## 5b. Headless auth for plain API routes (non-tRPC)

The call-endpoint broker only reaches tRPC procedures. Next.js API routes that call Clerk's
`auth()` directly (`/api/chat/*`, etc.) need a real Clerk session — which can be minted without a
browser by doing what clerk-js does internally against the dev instance's Frontend API
(`https://talented-kit-66.clerk.accounts.dev`):

```js
const FAPI = "https://talented-kit-66.clerk.accounts.dev";
// 1. dev-browser token (dev instances only)
const { token: dbJwt } = await (await fetch(`${FAPI}/v1/dev_browser`, { method: "POST" })).json();
// 2. consume the broker's signInToken as a ticket sign-in
const signIn = await (await fetch(`${FAPI}/v1/client/sign_ins?__clerk_db_jwt=${dbJwt}`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ strategy: "ticket", ticket: signInToken }),
})).json();
const sessionId = signIn.client.last_active_session_id;
// 3. mint a session JWT (~60 s validity — mint right before each burst of calls)
const { jwt } = await (await fetch(`${FAPI}/v1/client/sessions/${sessionId}/tokens?__clerk_db_jwt=${dbJwt}`, {
  method: "POST",
})).json();
// 4. the Next server accepts it as a Bearer token
await fetch(`http://127.0.0.1:${PORT}/api/chat/support`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
  body: JSON.stringify({ messages: [...] }),
});
```

Chat routes expect the `useChat` wire shape: `{ messages: [{ id, role, parts: [{ type: "text",
text }] }] }` — UIMessages with `parts`, not ModelMessages with `content`.

## 6. Cleanup

`next dev` is a descendant of `make`, so killing the make pid leaves the server running. Kill the
listener:

```bash
# -sTCP:LISTEN excludes connected clients (a bare port match would kill the
# browser too); the command check guards against the port having meanwhile been
# taken by something unrelated.
lsof -ti tcp:$PORT -sTCP:LISTEN | while read -r pid; do
  ps -p "$pid" -o command= | grep -q "next dev" && kill "$pid"
done
lsof -i :$PORT -sTCP:LISTEN   # expect no output
rm -f /tmp/tnr-dev-$PORT.log
```

Leave the Docker stack alone — every other worktree shares it. Test users are disposable and can
stay; re-provisioning is always safe.

## Pitfalls

- **Port collisions** — check `lsof -i :$PORT` before choosing.
- **Empty log with a live 200** — normal (buffering), not a failure.
- **`Invalid environment variables` at boot** — either no `app/.env` exists anywhere (`ensure-env`
  warns and continues rather than failing, so check its output for
  `WARNING: no app/.env found`), or a key in the shared file is missing or invalid
  (`app/src/env/schema.mjs` lists what is required). Fix the real file (`realpath app/.env`);
  do not export vars by hand.
- **`app/.env` is shared** — it is a symlink to one canonical file, so editing it repoints *every*
  worktree. To give one worktree its own database, replace its link with a real file.
- **A long-running stack predates the db healthcheck** — readiness gating only works for
  containers created after it was added, so a `tnr_mysql` from before then reports no health and
  counts as ready. Run `make docker-apply` once to pick it up.
- **Docker config changes are not auto-applied** — `ensure-services` only starts services that are
  missing, so it never restarts a container another worktree is using. After editing
  `.devcontainer/docker-compose.yml`, apply it deliberately with `make docker-apply` (this does
  recreate containers, so expect other worktrees' servers to reconnect).
- **`Village not found`** — the name is matched against the `name` column only. Do not grep
  `app/data/villages.sql` for the string: several villages also carry a different in-game
  `mapName` (`Syndicate` is displayed as "City of Mei"), and matching one of those never resolves.
