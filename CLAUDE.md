# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

<important>
    Claude code should never (!) run git commands or github CLI!
</important>

## Before Starting Work

- Always make a plan in "plan mode"
- After you make the plan, write the plan to .claude/tasks/TASK_NAME.md
- The plan should be a detailed implementation plan and the reasoning behind them, as well as the tasks broken down.
- If the task requires external knowledge, research to retrieve this knowledge (use Task tool for research)
- Do not over plan, always try to find the simplest solution
- Once you have the plan, first ask me to review it, and do not continue untill I approve the plan.

## While Implementing

- You should update the task plan .md-file as you work
- After you complete tasks in the plan, also update and append information on the changes made to the task .md-file

## Development Commands

All make commands should be run from the root directory `/`, not from `/app`.

**Primary Development:**

- `make build` - Build the Next.js application. Only run if explicitly asked.
- `make test` - Run unit tests with vitest
- `make lint` - Run ESLint on the codebase

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

Shared validation schemas between frontend and backend using Zod.

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

## Database Patterns

- Uses Drizzle ORM with MySQL
- Prefer query syntax over raw SQL
- Always try to use `Promise.all()` for parallel database operations
- Avoid transactions; use guards with where-statements instead
- Schema is centralized in `@/drizzle/schema.ts`
- We use the react compiler, and therefore must use useWatch hook, not watch, for react-hook-form.
- **No Legacy Fields**: When refactoring database schema, fully remove legacy/deprecated fields rather than keeping them for backward compatibility. Do not leave legacy fields in the schema - migrate all code to use new field names immediately.

## tRPC Patterns

- All API endpoints use tRPC for type safety
- Mutations follow pattern: queries → guards → mutation
- Mutations typical return type is `baseServerResponse` from `@/server/api/trpc`
- Check existing endpoints to avoid duplication
- Structure endpoints consistently across routers
- Convenience functions for database interaction should be in the router files at the bottom, see e.g. "fetchUser" function in profile router.

## Code Style Guidelines

- Use TypeScript with strict mode
- Functional and declarative patterns (avoid classes)
- Prefer named exports for components
- Use descriptive variable names with auxiliary verbs
- Directory names: lowercase with dashes
- Component file structure: exported component → subcomponents → helpers → types

## UI/Styling Guidelines

- Use Shadcn UI and Radix components
- Prioritize components from `/app/src/layout/` for reusability
- Mobile-first responsive design with Tailwind
- Optimize for Web Vitals (LCP, CLS, FID)

## Permission System

Centralized permission logic in `/app/src/utils/permissions.ts`.
