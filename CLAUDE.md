# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.


## Development Commands

All make commands should be run from the root directory `/`, not from `/app`.

**Primary Development:**

- `make build` - Build the Next.js application. Only run if explicitly asked.
- `make test` - Run unit tests with vitest. Suites that execute real SQL skip unless a throwaway database is configured; every table in it is truncated, so the opt-in is explicit. CI supplies one, and locally the dev stack's MySQL works: `TEST_MYSQL_ALLOW_DESTRUCTIVE=1 TEST_MYSQL_URL='mysql://root:placeholder@127.0.0.1:3307/tnr_test' make test`.
- `make lint` - Run biome on the codebase
- `make typecheck` - Run typechecking on the codebase

**Database Management:**

- `make makemigrations` - Generate database migration files. Do this after updating schema.ts

**Package Management:**

- `make bun add [package]` - Add new package dependency
- `make install` - Install dependencies with bun

**PlanetScale Databases (organization: `nano-mathias`):**

- **Production**: database `tnr`, branch `main-1`
- **Development**: database `tnr`, branch `development`
- **AI deployment** (separate app): database `theninja-ai`, branch `main`

**Local dev in parallel worktrees:** `make start PORT=<free-port>` is safe to run in any git worktree at the same time — it links `app/.env` from an existing worktree if missing and starts only the parts of the shared Docker service stack that are not already running. For the full workflow (starting the server, provisioning disposable AI test users via `/api/ai-test-user`, calling tRPC headlessly via `/api/ai-test-user/call-endpoint`, browser login with the Clerk `signInToken`), follow the skill at `.agents/skills/tnr-dev-server/SKILL.md`.

**Agent skills:** shared skills live in `.agents/skills/<name>/SKILL.md`, the harness-neutral location Codex, Cursor, Copilot, Gemini CLI, opencode and Amp read directly. Claude Code only discovers skills under `.claude/skills/`, which is gitignored, so `make ensure-skills` (run automatically by `make bun`) symlinks each one into place. Add new skills under `.agents/skills/` only.

## Architecture Overview

This is a Next.js 15 application using the App Router, built as a browser-based RPG game called "TheNinja-RPG". The stack includes:

- **Frontend**: Next.js 15 + React 19 + TypeScript
- **Styling**: Tailwind CSS + Shadcn UI components
- **Database**: MySQL with Drizzle ORM
- **API**: tRPC for type-safe API endpoints
- **Auth**: Clerk for authentication
- **State Management**: Jotai for client state
- **3D Graphics**: Three.js with React Three Fiber

## Key Directories

### `/app/src/app/` - Next.js App Router Pages

Contains all route pages following Next.js 15 App Router conventions. Key pages include:

- `combat/` - Real-time combat system
- `profile/` - User profile management
- `manual/` - Admin content management system
- `village/` - Village/faction system

### `/app/src/server/api/` - tRPC Backend

- `root.ts` - Main tRPC router aggregating all sub-routers
- `routers/` - Individual feature routers (40+ routers)
- `trpc.ts` - tRPC configuration and middleware

### `/app/src/libs/` - Feature-Specific Logic

Core game systems organized by feature:

- `combat/` - Complex turn-based combat system (see Combat System section)
- `travel/` - 3D world map and movement system
- `bounty/` - Bounty hunting system
- Plus libraries for bloodlines, items, jutsu, clans, etc.

### `/app/src/validators/` - Zod Schemas

Shared validation schemas between frontend and backend using Zod. **All Zod schemas should be defined here**, not in page components or routers. This includes form validation schemas, API input schemas, and any reusable type definitions. Import schemas from this directory rather than defining them inline.

### `/app/src/layout/` - Reusable UI Components

Custom components specific to the game (beyond basic Shadcn components).

### `/app/drizzle/` - Database Layer

- `schema.ts` - Complete database schema (40+ tables)
- `constants.ts` - Database constants and enums
- `migrations/` - Database migration files

## Combat System Architecture

The combat system is the most complex feature, with dedicated files:

**Core Files:**

- `combat/actions.ts` - Action availability and processing logic
- `combat/process.ts` - Round processing and effect application
- `combat/tags.ts` - Effect definitions (damage, healing, buffs, etc.)
- `combat/types.ts` - Zod schemas and TypeScript types
- `combat/util.ts` - Utility functions shared across combat system
- `combat/database.ts` - Database operations for combat
- `combat/ai_v2.ts` - AI behavior logic (rule-based system)
- `combat/drawing.ts` - Three.js rendering for combat visuals

**Key Functions:**

- `initiateBattle()` in `routers/combat.ts` - Start battles between users/AI
- `performAction()` in `routers/combat.ts` - Process user actions in combat

**⚠️ Battle Performance Requirements:**

The combat system has strict performance requirements. The data flow should be:

1. **Battle Initiation (`initiateBattle`)**: Load ALL required user data into the battle state. This includes user stats, items, jutsus, bloodlines, village info, quest data, and any other fields needed during combat (e.g., `rankedStreak`, `rankedWins`).

2. **Action Processing (`performAction`)**:
   - ONE initial query to fetch the battle state from the database
   - Process all combat logic using the pre-loaded battle state data
   - ONE parallel mutation step (`Promise.all`) for all database updates at the end

**NEVER add intermediate fetch queries during `performAction`**. If you need data during combat that isn't available, add it to the battle state during `initiateBattle` instead. This ensures combat endpoints remain performant.

## Native Apps (iOS / Android)

The native shells live in `mobile/` — a Capacitor project alongside `soketi/` and
`spacetimedb-towerdefense/`, with its own `package.json`. See `mobile/README.md` for build
prerequisites and store setup.

- **`app/src/libs/native/` is the only bridge to the shell**, and it has two kinds of
  export. *Fire-and-forget* ones — `haptics`, `widgets`, `audioSession`, `liveActivity` —
  no-op off device, so `haptics.impact("HEAVY")` needs no platform check and does nothing
  in a browser. *Result-bearing* ones — `appleAuth.authorize`, `oauthBrowser.open`,
  `purchases.purchase`, `push.register` — reject off device instead, because a sign-in that
  silently resolved without opening a browser would leave the caller waiting on a redirect
  that never comes. Call those only from a path that has established it is in the shell.
  A biome `noRestrictedImports` rule blocks `@capacitor/*` and the raw `bridge` module
  everywhere else under `src/`.
- **Capacitor packages are installed in `mobile/`, not `app/`.** `cap sync` needs them next
  to the native projects, and the web app reaches plugins through the `window.Capacitor`
  bridge the shell injects. Adding a plugin means installing it in `mobile/` *and* adding a
  wrapper in `libs/native/`.
- **Ordinary notifications go through `sendPushToUsers` in `@/server/utils/push`** — no
  router should reach a transport directly. It resolves devices, honours per-category
  opt-outs, fans out to both transports and prunes dead tokens. It never throws. Live
  Activities are the one exception, and go through `pushActivityUpdate` in the same
  directory: they address an ActivityKit push token rather than a device, so they cannot
  use the device fan-out. `hospital.ts` calls it, deferred with `after()` so a round-trip
  to Apple stays off the player's response.
- **The `Notification` table is a global announcement feed, not per-user delivery.** Its
  `userId` is the author; recipients are whoever the accompanying `unreadNotifications`
  increment targets. Push is genuinely per-user, so the two are separate systems.
- **The store gate is client-side.** `useNativeShell()` branches surfaces that must differ
  in the app: `points/page.tsx` renders `<NativeStore />` in place of the PayPal flow,
  because App Store guideline 3.1.1 forbids web checkout there. `isNativeUserAgent()` in
  `libs/native/userAgent.ts` exists and is tested for a server-side branch, but no router
  uses it yet.

## Database Patterns

- Uses Drizzle ORM with MySQL hosted on **PlanetScale**
- Prefer query syntax over raw SQL
- **Prefer guard clauses over transactions** - reach first for a WHERE condition that makes the update atomic on its own (e.g., `WHERE balance >= amount` to prevent negative balances) and check `rowsAffected`. This is cheaper and composes with parallel reads. Transactions *are* supported — the PlanetScale serverless driver runs interactive transactions by chaining a session token through each response, and `home.ts`, `item.ts`, `occupation.ts`, `paypal.ts` and `purchases/grant.ts` all use them — but that chaining forces every statement inside the transaction to be **sequential**, so `Promise.all` does not apply and each statement costs a full round-trip. Use one only when several rows must move together and no single guarded statement can express it, and keep the body as short as possible.
- **Prefer the readable form when the only race is the player's own.** A guard belongs inside the statement when losing the race costs someone else something or cannot be undone: a balance going negative, a receipt delivered twice, a reward two requests both claim. When the only way to lose is the same account racing itself (deleting while registering a device, toggling a setting mid-deletion) and the worst outcome is a stray row support can remove, write the plain check-then-write instead — `isLivePushUser` then `.insert().values()`, not an `INSERT … SELECT … FROM (SELECT 1) WHERE EXISTS` with a `rowsAffected` heuristic — and say in a comment what the window costs. Never close such a window with a transaction or `FOR UPDATE`: a locking read on a row that does not exist takes a gap lock, which is how this codebase has deadlocked before. `register.ts` and `push.ts` are the reference for the plain form; the atomic claims in `purchases/grant.ts` are the reference for a guard that must stay in the statement.
- Schema is centralized in `@/drizzle/schema.ts`
- We use the react compiler, and therefore must use useWatch hook, not watch, for react-hook-form.
- **No Legacy Fields**: When refactoring database schema, fully remove legacy/deprecated fields rather than keeping them for backward compatibility. Do not leave legacy fields in the schema - migrate all code to use new field names immediately.
- **Minimize DB Roundtrips**: For queries, prefer reducing the number of database roundtrips over reducing the amount of data fetched. Running queries in parallel with `Promise.all()` is faster than running them sequentially, even if it means fetching slightly more data upfront.

### CAS / idempotency (rewards and economy)

Grants are the case where a transaction is least likely to be worth its latency, because a single guarded statement usually expresses the whole invariant. Use **compare-and-swap** predicates and verify `rowsAffected` before granting irreversible rewards:

- Examples: raid reward JSON guards (`raids.ts`), activity streak `lastClaimDate` (`activityStreak.ts`), helpers in `@/server/utils/concurrency.ts` (`claimUserSnapshot`, `consumeUserItemAtomically`).
- Prefer **SQL increments** on counters (money, XP, prestige) via `` sql`${userData.money} + ${delta}` `` when parallel grants could otherwise apply the same stale base snapshot—mirror how village tokens and clan points already use atomic `+=` in `updateRewards`.

**Tournament reads:** `tournament.getTournament` awaits `syncTournamentState` before loading data so brackets advance and finals pay out without a separate client mutation. That procedure intentionally performs conditional writes; keep it off HTTP edge caches (normal authenticated tRPC POST batching is fine).

## tRPC Patterns

- All API endpoints use tRPC for type safety
- Mutations follow pattern: queries → guards → mutation
- Mutations typical return type is `baseServerResponse` from `@/server/api/trpc`
- Check existing endpoints to avoid duplication
- Structure endpoints consistently across routers
- Convenience functions for database interaction should be in the router files at the bottom, see e.g. "fetchUser" function in profile router.

### ⚠️ CRITICAL: Minimize Database Round-Trips

**This is a high-priority performance requirement.** When writing tRPC router endpoints:

1. **ALWAYS prefer `Promise.all()` for parallel queries** over sequential fetches, even if it means fetching slightly more data than strictly necessary.
2. **Latency matters more than bandwidth** - multiple sequential database calls add latency that compounds. A single round-trip fetching extra data is almost always faster than multiple round-trips fetching minimal data.
3. **Fetch data in parallel at the start** of your endpoint, then process/filter in JavaScript.

**Good pattern:**

```typescript
const [user, village, clan, items] = await Promise.all([
  fetchUser(userId),
  fetchVillage(villageId),
  fetchClan(clanId),
  fetchUserItems(userId), // Fetch all, filter in JS if needed
]);
```

**Bad pattern:**

```typescript
const user = await fetchUser(userId);
const village = await fetchVillage(user.villageId); // Sequential!
const clan = await fetchClan(user.clanId); // Sequential!
const items = await fetchUserItems(userId); // Sequential!
```

**Exception:** Only avoid parallel fetching when a query is especially expensive (e.g., complex aggregations, large table scans) AND the data may not be needed based on earlier results.

## Code Style Guidelines

- Use TypeScript with strict mode
- Functional and declarative patterns (avoid classes)
- Prefer named exports for components
- Use descriptive variable names with auxiliary verbs
- Component file structure: exported component → subcomponents → helpers → types. When adding sub-components to a page or component file, always keep sub-components below the main exported component in the file ordering.
- **Natural Comments Only**: Do not leave unnatural comments like "Issue X:", "TODO from review:", or similar tracking markers in committed code. Comments should describe the code's purpose, not reference external issues or review feedback. Remove any such markers before committing.
- **Time Utilities**: When adding time-related utility functions, always add them to `/app/src/utils/time.ts`. Check existing functions there first to avoid duplication.
- **Use Constants**: When displaying game-related values in the UI (costs, thresholds, damage values, etc.), always import and use the actual constants from `@/drizzle/constants.ts` rather than hardcoding values. This ensures values stay in sync and only need to be updated in one place.

## UI/Styling Guidelines

- Use Shadcn UI and Radix components
- Prioritize components from `/app/src/layout/` for reusability
- Mobile-first responsive design with Tailwind
- Optimize for Web Vitals (LCP, CLS, FID)

## Frontend React Guidelines

- **React Rules of Hooks**: All React hooks (useState, useEffect, useQuery, useMutation, etc.) MUST be called unconditionally and in the same order on every render. Hooks must be placed BEFORE any early returns (e.g., `if (!data) return <Loader />`) in the component.
- **Hook Ordering**: Always place all hooks at the top of the component, before any conditional logic or early returns.
- **Conditional Hook Enabling**: Use the `enabled` option for queries instead of conditionally calling hooks (e.g., `useQuery({ enabled: !!userData })`).
- **Check for Render Errors**: After modifying frontend components, verify there are no "Rendered more hooks than during the previous render" or similar React hook violations.

## Permission System

Centralized permission logic in `/app/src/utils/permissions.ts`.

## Error Handling & Sentry

### Sentry Error Filtering (`instrumentation-client.ts`)

When adding errors to the Sentry ignore list or `beforeSend` filter:

1. **Never just ignore - ensure graceful UX handling**: Before filtering an error from Sentry, verify that the error is handled gracefully for users. The global tRPC error handler in `_trpc/Provider.tsx` shows toast notifications for most API errors, but check that:

   - Users see a meaningful error message (via toast, inline error, or error boundary)
   - The application doesn't break or show blank screens
   - Any loading states are properly resolved

2. **Document UX handling**: Add a comment explaining how the error is handled for UX when filtering it from Sentry (see `isReplicateApiError` for an example).

3. **Use precise matching**: For URL-based filters, use regex patterns that properly validate the domain rather than simple substring checks to avoid false positives from spoofed URLs.

4. **Common filtered error categories**:
   - Third-party script errors (PayPal, Clerk, Google Translate, Cookiebot)
   - Network errors during navigation (handled by tRPC retry logic)
   - Transient third-party API errors (Replicate gateway errors)
   - Browser extension conflicts
   - Hydration mismatches (typically not user-visible)
