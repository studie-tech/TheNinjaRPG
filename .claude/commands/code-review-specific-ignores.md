---
description: Reviews code for overly broad error ignores, exception handlers, and filters that could mask real issues
allowed-tools: Read, Grep, Glob, Bash(git diff:*), Bash(git status:*), TaskCreate, TaskUpdate, TaskList, TaskGet
---

# Specific Ignores Review

Review code for overly broad error ignores, exception handlers, and filter patterns that could mask legitimate issues.

**Working directory**: $ARGUMENTS (or current directory if not provided)

## Task Tracking

**IMPORTANT**: Before starting the review, create tasks for each major checkpoint using TaskCreate. Update each task to `in_progress` when starting and `completed` when done.

Create these tasks at the start:
1. "Get changed files" - Get list of files with error handling
2. "Read full file contents" - Read complete files (not just diffs)
3. "Check error message ignores" - Verify ignores are specific, not generic
4. "Check catch-all handlers" - Verify unexpected errors are re-thrown
5. "Check regex patterns" - Verify patterns don't over-match
6. "Check silent failures" - Verify errors are logged or tracked
7. "Check stack trace usage" - Prefer stack-based filtering over message-only
8. "Compile findings" - Produce final report

Work through each task in order, marking as `in_progress` then `completed`.

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

### Review approach:
- When you see error ignores, ask "could this accidentally suppress a different, legitimate error?"
- When you see exception handlers, check if they're catching more than intended
- Prefer stack trace/origin-based filtering over message-only matching
- Assume ignores ARE too broad until you've verified their specificity

## Process

1. Get changed files:
   - `git diff --name-only main...HEAD` (branch commits)
   - `git diff --name-only --cached` (staged)
   - `git diff --name-only` (unstaged)
2. Filter to relevant files containing error handling patterns
3. **IMPORTANT: Read the FULL file content** for each changed file
4. **Analyze the specificity** of each error handling pattern:
   - Is it matching on message only, or also checking origin/stack?
   - Could a different error match this pattern accidentally?
   - Is there a more specific way to identify the intended error?
5. Report findings with recommendations for more specific filtering

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
```typescript
// BAD: Matches ANY "Error" in the message
ignoreErrors: [/Error/]

// GOOD: Specific pattern with anchors or unique identifiers
ignoreErrors: [/^ChunkLoadError: Loading chunk \d+ failed$/]
```

**Silent Failures Without Logging**
- Ignoring errors without any indication they occurred
```typescript
// BAD: Error silently disappears
try { parse(data); } catch { /* ignored */ }

// GOOD: At least log in development or track metrics
try {
  parse(data);
} catch (e) {
  if (process.env.NODE_ENV === "development") {
    console.warn("Parse failed:", e);
  }
}
```

### Warnings (Should Fix)

**Message-Only Filtering When Stack Available**
- Using only message matching when stack trace would be more reliable
```typescript
// WARNING: Message could change across versions
if (message.includes("Failed to fetch")) { return null; }

// BETTER: Also verify the source
if (message.includes("Failed to fetch") &&
    frames.some(f => f.filename?.includes("expected-source"))) {
  return null;
}
```

**Ignoring Errors by Partial String Match**
- Using `.includes()` or partial regex when exact match would be safer
```typescript
// WARNING: Could match "HTTP Client Error with status code: 5040"
if (message.includes("504")) { return null; }

// BETTER: More specific match
if (message.includes("HTTP Client Error with status code: 504")) { return null; }
```

**Multiple Similar Ignores That Could Be Consolidated**
- Several ignore patterns that could be one more specific pattern
```typescript
// WARNING: Three separate patterns
ignoreErrors: [
  "ChunkLoadError",
  "Loading chunk",
  "Failed to load chunk",
]

// BETTER: One comprehensive pattern with stack check
beforeSend(event) {
  const isChunkError = frames.some(f => f.filename?.includes("/_next/static/chunks/"));
  if (isChunkError) return null;
  return event;
}
```

**Empty Catch Blocks**
- Catching errors with empty handlers
```typescript
// WARNING: What was supposed to happen here?
try {
  operation();
} catch (e) {
  // TODO: handle error
}
```

### Suggestions (Consider)

**Add Comments Explaining Why Errors Are Ignored**
- Document the specific scenario being handled
```typescript
// GOOD: Clear documentation
// This error occurs in Edge browser during RSC navigation when webpack's
// getChunkScriptFilename returns undefined. Next.js handles this gracefully
// by falling back to browser navigation. See HUB-PROD-NJ.
if (message.includes("...") && frames.some(...)) { return null; }
```

**Consider Error Categories**
- Group related ignores with shared validation logic
```typescript
// Instead of multiple individual ignores:
const isTransientRscError = (message: string, frames: Frame[]) => {
  const rscPatterns = ["Failed to fetch RSC payload", "504"];
  const rscSources = ["fetch-server-response", "router-reducer"];
  return rscPatterns.some(p => message.includes(p)) &&
         frames.some(f => rscSources.some(s => f.filename?.includes(s)));
};
```

**Add Monitoring for Ignored Errors**
- Track frequency to know if the underlying issue is getting worse
```typescript
beforeSend(event) {
  if (shouldIgnore(event)) {
    trackMetric("ignored_errors", { type: "rsc_chunk_error" });
    return null;
  }
  return event;
}
```

## Files to Check

Focus on files containing error handling patterns:
- `instrumentation-client.ts` - Sentry client configuration
- `sentry.*.config.ts` - Sentry server/edge configuration
- `**/error.tsx` - React error boundaries
- `**/*.ts` with `try/catch` blocks
- Files with `ignoreErrors`, `beforeSend`, `denyUrls`

## Output Format

```
## Specific Ignores Review: [PASS/NEEDS FIXES]

### Critical Issues
- `file.ts:line` - [issue type]
  - Current: [what the code does now]
  - Problem: [why it's too broad]
  - **Recommendation**: [how to make it more specific]

### Warnings
- `file.ts:line` - [issue type]
  - [description of concern]
  - **Recommendation**: [suggestion]

### Suggestions
- `file.ts:line` - [improvement type]
  - [description]

### Summary
X critical issues, Y warnings, Z suggestions
```

If no issues found:
```
## Specific Ignores Review: PASS

No overly broad ignores found. Error handling is appropriately specific.
```

## Examples of Good Specificity

### Sentry beforeSend with Stack Trace Check
```typescript
beforeSend(event) {
  const message = event.exception?.values?.[0]?.value ?? "";
  const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];

  // Ignore Next.js RSC chunk loading errors (HUB-PROD-NJ)
  // Only when originating from Next.js internal code
  if (
    message.includes("Cannot read properties of undefined (reading 'split')") &&
    frames.some(f =>
      f.filename?.includes("encode-uri-path") ||
      f.filename?.includes("app-webpack")
    )
  ) {
    return null;
  }

  return event;
}
```

### Error Boundary with Specific Recovery
```typescript
class ChunkErrorBoundary extends React.Component {
  componentDidCatch(error: Error) {
    // Only handle chunk loading errors specifically
    if (error.name === "ChunkLoadError" ||
        error.message.includes("Loading chunk")) {
      // Attempt recovery by reloading
      window.location.reload();
    } else {
      // Re-throw unexpected errors to parent boundary
      throw error;
    }
  }
}
```

### Try-Catch with Type Guard
```typescript
try {
  await fetchData();
} catch (e) {
  if (e instanceof NetworkError && e.code === "ETIMEDOUT") {
    // Expected timeout, retry silently
    return retry();
  }
  if (e instanceof AbortError) {
    // User cancelled, ignore
    return;
  }
  // Unexpected error, report and rethrow
  Sentry.captureException(e);
  throw e;
}
```
