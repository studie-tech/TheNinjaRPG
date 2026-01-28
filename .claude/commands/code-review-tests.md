---
description: Runs test suite
allowed-tools: Bash(make test:*), TaskCreate, TaskUpdate, TaskList, TaskGet
---

Run tests and report results.

**Working directory**: $ARGUMENTS (or current directory if not provided)

## Task Tracking

**IMPORTANT**: Create tasks to track progress using TaskCreate. Update each task to `in_progress` when starting and `completed` when done.

Create these tasks at the start:
1. "Run tests" - Execute make test command
2. "Parse results" - Extract pass/fail counts
3. "Compile findings" - Produce final report

## Process

1. Run: `make test`
2. Parse pass/fail counts

## Output

```
Tests: PASS/FAIL
Stats: X passed, Y failed, Z total
Failures (if any):
- test name: error message
```
