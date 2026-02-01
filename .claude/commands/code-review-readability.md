---
description: Reviews code for readability, clarity, and maintainability
allowed-tools: Read, Grep, Glob, Bash(git diff:*, git status:*), Write, TodoWrite
---

# Code Readability Review

Review code for readability and clarity, ensuring code is easy to understand and maintain.

**Arguments**: `$ARGUMENTS` should contain `<IDENTIFIER>`

- **IDENTIFIER** (required): Used to organize review output files

## Process

### Step 1: Create Todo Checklist

**BEFORE starting, create a todo list with all checks.** Use TodoWrite:

- [ ] Get changed files
- [ ] Read full file contents (not just diffs)
- [ ] Check function length - Flag functions over 50 lines
- [ ] Check nesting depth - Flag nesting over 3 levels
- [ ] Check naming clarity - Verify variable/function names are descriptive
- [ ] Check magic values - Flag unexplained literal values
- [ ] Check complex expressions - Flag complex ternaries and boolean expressions
- [ ] Write findings or return PASS

Mark each todo as completed after performing it.

### Step 2: Execute Review

1. Get changed `.ts` and `.tsx` files (excluding migrations):
   - `git diff --name-only main...HEAD -- '*.ts' '*.tsx' ':!**/migrations/**'` (branch commits)
   - `git diff --name-only --cached -- '*.ts' '*.tsx' ':!**/migrations/**'` (staged)
   - `git diff --name-only -- '*.ts' '*.tsx' ':!**/migrations/**'` (unstaged)
2. **Read the FULL file content** for each changed file - you MUST read the entire file, not just the diff
3. **Locate the changed code within the file**, then examine the ENTIRE function/block containing those changes
4. **For every function over 30 lines:**
   - Check if it could be broken into smaller functions
   - Check if complex logic is explained
   - This check is mandatory even if only part of the function was changed
5. **For every conditional or loop:**
   - Count nesting levels
   - Check for early return opportunities

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

## Important: Read-Only Review

**This is a review-only skill. DO NOT edit, modify, or change any code files.**

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

## Output

### If readability issues found (NEEDS FIXES):

1. **Save detailed findings** to `.claude/review/$IDENTIFIER/readability.md` using Write tool (replace `$IDENTIFIER` with actual identifier from arguments):

   ```
   # Readability Review Results

   ## Critical Issues
   - `file.ts:line` - [issue type] - [description] - [suggestion]

   ## Warnings
   - `file.ts:line` - [warning type] - [description]

   ## Summary
   X critical issues, Y warnings
   ```

2. **Return only**:
   ```
   Readability: NEEDS FIXES
   Findings saved to: .claude/review/$IDENTIFIER/readability.md
   ```

### If review passes (PASS):

Return only: "Readability: PASS"
