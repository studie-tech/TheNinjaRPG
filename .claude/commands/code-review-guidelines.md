---
description: Reviews code for CLAUDE.md compliance
allowed-tools: Read, Grep, Glob, Bash(git diff:*, git status:*), Write, TodoWrite
---

# Guidelines Review

Review code changes for compliance with project guidelines.

**Arguments**: `$ARGUMENTS` should contain `<IDENTIFIER>`

- **IDENTIFIER** (required): Used to organize review output files

## Process

### Step 1: Create Todo Checklist

**BEFORE starting, create a todo list with all checks.** Use TodoWrite:

- [ ] Read CLAUDE.md for project guidelines
- [ ] Get changed files
- [ ] Read full file contents (not just diffs)
- [ ] Check TypeScript strict mode - No `any` types
- [ ] Check functional patterns - No unnecessary classes
- [ ] Check arrow functions - Arrow functions over function declarations
- [ ] Check naming conventions - Descriptive names with auxiliary verbs
- [ ] Check component structure - exported → subcomponents → helpers → types
- [ ] Check DRY principles - No code duplication
- [ ] Check for over-engineering
- [ ] Write findings or return PASS

Mark each todo as completed after performing it.

### Step 2: Execute Review

1. Read `CLAUDE.md` for project guidelines
2. Get changed `.ts` and `.tsx` files (excluding migrations):
   - `git diff --name-only main...HEAD -- '*.ts' '*.tsx' ':!**/migrations/**'` (branch commits)
   - `git diff --name-only --cached -- '*.ts' '*.tsx' ':!**/migrations/**'` (staged)
   - `git diff --name-only -- '*.ts' '*.tsx' ':!**/migrations/**'` (unstaged)
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

## Output

### If issues found (NEEDS FIXES):

1. **Save detailed findings** to `.claude/review/$IDENTIFIER/guidelines.md` using Write tool (replace `$IDENTIFIER` with actual identifier from arguments):

   ```
   # Guidelines Review Results

   ## Issues
   - file:line - [guideline] - [description] - [fix]

   ## Summary
   X issues found
   ```

2. **Return only**:
   ```
   Guidelines: NEEDS FIXES
   Findings saved to: .claude/review/$IDENTIFIER/guidelines.md
   ```

### If review passes (PASS):

Return only: "Guidelines: PASS"
