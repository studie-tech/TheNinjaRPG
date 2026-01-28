---
name: plan-sentry-fix
description: Create an implementation plan for a Sentry issue. Use /plan-sentry-fix <ISSUE_ID_OR_URL>
allowed-tools: mcp__sentry__get_issue_details, mcp__sentry__get_issue_tag_values, Read, Grep, Glob, Write, Task
---

# Plan Sentry Fix

Create a detailed implementation plan for fixing a Sentry issue by fetching issue details, thoroughly exploring the codebase, and producing a well-reasoned fix strategy.

**Input**: `$ARGUMENTS` contains the Sentry issue ID (e.g., `THENINJARPG-123`) or full Sentry URL.

## Process

### Step 1: Fetch Sentry Issue Details

Use the Sentry MCP tools to get issue details from the provided argument:

**$ARGUMENTS = `$ARGUMENTS`**

1. If `$ARGUMENTS` is a Sentry URL, use `get_issue_details` with the `issueUrl` parameter
2. If `$ARGUMENTS` is an issue ID (e.g., `THENINJARPG-123`), use `get_issue_details` with:
   - `organizationSlug`: `studie-tech-aps`
   - `regionUrl`: `https://de.sentry.io`
   - `issueId`: the provided ID

**Important**: Do NOT use `analyze_issue_with_seer` - always analyze issues manually by exploring the codebase yourself. This ensures a thorough understanding of the code context and produces better fixes.

Extract from the issue:

- **Issue ID**: The short ID like `THENINJARPG-XXX`
- **Error message**: The main error text
- **Stack trace**: File locations and line numbers where the error occurs
- **Frequency**: How often this error occurs
- **First/Last seen**: When the error started and last occurred
- **Tags/Context**: Any additional context like browser, OS, user info

### Step 2: Deep Codebase Exploration

**This is a critical step - do not rush it.**

Navigate to and carefully read the files mentioned in the stack trace:

1. **Read the error location**: Start with the exact file and line number where the error occurs
2. **Understand the call chain**: Trace back through the stack trace to understand how the code reached this point
3. **Examine related code**: Look at:
   - The function/method containing the error
   - Functions that call this code
   - Functions that this code calls
   - Related types, interfaces, and data structures
   - Similar patterns elsewhere in the codebase
4. **Check for existing patterns**: Search for how similar issues are handled elsewhere:
   - Error handling patterns
   - Null/undefined checks
   - Validation patterns
   - Retry logic

**Questions to answer during exploration**:

- What is the exact condition that causes this error?
- What data or state leads to this condition?
- Is this a race condition, timing issue, or data validation problem?
- Are there edge cases not being handled?
- Is this error reproducible or intermittent?
- What upstream changes might have introduced this issue?

### Step 3: Root Cause Analysis

Based on your exploration, document:

1. **Root Cause**: The fundamental reason the error occurs
2. **Trigger Conditions**: What specific data, state, or sequence of events triggers it
3. **Impact Assessment**: How severe is this issue? What user actions are affected?
4. **Contributing Factors**: Any code patterns or architectural issues that made this bug possible
5. **Argumentation**: Key insights from sentry (stacktrace, events, etc.) used to conclude this is the root cause

### Step 4: Develop Fix Strategy

Consider multiple approaches to fixing the issue:

1. **Option A**: [First approach - describe]
   - Pros: ...
   - Cons: ...

2. **Option B**: [Alternative approach - describe]
   - Pros: ...
   - Cons: ...

Select the best approach based on:

- Minimal code changes
- Consistency with existing patterns
- No introduction of new bugs
- Proper error handling
- Maintainability

### Step 5: Create Implementation Plan

Create a detailed implementation plan document with the following structure:

```markdown
# Implementation Plan: [SENTRY_ISSUE_ID]

## Issue Summary

- **Sentry Issue**: [ID with link]
- **Error**: [Brief error description]
- **Frequency**: [How often it occurs]
- **Impact**: [User/system impact]

## Root Cause Analysis

[Detailed explanation of what causes this error]

### Argumentation

[Key insights from Sentry (stacktrace, breadcrumbs, events, etc.) that led to this conclusion]

## Files to Modify

1. `path/to/file1.ts` - [What changes are needed]
2. `path/to/file2.ts` - [What changes are needed]

## Implementation Steps

### Step 1: [Description]
- [ ] Specific change to make
- [ ] Code snippet or approach

### Step 2: [Description]
- [ ] Specific change to make

... (continue for all steps)

## Testing Strategy

- [ ] How to verify the fix works
- [ ] Edge cases to test
- [ ] Regression testing considerations

## Risk Assessment

- Potential side effects: [List any]
- Rollback plan: [If fix causes issues]
```

### Step 6: Save the Plan

Save the implementation plan to: `.claude/tasks/[SENTRY_ID]_PLAN-[random]-[identifier].md`

Where:
- `[SENTRY_ID]` is the Sentry issue ID with hyphens removed (e.g., `THENINJARPG123`)
- `[random]` is a set of 6 random lowercase letters to create a unique plan ID
- `[identifier]` is a short description of the fix (e.g., `null_check`, `retry_logic`)

Example: `.claude/tasks/THENINJARPG123_PLAN-fdosdg-fix_null_reference.md`

### Step 7: Validate the Plan (Critical)

**Before finalizing, critically evaluate the implementation plan:**

1. **Re-read the Sentry error details** - Does the plan actually address the root cause?
2. **Trace through the fix mentally** - Will the proposed changes prevent the error from occurring?
3. **Check for completeness** - Are all affected code paths covered?
4. **Verify consistency** - Does the fix follow existing codebase patterns?
5. **Consider edge cases** - What happens in unusual scenarios?
6. **Evaluate risk** - Could this fix introduce new issues?

**Ask yourself**:

- [ ] Does this fix address the ACTUAL root cause, not just a symptom?
- [ ] Have I considered all the ways this code path can be reached?
- [ ] Is there any scenario where this fix would not work?
- [ ] Am I introducing any new failure modes?
- [ ] Is this the simplest fix that solves the problem?

If any validation check fails, return to Step 2-5 and refine the analysis and plan.

## Output

After completing all steps, report:

1. **Plan saved to**: `[path to saved plan file]`
2. **Summary**: Brief description of the issue and proposed fix
3. **Argumentation**: Key insights from sentry (stacktrace, events, etc.) used to conclude this is the fix
4. **Confidence level**: How confident you are that this fix will resolve the issue
5. **Next steps**: Instructions for implementing the fix (use `/implement [plan_path]`)

## Important Notes

- **Take your time** - A thorough analysis prevents multiple fix attempts
- **Never use `analyze_issue_with_seer`** - Manual analysis produces better understanding
- **Check existing patterns** - The codebase likely has similar error handling you can follow
- **Document assumptions** - If you're uncertain about something, note it in the plan
- **Be skeptical** - Question your own analysis before finalizing

## Sentry Configuration

For this project:
- **Organization**: `studie-tech-aps`
- **Region URL**: `https://de.sentry.io`
