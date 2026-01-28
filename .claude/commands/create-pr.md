---
description: Create a GitHub PR for current changes. Use /create-pr <title> [optional context]
allowed-tools: Bash(bash .claude/commands/common/*:*), Bash(git:*)
---

# Create Pull Request

This command creates a GitHub pull request for the current branch's changes.

**Input**: `$ARGUMENTS` contains:

- **Required**: PR title (short, technical description)
- **Optional**: Additional context (Sentry issue ID, GitHub issue number, description details)

## Parsing Arguments

The arguments should contain enough information to create a meaningful PR. Common patterns:

- `Fix THENINJARPG-123: Add null check` → Title with Sentry reference
- `Add user profile validation` → Simple title
- `Fix THENINJARPG-123: Add null check. Closes #42. Error was occurring when user.profile was null` → Title + GitHub issue + context

**$ARGUMENTS = `$ARGUMENTS`**

## Prerequisites

- GitHub CLI (`gh`) installed and authenticated
- Current branch has commits ready to push
- Branch is not `main`

## Workflow

### Step 1: Ensure Changes Are Committed

Check if there are uncommitted changes:

```bash
git status --porcelain
```

If there are uncommitted changes, commit them first:

```bash
git add .
git commit -m "Brief description of changes"
```

### Step 2: Push the Branch

```bash
git push -u origin HEAD
```

### Step 3: Extract PR Information

From the arguments, extract:

- **Title**: The main PR title (required)
- **Sentry Issue ID**: If present (e.g., `THENINJARPG-123`)
- **GitHub Issue Number**: If present (e.g., `#42` or `Closes #42`)
- **What**: Brief description of the change (1 sentence)
- **Why**: Reason for the change

If not all information is provided, infer from:

- The branch name (e.g., `fix/THENINJARPG123-null-reference`)
- Recent commit messages
- The diff of changes

### Step 4: Create the Pull Request

Use the common PR creation script:

```bash
bash .claude/commands/common/create_pr.sh \
  "." \
  "SENTRY_ISSUE_ID_OR_EMPTY" \
  "PR Title" \
  "Brief description of the change" \
  "Reason for the change" \
  "GITHUB_ISSUE_NUMBER_OR_EMPTY"
```

Arguments:

1. **Path**: Current directory (`.`)
2. **Sentry issue ID**: The Sentry issue ID (e.g., `THENINJARPG-123`) or empty string if none
3. **PR title**: Keep it short and technical
4. **What**: Brief description of the change (1 sentence)
5. **Why**: Reason for the change
6. **GitHub issue number** (optional): Links PR to GitHub issue with "Closes #X"

## PR Description Guidelines

The PR description should follow the template and be:

- **Short**: No unnecessary prose
- **Technical**: Focus on what changed and why
- **To the point**: Only essential information

Example PR description:

```markdown
## Summary

Fix null reference error in UserService when accessing user profile

## Why

NullReferenceException occurring 150 times/day

**Sentry Issue:** [THENINJARPG-123](https://studie-tech-aps.sentry.io/issues/THENINJARPG-123)

## Test plan

- Verified locally
- Code review passed

Closes #42
```

## Example Usage

### Simple PR

User: `/create-pr Add input validation to signup form`

1. Check for uncommitted changes
2. Push branch: `git push -u origin HEAD`
3. Create PR:

```bash
bash .claude/commands/common/create_pr.sh \
  "." \
  "" \
  "Add input validation to signup form" \
  "Add client-side validation for email and password fields" \
  "Improve user experience and reduce invalid submissions" \
  ""
```

### PR with Sentry Issue

User: `/create-pr Fix THENINJARPG-123: Add null check for user profile`

1. Check for uncommitted changes
2. Push branch: `git push -u origin HEAD`
3. Create PR:

```bash
bash .claude/commands/common/create_pr.sh \
  "." \
  "THENINJARPG-123" \
  "Fix THENINJARPG-123: Add null check for user profile" \
  "Add null check before accessing user.profile" \
  "Fixes Sentry issue THENINJARPG-123" \
  ""
```

### PR with GitHub Issue Link

User: `/create-pr Fix THENINJARPG-123: Add null check. Closes #42`

1. Check for uncommitted changes
2. Push branch: `git push -u origin HEAD`
3. Create PR:

```bash
bash .claude/commands/common/create_pr.sh \
  "." \
  "THENINJARPG-123" \
  "Fix THENINJARPG-123: Add null check for user profile" \
  "Add null check before accessing user.profile" \
  "Fixes Sentry issue THENINJARPG-123" \
  "42"
```

## Important Notes

- **Never add .claude files to git** - The `.claude` folder is gitignored and should not be committed
- **Do NOT add Co-Authored-By lines** - Don't include co-author attribution in commits or PRs
- **Always push before creating PR** - Ensure the branch is up to date on remote
