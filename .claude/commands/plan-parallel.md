---
description: Create an implementation plan using 6 parallel planning agents (3 Claude + 3 Codex) and aggregation. Use /plan-parallel <INSTRUCTIONS>
allowed-tools: Task, Bash(codex *:*)
---

# Plan Parallel

Generate a high-quality implementation plan by running 6 parallel planning agents (3 Claude Task subagents + 3 Codex CLI planners) and aggregating their results.

**Input**: `$ARGUMENTS` contains the implementation instructions (arbitrary length string describing what needs to be done).

## Workflow

### Step 1: Generate Implementation Plans (6 Parallel Planners)

Launch **6 parallel planners** to generate diverse perspectives on the implementation approach:

- **3 Claude Task subagents** using the `Task` tool
- **3 Codex CLI planners** using the `Shell` tool

#### 1a: Claude Task Subagents (3 parallel)

For each of the 3 subagents, use this prompt with the `Task` tool:

```
Run the /plan-implementation skill with the argument: INSTRUCTIONS

After completion, report ONLY the path to the saved plan file.
```

#### 1b: Codex CLI Planners (3 parallel)

For each of the 3 Codex planners, run this command in the `Shell` tool with `block_until_ms: 0` to background immediately:

```bash
codex exec --dangerously-bypass-approvals-and-sandbox "Run the /plan-implementation command found in .claude/commands folder with argument: INSTRUCTIONS. After completion, report the path to the saved plan file."
```

**Important**: Run each codex command in a separate Shell call so they run in parallel. After launching, monitor the terminal files to wait for completion and extract the plan file paths from the output.

Replace `INSTRUCTIONS` with the exact content from `$ARGUMENTS` in all commands:

**$ARGUMENTS = `$ARGUMENTS`**

**Wait for all 6 planners to complete.** Collect the 6 plan file paths they return (e.g., `.claude/tasks/20250131-143052_IMPL_PLAN-feature_name-abc123.md`).

### Step 2: Aggregate Plans

Launch a subagent using the `Task` tool to aggregate all 6 plans into one comprehensive plan:

```
Run the /plan-aggregate skill with the arguments: PLAN1_PATH PLAN2_PATH PLAN3_PATH PLAN4_PATH PLAN5_PATH PLAN6_PATH

Where:
- PLAN1_PATH = [path from Claude subagent 1]
- PLAN2_PATH = [path from Claude subagent 2]
- PLAN3_PATH = [path from Claude subagent 3]
- PLAN4_PATH = [path from Codex planner 1]
- PLAN5_PATH = [path from Codex planner 2]
- PLAN6_PATH = [path from Codex planner 3]

After completion, report ONLY the path to the aggregated plan file.
```

**Wait for the subagent to complete.**

### Step 3: Return Result

Return **ONLY** the path to the aggregated plan file. No other output.

Example output:

```
.claude/tasks/20250131-143100_IMPL_PLAN_AGGREGATED-xyz789-merged_plan.md
```

## Example Usage

User: `/plan-parallel Add a new settings page that allows users to configure notification preferences`

**Execution**:

1. Run 6 parallel planners (all at the same time):

   **Claude Task subagents:**

   ```
   Task: "Run /plan-implementation Add a new settings page that allows users to configure notification preferences"
   Task: "Run /plan-implementation Add a new settings page that allows users to configure notification preferences"
   Task: "Run /plan-implementation Add a new settings page that allows users to configure notification preferences"
   ```

   **Codex CLI planners (in Shell with block_until_ms: 0):**

   ```bash
   codex exec --dangerously-bypass-approvals-and-sandbox "Run the /plan-implementation command found in .claude/commands folder with argument: Add a new settings page that allows users to configure notification preferences. After completion, report the path to the saved plan file."
   ```

   (Run 3 times in parallel Shell calls)

   Results (after monitoring terminal output for completion):

   - Claude Plan 1: `.claude/tasks/20250131-143052_IMPL_PLAN-settings_page-abc123.md`
   - Claude Plan 2: `.claude/tasks/20250131-143053_IMPL_PLAN-notification_settings-def456.md`
   - Claude Plan 3: `.claude/tasks/20250131-143054_IMPL_PLAN-user_prefs-ghi789.md`
   - Codex Plan 1: `.claude/tasks/20250131-143055_IMPL_PLAN-settings_ui-jkl012.md`
   - Codex Plan 2: `.claude/tasks/20250131-143056_IMPL_PLAN-prefs_api-mno345.md`
   - Codex Plan 3: `.claude/tasks/20250131-143057_IMPL_PLAN-notif_schema-pqr678.md`

2. Aggregate all 6 plans:

   ```
   Task: "Run /plan-aggregate .claude/tasks/20250131-143052_IMPL_PLAN-settings_page-abc123.md .claude/tasks/20250131-143053_IMPL_PLAN-notification_settings-def456.md .claude/tasks/20250131-143054_IMPL_PLAN-user_prefs-ghi789.md .claude/tasks/20250131-143055_IMPL_PLAN-settings_ui-jkl012.md .claude/tasks/20250131-143056_IMPL_PLAN-prefs_api-mno345.md .claude/tasks/20250131-143057_IMPL_PLAN-notif_schema-pqr678.md"
   ```

   Result: `.claude/tasks/20250131-143100_IMPL_PLAN_AGGREGATED-xyz789-merged_plan.md`

3. Return:
   ```
   .claude/tasks/20250131-143100_IMPL_PLAN_AGGREGATED-xyz789-merged_plan.md
   ```

## Important Notes

- **6 parallel plans** - Running 6 planners (3 Claude, 3 Codex) maximizes solution quality through diverse analysis from different AI models
- **Monitor CLI planners** - The Codex CLI commands run in the background; monitor their terminal output files to detect completion and extract the plan file paths
- **Output only the path** - Do not include any other commentary or explanation
- **Never add .claude files to git** - The `.claude` folder is gitignored
