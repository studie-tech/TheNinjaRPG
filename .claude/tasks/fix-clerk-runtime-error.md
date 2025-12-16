# Plan: Fix Clerk runtime error on signup

## Goal
Prevent the "Cannot set property name" TypeError thrown when Clerk fails to load on `/signup`, ensuring the page handles Clerk runtime errors without crashing.

## Approach & Reasoning
1. **Map current Clerk integration on auth routes**
   - Need to understand which components/pages wrap `/signup` with Clerk and whether we extend Clerk's error handling.
   - Inspect relevant files (likely under `app/src/app/(auth)/signup`, shared auth layout, `ClerkProvider` setup) to know where to apply the fix without duplicating logic.

2. **Locate custom error instrumentation touching error objects**
   - The stack trace hints at an `Object.assign` call after the error is created, so search for helper utilities that clone error objects or enforce `name` fields.
   - Focus on middleware/hooks used with Clerk or Sentry (e.g., custom wrappers under `app/src/utils`, `app/src/libs/sentry`).

3. **Design a safe error-handling strategy**
   - Once the offending code is identified, update it to avoid mutating read-only properties (skip `name`, use `Object.defineProperty`, or copy only writable fields).
   - Ensure the fix stays consistent with existing patterns (functional style, descriptive names) and includes minimal, targeted changes.

4. **Implement the fix**
   - Modify the identified file(s) to guard against assigning to read-only properties, add concise comments if the logic is non-obvious.
   - Ensure typings stay strict and no duplicate logic is introduced.

5. **Validate**
   - If feasible, run a lightweight check (e.g., targeted unit test or `bunx next lint` on touched files) to ensure no regressions.
   - Reason about runtime behavior (Clerk timeout) to confirm the TypeError path is covered.

6. **Document status**
   - Update this plan file with progress notes while implementing.

## Tasks
- [ ] Inspect `/signup` route and shared auth wrappers.
- [ ] Find and analyze custom error instrumentation interacting with Clerk/Sentry.
- [ ] Update offending code to avoid setting read-only `name` property.
- [ ] Run validations (lint/tests) if practical.
- [ ] Summarize changes & verification steps for the user.
