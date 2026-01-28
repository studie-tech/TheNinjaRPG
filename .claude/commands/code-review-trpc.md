---
description: Reviews tRPC routers for performance and pattern compliance
allowed-tools: Read, Grep, Glob, Bash(git diff:*), Bash(git status:*), TaskCreate, TaskUpdate, TaskList, TaskGet
---

# tRPC Router Review

Review tRPC router files in `app/src/server/api/routers/` for compliance with project patterns.

## Task Tracking

**IMPORTANT**: Before starting the review, create tasks for each major checkpoint using TaskCreate. Update each task to `in_progress` when starting and `completed` when done.

Create these tasks at the start:
1. "Get changed router files" - Get list of files in routers/ to review
2. "Read full file contents" - Read complete files (not just diffs)
3. "Check sequential queries" - Look for await statements that should be parallelized
4. "Check Promise.all usage" - Verify awaits ABOVE Promise.all are merged in
5. "Check mutation outputs" - Verify .output(baseServerResponse) on mutations
6. "Check error handling" - Verify errorResponse() instead of throw new Error()
7. "Check for transactions" - Flag any database transaction usage
8. "Compile findings" - Produce final report

Work through each task in order, marking as `in_progress` then `completed`.

## Critical Review Mindset

**Your job is to FIND tRPC PATTERN VIOLATIONS. Do NOT validate or praise code.**

### What NOT to output:
- "Queries are well parallelized" or "Good use of Promise.all" - this is praise, not a finding
- "Correctly uses baseServerResponse" or "Proper error handling" - this is validation, not a finding
- Any statement saying code follows patterns correctly - SKIP IT ENTIRELY
- Do NOT include items in your output that aren't actual issues

### What TO output:
- ONLY actual tRPC pattern violations that need fixing
- If you find no issues, say "PASS" with no other commentary

### Review approach:
- Look for ANY sequence of `await` statements - can they be parallelized?
- Look for ANY mutation - does it have `.output(baseServerResponse)`?
- Look for ANY `throw new Error` - should it be `return errorResponse()`?
- Look for ANY transaction usage - should it be WHERE guards instead?
- Assume there ARE pattern violations until you've proven otherwise

## Process

1. Get changed files:
   - `git diff --name-only main...HEAD` (branch commits)
   - `git diff --name-only --cached` (staged)
   - `git diff --name-only` (unstaged)
2. Filter to only files in `app/src/server/api/routers/`
3. **Read the FULL file content** for each changed file - you MUST read the entire file, not just the diff
4. **Locate the changed code within the file**, then examine the ENTIRE procedure containing those changes
5. **For every `Promise.all` in the function:**
   - Look at the lines ABOVE the Promise.all (within the same function)
   - If there is ANY `await` statement above it that doesn't depend on the Promise.all results, report it as a CRITICAL issue
   - This check is mandatory even if the Promise.all itself was not changed
6. **For every mutation:**
   - Check if it has `.output(baseServerResponse)` in the chain
   - Check if errors use `return errorResponse()` instead of `throw new Error()`
7. Report ONLY actual problems - no praise, no validation, no "correctly implemented" commentary

### Mandatory check for every Promise.all:
When you see a `Promise.all`, you MUST check the 10-50 lines ABOVE it for any `await` statement. If there is an `await` above the `Promise.all` and it doesn't depend on results from the Promise.all, it MUST be merged into the Promise.all. This is a CRITICAL issue.

Example of what to catch:
```typescript
const x = await query1();  // <-- THIS must be merged into the Promise.all below
if (!x) return;
const [a, b, c] = await Promise.all([query2(), query3(), query4()]);
```

This should become:
```typescript
const [x, a, b, c] = await Promise.all([query1(), query2(), query3(), query4()]);
if (!x) return errorResponse("Not found");
```

## Patterns to Check

### Critical Issues (Must Fix)

**1. Sequential Database Queries**
- BAD: Multiple `await` statements that could be parallelized
```typescript
const user = await fetchUser(ctx.drizzle, userId);
const village = await fetchVillage(ctx.drizzle, villageId);  // Sequential!
```
- GOOD: Use `Promise.all()`
```typescript
const [user, village] = await Promise.all([
  fetchUser(ctx.drizzle, userId),
  fetchVillage(ctx.drizzle, villageId),
]);
```

**2. Missing Output Type on Mutations**
- BAD: `.mutation(async ...)` without `.output()`
- GOOD: `.output(baseServerResponse).mutation(async ...)`

**3. Database Transactions**
- BAD: Any use of `transaction`, `ctx.drizzle.transaction`
- FIX: Use WHERE guard clauses instead

**4. Thrown Errors for Expected Conditions**
- BAD: `throw new Error("User not found")` for validation
- GOOD: `return errorResponse("User not found")`

### Warnings

**1. Complex Inline Validators**
- Large Zod schemas (>5 fields) should be in `@/validators/`

**2. Missing Guard Clauses**
- Mutations should validate user/permissions before modifying data

**3. Non-standard Naming**
- Queries should be named: `get*`, `getAll*`, `fetch*`
- Mutations should use action verbs: `create`, `update`, `delete`, `start`, `abandon`, `buy`, etc.

**4. Unexported Helper Functions**
- Fetch functions at bottom of file should be exported for reuse

## Output Format

**IMPORTANT: Only include actual problems. Do NOT include:**
- Praise ("well-parallelized", "correctly structured", "good pattern")
- Validation ("this is an improvement", "properly follows convention")
- Commentary on code that has no issues

```
## tRPC Review: [PASS/NEEDS FIXES]

### Critical Issues
- `file.ts:line` - [issue type] - [description] - [fix suggestion]

### Warnings
- `file.ts:line` - [warning type] - [description]

### Summary
X critical issues, Y warnings
```

If no issues found, output ONLY:

```
tRPC Review: PASS
```
