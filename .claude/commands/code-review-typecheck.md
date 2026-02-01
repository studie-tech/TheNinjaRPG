---
description: Runs TypeScript type checking
allowed-tools: Bash(make typecheck:*), Write, TodoWrite
---

Run TypeScript type checking and report results.

**Arguments**: `$ARGUMENTS` should contain `<IDENTIFIER>`

- **IDENTIFIER** (required): Used to organize review output files

## Process

### Step 1: Create Todo Checklist

**BEFORE starting, create a todo list with all checks.** Use TodoWrite:

- [ ] Run typecheck (`make typecheck`)
- [ ] Parse type errors from output
- [ ] Write findings or return PASS

Mark each todo as completed after performing it.

### Step 2: Execute Review

1. Run: `make typecheck`
2. Parse errors from output

## Output

### If type errors found (NEEDS FIXES):

1. **Save detailed findings** to `.claude/review/$IDENTIFIER/typecheck.md` using Write tool (replace `$IDENTIFIER` with actual identifier from arguments):

   ```
   # TypeScript Results

   Stats: X errors

   ## Errors
   - file:line - error code - message
   ...
   ```

2. **Return only**:
   ```
   Typecheck: NEEDS FIXES
   Findings saved to: .claude/review/$IDENTIFIER/typecheck.md
   ```

### If typecheck passes (PASS):

Return only: "Typecheck: PASS"
