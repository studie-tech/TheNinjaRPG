---
description: Reviews that backend endpoints are actually consumed by frontend components and vice versa
allowed-tools: Read, Grep, Glob, Bash(git diff:*, git status:*), Write, TodoWrite
---

# Fullstack Link Review

Review code to ensure that backend endpoints (tRPC procedures, API routes) are properly linked with frontend components. This review catches two critical issues:

1. **Orphaned Backend**: Backend endpoints with no frontend consumer (AI implements backend but forgets frontend)
2. **Dead Backend Code**: Frontend removes endpoint usage but backend code remains (cleanup forgotten)

**Arguments**: `$ARGUMENTS` should contain `<IDENTIFIER>`

- **IDENTIFIER** (required): Used to organize review output files

## Process

### Step 1: Create Todo Checklist

**BEFORE starting, create a todo list with all checks.** Use TodoWrite:

- [ ] Get changed backend files - Get list of changed router/API files
- [ ] Identify new/modified procedures - Extract procedure names from changes
- [ ] Search for frontend consumers - Check if procedures are called from frontend
- [ ] Check API route consumers - Verify API routes have fetch calls
- [ ] Verify input/output compatibility - Check frontend passes correct data
- [ ] Get changed frontend files - Get list of changed frontend components
- [ ] Identify removed endpoint usages - Find removed api.x.y calls in frontend
- [ ] Check if removed endpoints are used elsewhere - Search codebase for other consumers
- [ ] Flag dead backend code - Report unused backend endpoints for removal
- [ ] Write findings or return PASS

Mark each todo as completed after performing it.

### Step 2: Execute Review (New Backend → Frontend Check)

1. Get changed backend files (excluding migrations):
   - `git diff --name-only main...HEAD -- 'app/src/server/api/routers/*.ts' 'app/src/app/api/**/*.ts' ':!**/migrations/**'` (branch commits)
   - `git diff --name-only --cached -- 'app/src/server/api/routers/*.ts' 'app/src/app/api/**/*.ts' ':!**/migrations/**'` (staged)
   - `git diff --name-only -- 'app/src/server/api/routers/*.ts' 'app/src/app/api/**/*.ts' ':!**/migrations/**'` (unstaged)
2. Get the actual diff content to identify added/modified procedures
3. **Read the FULL file content** for each changed backend file
4. **Extract new/modified procedure names:**
   - For tRPC: Look for new `.query(`, `.mutation(` definitions
   - For API routes: Note the route path from the file location
5. **Search for frontend consumers:**
   - For tRPC procedures: Search `app/src/app/` and `app/src/layout/` for `api.{routerName}.{procedureName}`
   - For API routes: Search for `fetch("` or `fetch('` calls to the route path
6. **If a consumer exists, verify compatibility:**
   - Check that frontend passes all required input fields
   - Check that frontend handles the response structure

### Step 3: Execute Review (Removed Frontend → Dead Backend Check)

1. Get changed frontend files:
   - `git diff --name-only main...HEAD -- 'app/src/app/**/*.tsx' 'app/src/layout/**/*.tsx' ':!**/migrations/**'` (branch commits)
   - `git diff --name-only --cached -- 'app/src/app/**/*.tsx' 'app/src/layout/**/*.tsx' ':!**/migrations/**'` (staged)
   - `git diff --name-only -- 'app/src/app/**/*.tsx' 'app/src/layout/**/*.tsx' ':!**/migrations/**'` (unstaged)
2. Get the actual diff content to identify **removed** endpoint usages (lines starting with `-`)
3. **Extract removed procedure calls:**
   - Look for removed lines containing `api.{routerName}.{procedureName}` patterns
   - Look for removed `fetch(` calls to API routes
4. **For each removed endpoint usage, search the entire codebase for other consumers:**
   - Search all of `app/src/` for `api.{routerName}.{procedureName}`
   - If the endpoint is still used elsewhere, no issue
   - If NO other usage exists, the backend endpoint is now dead code
5. **Verify backend endpoint still exists:**
   - Check if the procedure is still defined in the corresponding router file
   - If it exists but has no consumers, flag for removal

## Critical Review Mindset

**Your job is to FIND MISSING INTEGRATIONS and DEAD CODE. Do NOT validate or praise code.**

### What NOT to output:

- "Frontend correctly calls the endpoint" - this is praise, not a finding
- "Good integration between frontend and backend" - this is validation, not a finding
- Any statement saying the integration is correct/complete - SKIP IT ENTIRELY
- Do NOT include items in your output that aren't actual integration issues

### What TO output:

- ONLY actual missing frontend consumers, dead backend code, or integration issues
- If you find no issues, say "PASS" with no other commentary

### Review approach:

- For ANY new tRPC procedure - search for `api.routerName.procedureName` usage in frontend
- For ANY new API route - search for fetch calls to that route path
- For ANY modified procedure input - verify frontend passes new required fields
- For ANY modified procedure output - verify frontend handles new response shape
- For ANY removed frontend endpoint usage - search if backend is still used elsewhere
- Assume there ARE issues until you've proven otherwise

### Mandatory check for new procedures:

When you find a new tRPC procedure (query or mutation), you MUST:

1. Identify the router name (filename without .ts extension)
2. Identify the procedure name (the key in the router object)
3. Search for `api.{routerName}.{procedureName}` in frontend files
4. If NO usage found, report as CRITICAL - the endpoint is orphaned

Example of what to catch:

```typescript
// In app/src/server/api/routers/clan.ts - NEW procedure added:
rotateElders: protectedProcedure
  .input(z.object({ clanId: z.string() }))
  .output(baseServerResponse)
  .mutation(async ({ ctx, input }) => { ... })
```

Must find frontend usage like:

```typescript
// In some frontend component:
const { mutate: rotateElders } = api.clan.rotateElders.useMutation(...)
```

If no such usage exists, the backend endpoint is orphaned and needs frontend integration.

### Mandatory check for removed frontend usages:

When you find a removed `api.{routerName}.{procedureName}` call in the diff, you MUST:

1. Identify the router name and procedure name from the removed line
2. Search the ENTIRE codebase for other usages of `api.{routerName}.{procedureName}`
3. If NO other usage exists anywhere, report as CRITICAL - the backend is now dead code

Example of what to catch:

```diff
// In app/src/app/clan/page.tsx - REMOVED usage:
- const { mutate: rotateElders } = api.clan.rotateElders.useMutation(...)
```

Must search for any remaining usage:

```bash
# Search entire codebase for other consumers
grep -r "api.clan.rotateElders" app/src/
```

If no other usage exists but the backend procedure `rotateElders` still exists in `clan.ts`, the backend endpoint is now dead code and should be removed.

## Patterns to Check

### Critical Issues (Must Fix)

**1. Orphaned Backend Endpoints (New backend, no frontend)**

- New tRPC procedure with no frontend consumer
- New API route with no fetch calls from frontend
- AI implemented backend logic but forgot frontend integration

**2. Dead Backend Code (Frontend removed, backend remains)**

- Frontend removed usage of a tRPC procedure
- Backend procedure still exists but has NO consumers anywhere in codebase
- Backend should be cleaned up to avoid code rot

**3. Input Mismatch**

- Procedure expects fields the frontend doesn't provide
- Frontend passes fields the procedure doesn't accept

**4. Output Mismatch**

- Frontend expects response fields the procedure doesn't return
- Procedure returns new structure that frontend doesn't handle

### Warnings (Should Fix)

**1. Incomplete Error Handling**

- Frontend doesn't handle error states from the endpoint

**2. Missing Loading States**

- Frontend calls endpoint but doesn't show loading indicator

**3. Stale Frontend Code**

- Frontend still references a renamed/removed procedure

## What This Review Does NOT Check

- Whether the backend logic itself is correct (see logic review)
- Whether the frontend UI is well-designed (see UX review)
- Whether the tRPC patterns are followed (see tRPC review)

This review ONLY checks that backend and frontend are properly connected in BOTH directions:

- New backend endpoints have frontend consumers (orphaned backend check)
- Removed frontend usages don't leave dead backend code (dead code check)

## Output

### If integration issues found (NEEDS FIXES):

1. **Save detailed findings** to `.claude/review/$IDENTIFIER/fullstack-link.md` using Write tool (replace `$IDENTIFIER` with actual identifier from arguments):

   ```
   # Fullstack Link Review Results

   ## Critical Issues
   - `backend-file.ts:line` - [orphaned backend] - Procedure `routerName.procedureName` has no frontend consumer
   - `backend-file.ts:line` - [dead backend code] - Procedure `routerName.procedureName` no longer used anywhere, should be removed
   - `frontend-file.tsx:line` - [input mismatch] - Calls `api.x.y` but passes wrong input shape

   ## Warnings
   - `file.ts:line` - [warning type] - description

   ## Summary
   X critical issues, Y warnings
   ```

2. **Return only**:
   ```
   Fullstack Link: NEEDS FIXES
   Findings saved to: .claude/review/$IDENTIFIER/fullstack-link.md
   ```

### If review passes (PASS):

Return only: "Fullstack Link: PASS"
