# TNR Dev Client

A desktop client for TheNinja-RPG players. It signs in with your game account,
detects your local AI coding agents (Claude Code, OpenAI Codex), and lets you
claim dev jobs (pull request reviews, issue triage, issue implementations) from
the game repository — running them locally on your machine and earning in-game
rewards.

## Architecture

```
┌─────────────────────────── Tauri v2 shell (Rust) ───────────────────────────┐
│  src-tauri/                                                                │
│  - hosts the window, loads the built Vite app                              │
│  - start_sidecar / stop_sidecar / sidecar_info commands                    │
│    (spawns + tracks the compiled sidecar binary, nothing else)             │
└──────────────┬──────────────────────────────────────────────────────────────┘
               │ loopback HTTP (127.0.0.1:49200)
┌──────────────▼──────────────────────────────────────────────────────────────┐
│  UI (React 19 + Vite, src/)                                                │
│  plain fetch calls to the sidecar — never sees the device token            │
└──────────────┬──────────────────────────────────────────────────────────────┘
               │ same loopback HTTP
┌──────────────▼──────────────────────────────────────────────────────────────┐
│  Sidecar (Bun, sidecar/ — compiled with `bun build --compile`)             │
│  - owns the Clerk-signed device token (~/.tnr-dev-client/token.json, 0600) │
│  - PKCE loopback connect flow to /dev-connect on the game server           │
│  - talks tRPC (superjson) to the game's devContribution router             │
│  - detects CLIs, enforces daily token budgets, runs jobs via `claude`/     │
│    `codex` + `gh`, opens cross-fork PRs, reports usage to the server       │
└─────────────────────────────────────────────────────────────────────────────┘
```

All game logic lives in the sidecar. Rust only manages the sidecar process so
the app starts and stops cleanly.

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.3
- [Rust](https://rustup.rs) (stable) — only for building the Tauri shell
- For actually running jobs: a `claude` and/or `codex` CLI signed in, a `gh`
  CLI authenticated with a GitHub account that can open pull requests against
  the target repository, and a local clone of that repository (your fork).

## Development

```sh
make dev-client-install        # or: cd dev-client && bun install
make dev-client-test           # bun test (sidecar unit + integration tests)
make dev-client-typecheck      # tsc --noEmit
make dev-client-lint           # biome check (config extends ../app/biome.json)
make dev-client-build-sidecar  # bun build --compile → bin/tnr-dev-client
make dev-client-dev            # sidecar build + Tauri dev (Vite on :1420)
```

`make dev-client-dev` sets `TNR_DEV_CLIENT_SIDECAR` to the freshly compiled
binary so the dev shell runs the exact code under test.

The sidecar can also be run standalone (no Tauri) for quick checks:

```sh
# Every sidecar route requires the per-launch auth token, so pin a known one
# when driving it by hand (the Tauri shell mints a random one and passes it to
# the UI; a random token you never see is useless from curl).
TNR_DEV_CLIENT_AUTH_TOKEN=devtoken bun sidecar/main.ts
# → "TNR_DEV_CLIENT_READY port=49200"
curl -H "authorization: Bearer devtoken" http://127.0.0.1:49200/status
```

Requests without the token get `401`, and requests carrying a cross-origin
`Origin` header get `403` — that is what stops any web page you happen to be
visiting from driving your client.

## Production build

```sh
make dev-client-build          # tauri build → native app bundle
```

The sidecar binary is bundled as a resource (`bundle.resources` in
`tauri.conf.json`); at runtime the shell resolves it from the resource
directory.

## Configuration

Settings live in `~/.tnr-dev-client/` (override the directory with
`TNR_DEV_CLIENT_HOME`):

| File          | Purpose                                                |
| ------------- | ------------------------------------------------------ |
| `token.json`  | device token from the connect flow (mode 0600)         |
| `settings.json` | game server URL, repo path, token caps, auto-run     |
| `usage.json`  | local per-agent daily token ledger (14 days kept)      |
| `history.json`| finished job history (last 200)                        |

Environment variables:

- `TNR_DEV_CLIENT_PORT` — sidecar loopback port (default `49200`)
- `TNR_DEV_CLIENT_SIDECAR` — path to the sidecar binary (dev override)
- `TNR_DEV_CLIENT_HOME` — data directory (default `~/.tnr-dev-client`)
- `TNR_DEV_CLIENT_NO_BROWSER` — set to skip opening the browser on sign-in
- `TNR_DEV_CLIENT_AUTH_TOKEN` — the loopback API token; the Tauri shell sets
  this for the sidecar and the UI. Set it yourself only when driving the
  sidecar by hand, otherwise a fresh random one is generated per launch

## Sign-in flow

1. UI → `POST /auth/signin` → sidecar generates a PKCE pair, starts listening
   on the loopback port, returns the `/dev-connect` URL and opens the browser.
2. You sign in on the game site (Clerk) and confirm on the `/dev-connect`
   consent screen, which names the loopback port being authorised. Only then
   is a code minted, and the browser is redirected back to
   `http://127.0.0.1:<port>/callback?code=…&state=…`.
3. Sidecar validates `state`, exchanges the code for a 24-hour device token
   (`devContribution.exchangeConnectCode`) and stores it locally. The token is
   scoped server-side to `devContribution.*`, so it cannot act on the rest of
   your game account, and it can be revoked from an ordinary browser session.
4. All subsequent `devContribution` calls go to the game server with
   `Authorization: Bearer <device-token>`.

## Verifying your GitHub account

Rewards are only paid against a GitHub identity you have proven you own, so
this is a required one-off step — `claimNextJob` refuses to hand out work until
it is done:

1. `devContribution.requestGithubVerification { githubLogin }` returns a nonce.
2. Publish it: `gh gist create --public --desc "TheNinja-RPG verification" - <<< "<nonce>"`
3. `devContribution.confirmGithubVerification { githubLogin, gistId }` — the
   server reads the gist back and checks its owner before recording the login.

The login is deliberately *not* writable through `updateProfile`. A failed
confirm leaves the nonce in place so you can retry once the gist propagates.

## Job flow

Every job type runs inside a throwaway git worktree, and the agent is given the
smallest tool set that can do the work — read-only for triage and review,
`acceptEdits` plus a scoped allowlist for implementation. Issue and PR text is
passed as clearly delimited untrusted data, never as instructions.

- `POST /jobs/claim { agent }` — preflight (cap, CLI, repo, single job at a
  time) → `devContribution.claimNextJob` → run the agent on the job:
  - **PR_REVIEW** — read the cross-fork PR, run the agent, post the review via
    `gh pr review --comment`
  - **ISSUE_TRIAGE** — read the issue, run the agent, post a triage comment via
    `gh issue comment`
  - **ISSUE_IMPLEMENT** — work in a disposable git worktree, run the agent,
    commit, push a branch and open a cross-fork PR via `gh pr create`
- While running, the sidecar heartbeats the job every 2 minutes and streams
  progress into `GET /status`.
- On completion: usage is recorded locally + `devContribution.completeJob`
  (the server verifies the result on GitHub before paying out the reward).
  Failures go to `devContribution.failJob`.

## Testing

`bun test` runs the sidecar tests in `sidecar/__tests__/`:

- Unit tests for OAuth/PKCE, the budget ledger, CLI detection, the tRPC
  client, agent output parsing, and GitHub URL parsing.
- An integration test (`integration.test.ts`) that boots the real sidecar
  in-process against a fake game server and fake `claude`/`codex`/`gh` CLIs,
  exercising the whole loop: settings, the PKCE connect flow, token storage,
  claim pre-flight and daily caps, an end-to-end `ISSUE_TRIAGE` and
  `PR_REVIEW` run, aborting a running job, sign-out/revocation, the loopback
  API's auth and origin checks, and shutdown killing an agent that ignores
  SIGTERM.

CI runs the same suite plus `cargo check` for the Tauri shell
(`.github/workflows/test_dev_client.yml`).
