# Tests

Run commands from the repository root:

```sh
make install
make test
make typecheck
make lint
```

`make test` and `cd app && bun test` use the same Bun configuration. The first
preload supplies placeholder configuration for services; suites mock the external
boundaries they exercise. No personal service credentials are required. Test
configuration belongs in `setup/environment.ts`, before application modules load.

## Placement

Mirror the source layer under `tests/`: `app/` for routes, `components/` and
`layout/` for rendered UI, `hooks/`, `libs/`, `queries/`, `validators/`, `utils/`,
and `server/`. Router suites live in `server/api/routers/`; API infrastructure
checks stay in `server/api/`. Group a feature into a directory when it has several
suites, such as `server/api/routers/combat/`, `libs/quest/`, `libs/native/` or
`libs/rendering/`. Use descriptive behavior names within those directories.

Migration tests belong in `drizzle/` and execute the committed SQL against
representative rows. Native Android tests live in `native/android/` and run with
Gradle through the Android CI workflow. The audit-media CLI guard in `scripts/`
also supports `node --test app/tests/scripts/check-audit-media.test.mjs` from
the root: the content-audit worker validates proposals without installing the app.

Keep shared fixtures and service adapters in `setup/`. Reuse `factories.ts` for
SQL rows, `quest.ts` for in-memory tracker scenarios, `rateLimit.ts` for the Redis
rate-limit transport, and `localRedis.ts` for disposable Redis processes. Combat
builders are in `libs/combat/helpers/`. Keep scenario-specific objectives, rules,
expected results and failure injections visible in the suite.

## Running a subset

```sh
cd app
bun test ./tests/libs/quest
bun test ./tests/server/api/routers/combat
bun test ./tests/libs/combat/damageReduction.test.ts
bun test --test-name-pattern 'damage reduction floor'
```

A passing subset does not establish that module mocks are isolated. Bun shares
its module registry across files, so run `make test` after changing shared setup,
fixtures or module mocks. Prefer restorable spies and the delegating helpers in
`setup/serverModules.ts`; restore spies and environment/global changes in
`afterEach`. The `setup/dom.mjs` preload installs jsdom before any suite loads;
DOM tests clean up their rendered views.

## Database and Redis tests

SQL suites use `describeWithDatabase` and skip unless both variables are set:

```sh
TEST_MYSQL_ALLOW_DESTRUCTIVE=1 \
TEST_MYSQL_URL='mysql://root:placeholder@127.0.0.1:3307/tnr_test' \
make test
```

The database must already exist and be disposable: setup reconciles the schema
and truncates every table. Each suite resets the tables it touches in
`beforeEach`. Use a separate database for each concurrent test run. CI configures
this database so SQL assertions run there.

Redis integration suites require `redis-server` and `redis-cli` on `PATH`. They
start disposable processes on Unix sockets, execute the production Lua through
the Upstash adapter and stop those processes after their suites. Without those
binaries the Redis suites skip. Unit tests require neither a running MySQL nor a
running Redis service.

## Assertions

Exercise production functions, routers, components or committed migrations. A
local copy of an algorithm only tests that copy. Assert observable outcomes,
rejections, persisted rows and side effects; use fixed clocks or controlled
interleavings for boundaries and races. Parameterize cases that differ only in
inputs and expected results.

Source inspection is appropriate for repository-wide architecture constraints
and native configuration that Bun cannot execute. Keep it tied to a concrete
contract, such as excluding server modules from client bundles or authenticating
cron routes before work. A fixture round-trip, statement count or duplicate
constant-value assertion adds no behavior coverage by itself.
