---
description: Runs CodeRabbit analysis
allowed-tools: Bash(coderabbit review:*), Write, TodoWrite
---

Run CodeRabbit and summarize findings.

**Arguments**: `$ARGUMENTS` should contain `<IDENTIFIER>`

- **IDENTIFIER** (required): Used to organize review output files

## Process

### Step 1: Create Todo Checklist

**BEFORE starting, create a todo list with all checks.** Use TodoWrite:

- [ ] Run CodeRabbit (`coderabbit review --plain`)
- [ ] Extract actionable findings
- [ ] Categorize issues (critical, warning, suggestion)
- [ ] Write findings or return PASS

Mark each todo as completed after performing it.

### Step 2: Execute Review

1. Run: `coderabbit review --plain`
2. Extract actionable feedback
3. Categorize: critical, warning, suggestion

## Output

### If CodeRabbit issues found (NEEDS FIXES):

1. **Save detailed findings** to `.claude/review/$IDENTIFIER/coderabbit.md` using Write tool (replace `$IDENTIFIER` with actual identifier from arguments):

   ```
   # CodeRabbit Results

   ## Critical Issues
   - file:line - severity - description - recommendation

   ## Warnings
   - file:line - severity - description - recommendation

   ## Suggestions
   - file:line - description - recommendation

   ## Summary
   X critical, Y warnings, Z suggestions
   ```

2. **Return only**:
   ```
   CodeRabbit: NEEDS FIXES
   Findings saved to: .claude/review/$IDENTIFIER/coderabbit.md
   ```

### If CodeRabbit passes (PASS):

Return only: "CodeRabbit: PASS"
