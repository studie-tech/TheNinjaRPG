---
description: Reviews code for overly broad error ignores, exception handlers, and filters that could mask real issues
allowed-tools: Read, Grep, Glob, Bash(git diff:*, git status:*), Write, TodoWrite
---

# Specific Ignores Review

Review code for overly broad error ignores, exception handlers, and filter patterns that could mask legitimate issues.

**Arguments**: `$ARGUMENTS` should contain `<IDENTIFIER>`

- **IDENTIFIER** (required): Used to organize review output files

## Process

### Step 1: Create Todo Checklist

**BEFORE starting, create a todo list with all checks.** Use TodoWrite:

- [ ] Get changed files
- [ ] Read full file contents (not just diffs)
- [ ] Check error message ignores - Verify ignores are specific, not generic
- [ ] Check catch-all handlers - Verify unexpected errors are re-thrown
- [ ] Check regex patterns - Verify patterns don't over-match
- [ ] Check silent failures - Verify errors are logged or tracked
- [ ] Check stack trace usage - Prefer stack-based filtering over message-only
- [ ] Write findings or return PASS

Mark each todo as completed after performing it.

### Step 2: Execute Review

1. Get changed `.ts` and `.tsx` files (excluding migrations):
   - `git diff --name-only main...HEAD -- '*.ts' '*.tsx' ':!**/migrations/**'` (branch commits)
   - `git diff --name-only --cached -- '*.ts' '*.tsx' ':!**/migrations/**'` (staged)
   - `git diff --name-only -- '*.ts' '*.tsx' ':!**/migrations/**'` (unstaged)
2. Filter to relevant files containing error handling patterns
3. **IMPORTANT: Read the FULL file content** for each changed file
4. **Analyze the specificity** of each error handling pattern:
   - Is it matching on message only, or also checking origin/stack?
   - Could a different error match this pattern accidentally?
   - Is there a more specific way to identify the intended error?
5. Report findings with recommendations for more specific filtering

## Critical Review Mindset

**Your job is to FIND OVERLY BROAD IGNORES. Do NOT validate or praise code.**

### What NOT to output:

- "correctly scoped" or "appropriately specific" - this is praise, not a finding
- "good filtering practice" - this is validation, not a finding
- Any statement saying code is good/correct/proper - SKIP IT ENTIRELY
- Do NOT include items in your output that aren't actual specificity issues

### What TO output:

- ONLY actual issues where ignores/filters are too broad
- If you find no issues, say "PASS" with no other commentary

## Patterns to Check

### Critical Issues (Must Fix)

**Overly Broad Error Message Ignores**

- Generic error messages that could match multiple different errors

```typescript
// BAD: Could match ANY split error from anywhere
ignoreErrors: [
  "Cannot read properties of undefined (reading 'split')",
]

// GOOD: Check stack trace to ensure it's the specific error we want to ignore
beforeSend(event) {
  const message = event.exception?.values?.[0]?.value ?? "";
  const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];

  if (message.includes("Cannot read properties of undefined (reading 'split')")) {
    const isFromExpectedSource = frames.some(
      (frame) => frame.filename?.includes("encode-uri-path")
    );
    if (isFromExpectedSource) {
      return null;
    }
  }
  return event;
}
```

**Catch-All Exception Handlers**

- Catching `Exception` or `Error` base classes without re-throwing unexpected errors

```typescript
// BAD: Swallows ALL errors
try {
  riskyOperation();
} catch (e) {
  console.log("Something failed");
}

// GOOD: Handle expected errors specifically
try {
  riskyOperation();
} catch (e) {
  if (e instanceof ExpectedError) {
    handleExpected(e);
  } else {
    throw e; // Re-throw unexpected errors
  }
}
```

**Regex Patterns That Over-Match**

- Regex in ignoreErrors that could match unintended strings

**Silent Failures Without Logging**

- Ignoring errors without any indication they occurred

### Warnings (Should Fix)

**Message-Only Filtering When Stack Available**

- Using only message matching when stack trace would be more reliable

**Ignoring Errors by Partial String Match**

- Using `.includes()` or partial regex when exact match would be safer

**Multiple Similar Ignores That Could Be Consolidated**

- Several ignore patterns that could be one more specific pattern

**Empty Catch Blocks**

- Catching errors with empty handlers

## Files to Check

Focus on files containing error handling patterns:

- `instrumentation-client.ts` - Sentry client configuration
- `sentry.*.config.ts` - Sentry server/edge configuration
- `**/error.tsx` - React error boundaries
- `**/*.ts` with `try/catch` blocks
- Files with `ignoreErrors`, `beforeSend`, `denyUrls`

## Output

### If specificity issues found (NEEDS FIXES):

1. **Save detailed findings** to `.claude/review/$IDENTIFIER/specific-ignores.md` using Write tool (replace `$IDENTIFIER` with actual identifier from arguments):

   ```
   # Specific Ignores Review Results

   ## Critical Issues
   - `file.ts:line` - [issue type]
     - Current: [what the code does now]
     - Problem: [why it's too broad]
     - **Recommendation**: [how to make it more specific]

   ## Warnings
   - `file.ts:line` - [issue type]
     - [description of concern]
     - **Recommendation**: [suggestion]

   ## Summary
   X critical issues, Y warnings
   ```

2. **Return only**:
   ```
   Specific Ignores: NEEDS FIXES
   Findings saved to: .claude/review/$IDENTIFIER/specific-ignores.md
   ```

### If review passes (PASS):

Return only: "Specific Ignores: PASS"
