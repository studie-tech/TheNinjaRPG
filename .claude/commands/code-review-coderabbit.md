---
description: Runs CodeRabbit analysis
allowed-tools: Bash(coderabbit review:*), TaskCreate, TaskUpdate, TaskList, TaskGet
---

Run CodeRabbit and summarize findings.

**Working directory**: $ARGUMENTS (or current directory if not provided)

## Task Tracking

**IMPORTANT**: Create tasks to track progress using TaskCreate. Update each task to `in_progress` when starting and `completed` when done.

Create these tasks at the start:
1. "Run CodeRabbit" - Execute coderabbit review command
2. "Extract feedback" - Parse actionable findings
3. "Categorize issues" - Sort by severity (critical, warning, suggestion)
4. "Compile findings" - Produce final report

## Process

1. Run: `coderabbit review --plain`
2. Extract actionable feedback
3. Categorize: critical, warning, suggestion

## Output

For each issue:
```
file:line - severity - description - recommendation
```

If clean: "CodeRabbit: PASS"
