---
description: Review code for quality and guideline compliance. Use /code-review <IDENTIFIER>
allowed-tools: Task, TaskCreate, TaskUpdate, TaskList, TaskGet, TodoWrite, Write
---

# Code Review

**Arguments**: `$ARGUMENTS` should contain `<IDENTIFIER>`

- **IDENTIFIER** (required): Used to organize review output files (e.g., PR ID, branch name, feature name)

## Execution

### Step 1: Create Todo List

**BEFORE launching agents, create a task list to track all 14 review types.** Use TaskCreate with all reviews as pending:

- [ ] Guidelines review
- [ ] Tests review
- [ ] Lint review
- [ ] Typecheck review
- [ ] Security review
- [ ] tRPC review
- [ ] Logic review
- [ ] Readability review
- [ ] DRY review
- [ ] Frontend review
- [ ] UX review
- [ ] Redundancies review
- [ ] Specific Ignores review
- [ ] Fullstack Link review

### Step 2: Launch Parallel Agents

Launch 14 parallel Task agents. For each agent, use this **exact prompt format** (do NOT include the command file content in the prompt):

```
Read and execute the instructions in .claude/commands/code-review-<TYPE>.md

Arguments: <IDENTIFIER>

Return ONLY the final result line (e.g., "tRPC: PASS" or "tRPC: NEEDS FIXES - see .claude/review/<IDENTIFIER>/trpc.md")
```

Replace `<TYPE>` with the review type and `<IDENTIFIER>` with the actual identifier from $ARGUMENTS.

### Review Types to Launch (all in parallel)

| Agent Name       | Command File                      |
| ---------------- | --------------------------------- |
| Guidelines       | `code-review-guidelines.md`       |
| Tests            | `code-review-tests.md`            |
| Lint             | `code-review-lint.md`             |
| Typecheck        | `code-review-typecheck.md`        |
| Security         | `code-review-security.md`         |
| tRPC             | `code-review-trpc.md`             |
| Logic            | `code-review-logic.md`            |
| Readability      | `code-review-readability.md`      |
| DRY              | `code-review-dry.md`              |
| Frontend         | `code-review-frontend.md`         |
| UX               | `code-review-ux.md`               |
| Redundancies     | `code-review-redundancies.md`     |
| Specific Ignores | `code-review-specific-ignores.md` |
| Fullstack Link   | `code-review-fullstack-link.md`   |

**IMPORTANT**: Keep prompts minimal. The subagent will read the command file itself - do NOT paste its contents into the prompt.

Each sub-skill will either return:

- `[Review Type]: PASS` if no issues found
- `[Review Type]: NEEDS FIXES` with path to `.claude/review/<IDENTIFIER>/<skill>.md` for detailed findings

### Step 3: Track Results and Compile Summary

As each agent completes, mark the corresponding todo as completed using TodoWrite with `merge: true`.

After all complete, compile into a summary (replace `<IDENTIFIER>` with the actual identifier from arguments):

## Code Review Summary

| Review           | Status           | Findings                                          |
| ---------------- | ---------------- | ------------------------------------------------- |
| Guidelines       | PASS/NEEDS FIXES | `.claude/review/<IDENTIFIER>/guidelines.md`       |
| Tests            | PASS/NEEDS FIXES | `.claude/review/<IDENTIFIER>/tests.md`            |
| Lint             | PASS/NEEDS FIXES | `.claude/review/<IDENTIFIER>/lint.md`             |
| Typecheck        | PASS/NEEDS FIXES | `.claude/review/<IDENTIFIER>/typecheck.md`        |
| Security         | PASS/NEEDS FIXES | `.claude/review/<IDENTIFIER>/security.md`         |
| tRPC             | PASS/NEEDS FIXES | `.claude/review/<IDENTIFIER>/trpc.md`             |
| Logic            | PASS/NEEDS FIXES | `.claude/review/<IDENTIFIER>/logic.md`            |
| Readability      | PASS/NEEDS FIXES | `.claude/review/<IDENTIFIER>/readability.md`      |
| DRY              | PASS/NEEDS FIXES | `.claude/review/<IDENTIFIER>/dry.md`              |
| Frontend         | PASS/NEEDS FIXES | `.claude/review/<IDENTIFIER>/frontend.md`         |
| UX               | PASS/NEEDS FIXES | `.claude/review/<IDENTIFIER>/ux.md`               |
| Redundancies     | PASS/NEEDS FIXES | `.claude/review/<IDENTIFIER>/redundancies.md`     |
| Specific Ignores | PASS/NEEDS FIXES | `.claude/review/<IDENTIFIER>/specific-ignores.md` |
| Fullstack Link   | PASS/NEEDS FIXES | `.claude/review/<IDENTIFIER>/fullstack-link.md`   |

**Note**: Only include the findings path if status is NEEDS FIXES.
