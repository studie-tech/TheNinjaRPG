---
description: Review code for quality and guideline compliance. Use /code-review [WORKTREE_PATH]
allowed-tools: Task, TaskCreate, TaskUpdate, TaskList, TaskGet
---

# Code Review

## Task Tracking

**IMPORTANT**: Create a task for each sub-review before launching agents. Update tasks as each sub-review completes.

Create these tasks at the start:
1. "Guidelines review" - CLAUDE.md compliance
2. "Tests review" - Run test suite
3. "Lint review" - Run ESLint
4. "Typecheck review" - TypeScript checking
5. "Security review" - Security vulnerabilities
6. "tRPC review" - Router patterns
7. "Logic review" - Game logic correctness
8. "Readability review" - Code clarity
9. "DRY review" - Code duplication
10. "Frontend review" - React best practices
11. "UX review" - User experience quality
12. "Redundancies review" - Orphaned/duplicate code
13. "Specific Ignores review" - Error handling specificity
14. "Compile summary" - Aggregate all results

Mark each task as `in_progress` when launching its agent, and `completed` when you receive results.

Review code by launching 13 parallel Task agents:

1. **Guidelines**: `Skill(skill="code-review-guidelines", args="$ARGUMENTS")`
2. **Tests**: `Skill(skill="code-review-tests", args="$ARGUMENTS")`
3. **Lint**: `Skill(skill="code-review-lint", args="$ARGUMENTS")`
4. **Typecheck**: `Skill(skill="code-review-typecheck", args="$ARGUMENTS")`
5. **Security**: `Skill(skill="code-review-security", args="$ARGUMENTS")`
6. **tRPC**: `Skill(skill="code-review-trpc", args="$ARGUMENTS")`
7. **Logic**: `Skill(skill="code-review-logic", args="$ARGUMENTS")`
8. **Readability**: `Skill(skill="code-review-readability", args="$ARGUMENTS")`
9. **DRY**: `Skill(skill="code-review-dry", args="$ARGUMENTS")`
10. **Frontend**: `Skill(skill="code-review-frontend", args="$ARGUMENTS")`
11. **UX**: `Skill(skill="code-review-ux", args="$ARGUMENTS")`
12. **Redundancies**: `Skill(skill="code-review-redundancies", args="$ARGUMENTS")`
13. **Specific Ignores**: `Skill(skill="code-review-specific-ignores", args="$ARGUMENTS")`

Use Task tool with `run_in_background: true` for parallel execution.

After all complete, compile into:

## Code Review Summary

### Guidelines
<result>

### Tests
<result>

### Lint
<result>

### Typecheck
<result>

### Security
<result>

### tRPC
<result>

### Logic
<result>

### Readability
<result>

### DRY
<result>

### Frontend
<result>

### UX
<result>

### Redundancies
<result>

### Specific Ignores
<result>

### Recommendation
PASS if all passed, otherwise NEEDS FIXES
