---
description: Reviews game logic for correctness, safety, and consistency
allowed-tools: Read, Grep, Glob, Bash(git diff:*, git status:*), Write, TodoWrite
---

# Game Logic Review

Review code for game logic correctness, ensuring attribution, transfers, ownership, and state management are handled safely.

**Arguments**: `$ARGUMENTS` should contain `<IDENTIFIER>`

- **IDENTIFIER** (required): Used to organize review output files

## Process

### Step 1: Create Todo Checklist

**BEFORE starting, create a todo list with all checks.** Use TodoWrite:

- [ ] Get changed files
- [ ] Read full file contents (not just diffs)
- [ ] Check attribution - Verify rewards/XP go to correct user
- [ ] Check resource transfers - Verify balance checks before deductions
- [ ] Check ownership verification - Verify user owns items before modifying
- [ ] Check self-targeting - Verify actions can't inappropriately self-target
- [ ] Check double-spend - Verify actions can't be exploited for multiple rewards
- [ ] Check race conditions - Verify atomic guards on read-then-write patterns
- [ ] Write findings or return PASS

Mark each todo as completed after performing it.

### Step 2: Execute Review

1. Get changed `.ts` and `.tsx` files (excluding migrations):
   - `git diff --name-only main...HEAD -- '*.ts' '*.tsx' ':!**/migrations/**'` (branch commits)
   - `git diff --name-only --cached -- '*.ts' '*.tsx' ':!**/migrations/**'` (staged)
   - `git diff --name-only -- '*.ts' '*.tsx' ':!**/migrations/**'` (unstaged)
2. **Read the FULL file content** for each changed file - you MUST read the entire file, not just the diff
3. **Locate the changed code within the file**, then examine the ENTIRE function containing those changes
4. **For every database update that modifies resources (money, XP, items):**
   - Check if there's a WHERE clause guard for sufficient balance
   - Check if the correct userId is being modified
   - Check if affected rows are verified after the update
   - This check is mandatory even if only part of the mutation was changed
5. **For every action that targets another entity:**
   - Check for self-targeting prevention if applicable
   - Check for ownership verification

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
const result = await ctx.drizzle
  .update(userData)
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

## Output

### If logic issues found (NEEDS FIXES):

1. **Save detailed findings** to `.claude/review/$IDENTIFIER/logic.md` using Write tool (replace `$IDENTIFIER` with actual identifier from arguments):

   ```
   # Game Logic Review Results

   ## Critical Issues
   - `file.ts:line` - [issue type] - [description] - [fix suggestion]

   ## Warnings
   - `file.ts:line` - [warning type] - [description]

   ## Summary
   X critical issues, Y warnings
   ```

2. **Return only**:
   ```
   Logic: NEEDS FIXES
   Findings saved to: .claude/review/$IDENTIFIER/logic.md
   ```

### If review passes (PASS):

Return only: "Logic: PASS"
