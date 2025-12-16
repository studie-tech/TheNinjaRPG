# Fix hydration mismatch causing read-only stack error

## Goal
Eliminate the Suspense hydration mismatch on `/` that causes React to create an error object whose `stack` property cannot be reassigned. Once the mismatch is resolved, the client should hydrate cleanly without throwing.

## Reasoning & Constraints
- The stack trace shows React error `419`, which flags a hydration mismatch inside a `<Suspense>` boundary.
- We wrap large parts of the tree with `ClerkProvider`, layout switchers, and other dynamic UI. Anything that renders differently between SSR and CSR (random values, `window` access, media queries, user session state) can cause the mismatch.
- Fix must preserve existing UX, respect Shadcn/Tailwind conventions, and avoid disabling Suspense entirely unless no better option exists.

## Detailed Plan
1. **Map the Suspense boundary hierarchy**
   - Inspect `app/src/app/layout.tsx`, root providers, and any custom `Providers` component to see how Suspense boundaries, `ClerkProvider`, and layout switchers are composed.
   - Note components that run only on the client (e.g., ones using `window`, `matchMedia`, or `localStorage`).

2. **Identify non-deterministic rendering**
   - Review `app/src/app/page.tsx` (and any immediately rendered child such as `LayoutSwitcher`) for code that branches on client-only info.
   - Search for hooks like `useMediaQuery`, `useClientEffect`, or direct `typeof window !== 'undefined'` checks that might execute during SSR differently than CSR.
   - Focus on components inside Suspense boundaries, since the mismatch is detected there.

3. **Design the fix**
   - For components that cannot render deterministically on the server, gate them behind `useIsClient`/`useMounted` hooks or convert them to dynamic imports with `{ ssr: false }` so SSR output matches CSR.
   - Alternatively, adjust Suspense fallbacks (e.g., render the same skeleton both server and client) or move client-only rendering behind conditional checks that default to a stable server value.

4. **Implement the fix**
   - Modify the offending component(s) to ensure deterministic output. Keep code concise, using shared hooks/components where available (`useIsClient`, `LayoutContainer`, etc.).
   - Add clarifying comments if logic is non-obvious.

5. **Verification**
   - Run targeted lint/tests (e.g., `bun run lint app/src/app/page.tsx` or component-specific tests) to ensure no regressions.
   - If feasible, run the dev server briefly to confirm the homepage hydrates without the error (or add instrumentation).

## Next Steps
Await approval before executing the plan. Once approved, proceed with investigation (Step 1) and keep this task file updated with progress notes.
