---
agent: "CodeActAgent"
---

# Repository Purpose

This project is **TheNinja-RPG**, a browser-based RPG game built with Next.js 15. It's a comprehensive ninja-themed role-playing game featuring real-time combat, village systems, character progression, and complex game mechanics including jutsu, bloodlines, clans, and bounty hunting.

# Technology Stack

- **Frontend**: Next.js 15 + React 19 + TypeScript
- **Styling**: Tailwind CSS + Shadcn UI + Radix UI components
- **Database**: MySQL with Drizzle ORM
- **API**: tRPC for type-safe API endpoints
- **Authentication**: Clerk
- **State Management**: Jotai for client state
- **3D Graphics**: Three.js with React Three Fiber
- **Package Manager**: Bun

# Setup Instructions

**Primary Development Commands (run from root `/`):**

- `make build` - Build the Next.js application
- `make test` - Run unit tests with vitest
- `make lint` - Run biome linting on the codebase
- `make format` - Run biome formatting on the codebase
- `make install` - Install dependencies with bun
- `make makemigrations` - Generate database migration files (after updating schema.ts)
- `make bun add [package]` - Add new package dependency

# Repository Structure

## Core Directories

- **`/app/src/app/`**: Next.js App Router pages following Next.js 15 conventions

  - `combat/` - Real-time combat system
  - `profile/` - User profile management
  - `manual/` - Admin content management system
  - `village/` - Village/faction system

- **`/app/src/server/api/`**: tRPC Backend

  - `root.ts` - Main tRPC router aggregating all sub-routers
  - `routers/` - Individual feature routers (40+ routers)
  - `trpc.ts` - tRPC configuration and middleware

- **`/app/src/libs/`**: Feature-specific game logic

  - `combat/` - Complex turn-based combat system (see Combat System section)
  - `travel/` - 3D world map and movement system
  - `bounty/` - Bounty hunting system
  - Plus libraries for bloodlines, items, jutsu, clans, etc.

- **`/app/src/validators/`**: Zod schemas & inferred types for sharing between UI and tRPC endpoints

- **`/app/src/components/`**: Modified Shadcn layout components

- **`/app/src/layout/`**: Custom layout components specific to the codebase

- **`/app/src/utils/`**: Utility functions used across the codebase

- **`/app/src/hooks/`**: Custom React hooks

- **`/app/drizzle/`**: Database layer
  - `schema.ts` - Complete database schema (40+ tables)
  - `constants.ts` - Database constants and enums
  - `migrations/` - Database migration files

# Combat System Architecture

The combat system is the most complex feature with dedicated organization:

**Core Combat Files:**

- `/app/src/server/api/routers/combat.ts` - Main entry point with `initiateBattle` and `performAction` endpoints
- `/app/src/libs/combat/actions.ts` - User action logic and availability
- `/app/src/libs/combat/process.ts` - Round processing and effect application
- `/app/src/libs/combat/tags.ts` - Effect definitions (damage, heal, shield, etc.)
- `/app/src/libs/combat/types.ts` - Zod schemas and types for combat system
- `/app/src/libs/combat/util.ts` - Utility functions for combat
- `/app/src/libs/combat/database.ts` - Database operations for combat
- `/app/src/libs/combat/ai_v2.ts` - AI behavior logic (rule-based system)
- `/app/src/libs/combat/drawing.ts` - Three.js rendering for combat visuals

# Development Guidelines

## Code Style & Structure

- Write concise, technical TypeScript code with accurate examples
- Use functional and declarative programming patterns; avoid classes
- Prefer iteration and modularization over code duplication
- Use descriptive variable names with auxiliary verbs (e.g., isLoading, hasError)
- Always review previous similar implementations to maintain style consistency

## Code & Naming Conventions

- Use lowercase with dashes for directories (e.g., `components/auth-wizard`)
- Favor named exports for components
- When adding convenience methods for data fetching, always add at bottom of files

## Database Patterns

- Use Drizzle ORM with query syntax (avoid raw SQL except as last resort)
- Always try to use `Promise.all()` for parallel database operations
- Never use direct database transactions; use guards with where-statements instead
- Never create database migrations manually; use `make makemigrations`
- Schema is centralized in `@/drizzle/schema.ts`

## tRPC Patterns

- All API endpoints use tRPC for type safety
- Check existing endpoints to avoid duplication
- Structure mutations as: queries → guards → mutation
- Mutations should return `baseServerResponse` from `@/server/api/trpc`
- Add convenience database functions at bottom of router files

## UI & Styling

- Use Shadcn UI, Radix, and Tailwind for components and styling
- Use components from `/app/src/layout` whenever possible for code reuse
- Implement responsive design with Tailwind CSS using mobile-first approach
- Optimize Web Vitals (LCP, CLS, FID)

## Permissions

- Aggregate all permission controls in `/app/src/utils/permissions.ts`

## Important Notes

- Use React Compiler patterns: use `useWatch` hook, not `watch`, for react-hook-form
- Only run make commands in extreme cases; rely on editor integrations for linting
- Never run git commands or GitHub CLI when using automated tools
- If you implement backend functionality wrt. to a given issue, also implement corresponding frontend functionality!
