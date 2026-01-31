---
description: Fix Sentry issues and create GitHub PRs. Use /automation-fix-sentry-issue <ISSUE_ID_OR_URL>
allowed-tools: Bash(bash .claude/commands/common/*:*), Bash(git *:*), mcp__sentry__whoami, mcp__sentry__update_issue, Task, Skill
---

# Fix Sentry Issue (Automated)

This command helps you fix issues reported in Sentry using parallel plan generation, aggregation, and implementation with subagents.

**Input**: `$ARGUMENTS` contains the Sentry issue ID (e.g., `THENINJARPG-123`) or full Sentry URL.

## Prerequisites

- GitHub CLI (`gh`) installed and authenticated
- Sentry MCP tools available for fetching issue details

## Workflow

**IMPORTANT**: Create a todo list with all the steps below and follow them in order.

### Step 1: Assign the Sentry Issue

Assign the Sentry issue to yourself using the Sentry MCP tools. **Do NOT read/fetch the issue details** - the subagents will do that.

1. Use `update_issue` with the `assignedTo` parameter:
   - `organizationSlug`: `studie-tech-aps`
   - `regionUrl`: `https://de.sentry.io`
   - `assignedTo`: `user:3351344` (nano.mathias@gmail.com)

**$ARGUMENTS = `$ARGUMENTS`**

Example:
```
update_issue(organizationSlug='studie-tech-aps', regionUrl='https://de.sentry.io', issueId='THENINJARPG-123', assignedTo='user:3351344')
// Or with issueUrl:
update_issue(issueUrl='https://sentry.io/issues/PROJECT-123/', regionUrl='https://de.sentry.io', assignedTo='user:3351344')
```

This ensures the issue is tracked as being worked on.

### Step 2: Generate Implementation Plans (3 Parallel Subagents)

Launch **3 parallel subagents** using the `Task` tool, each running the `/plan-sentry-fix` skill with the Sentry issue ID. This generates diverse perspectives on the fix.

For each of the 3 subagents, use this prompt:

```
Run the /plan-sentry-fix skill with the argument: SENTRY_ISSUE_ID

After completion, report the path to the saved plan file.
```

Replace `SENTRY_ISSUE_ID` with the actual Sentry issue ID from `$ARGUMENTS`.

**Wait for all 3 subagents to complete.** Collect the 3 plan file paths they return (e.g., `.claude/tasks/THENINJARPG123_PLAN-abc123-fix_null.md`).

### Step 3: Aggregate Plans

Launch a subagent using the `Task` tool to aggregate the 3 plans into one comprehensive plan:

```
Run the /plan-aggregate skill with the arguments: PLAN1_PATH PLAN2_PATH PLAN3_PATH

Where:
- PLAN1_PATH = [path from subagent 1]
- PLAN2_PATH = [path from subagent 2]
- PLAN3_PATH = [path from subagent 3]

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
   git checkout -b "fix/SENTRY_ID_$(openssl rand -hex 3)"
   ```
   Example: `fix/THENINJARPG123_a1b2c3`
3. **If NOT on `main`**: Assume you're already on the intended branch
4. **Commit changes**:
   ```bash
   git add .
   git commit -m "Fix SENTRY_ISSUE_ID: Brief description of the fix"
   ```

Keep commit messages to a single sentence.

### Step 7: Push Branch

```bash
git push -u origin HEAD
```

### Step 8: Check for Existing GitHub Issue

Before creating a new issue, check if one already exists for this Sentry issue.

```bash
bash .claude/commands/common/check_github_issue.sh "SENTRY_ISSUE_ID"
```

The script will:
- Search GitHub issues for the Sentry issue ID in title or body
- Return the GitHub issue number if found
- Return empty if no matching issue exists

### Step 9: Create GitHub Issue (if needed)

If no existing issue was found, create one:

```bash
bash .claude/commands/common/create_github_issue.sh "SENTRY_ISSUE_ID" "Short description of the issue" "Detailed description with stack trace"
```

### Step 10: Create Pull Request

Create the PR using the common PR creation script. The PR description should include:
- **Sentry context**: What specific information from Sentry helped identify the root cause
- **Direct link**: A clickable link to the Sentry issue for the reviewer

**Read the aggregated plan** to extract the key insights for the PR description.

```bash
bash .claude/commands/common/create_pr.sh \
  "." \
  "SENTRY_ISSUE_ID" \
  "Fix SENTRY_ISSUE_ID: Short description" \
  "WHAT_CHANGED" \
  "WHY_SECTION_WITH_SENTRY_CONTEXT" \
  "GITHUB_ISSUE_NUMBER_OR_EMPTY"
```

## PR Description Guidelines

The PR description should include **specific Sentry context** that helped infer the solution:

```markdown
## Summary

[Brief description of the code change]

## Why

**Sentry Issue**: [SENTRY_ISSUE_ID](https://studie-tech-aps.sentry.io/issues/SENTRY_ISSUE_ID/)

**Error observed**: [The specific error message from Sentry]

**Frequency**: [How often the error occurs, e.g., "150 events/day"]

**Key insight from Sentry**: [What specific data from Sentry (stack trace, breadcrumbs, context, tags) led to identifying the root cause]

**Root cause**: [Brief explanation of why the error was occurring]

## Test plan

- Verified locally
- Code review passed

Closes #GITHUB_ISSUE_NUMBER
```

## Example Usage

User: `/automation-fix-sentry-issue THENINJARPG-123`

**Todo list**:
1. [ ] Assign Sentry issue to self
2. [ ] Run 3 parallel `/plan-sentry-fix THENINJARPG-123` subagents
3. [ ] Aggregate plans with `/plan-aggregate`
4. [ ] Implement with `/implement` (implementation only)
5. [ ] Run `/implement-review-loop` (code review)
6. [ ] Commit changes (create branch if on main)
7. [ ] Push branch
8. [ ] Check for existing GitHub issue
9. [ ] Create GitHub issue if needed
10. [ ] Create PR with Sentry context

**Execution**:

1. Assign the issue:
   ```
   update_issue(organizationSlug='studie-tech-aps', regionUrl='https://de.sentry.io', issueId='THENINJARPG-123', assignedTo='user:3351344')
   ```

2. Run 3 parallel subagents (all at the same time):
   ```
   Task: "Run /plan-sentry-fix THENINJARPG-123"
   Task: "Run /plan-sentry-fix THENINJARPG-123"
   Task: "Run /plan-sentry-fix THENINJARPG-123"
   ```
   Results:
   - Plan 1: `.claude/tasks/THENINJARPG123_PLAN-abc123-null_check.md`
   - Plan 2: `.claude/tasks/THENINJARPG123_PLAN-def456-validation.md`
   - Plan 3: `.claude/tasks/THENINJARPG123_PLAN-ghi789-error_handling.md`

3. Aggregate plans:
   ```
   Task: "Run /plan-aggregate .claude/tasks/THENINJARPG123_PLAN-abc123-null_check.md .claude/tasks/THENINJARPG123_PLAN-def456-validation.md .claude/tasks/THENINJARPG123_PLAN-ghi789-error_handling.md"
   ```
   Result: `.claude/tasks/THENINJARPG123_AGGREGATED-xyz789-merged_fix.md`

4. Implement:
   ```
   Task: "Run /implement .claude/tasks/THENINJARPG123_AGGREGATED-xyz789-merged_fix.md"
   ```

5. Code review loop:
   ```
   Skill(skill="implement-review-loop")
   ```

6. Commit:
   ```bash
   git branch --show-current  # Check if on main
   # If on main: git checkout -b "fix/THENINJARPG123_a1b2c3"
   git add .
   git commit -m "Fix THENINJARPG-123: Add null check for user profile"
   ```

7. Push:
   ```bash
   git push -u origin HEAD
   ```

8. Check for existing issue:
   ```bash
   bash .claude/commands/common/check_github_issue.sh "THENINJARPG-123"
   ```

9. Create issue if needed:
   ```bash
   bash .claude/commands/common/create_github_issue.sh "THENINJARPG-123" "Null reference in UserService" "Stack trace..."
   ```

10. Create PR:
    ```bash
    bash .claude/commands/common/create_pr.sh \
      "." \
      "THENINJARPG-123" \
      "Fix THENINJARPG-123: Null reference in UserService" \
      "Add null check for user profile before accessing properties" \
      "**Error observed**: TypeError: Cannot read property 'name' of undefined

**Frequency**: 150 events/day affecting ~50 users

**Key insight from Sentry**: Stack trace showed the error occurs in UserService.getProfile() when the API returns a 204 No Content response.

**Root cause**: Missing null check when API returns empty response after session expiration." \
      "42"
    ```

## Important Notes

- **Never add .claude files to git** - The `.claude` folder is gitignored and should not be committed
- **Do NOT use `analyze_issue_with_seer`** - Manual analysis via subagents produces better understanding
- **Do NOT add Co-Authored-By lines** - Don't include co-author attribution in commits or PRs
- **Do NOT read Sentry issue in main agent** - Let the subagents fetch and analyze the issue details
- **3 parallel plans** - Running multiple subagents increases solution quality through diverse analysis
- **Separate review loop** - Code review runs in the main thread via `/implement-review-loop` after implementation completes

## Handling Regressions

If the subagents report that an issue was already fixed (existing plan file, merged PR), but **recent Sentry events indicate the issue is still occurring**, this is likely a **regression**. Do NOT assume the issue is resolved.

**Investigation steps for regressions:**

1. **Check if the fix is actually in the current code**:
   ```bash
   git log --oneline -10 -- <file_that_was_fixed>
   ```
   Look for commits AFTER the fix that may have reverted or overwritten the changes.

2. **Search for the error message in the codebase**:
   ```bash
   grep -r "exact error message" app/src/
   ```
   If the error message doesn't exist, the fix may have been deployed but there's caching/deployment lag.

3. **Check if subsequent commits modified the fixed file**:
   ```bash
   git show <later_commit> -- <fixed_file>
   ```
   A later commit may have inadvertently reverted the fix while addressing a different issue.

4. **If the fix was overwritten**: Re-apply the fix, ensuring it doesn't conflict with the changes that overwrote it. Consider if the original fix was incomplete or caused other issues that led to reversion.

5. **If the error doesn't exist in code**: The issue may be:
   - Deployment lag (old code still serving some users)
   - Edge caching serving stale JavaScript bundles
   - Sentry aggregating historical events

**Document regression findings** in a new task file, noting what happened to the original fix and why it needs to be re-applied or modified.

## Configuration

The Sentry configuration for this project:

- **Organization**: `studie-tech-aps`
- **Region URL**: `https://de.sentry.io`
- **User ID**: `3351344` (nano.mathias@gmail.com)
