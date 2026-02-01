---
description: Runs ESLint
allowed-tools: Bash(make lint:*), Write, TodoWrite
---

Run ESLint and report results.

**Arguments**: `$ARGUMENTS` should contain `<IDENTIFIER>`

- **IDENTIFIER** (required): Used to organize review output files

## Process

### Step 1: Create Todo Checklist

**BEFORE starting, create a todo list with all checks.** Use TodoWrite:

- [ ] Run ESLint (`make lint`)
- [ ] Parse errors/warnings from output
- [ ] Write findings or return PASS

Mark each todo as completed after performing it.

### Step 2: Execute Review

1. Run: `make lint`
2. Parse errors/warnings from output

## Output

### If lint issues found (NEEDS FIXES):

1. **Save detailed findings** to `.claude/review/$IDENTIFIER/lint.md` using Write tool (replace `$IDENTIFIER` with actual identifier from arguments):

   ```
   # ESLint Results

   Stats: X errors, Y warnings

   ## Issues
   - file:line - rule - message
   ...
   ```

2. **Return only**:
   ```
   Lint: NEEDS FIXES
   Findings saved to: .claude/review/$IDENTIFIER/lint.md
   ```

### If lint passes (PASS):

Return only: "Lint: PASS"
