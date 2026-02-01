---
description: Reviews code for security vulnerabilities
allowed-tools: Read, Grep, Glob, Bash(git diff:*, git status:*), Write, TodoWrite
---

# Security Review

Review changed files for security vulnerabilities including permission checks, injection risks, and exposure issues.

**Arguments**: `$ARGUMENTS` should contain `<IDENTIFIER>`

- **IDENTIFIER** (required): Used to organize review output files

## Process

### Step 1: Create Todo Checklist

**BEFORE starting, create a todo list with all checks.** Use TodoWrite:

- [ ] Get changed files
- [ ] Read full file contents (not just diffs)
- [ ] Check permission guards - Verify ownership/permission checks on mutations
- [ ] Check injection risks - Look for SQL/Drizzle injection vulnerabilities
- [ ] Check data exposure - Ensure no sensitive data in API responses
- [ ] Check procedure types - Verify protectedProcedure vs publicProcedure
- [ ] Check input validation - Verify Zod validation on user inputs
- [ ] Write findings or return PASS

Mark each todo as completed after performing it.

### Step 2: Execute Review

1. Get changed `.ts` and `.tsx` files (excluding migrations):
   - `git diff --name-only main...HEAD -- '*.ts' '*.tsx' ':!**/migrations/**'` (branch commits)
   - `git diff --name-only --cached -- '*.ts' '*.tsx' ':!**/migrations/**'` (staged)
   - `git diff --name-only -- '*.ts' '*.tsx' ':!**/migrations/**'` (unstaged)
2. Focus on files in `routers/`, `app/`, `libs/`
3. **Read the FULL file content** for each changed file - you MUST read the entire file, not just the diff
4. **Locate the changed code within the file**, then examine the ENTIRE function containing those changes
5. **For every database mutation (update, delete, insert):**
   - Check if there's an ownership verification (userId check in WHERE clause)
   - Check if there's a permission check before the mutation
   - This check is mandatory even if only part of the mutation was changed
6. **For every API endpoint:**
   - Check if it uses protectedProcedure vs publicProcedure appropriately
   - Check what data is returned to the client

## Critical Review Mindset

**Your job is to FIND SECURITY VULNERABILITIES. Do NOT validate or praise code.**

### What NOT to output:

- "Permissions are correctly checked" or "Good security practice" - this is praise, not a finding
- "This properly validates input" or "Secure implementation" - this is validation, not a finding
- Any statement saying code is secure/safe/correct - SKIP IT ENTIRELY
- Do NOT include items in your output that aren't actual security issues

### What TO output:

- ONLY actual security vulnerabilities that need fixing
- If you find no issues, say "PASS" with no other commentary

## Patterns to Check

### Critical Issues (Must Fix)

**Missing Permission Checks in tRPC Routers**

- Mutations/queries that modify sensitive data without importing from `@/utils/permissions`
- Admin-only operations missing permission guards
- Endpoints using `publicProcedure` when they should use `protectedProcedure`
- Role checks using hardcoded strings instead of permission functions

**SQL/Drizzle Injection Risks**

- Raw SQL with string interpolation: `` sql`...${userInput}...` `` without proper escaping
- Dynamic column/table names from user input
- `sql.raw()` with unsanitized input
- Building queries with string concatenation

**Exposed Sensitive Data**

- Returning password hashes, tokens, or secrets in API responses
- Logging sensitive information (passwords, tokens, API keys)
- Hardcoded credentials or API keys in code

### Warnings (Should Fix)

**Incomplete Permission Checks**

- Permission check exists but doesn't cover all code paths
- Missing null/undefined checks before permission validation
- Permission function called but result not used in guard

**Data Exposure Risks**

- Returning full user objects instead of selecting specific fields
- Missing field filtering on queries that return to clients
- Internal IDs or metadata exposed unnecessarily

**Input Validation Gaps**

- Missing Zod validation on user inputs
- Overly permissive validation schemas
- Type coercion without validation

## Reference

Permission functions are in `app/src/utils/permissions.ts`. Key functions include:

- `canModerate`, `canModerateRoles` - Moderation permissions
- `canChangeContent` - Content editing
- `canDeleteUsers`, `canBanUsers`, `canSilenceUsers` - User management
- `canChangeUserRolesTo` - Role assignment
- `canSeeSecretData`, `canSeeIps` - Sensitive data access
- `canEditPublicUser` - User profile editing
- Various `canEdit*` functions for specific resources

## Output

### If security issues found (NEEDS FIXES):

1. **Save detailed findings** to `.claude/review/$IDENTIFIER/security.md` using Write tool (replace `$IDENTIFIER` with actual identifier from arguments):

   ```
   # Security Review Results

   ## Critical Issues
   - `file.ts:line` - [issue type] - [description] - [recommended fix]

   ## Warnings
   - `file.ts:line` - [issue type] - [description]

   ## Summary
   X critical issues, Y warnings
   ```

2. **Return only**:
   ```
   Security: NEEDS FIXES
   Findings saved to: .claude/review/$IDENTIFIER/security.md
   ```

### If review passes (PASS):

Return only: "Security: PASS"
