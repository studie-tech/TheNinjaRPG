---
description: Reviews code for duplication and opportunities to generalize shared logic
allowed-tools: Read, Grep, Glob, Bash(git diff:*, git status:*), Task, TaskCreate, TaskUpdate, TaskList, TaskGet
---

# DRY (Don't Repeat Yourself) Review

Review code for duplication, searching the entire codebase to find similar patterns that could be consolidated.

## Task Tracking

**IMPORTANT**: Before starting the review, create tasks for each major checkpoint using TaskCreate. Update each task to `in_progress` when starting and `completed` when done.

Create these tasks at the start:
1. "Get changed files" - Get list of files to review
2. "Read diff content" - Understand what code was changed
3. "Read full file contents" - Read complete files (not just diffs)
4. "Search for utility duplicates" - Check utils/, libs/, hooks/ for similar code
5. "Search for query duplicates" - Check routers for similar database queries
6. "Compile findings" - Produce final report

Work through each task in order, marking as `in_progress` then `completed`.

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

### Review approach:
- For ANY new function - search for similar implementations elsewhere
- For ANY new utility logic - check if `app/src/utils/` has similar
- For ANY new query pattern - search for similar queries in routers
- For ANY new validation schema - search validators for similar shapes
- Assume there IS duplication until you've proven otherwise

## Process

1. Get changed files:
   - `git diff --name-only main...HEAD` (branch commits)
   - `git diff --name-only --cached` (staged)
   - `git diff --name-only` (unstaged)
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
7. Report ONLY actual problems - no praise, no validation, no "correctly reuses" commentary

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

## Output Format

**IMPORTANT: Only include actual problems. Do NOT include:**
- Praise ("good reuse", "correctly consolidated", "DRY implementation")
- Validation ("no duplication", "properly abstracted")
- Commentary on code that has no issues

```
## DRY Review: [PASS/NEEDS FIXES]

### Critical Issues
- `new-file.ts:line` duplicates `existing-file.ts:line`
  - [description of duplication]
  - **Recommendation**: [specific refactoring suggestion]

### Warnings
- `file.ts:line` - [pattern type]
  - Similar code found in: `other-file.ts:line`
  - **Recommendation**: Extract to `app/src/[location]/[name].ts`

### Summary
X critical issues, Y warnings
```

If no issues found, output ONLY:

```
DRY Review: PASS
```
