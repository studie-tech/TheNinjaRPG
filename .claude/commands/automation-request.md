---
description: Automate a complex request using parallel investigation subagents, plan aggregation, and implementation. Use /automate-request <INSTRUCTIONS>
allowed-tools: Task, Skill
---

# Automate Request

Automate a complex feature request or bug fix by leveraging parallel investigation subagents, plan aggregation, and iterative implementation.

**Input**: `$ARGUMENTS`

The input should be arbitrary instructions describing:
- A feature to implement
- A bug to fix
- An improvement to make
- Any complex coding task

## Purpose

This skill orchestrates a multi-agent workflow to handle complex requests:

1. **Parallel Investigation** - Launch 3 independent subagents to investigate and create implementation plans
2. **Plan Aggregation** - Synthesize the best elements from all plans into one comprehensive plan
3. **Implementation** - Implement the aggregated plan with iterative review cycles

This approach ensures:
- Multiple perspectives on the problem
- Thorough exploration of the codebase
- Best solutions are identified through comparison
- High-quality implementation through iterative reviews

## Process

**IMPORTANT**: Create a todo list at the start to track progress through these steps.

### Step 1: Parse and Validate Input

**$ARGUMENTS = `$ARGUMENTS`**

1. Parse the input instructions
2. Generate a unique task identifier based on the request (e.g., `feature-auth-system`, `bugfix-user-sync`, `improvement-perf-cache`)
3. Ensure `.claude/tasks/` directory exists

### Step 2: Launch Parallel Investigation Subagents

Launch **3 subagents in parallel** using the `Task` tool. Each subagent should independently:

- Investigate the request
- Explore the codebase
- Create an implementation plan
- Save the plan to `.claude/tasks/`

**Subagent 1** - Launch with Task tool:
```
You are Investigation Agent 1. Your task is to independently analyze a request and create an implementation plan.

**Request**: <INSERT_FULL_INSTRUCTIONS_HERE>

**Your Process**:
1. Thoroughly investigate the codebase to understand:
   - Existing patterns and conventions
   - Related code and dependencies
   - Potential areas affected by the change

2. Analyze the request to determine:
   - Root cause (if bug fix) or requirements (if feature)
   - Technical approach and solution strategy
   - Files that need to be created or modified
   - Edge cases and potential risks

3. Create a detailed implementation plan with:
   - Summary of findings
   - Root cause analysis / requirements analysis
   - Proposed solution with rationale
   - List of files to modify with specific changes
   - Step-by-step implementation instructions
   - Testing strategy
   - Risk assessment

4. Save your implementation plan to: `.claude/tasks/<TASK_ID>_PLAN-A-<random-6-letters>.md`

**Important**:
- Work independently - your unique perspective is valuable
- Be thorough in your investigation
- Document your reasoning clearly
- Include specific code changes where helpful
```

**Subagent 2** - Launch with Task tool:
```
You are Investigation Agent 2. Your task is to independently analyze a request and create an implementation plan.

**Request**: <INSERT_FULL_INSTRUCTIONS_HERE>

**Your Process**:
1. Thoroughly investigate the codebase to understand:
   - Existing patterns and conventions
   - Related code and dependencies
   - Potential areas affected by the change

2. Analyze the request to determine:
   - Root cause (if bug fix) or requirements (if feature)
   - Technical approach and solution strategy
   - Files that need to be created or modified
   - Edge cases and potential risks

3. Create a detailed implementation plan with:
   - Summary of findings
   - Root cause analysis / requirements analysis
   - Proposed solution with rationale
   - List of files to modify with specific changes
   - Step-by-step implementation instructions
   - Testing strategy
   - Risk assessment

4. Save your implementation plan to: `.claude/tasks/<TASK_ID>_PLAN-B-<random-6-letters>.md`

**Important**:
- Work independently - your unique perspective is valuable
- Be thorough in your investigation
- Document your reasoning clearly
- Include specific code changes where helpful
```

**Subagent 3** - Launch with Task tool:
```
You are Investigation Agent 3. Your task is to independently analyze a request and create an implementation plan.

**Request**: <INSERT_FULL_INSTRUCTIONS_HERE>

**Your Process**:
1. Thoroughly investigate the codebase to understand:
   - Existing patterns and conventions
   - Related code and dependencies
   - Potential areas affected by the change

2. Analyze the request to determine:
   - Root cause (if bug fix) or requirements (if feature)
   - Technical approach and solution strategy
   - Files that need to be created or modified
   - Edge cases and potential risks

3. Create a detailed implementation plan with:
   - Summary of findings
   - Root cause analysis / requirements analysis
   - Proposed solution with rationale
   - List of files to modify with specific changes
   - Step-by-step implementation instructions
   - Testing strategy
   - Risk assessment

4. Save your implementation plan to: `.claude/tasks/<TASK_ID>_PLAN-C-<random-6-letters>.md`

**Important**:
- Work independently - your unique perspective is valuable
- Be thorough in your investigation
- Document your reasoning clearly
- Include specific code changes where helpful
```

**After launching all 3 subagents**: Wait for all to complete before proceeding.

### Step 3: Collect Plan Paths

After all investigation subagents complete:
1. List the files in `.claude/tasks/` directory
2. Identify the 3 plan files created (matching the `<TASK_ID>_PLAN-*` pattern)
3. Collect the full paths to all plans

### Step 4: Aggregate Plans

Invoke the `/plan-aggregate` command via the Skill tool:

```
Skill(skill="plan-aggregate", args="<PLAN_PATH_1> <PLAN_PATH_2> <PLAN_PATH_3>")
```

Replace the paths with the actual paths to the plan files created in Step 2.

Wait for the aggregation to complete and note the path to the aggregated plan.

### Step 5: Implement the Aggregated Plan

Invoke the `/implement` command via the Skill tool:

```
Skill(skill="implement", args="<AGGREGATED_PLAN_PATH>")
```

Replace the path with the actual path to the aggregated plan file.

This will:
1. Parse the implementation plan
2. Implement the changes iteratively
3. Run code reviews after each implementation step
4. Iterate until implementation is complete with no issues

Wait for the implementation to complete.

### Step 6: Final Report

After all steps are complete, generate a comprehensive report:

```markdown
# Automation Request Complete

## Original Request
<Brief summary of the original instructions>

## Investigation Phase
- **Plans Created**: 3
- **Plan A**: `<path>` - <brief summary of approach>
- **Plan B**: `<path>` - <brief summary of approach>
- **Plan C**: `<path>` - <brief summary of approach>

## Aggregation Phase
- **Aggregated Plan**: `<path>`
- **Best Elements Selected From**:
  - Plan A: <what was used>
  - Plan B: <what was used>
  - Plan C: <what was used>

## Implementation Phase
- **Status**: Complete / Partial / Failed
- **Changes Made**:
  - <list of key changes>
- **Files Modified**:
  - <list of files>

## Summary
<Overall summary of what was accomplished>

## Artifacts
- Investigation Plans: `.claude/tasks/<TASK_ID>_PLAN-*.md`
- Aggregated Plan: `.claude/tasks/<TASK_ID>_AGGREGATED-*.md`

## Next Steps (if any)
<Any remaining work or recommendations>
```

## Important Notes

- **Parallel execution is key** - The 3 investigation subagents MUST be launched in parallel for efficiency
- **Independence matters** - Each investigation agent should work independently without knowledge of others
- **Wait for completion** - Always wait for subagents to finish before proceeding to the next step
- **Track artifacts** - Keep track of all created plan files for the final report
- **Handle failures gracefully** - If a subagent fails, report the failure and continue with available plans (minimum 1 plan required for aggregation)

## Error Handling

- If fewer than 3 plans are created, proceed with plan aggregation using available plans
- If plan aggregation fails, report the error with details from individual plans
- If implementation fails, report what was accomplished and what remains
- Always provide a comprehensive final report regardless of partial failures
