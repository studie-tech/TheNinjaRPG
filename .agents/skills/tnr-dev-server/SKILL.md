---
name: tnr-dev-server
description: Run TheNinjaRPG dev servers in parallel worktrees, provision disposable users, call authenticated tRPC endpoints, and coordinate Chrome UI testing. Use for local server setup, test accounts, authenticated API calls, or browser reproduction.
---

# Local servers and test users

Run all `make` commands from the worktree root. Use these managed commands; they handle
shared env linking, dependencies, Docker readiness, port allocation and cleanup. Never
source `app/.env` or export secrets by hand to fix startup.

## Servers

```bash
make dev-up                 # start/reuse this worktree's server; wait for /login HTTP 200
make dev-status             # JSON: url, phase, PID, logPath, browser lease
make dev-doctor             # also show database target and whether broker/Clerk keys exist
make dev-down               # stop only this worktree's supervisor and descendants
```

`dev-up` reserves an available port in 3100–3999 across sibling worktrees and reuses a
live server in this worktree. `make start` runs the same supervisor in the foreground.
Pass `PORT=3123` to either command to request a port; an occupied port fails without
killing its listener. A second invocation never starts another Next against the same
`.next` directory. Caches are preserved. Restart after changing env/configuration.

Application Make commands select a Bun at least as new as `app/package.json`'s
`packageManager`, checking PATH then `~/.bun/bin/bun`. Setup uses `--frozen-lockfile`:
it must not re-resolve dependencies or rewrite the lockfile. If neither installed Bun
is compatible, install a compatible version and retry; do not regenerate the lockfile
with an older runtime. Use `make bun add <package>` for deliberate dependency changes,
or `make bun install` to refresh the lockfile after intentionally editing the manifest.

Background logs stream immediately to `logPath`. Preparation errors fail promptly;
a five-minute readiness timeout leaves a slow server running. Inspect status/logs,
then rerun `dev-up` to wait again. Status reports the managed process; verify individual
routes by HTTP. Do not adopt or kill an unmanaged server just because its port answers.

Worktrees share the database in `app/.env`; ports do **not** isolate data. Check
`dev-doctor` before scenarios. Startup never runs migrations, schema pushes or seeds.
Use a deliberately configured throwaway database for schema changes or destructive SQL
tests. Do not stop/recreate shared Docker to repair a single worktree.

`make dev-prepare` prepares without starting a server. Use it as a Codex local-environment
setup script and `make start` as the Run action. No build is required.

## Provision and call endpoints

Write a broker request JSON file:

```json
{"users":[
  {"key":"hero","level":50,"rank":"JONIN","villageName":"Akikaze"},
  {"key":"foe","level":10,"rank":"GENIN","villageName":"Hyorin"}
]}
```

```bash
make dev-user REQUEST=/tmp/my-scenario.json
make dev-call USER_KEY=hero ENDPOINT=profile.getUser
# Write a procedure's input object to a JSON file when needed:
make dev-call USER_KEY=hero ENDPOINT=<router.procedure> INPUT_FILE=/tmp/input.json
```

Paths are absolute or relative to the worktree root. The helper uses dotenv-parsed
`AI_TEST_USER_BROKER_TOKEN`, validates requests with the existing broker schemas and
calls the existing broker/tRPC caller. A missing token must be configured in the real
env file (`realpath app/.env`); do not paste secrets into command lines. A shared `.env`
symlink affects every linked worktree; replace its link with a real file for a separate
configuration/database.

Credentials and `loginUrl` values are saved with mode 0600 in gitignored
`app/scripts/.artifacts/dev-users.json`. Only IDs/names and that path are printed.
Never post passwords, tickets, tokens or the credentials file on a PR. `dev-call` resolves
`USER_KEY` from this file and prints the endpoint's JSON result. Shapes vary by procedure:
`profile.getUser` returns `result.userData.username`. HTTP/broker errors and procedure
results with `success:false` exit nonzero.

An omitted `runId` generates a unique worktree-prefixed ID. Providing the same explicit
`runId` reuses/reconfigures those users; choose deliberately to avoid resetting another
chat's scenario. Provisioning replaces the saved credentials file. Up to four users per
request; keys must stay unique after normalization. Ranks: `STUDENT`, `GENIN`, `CHUNIN`,
`JONIN`, `ELITE JONIN`, `ELDER`, `NONE`; optional `role` supplies staff scenario permissions.
Village names must match `village.name` exactly: `Akikaze`, `Wake Island`, `Hyorin`,
`Tsukimori`, `Akasumi`, `Iron Shield`, `Shirohana`, `Syndicate`, `Freedom State`, `Horizon`.
Supply `villageId` instead when known; map labels such as City of Mei do not match.

Prefer `dev-call` for tRPC verification: it runs alongside other chats without a browser.
For plain API routes calling Clerk auth directly, read [HTTP auth](references/http-auth.md).

## Chrome UI testing

Use the user's existing **Chrome**, following current tool documentation. Browser pages
must use `http://localhost:<port>`; `127.0.0.1` can make Next dev chunks return 403 and
leave Clerk loading forever. API requests are unaffected.

Separate windows, tabs, tab groups, session names and ports **share cookies**. Incognito
windows in one profile also share an incognito cookie store. Do not ask the user to stop
other chats or close their browser to resolve a collision.

- When the connected Chrome tool explicitly supports isolated contexts, use one unique
  context per chat/worktree (and per simultaneous actor). Chrome DevTools `new_page`
  exposes `isolatedContext`; use it only when connected to the intended Chrome. Retain
  explicit page IDs for actions.
- For the Chrome extension / `cua_repl`, acquire `make dev-browser` **before provisioning
  tickets or signing in**. Hold this repository-wide login lease through authenticated
  testing and screenshots. Another owner returns an actionable error: continue API/server
  work, then retry after release. No user permission is needed to coordinate the lease.
  It expires in 30 minutes; renew with `make dev-browser` for longer work. Release in
  cleanup with `make dev-browser-release`.
- Name the automation session with worktree/issue and create your own tab using
  `cua.createBrowserTab("chrome", url, {sessionName: "🧪 Issue <number>"})`. Retain that
  handle and interact only with your own tabs. Read the first-use documentation instead
  of assuming APIs from older chats exist. Avoid global active-window keyboard shortcuts.
- Read a user's `loginUrl` from the private artifact and navigate your tab there. Tickets
  are single-use and last about 300 seconds. Warm the server before provisioning; provision
  just before login and before setting up a scenario that re-provisioning would reset.
  Check the visible username against the saved user. After a navigation timeout, inspect
  the existing tab before reloading or consuming another ticket.
- Close your temporary tabs, release the lease and stop your server when finished. Leave
  other tabs, browser processes and shared services alone. Disposable users can stay.

If Chrome DevTools says its `chrome-profile` is already running, it is trying to launch
a contended managed profile. Use the available existing-Chrome extension flow; do not
kill Chrome, delete profile locks, edit global MCP settings or switch browsers. Respect
actual browser security restrictions. A lease coordinates cooperating chats; it cannot
prevent a user or an older chat from changing accounts. Recheck identity after unexpected
account/control changes and discard invalid evidence.

## Recovery

- Missing env: preparation links from another worktree or fails with instructions when
  no source exists. Fix the real file, never export secrets by hand.
- Docker unreachable: start Docker and retry. Existing unhealthy services are waited on,
  never recreated. Changed Docker config/healthchecks require explicit `make docker-apply`;
  coordinate that shared-stack operation with affected work.
- Registry lock: `registry.lock/owner.json` identifies its PID. Remove a stale lock only
  after confirming that process exited. Orphan children are reported for inspection;
  the manager never kills listeners by port.
- `make test` exports `NODE_ENV=test`. SQL suites only run with explicit throwaway DB
  configuration, and truncate every table in that database.
