---
description: Fix GitHub issues and create PRs. Use /automation-fix-github-issue <ISSUE_NUMBER_OR_URL>
allowed-tools: Bash(bash .claude/commands/common/*:*), Bash(git *:*), Bash(gh *:*), Bash(codex *:*), Task, Skill, Read
---

# Fix GitHub Issue (Automated)

This command helps you fix issues reported on GitHub using parallel plan generation, aggregation, and implementation with subagents.

**Input**: `$ARGUMENTS` contains the GitHub issue number (e.g., `123`) or full GitHub issue URL (e.g., `https://github.com/owner/repo/issues/123`).

## Prerequisites

- GitHub CLI (`gh`) installed and authenticated

## Workflow

**IMPORTANT**: Create a todo list with all the steps below and follow them in order.

### Step 1: Parse Issue Number and Assign to Self

Extract the issue number from `$ARGUMENTS` and assign the issue to yourself.

**$ARGUMENTS = `$ARGUMENTS`**

1. If `$ARGUMENTS` is a URL, extract the issue number from it
2. If `$ARGUMENTS` is just a number, use it directly

Assign the issue:

```bash
gh issue edit <ISSUE_NUMBER> --add-assignee @me
```

**Do NOT read/fetch the full issue details** - the subagents will do that.

### Step 2: Generate Implementation Plans (6 Parallel Planners)

Launch **6 parallel planners** to generate diverse perspectives on the solution:

- **3 Claude Task subagents** using the `Task` tool
- **3 Codex CLI planners** using the `Shell` tool

#### 2a: Claude Task Subagents (3 parallel)

For each of the 3 subagents, use this prompt with the `Task` tool:

```
Run the /plan-github-fix skill with the argument: GITHUB_ISSUE_NUMBER

After completion, report the path to the saved plan file.
```

#### 2b: Codex CLI Planners (3 parallel)

For each of the 3 Codex planners, run this command in the `Shell` tool with `block_until_ms: 0` to background immediately:

```bash
codex exec --dangerously-bypass-approvals-and-sandbox "Run the /plan-github-fix command found in .claude/commands folder with argument GITHUB_ISSUE_NUMBER. After completion, report the path to the saved plan file."
```

**Important**: Run each codex command in a separate Shell call so they run in parallel. After launching, monitor the terminal files to wait for completion and extract the plan file paths from the output.

Replace `GITHUB_ISSUE_NUMBER` with the actual issue number from `$ARGUMENTS` in all commands.

**Wait for all 6 planners to complete.** Collect the 6 plan file paths they return (e.g., `.claude/tasks/20250131-143052_GH123_PLAN-abc123-fix_null.md`).

### Step 3: Aggregate Plans

Launch a subagent using the `Task` tool to aggregate all 6 plans into one comprehensive plan:

```
Run the /plan-aggregate skill with the arguments: PLAN1_PATH PLAN2_PATH PLAN3_PATH PLAN4_PATH PLAN5_PATH PLAN6_PATH

Where:
- PLAN1_PATH = [path from Claude subagent 1]
- PLAN2_PATH = [path from Claude subagent 2]
- PLAN3_PATH = [path from Claude subagent 3]
- PLAN4_PATH = [path from Codex planner 1]
- PLAN5_PATH = [path from Codex planner 2]
- PLAN6_PATH = [path from Codex planner 3]

After completion, report the path to the aggregated plan file.
```

**Wait for the subagent to complete.** Save the aggregated plan path for the next step.

### Step 4: Implement the Aggregated Plan

Launch a subagent using the `Task` tool to implement the aggregated plan:

```
Run the /implement skill with the argument: AGGREGATED_PLAN_PATH

Where AGGREGATED_PLAN_PATH = [path to aggregated plan from step 3]

Implement the fix following the plan. Report when complete.
```

**Wait for the subagent to complete.**

**Note**: The `/implement` skill focuses ONLY on implementation with self-evaluation. It does NOT run code review - that's handled in the next step.

### Step 5: Code Review Loop

Run the iterative code review loop using the Skill tool:

```
Skill(skill="implement-review-loop")
```

This runs in the **main thread** and will:

1. Run comprehensive code review (14 parallel checks)
2. Fix any issues found
3. Iterate until all checks pass

**Wait for completion before proceeding.**

### Step 6: Commit Changes

Check the current branch and commit changes:

1. **Check current branch**: Run `git branch --show-current`
2. **If on `main`**: Create a new branch with the naming convention:
   ```bash
   git checkout -b "fix/GH<ISSUE_NUMBER>_$(openssl rand -hex 3)"
   ```
   Example: `fix/GH123_a1b2c3`
3. **If NOT on `main`**: Assume you're already on the intended branch
4. **Commit changes**:
   ```bash
   git add .
   git commit -m "Fix #<ISSUE_NUMBER>: Brief description of the fix"
   ```

Keep commit messages to a single sentence.

### Step 7: Push Branch

```bash
git push -u origin HEAD
```

### Step 8: Create Pull Request

Create the PR using the common PR creation script. The PR description should include:

- **Issue context**: What specific information from the issue helped identify the solution
- **Direct link**: Reference to the GitHub issue (will auto-close when merged)

**Read the aggregated plan** to extract the key insights for the PR description.

```bash
bash .claude/commands/common/create_pr.sh \
  "." \
  "none" \
  "Fix #<ISSUE_NUMBER>: Short description" \
  "WHAT_CHANGED" \
  "WHY_SECTION_WITH_ISSUE_CONTEXT" \
  "<ISSUE_NUMBER>"
```

The second parameter is "none" (no Sentry issue), and the last parameter is the GitHub issue number for "Closes #123".

## PR Description Guidelines

The PR description should include **specific context from the GitHub issue** that helped inform the solution:

```markdown
## Summary

[Brief description of the code change]

## Why

**GitHub Issue**: #[NUMBER]

**Problem**: [The specific problem described in the issue]

**Key insight from issue**: [What specific details from the issue (description, comments, reproduction steps) led to identifying the solution]

**Solution**: [Brief explanation of how this change addresses the issue]

## Test plan

- Verified locally
- Code review passed

Closes #[ISSUE_NUMBER]
```

## Example Usage

User: `/automation-fix-github-issue 123`

**Todo list**:

1. [ ] Extract issue number and assign to self
2. [ ] Run 6 parallel planners (3 Claude, 3 Codex)
3. [ ] Aggregate all 6 plans with `/plan-aggregate`
4. [ ] Implement with `/implement` (implementation only)
5. [ ] Run `/implement-review-loop` (code review)
6. [ ] Commit changes (create branch if on main)
7. [ ] Push branch
8. [ ] Create PR with issue context

**Execution**:

1. Extract and assign:

   ```bash
   gh issue edit 123 --add-assignee @me
   ```

2. Run 6 parallel planners (all at the same time):

   **Claude Task subagents:**

   ```
   Task: "Run /plan-github-fix 123"
   Task: "Run /plan-github-fix 123"
   Task: "Run /plan-github-fix 123"
   ```

   **Codex CLI planners (in Shell with block_until_ms: 0):**

   ```bash
   codex exec --dangerously-bypass-approvals-and-sandbox "Run the /plan-github-fix command found in .claude/commands folder with argument 123. After completion, report the path to the saved plan file."
   ```

   (Run 3 times in parallel Shell calls)

   Results (after monitoring terminal output for completion):

   - Claude Plan 1: `.claude/tasks/20250131-143052_GH123_PLAN-abc123-null_check.md`
   - Claude Plan 2: `.claude/tasks/20250131-143053_GH123_PLAN-def456-validation.md`
   - Claude Plan 3: `.claude/tasks/20250131-143054_GH123_PLAN-ghi789-error_handling.md`
   - Codex Plan 1: `.claude/tasks/20250131-143055_GH123_PLAN-jkl012-input_sanitize.md`
   - Codex Plan 2: `.claude/tasks/20250131-143056_GH123_PLAN-mno345-boundary_check.md`
   - Codex Plan 3: `.claude/tasks/20250131-143057_GH123_PLAN-pqr678-type_guard.md`

3. Aggregate all 6 plans:

   ```
   Task: "Run /plan-aggregate .claude/tasks/20250131-143052_GH123_PLAN-abc123-null_check.md .claude/tasks/20250131-143053_GH123_PLAN-def456-validation.md .claude/tasks/20250131-143054_GH123_PLAN-ghi789-error_handling.md .claude/tasks/20250131-143055_GH123_PLAN-jkl012-input_sanitize.md .claude/tasks/20250131-143056_GH123_PLAN-mno345-boundary_check.md .claude/tasks/20250131-143057_GH123_PLAN-pqr678-type_guard.md"
   ```

   Result: `.claude/tasks/20250131-143100_GH123_AGGREGATED-xyz789-merged_fix.md`

4. Implement:

   ```
   Task: "Run /implement .claude/tasks/20250131-143100_GH123_AGGREGATED-xyz789-merged_fix.md"
   ```

5. Code review loop:

   ```
   Skill(skill="implement-review-loop")
   ```

6. Commit:

   ```bash
   git branch --show-current  # Check if on main
   # If on main: git checkout -b "fix/GH123_a1b2c3"
   git add .
   git commit -m "Fix #123: Add null check for user profile"
   ```

7. Push:

   ```bash
   git push -u origin HEAD
   ```

8. Create PR:
   ```bash
   bash .claude/commands/common/create_pr.sh \
     "." \
     "none" \
     "Fix #123: Add null check for user profile" \
     "Add null check before accessing user profile properties" \
     "**Problem**: Users reported crashes when accessing profiles that don't exist.
   ```

**Key insight from issue**: The reproduction steps showed the crash happens specifically when navigating directly to a profile URL for a deleted user.

**Solution**: Added null check with graceful fallback to 404 page when profile doesn't exist." \
 "123"

````

## Important Notes

- **Never add .claude files to git** - The `.claude` folder is gitignored and should not be committed
- **Do NOT add Co-Authored-By lines** - Don't include co-author attribution in commits or PRs
- **Do NOT read GitHub issue in main agent** - Let the planners fetch and analyze the issue details
- **6 parallel plans** - Running 6 planners (3 Claude, 3 Codex) maximizes solution quality through diverse analysis from different AI models
- **Monitor CLI planners** - The Codex CLI commands run in the background; monitor their terminal output files to detect completion and extract the plan file paths
- **Separate review loop** - Code review runs in the main thread via `/implement-review-loop` after implementation completes
- **Auto-close issue** - The "Closes #NUMBER" in the PR will automatically close the issue when merged

## Handling Edge Cases

### Issue Already Has a PR

Before starting work, check if there's already a PR for this issue:

```bash
gh pr list --search "closes:#<ISSUE_NUMBER> OR fixes:#<ISSUE_NUMBER>"
````

If a PR exists, report this to the user and ask if they want to:

1. Review/continue the existing PR
2. Start fresh with a new approach

### Issue is Already Closed

Check the issue state first:

```bash
gh issue view <ISSUE_NUMBER> --json state
```

If the issue is closed, report this and ask the user if they want to proceed anyway (e.g., for a regression fix).

### Ambiguous Issue Description

If the subagents report that the issue is too vague to create a meaningful plan:

1. Report the ambiguity to the user
2. Suggest specific clarifying questions to add as a comment on the issue
3. Ask if the user wants to proceed with assumptions or wait for clarification
