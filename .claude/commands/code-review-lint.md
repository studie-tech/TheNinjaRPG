---
description: Runs ESLint
allowed-tools: Bash(make lint:*), TaskCreate, TaskUpdate, TaskList, TaskGet
---

Run ESLint and report results.

**Working directory**: $ARGUMENTS (or current directory if not provided)

## Task Tracking

**IMPORTANT**: Create tasks to track progress using TaskCreate. Update each task to `in_progress` when starting and `completed` when done.

Create these tasks at the start:
1. "Run ESLint" - Execute make lint command
2. "Parse results" - Extract errors and warnings
3. "Compile findings" - Produce final report

## Process

1. Run: `make lint`
2. Parse errors/warnings

## Output

```
Lint: PASS/FAIL
Stats: X errors, Y warnings
Issues (if any):
- file:line - rule - message
```
