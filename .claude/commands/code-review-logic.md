---
description: Reviews game logic for correctness, safety, and consistency
allowed-tools: Read, Grep, Glob, Bash(git diff:*, git status:*), TaskCreate, TaskUpdate, TaskList, TaskGet
---

# Game Logic Review

Review code for game logic correctness, ensuring attribution, transfers, ownership, and state management are handled safely.

## Task Tracking

**IMPORTANT**: Before starting the review, create tasks for each major checkpoint using TaskCreate. Update each task to `in_progress` when starting and `completed` when done.

Create these tasks at the start:
1. "Get changed files" - Get list of files to review
2. "Read full file contents" - Read complete files (not just diffs)
3. "Check attribution" - Verify rewards/XP go to correct user
4. "Check resource transfers" - Verify balance checks before deductions
5. "Check ownership verification" - Verify user owns items before modifying
6. "Check self-targeting" - Verify actions can't inappropriately self-target
7. "Check double-spend" - Verify actions can't be exploited for multiple rewards
8. "Check race conditions" - Verify atomic guards on read-then-write patterns
9. "Compile findings" - Produce final report

Work through each task in order, marking as `in_progress` then `completed`.

## Critical Review Mindset

**Your job is to FIND LOGIC BUGS AND EXPLOITS. Do NOT validate or praise code.**

### What NOT to output:
- "Logic is correct" or "Good ownership check" - this is praise, not a finding
- "This properly handles the edge case" or "Safe implementation" - this is validation, not a finding
- Any statement saying logic is correct/safe/proper - SKIP IT ENTIRELY
- Do NOT include items in your output that aren't actual logic issues

### What TO output:
- ONLY actual logic bugs or exploit risks that need fixing
- If you find no issues, say "PASS" with no other commentary

### Review approach:
- Look for ANY reward/XP/money grant - is it attributed to the correct user?
- Look for ANY resource deduction - is there a balance check?
- Look for ANY item/resource modification - is ownership verified?
- Look for ANY action - can it be self-targeted when it shouldn't be?
- Look for ANY reward - can it be claimed multiple times?
- Assume there ARE logic bugs until you've proven otherwise

## Process

1. Get changed files:
   - `git diff --name-only main...HEAD` (branch commits)
   - `git diff --name-only --cached` (staged)
   - `git diff --name-only` (unstaged)
2. Filter to TypeScript files (`.ts`, `.tsx`)
3. **Read the FULL file content** for each changed file - you MUST read the entire file, not just the diff
4. **Locate the changed code within the file**, then examine the ENTIRE function containing those changes
5. **For every database update that modifies resources (money, XP, items):**
   - Check if there's a WHERE clause guard for sufficient balance
   - Check if the correct userId is being modified
   - Check if affected rows are verified after the update
   - This check is mandatory even if only part of the mutation was changed
6. **For every action that targets another entity:**
   - Check for self-targeting prevention if applicable
   - Check for ownership verification
7. Report ONLY actual problems - no praise, no validation, no "correctly handles" commentary

### Mandatory check for resource modifications:
When you see a database update that deducts resources, you MUST verify:
1. There is a WHERE clause with a balance check (e.g., `gte(userData.money, cost)`)
2. The result's affected rows are checked
3. If no guard exists, report as CRITICAL

Example of what to catch:
```typescript
// BAD - No balance guard
await ctx.drizzle.update(userData).set({ money: sql`money - ${cost}` });
```

This should be:
```typescript
const result = await ctx.drizzle.update(userData)
  .set({ money: sql`money - ${cost}` })
  .where(and(eq(userData.userId, userId), gte(userData.money, cost)));
if (result.rowsAffected === 0) {
  return errorResponse("Insufficient funds");
}
```

## Patterns to Check

### Critical Issues (Must Fix)

**1. Incorrect Attribution**
- Rewards, experience, reputation, or achievements attributed to wrong user

**2. Unsafe Resource Transfers**
- Deducting resources without checking if user has enough

**3. Missing Ownership Verification**
- Modifying items/resources without verifying the user owns them

**4. Self-Targeting Exploits**
- Actions that shouldn't allow self-targeting but don't check

**5. Double-Spend / Double-Reward**
- Same action can be executed multiple times for repeated rewards

**6. Race Condition Vulnerabilities**
- Read-then-write patterns without atomic guards

### Warnings

**1. Missing Permission Checks**
- Village-specific actions without village membership check
- Staff actions without role verification

**2. Insufficient Input Validation**
- User-provided IDs used directly without validation
- Numeric values not bounded

**3. State Consistency Issues**
- Related data updated separately without ensuring consistency

**4. Cooldown/Rate Limit Bypasses**
- Actions with cooldowns that can be bypassed

**5. Status Check Gaps**
- Actions allowed on users in invalid states

**6. Boundary Condition Errors**
- Off-by-one errors, zero/max value edge cases, division without zero-check

## Output Format

**IMPORTANT: Only include actual problems. Do NOT include:**
- Praise ("correct attribution", "safe implementation", "good guard")
- Validation ("properly handles", "correctly checks")
- Commentary on code that has no issues

```
## Game Logic Review: [PASS/NEEDS FIXES]

### Critical Issues
- `file.ts:line` - [issue type] - [description] - [fix suggestion]

### Warnings
- `file.ts:line` - [warning type] - [description]

### Summary
X critical issues, Y warnings
```

If no issues found, output ONLY:

```
Game Logic Review: PASS
```
