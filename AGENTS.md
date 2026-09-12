# AGENTS.md

Repository-wide agent instructions; `CLAUDE.md` imports this file. Paths below are relative to the repository root.

## Required invariants

- Run all `make` commands from the repository/worktree root, never `app/`. Run `make build` **only when explicitly requested**.
- **Combat:** `initiateBattle()` must preload everything combat needs into battle state. `performAction()` gets ONE initial battle-state query, in-memory processing, then ONE `Promise.all` mutation phase. **Never add intermediate fetches**; add missing data at initiation.
- **Economy:** use atomic WHERE/CAS guards for balances, receipt delivery and reward claims; check `rowsAffected` before granting irreversible rewards. Use SQL increments for counters vulnerable to stale snapshots.
- **Database latency:** fetch independent queries upfront with `Promise.all()`, then filter in JavaScript. Prefer fewer round-trips over smaller payloads. Defer a query only when it depends on an earlier result, or is expensive and potentially unnecessary.
- Define all Zod schemas in `app/src/validators/`, never inline in pages or routers.
- When refactoring schema, remove deprecated fields and migrate all callers; do not retain legacy fields. Run `make makemigrations` after editing `app/drizzle/schema.ts`.
- React hooks must run unconditionally, in stable order, before early returns. Use query `enabled` for conditional fetching and react-hook-form `useWatch`, never `watch` (React Compiler). Verify hook ordering after frontend changes.
- Before filtering a Sentry error, verify meaningful user feedback, resolved loading states and no broken/blank UI. Comment how UX is handled; use domain-validating regexes for URL filters, never substring matching.

## Commands and environments

| Command | Purpose |
| --- | --- |
| `make test` | Vitest; real-SQL suites skip without explicit throwaway DB configuration |
| `make lint` | Biome |
| `make typecheck` | TypeScript |
| `make makemigrations` | Generate schema migrations |
| `make bun add [package]` | Add dependency |
| `make install` | Install with Bun |
| `make start PORT=<free-port>` | Start local dev in any worktree; reuse shared Docker services and link missing `app/.env` from an existing worktree |

SQL tests **truncate every table in the configured database**. Use only a throwaway DB; CI supplies one. Local dev-stack invocation:

```sh
TEST_MYSQL_ALLOW_DESTRUCTIVE=1 TEST_MYSQL_URL='mysql://root:placeholder@127.0.0.1:3307/tnr_test' make test
```

PlanetScale organization: `nano-mathias`. Production: `tnr` / `main-1`; development: `tnr` / `development`; separate AI deployment: `theninja-ai` / `main`.

For local servers, disposable test users, authenticated tRPC calls and browser login, follow `.agents/skills/tnr-dev-server/SKILL.md`.

Create/edit shared skills only in `.agents/skills/<name>/SKILL.md`. `make ensure-skills` (automatic with `make bun`) symlinks them into gitignored `.claude/skills/`; do not edit those copies.

## Code map

Next.js 15 App Router / React 19 / strict TypeScript; Tailwind, Shadcn/Radix; Drizzle/MySQL; tRPC; Clerk; Jotai; Three.js / React Three Fiber.

| Path | Responsibility |
| --- | --- |
| `app/src/app/` | Routes; `manual/` is admin content management |
| `app/src/server/api/` | `root.ts`: router registry; `trpc.ts`: middleware and `baseServerResponse`; `routers/`: endpoints |
| `app/src/libs/` | Game logic by feature (combat, travel, bounty, etc.) |
| `app/src/validators/` | Shared Zod schemas |
| `app/src/layout/` | Reusable game UI; prefer existing components |
| `app/drizzle/` | `schema.ts`, `constants.ts`, `migrations/` |
| `app/src/utils/permissions.ts` | Centralized permissions |
| `app/src/utils/time.ts` | All new time utilities; check for existing helpers first |

Combat logic lives in `app/src/libs/combat/`: `actions.ts` (actions), `process.ts` (rounds/effects), `tags.ts` (effects), `types.ts` (battle state), `util.ts`, `database.ts`, `ai_v2.ts` (rules), `drawing.ts` (rendering). Tag schemas: `validators/combat.ts`; `initiateBattle` / `performAction`: `server/api/routers/combat.ts` (both under `app/src/`).

## Database and tRPC

- Prefer Drizzle query syntax over raw SQL. Endpoint shape: parallel queries → guards → mutations. Reuse existing endpoints/patterns; mutations typically return `baseServerResponse`. Keep DB convenience helpers at the bottom of their router (e.g. profile's `fetchUser`).
- Prefer a single guarded update over a transaction. Transactions are supported, but the PlanetScale serverless driver serializes statements through a session token; `Promise.all` does not remove those round-trips. Use a short transaction only when multiple rows must change together and one guarded statement cannot express the invariant.
- For a race confined to the same account with a reversible, support-removable outcome (e.g. a stray device row), prefer readable check-then-write and comment the race's cost. See `register.ts` / `push.ts`. **Do not add transactions or `FOR UPDATE` for these races**: missing-row locking reads can gap-lock and deadlock. Irreversible or cross-user costs still require atomic guards (see `purchases/grant.ts`).
- Handle deadlocks in safely restartable work with `retryOnDeadlock` from `@/server/utils/mysqlErrors`, not additional locks; even single statements can deadlock on index order.
- CAS references: `raids.ts` reward JSON guards, `activityStreak.ts` `lastClaimDate`, and `@/server/utils/concurrency.ts` (`claimUserSnapshot`, `consumeUserItemAtomically`). For concurrent counter grants use SQL increments such as `` sql`${userData.money} + ${delta}` ``; see token/point increments in `updateRewards`.
- `tournament.getTournament` must await `syncTournamentState` before loading data: the read intentionally advances brackets and pays finals. **Keep it off HTTP edge caches**; authenticated tRPC POST batching is fine.

## Native apps

Capacitor shells and dependencies live in `mobile/`, with their own `package.json`; see `mobile/README.md` for setup.

- `app/src/libs/native/` is the **only shell bridge**. Do not import `@capacitor/*` or raw `bridge` elsewhere under `src/` (Biome enforces this). Install plugins in `mobile/`, not `app/`, and add a wrapper in `libs/native/`.
- Fire-and-forget exports (`haptics`, `widgets`, `audioSession`, `liveActivity`) no-op off device; no platform check needed. Result-bearing calls (`appleAuth.authorize`, `oauthBrowser.open`, `purchases.purchase`, `push.register`) reject off device; call only after establishing shell context.
- Ordinary push must use `sendPushToUsers` from `@/server/utils/push`, never router-to-transport calls. It handles opt-outs, device fan-out and dead-token pruning, and never throws. Live Activities use `pushActivityUpdate` instead (ActivityKit tokens); defer with `after()` as in `hospital.ts` to keep Apple latency off the response.
- `Notification` is a global announcement feed: `userId` is the author; `unreadNotifications` increments determine recipients. It is separate from per-user push delivery.
- Store branching is client-side via `useNativeShell()`: `points/page.tsx` renders `NativeStore` instead of PayPal in the shell. Preserve this gate against web checkout. `libs/native/userAgent.ts` has a tested server-side detector, but routers do not currently use it.

## Code and UI conventions

- Use functional/declarative TypeScript, avoid classes, prefer named component exports and descriptive names (auxiliary verbs for booleans).
- File order: exported component → subcomponents → helpers → types.
- Comments explain purpose, not review history; remove markers such as "Issue X:" or "TODO from review:".
- Display game values using `@/drizzle/constants.ts`; never hardcode costs, thresholds or damage values.
- Prefer reusable `app/src/layout/` components and Shadcn/Radix; use mobile-first Tailwind and optimize Web Vitals.
- Sentry filtering lives in `app/instrumentation-client.ts`; inspect `app/src/app/_trpc/Provider.tsx` for existing toast handling and `isReplicateApiError` for a documented UX example. Third-party, network, extension or hydration errors are not automatically safe to ignore; apply the required UX checks above.
