---
description: Review, evaluate, and fuse multiple implementation plans into one comprehensive plan. Use /plan-aggregate <PLAN_PATH_1> <PLAN_PATH_2> [... more paths]
allowed-tools: Read, Grep, Glob, Write
---

# Plan Aggregate

Review and evaluate multiple implementation plans created by separate agents, then fuse them into a single comprehensive and accurate plan by selecting the best solutions from each.

**Input**: `$ARGUMENTS` contains space-separated paths to one or more plan files (e.g., `.claude/tasks/PLAN1.md .claude/tasks/PLAN2.md`)

## Purpose

When multiple agents work on creating implementation plans for the same issue, they may:

- Arrive at different root cause analyses
- Propose different fix strategies
- Have varying levels of thoroughness in codebase exploration
- Make different assumptions or miss edge cases
- Go off track with incorrect implementations

This skill aggregates these plans, critically evaluates each one, and produces a single authoritative plan that incorporates the best insights while discarding incorrect or suboptimal approaches.

## Process

### Step 1: Parse and Load All Plans

Parse the `$ARGUMENTS` to extract plan paths:

**$ARGUMENTS = `$ARGUMENTS`**

1. Split the arguments by spaces to get individual plan paths
2. Read each plan file completely
3. If any path is invalid or file doesn't exist, report the error and continue with valid plans
4. If fewer than 1 valid plan is found, abort with an error message

For each plan, extract and note:

- **Plan ID**: The filename/identifier
- **Issue being addressed**: What problem is this solving?
- **Root cause analysis**: What does this plan identify as the cause?
- **Proposed solution**: What fix strategy is recommended?
- **Files to modify**: Which files are targeted?
- **Implementation steps**: The specific changes proposed
- **Assumptions made**: Any stated or implicit assumptions

### Step 2: Deep Comparative Analysis

**This is the critical evaluation step.**

For each plan, thoroughly verify its analysis by exploring the codebase yourself:

1. **Verify Root Cause Claims**
   - Read the files and code sections referenced in each plan
   - Trace the error paths or logic flows described
   - Determine which plan(s) correctly identified the root cause
   - Flag any plans that misdiagnosed the problem

2. **Evaluate Proposed Solutions**
   - Assess whether each solution actually addresses the root cause
   - Check if the proposed changes follow existing codebase patterns
   - Identify potential bugs or regressions in proposed solutions
   - Rate solutions on: correctness, simplicity, maintainability, risk

3. **Check Thoroughness**
   - Did the plan explore all relevant code paths?
   - Are there edge cases the plan missed?
   - Did the plan consider alternative approaches?
   - Is the testing strategy adequate?

4. **Identify Conflicts and Contradictions**
   - Where do plans disagree on root cause?
   - Where do plans propose incompatible solutions?
   - Which plan's reasoning is better supported by evidence?

### Step 3: Quality Scoring

Rate each plan on a 1-5 scale for each criterion:

| Criterion | Description |
|-----------|-------------|
| **Root Cause Accuracy** | Does the plan correctly identify the actual root cause? |
| **Solution Correctness** | Will the proposed fix actually solve the problem? |
| **Codebase Understanding** | Does the plan show deep understanding of the code? |
| **Pattern Compliance** | Does the solution follow existing codebase patterns? |
| **Completeness** | Are all affected areas and edge cases addressed? |
| **Risk Assessment** | Are risks and potential regressions properly considered? |
| **Testing Strategy** | Is the verification approach thorough? |

Create a comparison matrix:

```markdown
| Criterion             | Plan A | Plan B | Plan C | Notes |
|-----------------------|--------|--------|--------|-------|
| Root Cause Accuracy   | 4      | 2      | 5      | Plan C correctly identified X |
| Solution Correctness  | 3      | 4      | 5      | Plan B/C both valid approaches |
| ...                   | ...    | ...    | ...    | ... |
| **TOTAL**             | 24     | 21     | 32     | Plan C is strongest |
```

### Step 4: Synthesize Best Elements

Based on your analysis, create a fused plan by:

1. **Select the Best Root Cause Analysis**
   - Choose the most accurate and thorough diagnosis
   - If multiple plans are correct, combine their insights
   - Explicitly note why other analyses were rejected

2. **Choose the Optimal Solution Strategy**
   - Select the approach that best balances correctness, simplicity, and risk
   - If one plan's solution is clearly superior, adopt it
   - If plans have complementary good ideas, merge them thoughtfully

3. **Compile Comprehensive File List**
   - Union of all files that genuinely need modification
   - Exclude files incorrectly identified by flawed plans
   - Add any files that all plans missed but should be modified

4. **Merge Implementation Steps**
   - Use the most detailed and accurate steps
   - Reorder if necessary for logical flow
   - Add clarifications where plans were vague
   - Remove incorrect or unnecessary steps

5. **Strengthen Testing Strategy**
   - Combine all valid test cases from all plans
   - Add tests for edge cases any plan missed
   - Ensure regression coverage

### Step 5: Create the Aggregated Plan

Create a new implementation plan document with this structure:

```markdown
# Aggregated Implementation Plan: [ISSUE_ID]

## Source Plans Analyzed

| Plan | Path | Quality Score | Verdict |
|------|------|---------------|---------|
| Plan A | `.claude/tasks/...` | 24/35 | Partially used - good solution, missed edge cases |
| Plan B | `.claude/tasks/...` | 21/35 | Rejected - incorrect root cause analysis |
| Plan C | `.claude/tasks/...` | 32/35 | Primary source - most thorough and accurate |

## Issue Summary

- **Original Issue**: [Brief description]
- **Root Cause**: [Synthesized from best analysis]
- **Impact**: [Combined understanding]

## Plan Evaluation Summary

### What Plan A Got Right
- [List correct insights]

### What Plan A Got Wrong
- [List incorrect elements and why]

### What Plan B Got Right
- [List correct insights]

### What Plan B Got Wrong
- [List incorrect elements and why]

[... repeat for all plans ...]

### Synthesis Decision
[Explain why the final approach was chosen and how elements were combined]

## Root Cause Analysis

[Comprehensive root cause analysis, taking the best from all plans]

## Files to Modify

1. `path/to/file1.ts` - [What changes are needed and why]
2. `path/to/file2.ts` - [What changes are needed and why]

## Implementation Steps

### Step 1: [Description]
- [ ] Specific change to make
- [ ] Source: Plan C, Step 2 (verified correct)

### Step 2: [Description]
- [ ] Specific change to make
- [ ] Source: Combined from Plan A Step 3 and Plan C Step 4

[... continue for all steps ...]

## Testing Strategy

- [ ] Test case 1 (from Plan A)
- [ ] Test case 2 (from Plan C)
- [ ] Additional test case for edge case X (added during review)

## Risk Assessment

- **Risks identified by plans**: [Combined list]
- **Additional risks found during review**: [Any new concerns]
- **Mitigations**: [How risks are addressed]
- **Rollback plan**: [If fix causes issues]

## Rejected Approaches

### Approach from Plan B: [Description]
**Why rejected**: [Explanation of why this approach was not used]

[... repeat for other rejected approaches ...]
```

### Step 6: Save the Aggregated Plan

Save the aggregated plan to: `.claude/tasks/[ISSUE_ID]_AGGREGATED-[random]-[identifier].md`

Where:
- `[ISSUE_ID]` is the issue identifier (e.g., `HUBPROD123`)
- `[random]` is a set of 6 random letters for uniqueness
- `[identifier]` is a short description (e.g., `merged_fix`)

Example: `.claude/tasks/HUBPROD123_AGGREGATED-xkwmqp-merged_fix.md`

### Step 7: Final Validation

Before completing, validate the aggregated plan:

1. **Trace through the solution mentally** - Does it fully address the root cause?
2. **Check for internal consistency** - Do all steps work together?
3. **Verify no good ideas were lost** - Review each source plan one more time
4. **Confirm rejected approaches are truly inferior** - Double-check your reasoning
5. **Ensure implementation is complete** - No gaps in the steps?

**Validation Checklist**:
- [ ] The aggregated root cause is correct and well-supported
- [ ] The chosen solution is the best option from all plans
- [ ] All necessary files are included
- [ ] Implementation steps are clear and complete
- [ ] Testing strategy covers all scenarios
- [ ] Rejected approaches are genuinely inferior

## Output

After completing all steps, report:

1. **Plans analyzed**: List of input plans with their quality scores
2. **Plan saved to**: `[path to aggregated plan file]`
3. **Summary**: Brief description of the synthesized approach
4. **Key decisions**: Most important choices made during aggregation
5. **Confidence level**: How confident you are in the aggregated plan
6. **Next steps**: Instructions for implementing the fix (use `/implement [aggregated_plan_path]`)

## Important Notes

- **Be ruthlessly objective** - Don't favor a plan because it came first or seems more polished
- **Verify everything yourself** - Don't trust any plan's claims without checking the code
- **Document your reasoning** - Future reviewers should understand why decisions were made
- **Prefer simplicity** - When two approaches are equally correct, choose the simpler one
- **Preserve valuable insights** - Even rejected plans may have useful observations
- **Single agent plans are valid** - If only one plan is provided, still thoroughly validate it and create an aggregated format output
