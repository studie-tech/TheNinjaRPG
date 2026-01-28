---
description: Iteratively run code review and fix all findings until the codebase passes all checks
allowed-tools: Task, Skill, Read
---

# Implement Review Loop

This command iteratively runs code review and fixes all findings until all checks pass.

**No arguments required.**

## Workflow

**IMPORTANT**: Create a todo list and follow these steps exactly.

### Step 1: Generate Review Identifier

Generate a unique identifier for this review loop run to avoid overwriting previous reviews:

```bash
echo "review-loop-$(date +%Y%m%d-%H%M%S)"
```

This creates an identifier like `review-loop-20240124-143052`. Use this identifier throughout the review loop run.

### Step 2: Run Code Review (Isolated)

Launch a **single Task** to run the code review. This isolates all sub-task overhead from the main thread context, preventing context window bloat.

Use the Task tool with this prompt:

```
Run the /code-review skill with argument: <IDENTIFIER>
After completion, return ONLY the Code Review Summary table that the skill outputs. Do NOT include any other text, explanation, or reasoning - ONLY the summary table.
```

Replace `<IDENTIFIER>` with the identifier generated in Step 1.

Wait for the Task to complete. Parse the returned summary table.

### Step 3: Parse Review Results

Examine the code review summary. For each review that returned `NEEDS FIXES`, note:

- The review type (e.g., Frontend, tRPC, Logic, etc.)
- The findings file path (e.g., `.claude/review/<IDENTIFIER>/frontend.md`)

If **ALL reviews returned PASS**, proceed to **Step 6** (Completion).

### Step 4: Launch Parallel Fixer Agents

For **each** review type that returned `NEEDS FIXES`, launch a **separate** subagent using the `Task` tool.

**CRITICAL**: To minimize context explosion, do NOT read or paste the findings content. Only pass the file path.

For each fixer agent, use this prompt:

```
Fix all code review findings documented in: FINDINGS_FILE_PATH

Instructions:
1. Read the findings file at the path above
2. Fix each issue documented in the file
3. Do NOT fix issues that are explicitly marked as acceptable or intentional
4. After fixing, report what was fixed
5. Only fix things which are directly related to this branch (commits, unstaged, staged) changes

Do not ask for clarification - make reasonable decisions based on the documented issues.
```

Replace `FINDINGS_FILE_PATH` with the actual path (e.g., `.claude/review/<IDENTIFIER>/frontend.md` such as `.claude/review/review-loop-20240124-143052/frontend.md`).

**Launch ALL fixer agents in parallel** - they work on different aspects of the code and are independent.

Wait for all fixer agents to complete.

### Step 5: Repeat Code Review Until All Pass

After all fixer agents complete, **go back to Step 2** and run the code review again (reusing the same identifier).

This creates an iterative loop:

1. Run code review
2. If all pass → Proceed to Step 6
3. If any need fixes → Launch fixer agents
4. Go to step 1

**Continue this loop until ALL code reviews return PASS.**

**Max iterations**: If the loop runs more than 5 times without converging, stop and report the remaining issues to the user for manual review.

### Step 6: Completion

When all code reviews pass:

Output:

```
## Review Loop Complete

All quality checks passed:
- ✅ Code Review: All checks passed

The implementation is ready for commit.
```

## Important Notes

- **Parallel execution**: All fixer agents run simultaneously for efficiency
- **Minimal context**: Only pass file paths to fixer agents, never paste findings content
- **Iterative improvement**: Some fixes may introduce new issues or reveal previously hidden ones
- **Natural termination**: The loop ends when all code reviews pass
- **Max iterations**: If the loop runs more than 5 times without converging, stop and report the remaining issues to the user for manual review

## Example Execution

**Iteration 1:**

1. Run `/code-review`
2. Results:

   - Guidelines: PASS
   - Tests: PASS
   - Lint: NEEDS FIXES → `.claude/review/review-loop-20240124-143052/lint.md`
   - Frontend: NEEDS FIXES → `.claude/review/review-loop-20240124-143052/frontend.md`
   - tRPC: PASS
   - (etc.)

3. Launch 2 parallel fixer agents:

   ```
   Task: "Fix all code review findings documented in: .claude/review/review-loop-20240124-143052/lint.md ..."
   Task: "Fix all code review findings documented in: .claude/review/review-loop-20240124-143052/frontend.md ..."
   ```

4. Wait for completion, then repeat

**Iteration 2:**

1. Run `/code-review` again
2. Results:

   - All reviews: PASS

3. Output: "Review Loop Complete - All quality checks passed."

## Todo List Template

1. [ ] Generate unique review identifier
2. [ ] Run code review (iteration 1)
3. [ ] Parse results for NEEDS FIXES items
4. [ ] Launch fixer agents for each failing review
5. [ ] Run code review (iteration 2+) until all pass
6. [ ] Complete when all checks pass
