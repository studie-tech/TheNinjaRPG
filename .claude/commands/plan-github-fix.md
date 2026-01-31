---
name: plan-github-fix
description: Create an implementation plan for a GitHub issue. Use /plan-github-fix <ISSUE_NUMBER_OR_URL>
allowed-tools: Bash(gh *:*), Read, Grep, Glob, Write, Task
---

# Plan GitHub Fix

Create a detailed implementation plan for fixing a GitHub issue by fetching issue details, thoroughly exploring the codebase, and producing a well-reasoned fix strategy.

**Input**: `$ARGUMENTS` contains the GitHub issue number (e.g., `123`) or full GitHub issue URL.

## Process

### Step 1: Fetch GitHub Issue Details

Use the GitHub CLI to get issue details from the provided argument:

**$ARGUMENTS = `$ARGUMENTS`**

1. If `$ARGUMENTS` is a GitHub URL, extract the issue number from it
2. If `$ARGUMENTS` is just a number, use it directly

Fetch the issue details:

```bash
gh issue view <ISSUE_NUMBER> --json number,title,body,labels,assignees,state,comments \
  --jq '{number, title, body, labels, assignees, state, comments: [.comments[] | select(.isMinimized == false)]}'
```

This command filters out minimized/hidden comments, keeping only visible ones.

Extract from the issue:

- **Issue Number**: The issue ID like `#123`
- **Title**: The issue title/summary
- **Description**: The main issue body with problem description
- **Labels**: Any labels (bug, enhancement, feature, etc.)
- **Comments**: Any additional context from comments (see comment analysis below)
- **Acceptance Criteria**: Any specific requirements mentioned

**Comment Analysis** (Critical for understanding full context):

Carefully read through ALL visible comments to identify:

1. **Clarifications**: Additional details from the reporter or maintainers that refine the issue
2. **Reproduction steps**: Any steps provided in comments that weren't in the original description
3. **Failed attempts**: Solutions that were tried and didn't work (avoid repeating these)
4. **Partial solutions**: Workarounds or hints that point toward the fix
5. **Related context**: Links to related issues, PRs, or documentation
6. **Scope changes**: Any updates to requirements or acceptance criteria discussed in comments
7. **Developer insights**: Technical observations from team members about root cause

Comments often contain crucial information not in the original issue body. Integrate all relevant comment insights into your analysis.

### Step 2: Categorize the Issue

Based on the issue details, determine the type of work required:

1. **Bug Fix**: An error, incorrect behavior, or crash

   - Look for: error messages, stack traces, reproduction steps
   - Focus on: root cause analysis, minimal fix

2. **Feature Request**: New functionality to implement

   - Look for: user stories, acceptance criteria, mockups
   - Focus on: design decisions, integration points

3. **Enhancement**: Improvement to existing functionality

   - Look for: current behavior, desired behavior
   - Focus on: backward compatibility, minimal changes

4. **Refactoring**: Code quality improvement
   - Look for: code smells, performance issues, technical debt
   - Focus on: maintaining behavior, improving structure

### Step 3: Deep Codebase Exploration

**This is a critical step - do not rush it.**

Navigate to and carefully read the files mentioned or implied by the issue:

1. **Find relevant code**: Search for keywords, function names, or file paths mentioned in the issue
2. **Understand the context**: Read the surrounding code to understand how it works
3. **Trace the flow**: Follow the code path that's relevant to the issue
4. **Examine related code**: Look at:
   - The function/method containing the code in question
   - Functions that call this code
   - Functions that this code calls
   - Related types, interfaces, and data structures
   - Similar patterns elsewhere in the codebase
5. **Check for existing patterns**: Search for how similar issues are handled elsewhere:
   - Error handling patterns
   - Validation patterns
   - Component structures
   - API patterns

**Questions to answer during exploration**:

- What is the exact condition or requirement described in the issue?
- What code areas are affected?
- Are there similar implementations to reference?
- What edge cases should be handled?
- What tests exist for this area?
- What could break as a result of changes?

### Step 4: Root Cause / Requirements Analysis

Based on your exploration, document:

**For Bug Fixes**:

1. **Root Cause**: The fundamental reason the bug occurs
2. **Trigger Conditions**: What specific data, state, or sequence of events triggers it
3. **Impact Assessment**: How severe is this issue? What user actions are affected?
4. **Contributing Factors**: Any code patterns or architectural issues that made this bug possible

**For Features/Enhancements**:

1. **Functional Requirements**: What the code needs to do
2. **Technical Requirements**: How it needs to be implemented
3. **Integration Points**: Where this code connects with existing code
4. **Impact Assessment**: What areas of the application are affected?

### Step 5: Develop Implementation Strategy

Consider multiple approaches to addressing the issue:

1. **Option A**: [First approach - describe]

   - Pros: ...
   - Cons: ...

2. **Option B**: [Alternative approach - describe]
   - Pros: ...
   - Cons: ...

Select the best approach based on:

- Minimal code changes
- Consistency with existing patterns
- No introduction of new bugs
- Proper error handling
- Maintainability

### Step 6: Create Implementation Plan

Create a detailed implementation plan document with the following structure:

```markdown
# Implementation Plan: GitHub Issue #[NUMBER]

## Issue Summary

- **GitHub Issue**: #[NUMBER] - [Title]
- **Type**: [Bug Fix / Feature / Enhancement / Refactoring]
- **Labels**: [List of labels]
- **Description**: [Brief description of the issue]

## Key Insights from Comments

[Summarize important information gathered from issue comments that informed this plan. Include:

- Additional context or clarifications from reporters/maintainers
- Failed attempts or workarounds mentioned
- Any scope changes or refined requirements
- Technical observations from team members]

## Analysis

### For Bug Fixes:

#### Root Cause Analysis

[Detailed explanation of what causes this issue]

#### Key Insights from Issue

[Specific details from the issue description, comments, or reproduction steps that led to this conclusion]

### For Features/Enhancements:

#### Requirements Analysis

[Functional and technical requirements]

#### Acceptance Criteria

[What defines success for this issue]

## Files to Modify

1. `path/to/file1.ts` - [What changes are needed]
2. `path/to/file2.ts` - [What changes are needed]

## New Files to Create (if any)

1. `path/to/new-file.ts` - [Purpose]

## Implementation Steps

### Step 1: [Description]

- [ ] Specific change to make
- [ ] Code snippet or approach

### Step 2: [Description]

- [ ] Specific change to make

... (continue for all steps)

## Testing Strategy

- [ ] How to verify the fix/feature works
- [ ] Edge cases to test
- [ ] Regression testing considerations

## Risk Assessment

- Potential side effects: [List any]
- Rollback plan: [If changes cause issues]
```

### Step 7: Save the Plan

Save the implementation plan to: `.claude/tasks/[DATETIME]_GH[NUMBER]_PLAN-[random]-[identifier].md`

Where:

- `[DATETIME]` is the current date and time in format `YYYYMMDD-HHMMSS` (e.g., `20250131-143052`)
- `[NUMBER]` is the GitHub issue number (e.g., `123`)
- `[random]` is a set of 6 random lowercase letters to create a unique plan ID
- `[identifier]` is a short description of the fix (e.g., `add_validation`, `fix_crash`)

Example: `.claude/tasks/20250131-143052_GH123_PLAN-fdosdg-fix_null_reference.md`

### Step 8: Validate the Plan (Critical)

**Before finalizing, critically evaluate the implementation plan:**

1. **Re-read the GitHub issue** - Does the plan actually address what's being asked?
2. **Trace through the solution mentally** - Will the proposed changes solve the issue?
3. **Check for completeness** - Are all affected code paths covered?
4. **Verify consistency** - Does the solution follow existing codebase patterns?
5. **Consider edge cases** - What happens in unusual scenarios?
6. **Evaluate risk** - Could this change introduce new issues?

**Ask yourself**:

- [ ] Does this plan address the ACTUAL issue, not just a symptom?
- [ ] Have I incorporated insights from ALL issue comments, not just the original description?
- [ ] Have I considered all the ways this code path can be reached?
- [ ] Is there any scenario where this solution would not work?
- [ ] Am I introducing any new failure modes?
- [ ] Is this the simplest solution that solves the problem?

If any validation check fails, return to Step 3-6 and refine the analysis and plan.

## Output

After completing all steps, report:

1. **Plan saved to**: `[path to saved plan file]`
2. **Summary**: Brief description of the issue and proposed solution
3. **Issue Type**: Bug fix, feature, enhancement, or refactoring
4. **Key Insights**: Important details from the issue that informed the solution
5. **Confidence level**: How confident you are that this solution will resolve the issue
6. **Next steps**: Instructions for implementing the fix (use `/implement [plan_path]`)

## Important Notes

- **Take your time** - A thorough analysis prevents multiple fix attempts
- **Read the full issue AND all comments** - Comments often contain critical context, clarifications, failed attempts, or scope changes not in the original description
- **Check existing patterns** - The codebase likely has similar handling you can follow
- **Document assumptions** - If you're uncertain about something, note it in the plan
- **Be skeptical** - Question your own analysis before finalizing
- **Stay in scope** - Don't expand beyond what the issue asks for
