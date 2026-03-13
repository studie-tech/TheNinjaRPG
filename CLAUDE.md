# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.


## Development Commands

All make commands should be run from the root directory `/`, not from `/app`.

**Primary Development:**

- `make build` - Build the Next.js application. Only run if explicitly asked.
- `make test` - Run unit tests with vitest
- `make lint` - Run biome on the codebase
- `make typecheck` - Run typechecking on the codebase

**Database Management:**

- `make makemigrations` - Generate database migration files. Do this after updating schema.ts

**Package Management:**

- `make bun add [package]` - Add new package dependency
- `make install` - Install dependencies with bun

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

## Database Patterns

- Uses Drizzle ORM with MySQL hosted on **PlanetScale**
- Prefer query syntax over raw SQL
- **⚠️ NEVER use database transactions** - PlanetScale does not support traditional transactions. Instead, use guard clauses with WHERE conditions to ensure atomic updates (e.g., `WHERE balance >= amount` to prevent negative balances).
- Schema is centralized in `@/drizzle/schema.ts`
- We use the react compiler, and therefore must use useWatch hook, not watch, for react-hook-form.
- **No Legacy Fields**: When refactoring database schema, fully remove legacy/deprecated fields rather than keeping them for backward compatibility. Do not leave legacy fields in the schema - migrate all code to use new field names immediately.
- **Minimize DB Roundtrips**: For queries, prefer reducing the number of database roundtrips over reducing the amount of data fetched. Running queries in parallel with `Promise.all()` is faster than running them sequentially, even if it means fetching slightly more data upfront.

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
- Prefer arrow functions over function declarations (e.g., `const fn = () => {}` instead of `function fn() {}`)
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
