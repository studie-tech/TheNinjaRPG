---
description: Reviews code for duplication and opportunities to generalize shared logic
allowed-tools: Read, Grep, Glob, Bash(git diff:*, git status:*), Task, Write, TodoWrite
---

# DRY (Don't Repeat Yourself) Review

Review code for duplication, searching the entire codebase to find similar patterns that could be consolidated.

**Arguments**: `$ARGUMENTS` should contain `<IDENTIFIER>`

- **IDENTIFIER** (required): Used to organize review output files

## Process

### Step 1: Create Todo Checklist

**BEFORE starting, create a todo list with all checks.** Use TodoWrite:

- [ ] Get changed files
- [ ] Read diff content - Understand what code was changed
- [ ] Read full file contents (not just diffs)
- [ ] Search for utility duplicates - Check utils/, libs/, hooks/ for similar code
- [ ] Search for query duplicates - Check routers for similar database queries
- [ ] Write findings or return PASS

Mark each todo as completed after performing it.

### Step 2: Execute Review

1. Get changed `.ts` and `.tsx` files (excluding migrations):
   - `git diff --name-only main...HEAD -- '*.ts' '*.tsx' ':!**/migrations/**'` (branch commits)
   - `git diff --name-only --cached -- '*.ts' '*.tsx' ':!**/migrations/**'` (staged)
   - `git diff --name-only -- '*.ts' '*.tsx' ':!**/migrations/**'` (unstaged)
2. Read the diff to identify new/modified code blocks
3. **Read the FULL file content** for each changed file - you MUST read the entire file, not just the diff
4. For each significant code pattern (functions, calculations, queries, UI patterns), search for similar code elsewhere in the codebase
5. **For every new function or utility:**
   - Search `app/src/utils/` for similar functionality
   - Search `app/src/libs/` for similar business logic
   - Search `app/src/hooks/` for similar React patterns
6. **For every new database query pattern:**
   - Search other routers for similar queries
   - Check if a reusable fetch function already exists

## Critical Review Mindset

**Your job is to FIND DUPLICATE CODE. Do NOT validate or praise code.**

### What NOT to output:

- "Good code reuse" or "Correctly uses existing utility" - this is praise, not a finding
- "This properly extends the base" or "No duplication found" - this is validation, not a finding
- Any statement saying code is DRY/clean/consolidated - SKIP IT ENTIRELY
- Do NOT include items in your output that aren't actual duplication issues

### What TO output:

- ONLY actual duplications that need consolidating
- If you find no issues, say "PASS" with no other commentary

### Mandatory search for new code:

When you see new utility logic, you MUST search the codebase for similar implementations before reporting. Use Grep to search for:

- Similar function names
- Similar logic patterns (e.g., date formatting, array transformations)
- Similar constant values

## What to Search For

### 1. Utility Functions

- Date/time formatting or calculations
- String manipulation helpers
- Array/object transformation utilities
- Validation helpers

**Recommended location**: `app/src/utils/`

### 2. Database Query Patterns

- Similar SELECT queries with minor variations
- Common WHERE clause patterns
- Repeated JOIN patterns

**Recommended location**: Bottom of relevant router file as exported helper

### 3. Business Logic

- Game mechanic calculations
- Permission/eligibility checks
- State transition logic

**Recommended location**: `app/src/libs/`

### 4. UI Components & Patterns

- Similar form structures
- Repeated layout patterns

**Recommended location**: `app/src/layout/`

### 5. Validation Schemas

- Similar Zod schemas with overlapping fields

**Recommended location**: `app/src/validators/`

## Patterns to Report

### Critical Issues (Must Fix)

**1. Exact Duplication**

- Same code copied in multiple places

**2. Near-Duplicate with Bugs**

- Similar code where one instance has a bug fix the others lack

### Warnings

**1. Similar Logic, Different Implementation**

- Same calculation done differently in multiple places

**2. Repeated Patterns That Could Be Abstracted**

- 3+ occurrences of similar pattern warrants extraction

**3. Missed Existing Utility**

- New code that reimplements existing utility function

**4. Inconsistent Approaches**

- Same problem solved differently across codebase

## Output

### If duplication issues found (NEEDS FIXES):

1. **Save detailed findings** to `.claude/review/$IDENTIFIER/dry.md` using Write tool (replace `$IDENTIFIER` with actual identifier from arguments):

   ```
   # DRY Review Results

   ## Critical Issues
   - `new-file.ts:line` duplicates `existing-file.ts:line`
     - [description of duplication]
     - **Recommendation**: [specific refactoring suggestion]

   ## Warnings
   - `file.ts:line` - [pattern type]
     - Similar code found in: `other-file.ts:line`
     - **Recommendation**: Extract to `app/src/[location]/[name].ts`

   ## Summary
   X critical issues, Y warnings
   ```

2. **Return only**:
   ```
   DRY: NEEDS FIXES
   Findings saved to: .claude/review/$IDENTIFIER/dry.md
   ```

### If review passes (PASS):

Return only: "DRY: PASS"
