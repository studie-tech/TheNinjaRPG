---
description: Reviews code for readability, clarity, and maintainability
allowed-tools: Read, Grep, Glob, Bash(git diff:*), Bash(git status:*), TaskCreate, TaskUpdate, TaskList, TaskGet
---

# Code Readability Review

Review code for readability and clarity, ensuring code is easy to understand and maintain.

## Task Tracking

**IMPORTANT**: Before starting the review, create tasks for each major checkpoint using TaskCreate. Update each task to `in_progress` when starting and `completed` when done.

Create these tasks at the start:
1. "Get changed files" - Get list of files to review
2. "Read full file contents" - Read complete files (not just diffs)
3. "Check function length" - Flag functions over 50 lines
4. "Check nesting depth" - Flag nesting over 3 levels
5. "Check naming clarity" - Verify variable/function names are descriptive
6. "Check magic values" - Flag unexplained literal values
7. "Check complex expressions" - Flag complex ternaries and boolean expressions
8. "Compile findings" - Produce final report

Work through each task in order, marking as `in_progress` then `completed`.

## Critical Review Mindset

**Your job is to FIND READABILITY PROBLEMS. Do NOT validate or praise code.**

### What NOT to output:
- "Code is well-structured" or "Good naming conventions" - this is praise, not a finding
- "This is readable" or "Clear implementation" - this is validation, not a finding
- Any statement saying code is clean/clear/readable - SKIP IT ENTIRELY
- Do NOT include items in your output that aren't actual readability issues

### What TO output:
- ONLY actual readability issues that need fixing
- If you find no issues, say "PASS" with no other commentary

### Review approach:
- Look for ANY complex logic - is it explained with comments or clear naming?
- Look for ANY function over 50 lines - can it be broken up?
- Look for ANY nesting over 3 levels - should it use early returns?
- Look for ANY magic numbers/strings - should they be constants?
- Assume there ARE readability problems until you've proven otherwise

## Important: Read-Only Review

**This is a review-only skill. DO NOT edit, modify, or change any code files.**

Your role is to:
- Analyze code and identify issues
- Report findings with file paths and line numbers
- Provide suggestions in the output report

## Process

1. Get changed files:
   - `git diff --name-only main...HEAD` (branch commits)
   - `git diff --name-only --cached` (staged)
   - `git diff --name-only` (unstaged)
2. Filter to TypeScript files (`.ts`, `.tsx`)
3. **Read the FULL file content** for each changed file - you MUST read the entire file, not just the diff
4. **Locate the changed code within the file**, then examine the ENTIRE function/block containing those changes
5. **For every function over 30 lines:**
   - Check if it could be broken into smaller functions
   - Check if complex logic is explained
   - This check is mandatory even if only part of the function was changed
6. **For every conditional or loop:**
   - Count nesting levels
   - Check for early return opportunities
7. Report ONLY actual problems - no praise, no validation, no "well-written" commentary

## Patterns to Check

### Critical Issues (Must Fix)

**1. Incomprehensible Logic**
- Complex algorithms or business logic with no explanation
- Non-obvious code that requires tribal knowledge to understand

**2. Misleading Names**
- Variable/function names that don't match their purpose
- Boolean names that don't read naturally

### Warnings

**1. Overly Long Functions**
- Functions exceeding ~50 lines that could be broken into smaller pieces
- **Exception**: tRPC mutations with clear section comments are acceptable

**2. Deep Nesting**
- More than 3 levels of nesting (if/for/while)
- Should use early returns or guard clauses

**3. Magic Numbers/Strings**
- Unexplained literal values in logic

**4. Complex Ternary Expressions**
- Nested ternaries or ternaries with complex conditions

**5. Long Boolean Expressions**
- Complex conditions that could be extracted to named variables

**6. Callback Hell**
- Deeply nested callbacks instead of async/await

**7. Inconsistent Patterns**
- Similar operations done differently in the same file

## Output Format

**IMPORTANT: Only include actual problems. Do NOT include:**
- Praise ("well-structured", "clear naming", "readable code")
- Validation ("this is easy to follow", "good organization")
- Commentary on code that has no issues

```
## Readability Review: [PASS/NEEDS FIXES]

### Critical Issues
- `file.ts:line` - [issue type] - [description] - [suggestion]

### Warnings
- `file.ts:line` - [warning type] - [description]

### Summary
X critical issues, Y warnings
```

If no issues found, output ONLY:

```
Readability Review: PASS
```
