---
description: Create an implementation plan using 3 parallel planning agents and aggregation. Use /plan-parallel <INSTRUCTIONS>
allowed-tools: Task
---

# Plan Parallel

Generate a high-quality implementation plan by running 3 parallel planning agents and aggregating their results.

**Input**: `$ARGUMENTS` contains the implementation instructions (arbitrary length string describing what needs to be done).

## Workflow

### Step 1: Generate Implementation Plans (3 Parallel Subagents)

Launch **3 parallel subagents** using the `Task` tool, each running the `/plan-implementation` skill with the provided instructions. This generates diverse perspectives on the implementation approach.

For each of the 3 subagents, use this prompt:

```
Run the /plan-implementation skill with the argument: INSTRUCTIONS

After completion, report ONLY the path to the saved plan file.
```

Replace `INSTRUCTIONS` with the exact content from `$ARGUMENTS`:

**$ARGUMENTS = `$ARGUMENTS`**

**Wait for all 3 subagents to complete.** Collect the 3 plan file paths they return (e.g., `.claude/tasks/IMPL_PLAN-abc123-feature_name.md`).

### Step 2: Aggregate Plans

Launch a subagent using the `Task` tool to aggregate the 3 plans into one comprehensive plan:

```
Run the /plan-aggregate skill with the arguments: PLAN1_PATH PLAN2_PATH PLAN3_PATH

Where:
- PLAN1_PATH = [path from subagent 1]
- PLAN2_PATH = [path from subagent 2]
- PLAN3_PATH = [path from subagent 3]

After completion, report ONLY the path to the aggregated plan file.
```

**Wait for the subagent to complete.**

### Step 3: Return Result

Return **ONLY** the path to the aggregated plan file. No other output.

Example output:
```
.claude/tasks/IMPL_PLAN_AGGREGATED-xyz789-merged_plan.md
```

## Example Usage

User: `/plan-parallel Add a new settings page that allows users to configure notification preferences`

**Execution**:

1. Run 3 parallel subagents (all at the same time):
   ```
   Task: "Run /plan-implementation Add a new settings page that allows users to configure notification preferences"
   Task: "Run /plan-implementation Add a new settings page that allows users to configure notification preferences"
   Task: "Run /plan-implementation Add a new settings page that allows users to configure notification preferences"
   ```
   Results:
   - Plan 1: `.claude/tasks/IMPL_PLAN-abc123-settings_page.md`
   - Plan 2: `.claude/tasks/IMPL_PLAN-def456-notification_settings.md`
   - Plan 3: `.claude/tasks/IMPL_PLAN-ghi789-user_prefs.md`

2. Aggregate plans:
   ```
   Task: "Run /plan-aggregate .claude/tasks/IMPL_PLAN-abc123-settings_page.md .claude/tasks/IMPL_PLAN-def456-notification_settings.md .claude/tasks/IMPL_PLAN-ghi789-user_prefs.md"
   ```
   Result: `.claude/tasks/IMPL_PLAN_AGGREGATED-xyz789-merged_plan.md`

3. Return:
   ```
   .claude/tasks/IMPL_PLAN_AGGREGATED-xyz789-merged_plan.md
   ```

## Important Notes

- **3 parallel plans** - Running multiple subagents increases solution quality through diverse analysis
- **Output only the path** - Do not include any other commentary or explanation
- **Never add .claude files to git** - The `.claude` folder is gitignored
