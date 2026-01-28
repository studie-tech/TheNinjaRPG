---
description: Runs TypeScript type checking
allowed-tools: Bash(make typecheck:*), TaskCreate, TaskUpdate, TaskList, TaskGet
---

Run TypeScript type checking and report results.

**Working directory**: $ARGUMENTS (or current directory if not provided)

## Task Tracking

**IMPORTANT**: Create tasks to track progress using TaskCreate. Update each task to `in_progress` when starting and `completed` when done.

Create these tasks at the start:
1. "Run typecheck" - Execute make typecheck command
2. "Parse results" - Extract type errors
3. "Compile findings" - Produce final report

## Process

1. Run: `make typecheck`
2. Parse errors/warnings

## Output

```
Typecheck: PASS/FAIL
Stats: X errors
Issues (if any):
- file:line - error code - message
```
