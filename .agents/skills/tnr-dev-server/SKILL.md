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
make dev-status             # JSON: url, phase, PID, logPath, browser context prefix
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
`AI_TEST_USER_BROKER_TOKEN`, validates requests with the broker schemas
(`@/validators/ai-test-user`) and calls the AI test-user broker endpoint
(`/api/ai-test-user`). A missing token must be configured in the real
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

Use **Chrome DevTools MCP** launched with `--isolated` for disposable-account local UI
tests, using the installed Google Chrome. Each MCP process gets a temporary profile;
create `new_page` with a named `isolatedContext` unique to worktree, chat and actor.
Derive the prefix from `make dev-status`'s `browserSession`, then append the chat ID and
actor key. Retain explicit page IDs for every action and close only your own pages.
Read [Chrome isolation](references/chrome-isolation.md) for setup, verification and
cleanup. Do not treat an ordinary tab or an unverified connection as isolated.

Use the user's existing **Chrome extension** for workflows that need its current
signed-in personal account. Never sign disposable users into that profile or switch its
account for a local test: windows, tabs, tab groups, session names and ports in one
profile share cookies. If isolated Chrome is unavailable, continue `dev-call` and server
checks until its connection is ready. Do not ask the user to stop other chats or close
their browser to resolve a collision.

Browser pages must use `http://localhost:<port>`; `127.0.0.1` can make Next dev chunks
return 403 and leave Clerk loading forever. API requests are unaffected.

- Warm the server before provisioning. Provision just before login and before setting
  up a scenario that re-provisioning would reset. A `loginUrl` from the private artifact
  contains a single-use ticket lasting about 300 seconds; navigate only the actor's own
  isolated page there and check the visible username against the saved user.
- After a navigation timeout, inspect the existing page before reloading or consuming
  another ticket. Recheck identity after unexpected account/control changes and discard
  invalid evidence.
- Close your temporary pages and stop only servers you started. Leave other pages,
  browser processes and shared services alone. Disposable users can stay.

If Chrome DevTools reports a contended `chrome-profile`, its connection is not using
`--isolated`. Check the isolation guide and continue API/server work until the connection
is configured and reloaded. Do not kill Chrome, delete profile locks, attach to other
chats' debugging endpoints, enable insecure certificates, change browser security settings
or switch browsers to bypass a blocked action.

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
