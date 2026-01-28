---
description: Reviews code for CLAUDE.md compliance
allowed-tools: Read, Grep, Glob, Bash(git diff:*, git status:*), TaskCreate, TaskUpdate, TaskList, TaskGet
---

# Guidelines Review

Review code changes for compliance with project guidelines.

## Task Tracking

**IMPORTANT**: Before starting the review, create tasks for each major checkpoint using TaskCreate. Update each task to `in_progress` when starting and `completed` when done.

Create these tasks at the start:
1. "Read CLAUDE.md" - Understand project guidelines
2. "Get changed files" - Get list of files to review
3. "Read full file contents" - Read complete files (not just diffs)
4. "Check TypeScript strict mode" - No `any` types or unsafe operations
5. "Check functional patterns" - No unnecessary classes
6. "Check arrow functions" - Arrow functions over function declarations
7. "Check naming conventions" - Descriptive names with auxiliary verbs
8. "Check component structure" - exported → subcomponents → helpers → types
9. "Check DRY principles" - No code duplication
10. "Check for over-engineering" - No unnecessary abstractions
11. "Compile findings" - Produce final report

Work through each task in order, marking as `in_progress` then `completed`.

## Critical Review Mindset

**Your job is to FIND GUIDELINE VIOLATIONS. Do NOT validate or praise code.**

### What NOT to output:
- "Follows guidelines correctly" or "Good naming convention" - this is praise, not a finding
- "This properly uses functional patterns" or "Correct structure" - this is validation, not a finding
- Any statement saying code is compliant/correct/proper - SKIP IT ENTIRELY
- Do NOT include items in your output that aren't actual guideline violations

### What TO output:
- ONLY actual guideline violations that need fixing
- If you find no issues, say "PASS" with no other commentary

### Review approach:
- Look for ANY `any` type usage - should be properly typed
- Look for ANY class usage - should be functional
- Look for ANY function declaration - should be arrow function
- Look for ANY new file/function - does similar exist in codebase?
- Assume there ARE violations until you've proven otherwise

## Process

1. Read `CLAUDE.md` for project guidelines
2. Get changed files:
   - `git diff --name-only main...HEAD` (branch commits)
   - `git diff --name-only --cached` (staged)
   - `git diff --name-only` (unstaged)
3. **Read the FULL file content** for each changed file - you MUST read the entire file, not just the diff
4. **Locate the changed code within the file**, then examine the ENTIRE function/block containing those changes
5. For each changed file, check:

   **TypeScript strict mode**: No `any` types or unsafe operations

   **Functional patterns**: No unnecessary classes where functions work better

   **Arrow functions**: Use arrow functions over function declarations

   **Naming conventions**: Descriptive names with auxiliary verbs

   **Component structure**: exported component → subcomponents → helpers → types

   **DRY principles**: No code duplication that could be consolidated

   **Reuse over creation**: Check if new code overlaps with existing functionality

   **JSX string literals**: No hardcoded strings using `{"string"}` syntax

   **Over-engineering**: No unnecessary abstractions, features, or error handling

   **Comments**: No unnatural tracking markers or unnecessary comments

6. Report ONLY actual problems - no praise, no validation, no "correctly follows" commentary

## Output Format

**IMPORTANT: Only include actual problems. Do NOT include:**
- Praise ("follows guidelines", "good structure", "correct pattern")
- Validation ("properly implements", "correctly uses")
- Commentary on code that has no issues

```
## Guidelines Review: [PASS/NEEDS FIXES]

### Issues
- file:line - [guideline] - [description] - [fix]

### Summary
X issues found
```

If no issues found, output ONLY:

```
Guidelines Review: PASS
```
