---
description: Runs test suite
allowed-tools: Bash(make test:*), Write, TodoWrite
---

Run tests and report results.

**Arguments**: `$ARGUMENTS` should contain `<IDENTIFIER>`

- **IDENTIFIER** (required): Used to organize review output files

## Process

### Step 1: Create Todo Checklist

**BEFORE starting, create a todo list with all checks.** Use TodoWrite:

- [ ] Run tests (`make test`)
- [ ] Parse pass/fail counts
- [ ] Write findings or return PASS

Mark each todo as completed after performing it.

### Step 2: Execute Review

1. Run: `make test`
2. Parse pass/fail counts from output

## Output

### If test failures found (NEEDS FIXES):

1. **Save detailed findings** to `.claude/review/$IDENTIFIER/tests.md` using Write tool (replace `$IDENTIFIER` with actual identifier from arguments):

   ```
   # Test Results

   Stats: X passed, Y failed, Z total

   ## Failures
   - test name: error message
   ...
   ```

2. **Return only**:
   ```
   Tests: NEEDS FIXES
   Findings saved to: .claude/review/$IDENTIFIER/tests.md
   ```

### If tests pass (PASS):

Return only: "Tests: PASS"
