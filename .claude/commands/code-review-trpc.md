---
description: Reviews tRPC routers for performance and pattern compliance
allowed-tools: Read, Grep, Glob, Bash(git diff:*, git status:*), Write, TodoWrite
---

# tRPC Router Review

Review tRPC router files in `app/src/server/api/routers/` for compliance with project patterns.

**Arguments**: `$ARGUMENTS` should contain `<IDENTIFIER>`

- **IDENTIFIER** (required): Used to organize review output files

## Process

### Step 1: Create Todo Checklist

**BEFORE starting, create a todo list with all checks.** Use TodoWrite:

- [ ] Get changed router files
- [ ] Read full file contents (not just diffs)
- [ ] Check sequential queries - Look for await statements that should be parallelized
- [ ] Check Promise.all usage - Verify awaits ABOVE Promise.all are merged in
- [ ] Check mutation outputs - Verify .output(baseServerResponse) on mutations
- [ ] Check error handling - Verify errorResponse() instead of throw new Error()
- [ ] Check for transactions - Flag any database transaction usage
- [ ] Write findings or return PASS

Mark each todo as completed after performing it.

### Step 2: Execute Review

1. Get changed `.ts` files in routers (excluding migrations):
   - `git diff --name-only main...HEAD -- 'app/src/server/api/routers/*.ts' ':!**/migrations/**'` (branch commits)
   - `git diff --name-only --cached -- 'app/src/server/api/routers/*.ts' ':!**/migrations/**'` (staged)
   - `git diff --name-only -- 'app/src/server/api/routers/*.ts' ':!**/migrations/**'` (unstaged)
2. **Read the FULL file content** for each changed file - you MUST read the entire file, not just the diff
3. **Locate the changed code within the file**, then examine the ENTIRE procedure containing those changes
4. **For every `Promise.all` in the function:**
   - Look at the lines ABOVE the Promise.all (within the same function)
   - If there is ANY `await` statement above it that doesn't depend on the Promise.all results, report it as a CRITICAL issue
   - This check is mandatory even if the Promise.all itself was not changed
5. **For every mutation:**
   - Check if it has `.output(baseServerResponse)` in the chain
   - Check if errors use `return errorResponse()` instead of `throw new Error()`

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

### Mandatory check for every Promise.all:

When you see a `Promise.all`, you MUST check the 10-50 lines ABOVE it for any `await` statement. If there is an `await` above the `Promise.all` and it doesn't depend on results from the Promise.all, it MUST be merged into the Promise.all. This is a CRITICAL issue.

Example of what to catch:

```typescript
const x = await query1(); // <-- THIS must be merged into the Promise.all below
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
const village = await fetchVillage(ctx.drizzle, villageId); // Sequential!
```

- GOOD: Use `Promise.all()`

```typescript
const [user, village] = await Promise.all([fetchUser(ctx.drizzle, userId), fetchVillage(ctx.drizzle, villageId)]);
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

## Output

### If tRPC issues found (NEEDS FIXES):

1. **Save detailed findings** to `.claude/review/$IDENTIFIER/trpc.md` using Write tool (replace `$IDENTIFIER` with actual identifier from arguments):

   ```
   # tRPC Review Results

   ## Critical Issues
   - `file.ts:line` - [issue type] - [description] - [fix suggestion]

   ## Warnings
   - `file.ts:line` - [warning type] - [description]

   ## Summary
   X critical issues, Y warnings
   ```

2. **Return only**:
   ```
   tRPC: NEEDS FIXES
   Findings saved to: .claude/review/$IDENTIFIER/trpc.md
   ```

### If review passes (PASS):

Return only: "tRPC: PASS"
