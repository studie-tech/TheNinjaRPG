---
name: plan-implementation
description: Create an implementation plan based on instructions. Use /plan-implementation <INSTRUCTIONS>
---

# Plan Implementation

Create a detailed implementation plan based on provided instructions by thoroughly exploring the codebase and producing a well-reasoned implementation strategy.

**Input**: `$ARGUMENTS` contains the implementation instructions (a description of what needs to be done).

## Process

### Step 1: Parse and Understand Instructions

Parse the provided instructions from the argument:

**$ARGUMENTS = `$ARGUMENTS`**

Extract from the instructions:

- **Goal**: What is the primary objective?
- **Scope**: What areas of the codebase are likely affected?
- **Constraints**: Any specific requirements or limitations mentioned?
- **Success criteria**: How will we know when it's done correctly?

If the instructions are vague, make reasonable assumptions and document them clearly in the plan.

### Step 2: Deep Codebase Exploration

**This is a critical step - do not rush it.**

Explore the codebase to understand the context and identify relevant code:

1. **Search for related code**: Use semantic search and grep to find code related to the instructions
2. **Understand existing patterns**: Look at how similar features or changes are implemented
3. **Identify affected areas**: Determine which files, components, or modules need to be modified
4. **Examine related code**: Look at:
   - Functions/components that will be affected
   - Functions that call this code
   - Functions that this code calls
   - Related types, interfaces, and data structures
   - Similar patterns elsewhere in the codebase
5. **Check for existing patterns**: Search for how similar changes have been made:
   - Coding patterns
   - Error handling patterns
   - Component structures
   - API patterns

**Questions to answer during exploration**:

- What existing code is most relevant to this change?
- What patterns should the implementation follow?
- Are there any dependencies that need to be considered?
- What edge cases should be handled?
- Are there tests that need to be added or updated?
- What could go wrong with this implementation?

### Step 3: Requirements Analysis

Based on your exploration, document:

1. **Functional Requirements**: What the code needs to do
2. **Technical Requirements**: How it needs to be implemented (patterns, technologies)
3. **Integration Points**: Where this code connects with existing code
4. **Impact Assessment**: What areas of the application are affected?
5. **Dependencies**: External libraries, internal modules, or APIs needed

### Step 4: Develop Implementation Strategy

Consider multiple approaches to implementing the feature:

1. **Option A**: [First approach - describe]
   - Pros: ...
   - Cons: ...

2. **Option B**: [Alternative approach - describe]
   - Pros: ...
   - Cons: ...

Select the best approach based on:

- Consistency with existing patterns
- Minimal code changes
- Maintainability
- Performance implications
- Proper error handling

### Step 5: Create Implementation Plan

Create a detailed implementation plan document with the following structure:

```markdown
# Implementation Plan: [SHORT_IDENTIFIER]

## Instructions Summary

- **Original Instructions**: [The instructions provided]
- **Goal**: [Primary objective]
- **Scope**: [Areas affected]

## Requirements Analysis

### Functional Requirements
[What the code needs to do]

### Technical Requirements
[How it needs to be implemented]

### Integration Points
[Where this connects with existing code]

## Codebase Analysis

[Summary of relevant code discovered during exploration]

### Related Files
- `path/to/file1.ts` - [Why it's relevant]
- `path/to/file2.ts` - [Why it's relevant]

### Patterns to Follow
[Existing patterns that should be used]

## Files to Modify

1. `path/to/file1.ts` - [What changes are needed]
2. `path/to/file2.ts` - [What changes are needed]

## New Files to Create

1. `path/to/new-file.ts` - [Purpose and contents]

## Implementation Steps

### Step 1: [Description]
- [ ] Specific change to make
- [ ] Code snippet or approach

### Step 2: [Description]
- [ ] Specific change to make

... (continue for all steps)

## Testing Strategy

- [ ] How to verify the implementation works
- [ ] Edge cases to test
- [ ] Regression testing considerations

## Risk Assessment

- Potential side effects: [List any]
- Rollback plan: [If implementation causes issues]
```

### Step 6: Save the Plan

Save the implementation plan to: `.claude/tasks/IMPL_PLAN-[identifier]-[random].md`

Where:
- `[identifier]` is a short description of the implementation (e.g., `add_auth`, `refactor_api`)
- `[random]` is a set of 6 random letters in order to create a unique plan ID

Example: `.claude/tasks/IMPL_PLAN-fdosdg-add_user_settings.md`

### Step 7: Validate the Plan (Critical)

**Before finalizing, critically evaluate the implementation plan:**

1. **Re-read the original instructions** - Does the plan actually address what was asked?
2. **Trace through the implementation mentally** - Will the proposed changes achieve the goal?
3. **Check for completeness** - Are all required changes covered?
4. **Verify consistency** - Does the implementation follow existing codebase patterns?
5. **Consider edge cases** - What happens in unusual scenarios?
6. **Evaluate risk** - Could this implementation introduce new issues?

**Ask yourself**:

- [ ] Does this plan address the ACTUAL goal, not a misinterpretation?
- [ ] Have I considered all the affected areas?
- [ ] Is there any scenario where this implementation would not work?
- [ ] Am I introducing any new failure modes?
- [ ] Is this the simplest implementation that achieves the goal?

If any validation check fails, return to Step 2-5 and refine the analysis and plan.

## Output

After completing all steps, report:

1. **Plan saved to**: `[path to saved plan file]`
2. **Summary**: Brief description of the implementation approach
3. **Key decisions**: Important choices made during planning
4. **Confidence level**: How confident you are that this plan will achieve the goal
5. **Next steps**: Instructions for implementing the plan (use `/implement [plan_path]`)

## Important Notes

- **Take your time** - A thorough analysis prevents multiple implementation attempts
- **Check existing patterns** - The codebase likely has similar code you can follow
- **Document assumptions** - If you're uncertain about something, note it in the plan
- **Be skeptical** - Question your own analysis before finalizing
- **Stay focused** - Don't expand scope beyond what was asked
