---
name: implement
description: Implement features from a plan using self-evaluation iteration. Use /implement <IMPLEMENTATION_PLAN>
allowed-tools: Task
---

# Implement

Implement features based on an implementation plan. Iterates using self-evaluation until the implementation is complete.

**Input**: $ARGUMENTS

The input should be a reference to an implementation plan:

- A file path to a task file (e.g., `.claude/tasks/feature-name.md`)
- A URL to a GitHub issue or document
- A structured implementation plan

## Process

Create a todo list and follow these steps:

### Step 1: Implementation with Self-Evaluation Loop

Launch a sub-agent using the `Task` tool with the following instructions:

```
You are an implementation agent. Your task is to implement features and iterate until the implementation is complete.

**Implementation Plan**: <PATH_TO_PLAN_OR_PLAN_CONTENT>

**Process**:
1. Read and understand the implementation plan
2. Implement the changes according to the plan:
   - Create new files as needed
   - Modify existing files following project patterns
   - Follow existing code conventions and styles
   - Handle error cases appropriately
3. After implementing, perform a self-evaluation:
   - Did I fully implement all requirements from the plan?
   - Are there any missing pieces or incomplete features?
   - Does the implementation match the plan's intent?
4. Decision:
   - If implementation is incomplete: Continue implementing the missing parts, then re-evaluate
   - If implementation is complete: Report success and finish

**Self-Evaluation Criteria**:
- All features from the plan are implemented
- All files mentioned in the plan are created/modified
- The implementation follows existing patterns in the codebase
- No obvious errors or omissions in the code

**Important**:
- Each iteration builds on the previous one - don't start from scratch
- Focus on completing the specific requirements in the plan
- Be persistent - some implementations may take multiple iterations to fully complete
- Track what has been implemented to ensure completeness
- Do NOT run code review or browser tests - these will be run separately after implementation

**Iteration Workflow**:
1. Implement → 2. Self-evaluate → 3. If incomplete, continue implementing → (repeat)
```

Wait for the sub-agent to complete.

### Step 2: Completion

Once the implementation sub-agent reports success:

1. Summarize what was implemented
2. List any important notes or considerations
3. Report that the implementation is complete

**Note**: Code review and browser testing should be run separately using `/implement-review-loop` after this command completes.

## Important Notes

- The self-evaluation loop ensures complete implementations before moving to review
- Sub-agents run with clean context to avoid context pollution
- This command focuses ONLY on implementation - no code review or browser tests are run
- After implementation, run `/implement-review-loop` in the main thread for quality checks
