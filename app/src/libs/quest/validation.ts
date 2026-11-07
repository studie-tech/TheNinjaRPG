import { objectiveLinks } from "@/libs/objectives";
import { isSupportedOverworldBindingTask } from "@/libs/overworldAi";
import type { AllObjectivesType } from "@/validators/objectives";

/**
 * Validation a quest's objective content must pass before it is persisted (used by both
 * the `update` and `clone` quest mutations). Dialog branches are always validated; the full
 * chain/reachability flow is validated only for consecutive quests, since a
 * non-consecutive quest legitimately has multiple independent objectives that
 * {@link verifyQuestObjectiveFlow} would otherwise reject.
 *
 * Guardrail for overworld-bound objectives: a placement-bound objective completes the moment the
 * player stands on its NPC, so a non-consecutive quest binding two objectives to different NPCs can
 * be completed out of narrative order (the runtime overworld gate blocks the interaction, but the
 * intended ordering still can't be expressed). Ordering intent lives in the `nextObjectiveId` chain,
 * which only consecutive quests carry, so reject the save and let the author make the quest
 * consecutive rather than silently coercing the flag onto a chainless quest (which
 * {@link verifyQuestObjectiveFlow} would then reject anyway).
 */
export const verifyQuestContentForSave = (
  objectives: AllObjectivesType[],
  consecutiveObjectives: boolean,
): { check: boolean; message: string } => {
  const unsupportedBinding = objectives.find(
    (objective) =>
      !!objective.overworldPlacementId &&
      !isSupportedOverworldBindingTask(objective.task),
  );
  if (unsupportedBinding) {
    return {
      check: false,
      message: `Objective task ${unsupportedBinding.task} cannot bind to an overworld placement. Only defeat_opponents, deliver_item, and dialog are supported.`,
    };
  }
  // Consecutive quests run the full flow check, whose first step is the same dialog-branch scan —
  // so only the non-consecutive branch needs the standalone dialog check here (avoids scanning twice).
  if (consecutiveObjectives) return verifyQuestObjectiveFlow(objectives);
  const dialogCheck = verifyDialogBranches(objectives);
  if (!dialogCheck.check) return dialogCheck;
  const boundObjectiveCount = objectives.filter((o) => !!o.overworldPlacementId).length;
  if (boundObjectiveCount >= 2) {
    return {
      check: false,
      message:
        "A quest with more than one overworld NPC-bound objective must use consecutive objectives so they complete in a defined order.",
    };
  }
  return { check: true, message: "" };
};

/**
 * Verifies that the objective flow is valid according to the following rules:
 * - There can only be one starting objective, i.e. an objective where no other objectives point to it
 * - All objectives must be connected to the starting objective via a chain of nextObjectiveId
 * - All defined nextObjectiveId must be valid, i.e. point to an existing objective
 *
 * @param objectives - The objectives to verify.
 * @returns A boolean indicating whether the objective flow is valid.
 */
export const verifyQuestObjectiveFlow = (
  objectives: AllObjectivesType[],
): { check: boolean; message: string } => {
  const collectNextIds = (obj: AllObjectivesType) =>
    objectiveLinks(obj).flatMap((link) => (link.kind === "reset" ? [] : [link.target]));

  try {
    // ------------------------------------------------------------------
    // 0. Basic presence check
    // ------------------------------------------------------------------
    if (!objectives || objectives.length === 0) {
      throw new Error("No objectives provided");
    }

    // Newly authored dialog branches must each route to a next objective.
    const dialogCheck = verifyDialogBranches(objectives);
    if (!dialogCheck.check) {
      throw new Error(dialogCheck.message);
    }

    // ------------------------------------------------------------------
    // 1. Build quick lookup map & guard against duplicate ids
    // ------------------------------------------------------------------
    const idToObj = new Map<string, AllObjectivesType>();
    for (const obj of objectives) {
      if (idToObj.has(obj.id)) {
        throw new Error(`Duplicate objective id '${obj.id}'`);
      }
      idToObj.set(obj.id, obj);
    }

    // ------------------------------------------------------------------
    // 2. Build adjacency list while validating references & special rules
    // ------------------------------------------------------------------
    const adjacency = new Map<string, string[]>();
    const referencedIds = new Set<string>();

    for (const obj of objectives) {
      const neighbours = collectNextIds(obj);
      if (neighbours.length === 0) {
        adjacency.set(obj.id, adjacency.get(obj.id) ?? []);
      }

      for (const nextId of neighbours) {
        // Self-reference
        if (nextId === obj.id) {
          throw new Error(
            `Objective '${obj.id}' has a self-referencing nextObjectiveId`,
          );
        }
        // Unknown reference
        if (!idToObj.has(nextId)) {
          throw new Error(
            `Objective '${obj.id}' references unknown nextObjectiveId '${nextId}'`,
          );
        }
        referencedIds.add(nextId);
        const list = adjacency.get(obj.id) ?? [];
        list.push(nextId);
        adjacency.set(obj.id, list);
      }
    }

    // ------------------------------------------------------------------
    // 3. Determine unique starting objective (never referenced by others)
    // ------------------------------------------------------------------
    const startingIds = objectives
      .map((o) => o.id)
      .filter((id) => !referencedIds.has(id));

    if (startingIds.length === 0) {
      throw new Error("No starting objective found");
    }
    if (startingIds.length > 1) {
      throw new Error(`Multiple starting objectives found: ${startingIds.join(", ")}`);
    }
    const startId = startingIds[0];
    if (!startId) {
      throw new Error("No starting objective found");
    }

    // ------------------------------------------------------------------
    // 4. DFS to detect cycles & ensure reachability
    // ------------------------------------------------------------------
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (currentId: string): void => {
      if (recursionStack.has(currentId)) {
        throw new Error("Cycle detected in objective chain");
      }
      if (visited.has(currentId)) return;

      visited.add(currentId);
      recursionStack.add(currentId);

      const neighbours = adjacency.get(currentId) ?? [];
      for (const next of neighbours) dfs(next);

      recursionStack.delete(currentId);
    };

    dfs(startId);

    // All objectives must be reachable from the start
    if (visited.size !== objectives.length) {
      const unreachable = objectives.filter((o) => !visited.has(o.id)).map((o) => o.id);
      throw new Error(`Unreachable objectives detected: ${unreachable.join(", ")}`);
    }

    return { check: true, message: "" };
  } catch (err) {
    return { check: false, message: (err as Error).message };
  }
};

/**
 * Validates that every newly authored dialog option routes to an existing objective. Legacy
 * terminal branches still complete through the runtime sentinel, but new content must express
 * its flow explicitly. This rule applies to every quest, independent of `consecutiveObjectives`.
 */
export const verifyDialogBranches = (
  objectives: AllObjectivesType[],
): { check: boolean; message: string } => {
  const objectiveIds = new Set(objectives.map((o) => o.id));
  for (const obj of objectives) {
    if (obj.task !== "dialog") continue;
    const nextRef = (obj as { nextObjectiveId?: unknown }).nextObjectiveId;
    if (!Array.isArray(nextRef) || nextRef.length === 0) {
      return {
        check: false,
        message: `Dialog objective '${obj.id}' must have at least one option`,
      };
    }
    for (const branch of nextRef) {
      const branchNext = (branch as { nextObjectiveId?: unknown })?.nextObjectiveId;
      if (typeof branchNext !== "string" || branchNext.length === 0) {
        return {
          check: false,
          message: `Dialog objective '${obj.id}' has an option with no nextObjectiveId`,
        };
      }
      if (!objectiveIds.has(branchNext)) {
        return {
          check: false,
          message: `Dialog objective '${obj.id}' has an option pointing to unknown objective '${branchNext}'`,
        };
      }
    }
  }
  return { check: true, message: "" };
};
