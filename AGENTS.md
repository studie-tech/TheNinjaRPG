# AGENTS.md

Repository-wide agent instructions; `CLAUDE.md` imports this file. Paths below are relative to the repository root.

## Required invariants

- **Game media assets:** upload all game artwork and generated media (including sprite/shadow atlases, emission overlays and baked light pools) to UploadThing and serve them through the existing BunnyCDN hosts via `app/src/utils/image.ts`. Never add or serve these assets from `app/public/` or another application-local static path. Packed atlases and numerical light textures must use raw file-key URLs without resize/optimizer parameters; verify byte-identical CDN delivery before publishing their manifests. Keep source/publication caches outside the repository. This media CDN is separate from `CDN_URL`, which serves only `/_next/static`.
- Run all `make` commands from the repository/worktree root, never `app/`. Run `make build` **only when explicitly requested**.
- **Combat:** `initiateBattle()` must preload everything combat needs into battle state. `performAction()` gets ONE initial battle-state query, in-memory processing, then ONE `Promise.all` mutation phase. **Never add intermediate fetches**; add missing data at initiation.
- **Economy:** use atomic WHERE/CAS guards for balances, receipt delivery and reward claims; check `rowsAffected` before granting irreversible rewards. Use SQL increments for counters vulnerable to stale snapshots.
- **Server caches:** Vercel functions are ephemeral and run as many instances, so module memory neither survives a cold start nor sees writes made on another instance. Cache reads shared across requests through `createRuntimeCache` (`app/src/server/utils/caches/runtimeCache.ts`, the Vercel Runtime Cache). Keyed content too large for one value, such as published sector maps, uses `createRuntimeEntryCache` from the same file, or `createDefinitionCache` (`caches/definitionCache.ts`) for revision-keyed definitions: each entry names the row revision it holds and is served only when it matches a revision just read from the database. Module memory is acceptable only as a layer in front of these that is version-checked, or briefly TTL-bounded and then version-probed with an always-probe option for reads that must see a write at once, or as request scope (`scopedRead`). Runtime Cache reads and writes are billed per 8 KB unit and items are capped at 2 MB, so before adding a cache compare payload size times call volume with the database read it replaces, and never cache failures.
- **Database latency:** fetch independent queries upfront with `Promise.all()`, then filter in JavaScript. Prefer fewer round-trips over smaller payloads. Defer a query only when it depends on an earlier result, or is expensive and potentially unnecessary.
- **Cache modules:** every cache lives in its own module under `app/src/server/utils/caches/`, named in camelCase after its `name` (`open-polls` → `openPolls.ts`), and is the only module that builds it; `app/tests/server/utils/caches/boundary.test.ts` enforces this. Its `load` calls a statement from `app/src/queries/`, never an inline query, and the module exports `fetch<Name>` (or a derived read named for what it returns, such as `hasOpenPoll`) and `invalidate<Name>`. Query waves in `queries/` may read these exports, but a cache's statement must not live in a `queries/` module that reads the same cache. Writes made for an editor `await` the invalidation so the editor sees a failure; a cron or game flow whose write has already committed ignores a failed invalidation with `.catch(() => undefined)` and a comment naming the TTL that bounds the stale value.
- Keep router-only Zod schemas inline in their routers. Use `app/src/validators/` for schemas reused in multiple places or consumed by non-router code (forms, libraries, integrations). Compose endpoint-specific input/output envelopes inline around shared validators; similar ID or pagination shapes alone are not a reason to extract a router-only contract.
- When refactoring schema, remove deprecated fields and migrate all callers; do not retain legacy fields. Run `make makemigrations` after editing `app/drizzle/schema.ts`. Keep migration SQL free of `--> statement-breakpoint` markers; `app/drizzle.config.ts` disables their generation. When `main` gains a migration with your branch's number, restore `main`'s journal and snapshot, delete your unmerged migration and rerun `make makemigrations`; never renumber by hand. A branch carries at most one migration: when you change `schema.ts` again before merge, delete the branch's migration, its snapshot and its journal entry the same way and regenerate, instead of adding a second one. After regenerating, check that the snapshot's `prevId` is `main`'s latest `id` and the journal `when` is later than `main`'s. Never edit a migration that production has applied; add a new one.
- React hooks must run unconditionally, in stable order, before early returns. Use query `enabled` for conditional fetching and react-hook-form `useWatch`, never `watch` (React Compiler). Verify hook ordering after frontend changes.
- **Sprite Studio:** `/manual/sprite_studio` spends gameasset.dev credits through the server-only `GAMEASSET_API_KEY`. Results are finished and stored on our CDN before review, and enter `SpriteAnimation` only when an editor accepts them. Keep every call to gameasset.dev in `app/src/server/utils/gameAsset.ts` and guard status changes with `transitionSpriteGeneration`.
- **Tutorial:** Every implementation must assess its effect on the tutorial, including routes, highlighted element IDs, progression triggers, prerequisites, content and combat guidance. Preserve the guided path; when affected, update tutorial code and regression coverage and play through the impacted steps with a fresh disposable user on the dev server before declaring the work complete.
- Before filtering a Sentry error, verify meaningful user feedback, resolved loading states and no broken/blank UI. Comment how UX is handled; use domain-validating regexes for URL filters, never substring matching.

## Repository consistency

- Keep code, comments, repository documentation and PR descriptions timeless: describe the resulting behavior, contracts and durable technical rationale, without development chronology, comparisons with previous implementations, review anecdotes or discarded approaches. PR descriptions may summarize validation and measured results concisely. Keep implementation plans, task checklists, progress/review logs, benchmark scripts, measurement collectors, report generators and temporary QA/scenario tooling outside the repository unless explicitly requested as a maintained feature. Retain appropriate product regression tests and required generated files; update repository documentation only for lasting usage or operational guidance.
- Before implementing, inspect comparable features and reuse their architecture, components, helpers, naming, validation, error handling and tests. Follow established repository patterns across frontend, backend, integrations and tooling; do not introduce a parallel approach merely because it is convenient or familiar.
- Verify that code-index/search results belong to the current repository and worktree; treat mismatched or stale indexes as advisory and validate findings against the current checkout.
- Keep test suites in `app/tests/`, organized by the corresponding source feature; use the shared setup in `app/tests/setup/`.
- Reset relevant database rows and process caches together in test fixtures; run suites sharing that state together.
- Bun module mocks persist across test files; verify affected suites together, since isolated passes can miss suite-order failures.
- Keep PR branches rebased on `main`: the "Rebased on main" check rejects merge commits, so resolve conflicts by rebasing.
- A table keyed by a user ID belongs in both the account-deletion list (`app/src/server/utils/accountDeletion/deleteUserData.ts`) and the staff user-ID rename list (`updateUserId` in `app/src/server/api/routers/staff.ts`), so its rows follow the character.
- Use the existing tRPC routers and client hooks for application queries and mutations, with the established authentication and response conventions. Reserve standalone HTTP routes for integrations that require them, such as webhooks and scheduled jobs; SDK convenience alone is not a reason to bypass tRPC.
- Build mutation cache patches, deltas, expected values and notification changes in `app/src/deltas/`, grouped by feature, with a purpose-specific JSDoc on each exported builder. Keep these calculations pure and use already-loaded inputs; routers retain schemas, authorization, database orchestration and write-success guards. Preserve the distinction between an empty update and explicitly withheld data requiring reconciliation. `app/tests/deltas/boundary.test.ts` enforces this boundary.
- Centralize reusable query-cache bindings (typed keys, mutation snapshots, updates and related-cache refetch policy) in feature hooks/controllers under `app/src/hooks/`; pages and components consume their prepare/update APIs. Reuse `useQueryCacheUpdate` and the existing `QueryClient`, with pure calculations in `app/src/deltas/`. Keep the profile API in `UserContext`. Capture input-specific keys when the mutation starts so later selection/filter changes cannot redirect its result.
- Prefer optimistic updates for predictable changes and reconcile them with confirmed mutation patches/deltas through the existing cache APIs. Avoid invalidating or refetching expensive queries, especially `profile.getUser`, when already-loaded data and mutation results are sufficient; refetch only for genuinely unknown outcomes or failed identity/revision guards.
- Cron endpoints must call `authenticateCronRequest` from `@/server/utils/cron` before timers, database access or other work. Keep their existing timing locks; authentication does not replace scheduling or concurrency guards.
- If an existing pattern cannot meet a concrete requirement, verify the limitation, choose the smallest compatible extension and document why the exception is needed. When replacing an approach, migrate its callers and remove the obsolete implementation.

## Commands and environments

| Command | Purpose |
| --- | --- |
| `make test` | Up to four isolated Bun shards; real-SQL suites skip without explicit throwaway DB configuration |
| `make test-serial` | One Bun process for debugging |
| `make lint` | Biome |
| `make typecheck` | Native TypeScript |
| `make check` | Biome linting, formatting and TypeScript diagnostics |
| `make makemigrations` | Generate schema migrations |
| `make bun add [package]` | Add dependency |
| `make install` | Install with Bun |
| `make start` / `make dev-up` | Foreground / background dev server; allocate a port per worktree, reuse shared Docker and link missing env |
| `make dev-status` / `make dev-down` | Inspect URL/logs / stop only this worktree's managed server |
| `make dev-user REQUEST=<file>` / `make dev-call USER_KEY=<key> ENDPOINT=<path>` | Provision disposable users / call tRPC through the authenticated broker |

`make test` uses up to four available CPUs; `TEST_SHARDS=2 make test` selects fewer workers.
With SQL enabled, it creates unique schemas per invocation and shard, then drops those schemas
after success, failure or SIGINT/SIGTERM. The configured credentials need CREATE/DROP DATABASE
permission on the throwaway MySQL server. Simultaneous runs and worktrees have separate schemas.

Direct `bun test` and `make test-serial` **truncate every table in the configured database**.
Use only a throwaway DB; CI supplies one. Local dev-stack invocation:

```sh
TEST_MYSQL_ALLOW_DESTRUCTIVE=1 TEST_MYSQL_URL='mysql://root:placeholder@127.0.0.1:3307/tnr_test' make test
```

For targeted suites, create a database unique to the worktree in the dev-stack `tnr_mysql` container, run `bun test` from `app/` against it, then drop it (the host has no `mysql` client). `placeholder` is the dev-stack `MYSQL_ROOT_PASSWORD` committed in `.devcontainer/.env`:

```sh
docker exec tnr_mysql mysql -uroot -pplaceholder -e "CREATE DATABASE tnr_test_<worktree>"
cd app && TEST_MYSQL_ALLOW_DESTRUCTIVE=1 TEST_MYSQL_URL='mysql://root:placeholder@127.0.0.1:3307/tnr_test_<worktree>' bun test <files>
docker exec tnr_mysql mysql -uroot -pplaceholder -e "DROP DATABASE tnr_test_<worktree>"
```

Without `TEST_MYSQL_URL`, the real-SQL suites are skipped, not failed. Check that the summary shows no skips before reporting them as passing.

To lint only the changed files, run the project's pinned Biome from `app/` with paths relative to `app/`: `cd app && ./node_modules/.bin/biome check $(git diff --name-only origin/main... -- app | sed 's#^app/##')`. Don't use `bunx biome`, which may resolve another version. Errors must be zero. The nursery `useTailwindSortedClasses` warnings on lines you did not touch are known; don't re-sort them in an unrelated PR. The pre-commit hook runs `biome check --write` on staged files.

PlanetScale organization: `nano-mathias`. Production: `tnr` / `main-1`; development: `tnr` / `development`.

- `CDN_URL` points production at a pull zone (bunny.net) that fronts `/_next/static` only. `next.config.mjs` resolves it once through `cdnOrigin` in `app/src/libs/cdn.mjs`, which feeds `assetPrefix` and the CSP hosts; read the origin from there and never introduce a second source for it. It stays off outside production, whose assets are the only ones the zone holds, and it belongs to the `tnr` project's Production environment alone — another project building this repo would serve its own chunks from a zone that does not have them. The zone's own settings are part of the contract: origin over https, "respect origin Cache-Control", vary on the query string, strip response cookies, and an edge rule answering for `/_next/static/*` and nothing else, so no page or cookie-bearing response can be cached on its hostname.

For local servers, disposable test users, authenticated tRPC calls and browser login, follow `.agents/skills/tnr-dev-server/SKILL.md`.
For disposable-account local UI tests, use Chrome DevTools MCP launched with `--isolated`. Create a named `new_page` `isolatedContext` unique to the worktree, chat and actor so different accounts can test in parallel. Keep explicit page IDs. Use the existing personal Chrome session for workflows that need its current signed-in account; never sign disposable test users into that profile or switch its account for local testing. If isolated Chrome is unavailable, continue API/server checks until its connection is ready. Never change browser/security settings or switch browsers to bypass a blocked action. Follow the dev-server skill for setup and context cleanup.

Create/edit shared skills only in `.agents/skills/<name>/SKILL.md`. `make ensure-skills` (automatic with `make bun`) symlinks them into gitignored `.claude/skills/`; do not edit those copies.

## Code map

Next.js 16 App Router / React 19 / strict TypeScript; Tailwind, Shadcn/Radix; Drizzle/MySQL; tRPC; Clerk; Jotai; PixiJS.

| Path | Responsibility |
| --- | --- |
| `app/src/app/[shell]/` | Routes, prerendered once per shell variant (`app/src/libs/shell.ts`); the proxy rewrites each request to its variant. Route handlers and metadata files stay at `app/src/app/`. `manual/` is admin content management |
| `app/src/server/api/` | `root.ts`: router registry; `trpc.ts`: middleware and `baseServerResponse`; `routers/`: endpoints |
| `app/src/libs/` | Game logic by feature (combat, travel, bounty, etc.) |
| `app/src/standalone/` | Standalone builds of app games for web portals (Shuriken Siege, `make shuriken-siege`); see `docs/ShurikenSiege.md` |
| `app/src/queries/` | Application database statements and reusable query helpers, grouped by feature; imported through `@/queries/*` |
| `app/src/deltas/` | Pure feature-specific cache patch and delta calculations; no database access or side effects. `app/src/utils/queryCache.ts` reconciles query revisions; `app/src/hooks/useQueryCacheUpdate.ts` binds confirmed mutations to an exact query key |
| `app/src/validators/` | Shared Zod schemas and schemas consumed outside routers; router-only contracts stay inline |
| `app/src/screens/` | Route-independent game screens grouped by feature, with shared screen-host navigation; compose these from routes or dialog hosts |
| `app/src/layout/` | Reusable game UI components composed by screens and routes; prefer existing components |
| `app/drizzle/` | `schema.ts`, `constants.ts`, `migrations/` |
| `app/src/utils/permissions.ts` | Centralized permissions |
| `app/src/utils/time.ts` | All new time utilities; check for existing helpers first |

Combat logic lives in `app/src/libs/combat/`: `actions.ts` (actions), `bossFight.ts` (multi-form bosses built from `AiTransformation` rows, which staff edit on the AI page), `process.ts` (rounds/effects), `damagePipeline.ts` (damage modifiers), `tags.ts` (effects), `types.ts` (battle state), `util.ts`, `database.ts`, `ai_v2.ts` (rules), `drawing.ts` (rendering). Tag schemas: `validators/combat.ts`; `initiateBattle` / `performAction`: `server/api/routers/combat.ts` (both under `app/src/`).

## Database and tRPC

- For expected mutation rejections (unsupported client, changed account, unmet prerequisites), return `errorResponse(message)` and stop before side effects. Follow the existing response contract instead of throwing `serverError` for normal user-facing outcomes. The frontend must display the message near the action, clear pending state and allow recovery without treating failure as success. Keep authentication/authorization middleware and schema validation enforced; unexpected exceptions remain errors.
- Prefer Drizzle query syntax over raw SQL. Endpoint shape: parallel queries → guards → mutations. Reuse existing endpoints/patterns; mutations typically return `baseServerResponse`. Define application database statements and reusable query helpers in `app/src/queries/`, including statements used by cron jobs, webhooks and server utilities. Import helpers directly from their feature module; keep authentication, authorization, orchestration and transaction boundaries in their callers. Query helpers return builders when callers compose subqueries or control execution; do not add `async` wrappers that eagerly execute them. `app/tests/queries/boundary.test.ts` enforces the source boundary.
- Use a single atomic statement with WHERE/CAS guards whenever it can preserve the invariant, including guarded multi-table UPDATEs. Multiple tables, ORM limitations or sharing one code path are not reasons to introduce a transaction; use parameterized SQL when Drizzle cannot express the required atomic statement.
- Explicit transactions are a last resort: use one only after ruling out safe single-statement alternatives, and comment the concrete limitation that requires it. Keep it short and restrict it to the branches that need it; a branch expressible as one guarded statement must stay outside the transaction. The PlanetScale serverless driver serializes statements through a session token, so `Promise.all` does not remove their round-trips.
- For a race confined to the same account with a reversible, support-removable outcome (e.g. a stray device row), prefer readable check-then-write and comment the race's cost. See `register.ts` / `push.ts`. **Do not add transactions or `FOR UPDATE` for these races**: missing-row locking reads can gap-lock and deadlock. Irreversible or cross-user costs still require atomic guards (see `purchases/grant.ts`).
- Handle deadlocks in safely restartable work with `retryOnDeadlock` from `@/server/utils/mysqlErrors`, not additional locks; even single statements can deadlock on index order. Use it for transactions, multi-statement sequences and long bulk statements; short autocommit statements are already retried by `createRetryingFetch`.
- CAS references: `raids.ts` reward JSON guards, `activityStreak.ts` `lastClaimDate`, and `@/server/utils/concurrency.ts` (`claimUserSnapshot`, `consumeUserItemAtomically`). For concurrent counter grants use SQL increments such as `` sql`${userData.money} + ${delta}` ``; see token/point increments in `updateRewards`.
- `tournament.getTournament` must await `syncTournamentState` before loading data: the read intentionally advances brackets and pays finals. **Keep it off HTTP edge caches**; authenticated tRPC POST batching is fine.
- Content update and delete mutations (jutsu, item, bloodline, quest, badge, game asset, AI) must call `outdateProposalsFor` from `@/libs/contentReview/outdate` once their write has finished (it compares versions against the saved row), so review suggestions built on the old version leave the `/manual/review` queue. Approving a suggestion runs the entity's own update procedure through a server-side caller; keep guards, ActionLog and Discord posts there rather than in the review router.
- The high-value mutations listed in `BOTID_PROTECTED_PROCEDURES` (`app/src/libs/botid.ts`: training starts, quest starts, arena battles, harvests, reward claims, account creation, value transfers, merch cart) pass Vercel BotID (Basic level, except Deep Analysis for `register.createCharacter` via `BOTID_DEEP_ANALYSIS_PROCEDURES`; Deep Analysis is billed per call) in `botIdMiddleware`; every other procedure skips it because each check adds a ~150-350 ms round trip. `instrumentation-client.ts` attaches the challenge to those procedures' POSTs, and a request BotID classifies as a bot is rejected with FORBIDDEN on the production deployment (`BOTID_ENFORCE=false` records without blocking; `true` also blocks on previews). A protected POST without the challenge header (a tab still running a bundle from before the procedure was protected, or a script) is not sent to BotID and is rejected with PRECONDITION_FAILED and `BOTID_RELOAD_REQUIRED_MESSAGE`; the client offers a reload. Server-side `createCaller` callers never see it. Scripted mutations must go through a real page or the AI test-user broker, not raw HTTP against a deployment. See `app/src/server/utils/botid.ts`.
- Build a query with `cdnCachedProcedure` (`app/src/server/api/trpc.ts`) only when its result reads nothing from `ctx` but `drizzle` and no client code invalidates or refetches it after an action; the client sends those queries to `/api/trpc/cdn`, which answers with `s-maxage`, so a refetch would get the CDN's copy of before the action. List such a query in `CDN_CACHED_QUERY_PATHS` (`app/src/server/api/cdnCachedQueries.ts`), which the shell layout reads without loading the router; `tests/server/api/cdnCachedQueries.test.ts` checks the list against the router's metadata and fails on a cache call against a listed query.
- Federal status is derived from PayPal, Stripe and store receipts, and each provider confirms a renewal only after the paid period ends: PayPal through `updatedAt` plus `PAYPAL_PAID_PERIOD_DAYS`, Stripe at `invoice.paid` after `expiresAt`, stores at RENEWAL. Side effects that undo a tier perk when the status drops, such as the Diamond bloodline revert (`pendingDiamondRenewal` in `app/src/queries/bloodline.ts`), must apply the same bounded grace to every provider, never only PayPal, and must let a confirmed store EXPIRATION (`revokedAt`) through.

## A/B tests

Model new signed-out experiments on `app/src/libs/wallpaperExperiment.ts`; [#2635](https://github.com/studie-tech/TheNinjaRPG/pull/2635) shows every file an experiment touches.

## Native apps

Capacitor shells and dependencies live in `mobile/`, with their own `package.json`; see `mobile/README.md` for setup.

- `app/src/libs/native/` is the **only shell bridge**. Do not import `@capacitor/*` or raw `bridge` elsewhere under `src/` (Biome enforces this). Install plugins in `mobile/`, not `app/`, and add a wrapper in `libs/native/`.
- Fire-and-forget exports (`haptics`, `audioSession`, `liveActivity`) no-op off device; no platform check needed. Result-bearing calls (`appleAuth.authorize`, `oauthBrowser.open`, `purchases.purchaseForBoundIdentity`, `purchases.restoreForBoundIdentity`, `widgets.sync`, `widgets.clear`) reject off device; call only after establishing shell context. `push.register` resolves without registering off device.
- Ordinary push must use `sendPushToUsers` from `@/server/utils/push`, never router-to-transport calls. It handles opt-outs, device fan-out and dead-token pruning, and never throws. Live Activities use `pushActivityUpdate` instead (ActivityKit tokens); defer with `after()` as in `hospital.ts` to keep Apple latency off the response.
- `Notification` is a global announcement feed: `userId` is the author; `unreadNotifications` increments determine recipients. It is separate from per-user push delivery.
- Store branching is client-side via `useNativeShell()`: `points/page.tsx` renders `NativeStore` instead of PayPal in the shell. Preserve this gate against web checkout. `libs/native/userAgent.ts` has a tested server-side detector, and the account-deletion router uses it to restrict the supported client.

## Code and UI conventions

- Use functional/declarative TypeScript, avoid classes, prefer named component exports and descriptive names (auxiliary verbs for booleans).
- File order: exported component → subcomponents → helpers → types.
- Keep static imports together at the top of the file, before declarations or executable code. Use top-level `import type` declarations for type-only dependencies; do not use inline `import("module").Type` annotations.
- Comments explain purpose, not review history; remove markers such as "Issue X:" or "TODO from review:".
- The `QueryClient` and tRPC client are built once, during hydration, and are no longer rebuilt when clerk-js loads (`app/src/layout/ActiveSessionBoundary.tsx` rebuilds only on an account switch or a sign-out). Nothing wired into them may capture auth state at construction: read it when it is needed, as `useGlobalOnMutateProtect` reads `useClerk().isSignedIn`. A captured `isSignedIn` is `undefined` during hydration and silently rejects every mutation for the life of the page.
- Read the path with `usePublicPathname` from `@/utils/routing`, never `usePathname`: a prerendered page renders under its shell variant's internal path, and branching on `usePathname` gives the server and the client different values. Import `Link` from `@/layout/Link`, never `next/link`. Biome enforces both.
- Display game values using `@/drizzle/constants.ts`; never hardcode costs, thresholds or damage values.
- Prefer reusable `app/src/layout/` components and Shadcn/Radix; use mobile-first Tailwind and optimize Web Vitals.
- The root font size is `calc(12px * var(--font-scale))` (`app/src/styles/globals.css`), and Tailwind breakpoints and container queries are rem-based. At the default scale `@lg`/`@xl`/`@2xl`/`@5xl` are 384/432/504/768px, not the 16px-based 512/576/672/1024. The classic centre column is about 650–670px wide. Choose `@container` column breakpoints against those widths, and comment why at the grid.
- New features and UI must look and behave consistently with the rest of the codebase. Match comparable screens and neighboring controls, including action styles, icon sizes, spacing, tooltips and keyboard interactions; verify the result in context on desktop and mobile.
- When showing multiple `ContentBox` sections on a page, use `initialBreak` for inter-section spacing; do not stack it with parent `space-y-*`, gaps or section margins. Put page-level back navigation (`defaultBackHref` / `onBack`) on the first visible `ContentBox` only. Check conditional layouts and forward these props through wrapper components so preceding sections do not leave the back control on a lower section. Verify spacing and back-control placement on mobile and desktop.
- When an optional env id gates a feature (for example a PayPal plan id that hides a tier while unset), guard the comparison with a non-empty check (`id && value === id`) instead of `case process.env.X:`. An unset id would otherwise match a missing value.
- Mutations fired without a user action (layout watchers, effects) set `meta: { handlesTransportError: true }`, so a transport failure does not show the "could not confirm" toast for an action the player never took; let them retry on a later visit.
- Sentry filtering lives in `app/instrumentation-client.ts`; inspect `app/src/app/_trpc/Provider.tsx` for existing toast handling and `isReplicateApiError` for a documented UX example. Third-party, network, extension or hydration errors are not automatically safe to ignore; apply the required UX checks above.
