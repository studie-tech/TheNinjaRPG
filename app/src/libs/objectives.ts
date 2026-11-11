import type { ElementDefinition } from "cytoscape";
import { TERMINAL_DIALOG_PREFIX } from "@/drizzle/constants";
import type { Quest } from "@/drizzle/schema";
import { masteryRewardLabels } from "@/libs/masteryRewards";
import { collapseRewards } from "@/libs/rewards";
import { capitalizeFirstLetter } from "@/utils/string";
import {
  type AllObjectivesType,
  type ObjectiveTrackerType,
  objectiveImageMap,
  type QuestTrackerType,
} from "@/validators/objectives";
import {
  QuestReward,
  type QuestRewardType,
  rewardPayloads,
} from "@/validators/rewardPackages";
import { ObjectiveReward } from "@/validators/rewards";

/**
 * Content id a dialog choice reports. A terminal branch has no follow-up objective, so it
 * sends an objective-scoped sentinel for the server to complete the dialog instead of
 * re-opening it.
 */
export const dialogChoiceContentId = (
  nextObjectiveId: string | undefined,
  objectiveId: string,
) => nextObjectiveId ?? `${TERMINAL_DIALOG_PREFIX}${objectiveId}`;

export const getObjectiveImage = (objective: AllObjectivesType) => {
  return objectiveImageMap[objective.task] ?? { image: "", title: "???" };
};

/**
 * Checks if an objective is complete based on the provided tracker and objective.
 * @param tracker - The quest tracker object.
 * @param objective - The objective to check.
 * @returns An object containing the value, done status, and canCollect status of the objective.
 */
export const isObjectiveComplete = (
  tracker: QuestTrackerType,
  objective: AllObjectivesType,
) => {
  const status = tracker.goals.find((g) => g.id === objective.id);
  const value = status?.value || 0;
  const done = status?.done || ("value" in objective && value >= objective.value);
  const canCollect = !status?.collected && done;
  return { value, done, canCollect, status };
};

/**
 * Whether a lost start_battle objective can be fought again. A loss that completed the
 * objective (a `completionOutcome` of "Lose"/"Any", or routing to a `failObjectiveId`
 * branch) has already moved the quest on, so there is nothing left to retry.
 */
export const canRetryQuestBattle = (
  goal: Pick<ObjectiveTrackerType, "recentlyDied" | "done"> | undefined,
) => !!goal?.recentlyDied && !goal.done;

/**
 * Outgoing links of an objective, in display order: next (a string, or one per dialog branch),
 * then fail, then reset. Unset and empty ids are left out.
 */
export const objectiveLinks = (objective: AllObjectivesType): ObjectiveLink[] => {
  const { nextObjectiveId, failObjectiveId, resetObjectiveId } = objective as {
    nextObjectiveId?: unknown;
    failObjectiveId?: unknown;
    resetObjectiveId?: unknown;
  };
  const nextIds: unknown[] = Array.isArray(nextObjectiveId)
    ? nextObjectiveId.map((branch) => branch?.nextObjectiveId)
    : [nextObjectiveId];
  return [
    ...nextIds.map((target) => ({ target, kind: "next" as const })),
    { target: failObjectiveId, kind: "fail" as const },
    { target: resetObjectiveId, kind: "reset" as const },
  ].filter(
    (link): link is ObjectiveLink => !!link.target && typeof link.target === "string",
  );
};

type ObjectiveLink = { target: string; kind: "next" | "fail" | "reset" };

/** Whether completing or failing `objective` can lead to `targetId`; a reset is not progress. */
const leadsTo = (objective: AllObjectivesType, targetId: string) =>
  objectiveLinks(objective).some(
    (link) => link.kind !== "reset" && link.target === targetId,
  );

/**
 * Finds the predecessor objective for a given target objective id.
 * @param objectives - The list of all objectives.
 * @param targetId - The id of the objective whose predecessor to find.
 * @returns The predecessor objective, or undefined if none exists.
 */
export const findPredecessor = (
  objectives: AllObjectivesType[],
  targetId: string,
): AllObjectivesType | undefined => objectives.find((obj) => leadsTo(obj, targetId));

/** Order prerequisites before successors, choosing ready objectives in authored order. */
export const orderObjectivesByPrerequisites = (objectives: AllObjectivesType[]) => {
  const remaining = [...objectives];
  const ordered: AllObjectivesType[] = [];
  while (remaining.length > 0) {
    const index = remaining.findIndex(
      (objective) => !findPredecessor(remaining, objective.id),
    );
    // Invalid cyclic content still passes through the runtime availability guards.
    if (index === -1) return [...ordered, ...remaining];
    ordered.push(...remaining.splice(index, 1));
  }
  return ordered;
};

/**
 * Finds the predecessor objective for a given target objective id, and checks if it is completed.
 * @param objectives - The list of all objectives.
 * @param targetId - The id of the objective whose predecessor to find.
 * @param tracker - The quest tracker object.
 * @returns The predecessor objective, or undefined if none exists.
 */
export const findCompletedPredecessor = (
  objectives: AllObjectivesType[],
  targetId: string,
  tracker: QuestTrackerType,
): AllObjectivesType | undefined => {
  return objectives.find((obj) => {
    // An objective cannot be its own predecessor
    if (obj.id === targetId) return false;

    if (!leadsTo(obj, targetId)) return false;

    // Check if predecessor is complete
    const status = tracker.goals.find((goal) => goal.id === obj.id);
    return status?.done;
  });
};

/**
 * Checks if a quest is complete.
 * @param quest - The quest object.
 * @param tracker - The quest tracker object.
 * @returns A boolean indicating whether the quest is complete.
 */
export const isQuestComplete = (
  quest: Pick<Quest, "content" | "consecutiveObjectives">,
  tracker: QuestTrackerType,
) => {
  const objectives = quest.content.objectives;
  if (!quest.consecutiveObjectives) {
    // All objectives must be complete
    return objectives.every(
      (objective) => isObjectiveComplete(tracker, objective).done,
    );
  }

  const { ids, cyclic } = selectedObjectivePath(objectives, tracker);
  if (ids.length === 0 || cyclic) return false;
  return ids.every((id) => {
    const objective = objectives.find((obj) => obj.id === id);
    return !!objective && !!isObjectiveComplete(tracker, objective).done;
  });
};

/**
 * Objective ids along the branch the tracker selected, from the starting objective (the one
 * without a predecessor), stopping at the first unfinished objective. A saved next link
 * selects a branch but does not satisfy the objective that owns it. `cyclic` reports a
 * selection that loops back on itself.
 */
const selectedObjectivePath = (
  objectives: AllObjectivesType[],
  tracker: QuestTrackerType,
) => {
  const visited = new Set<string>();
  let currentId = objectives.find((obj) => !findPredecessor(objectives, obj.id))?.id;
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const id = currentId;
    const goal = tracker.goals.find((goal) => goal.id === id);
    currentId = goal?.done ? goal.selectedNextObjectiveId : undefined;
  }
  return { ids: [...visited], cyclic: !!currentId };
};

/**
 * Checks if a quest objective is available.
 * @param quest - The quest object.
 * @param tracker - The quest tracker object.
 * @param objectiveIdx - The index of the objective to check.
 * @returns A boolean indicating whether the objective is available.
 */
export const isQuestObjectiveAvailable = (
  quest: Quest,
  tracker: QuestTrackerType,
  objectiveIdx: number,
) => {
  // If not using consecutive objectives, all are available
  if (!quest.consecutiveObjectives) return true;

  const objectives = quest.content.objectives;
  const currentObjective = objectives[objectiveIdx];
  if (!currentObjective) return false;

  return selectedObjectivePath(objectives, tracker).ids.includes(currentObjective.id);
};

/**
 * Returns the active objective for a quest.
 * @param quest - The quest object.
 * @param tracker - The quest tracker object.
 * @returns The active objective.
 */
export const getActiveObjective = (quest: Quest, tracker: QuestTrackerType) => {
  if (!quest.consecutiveObjectives) return null;
  const objectives = quest.content.objectives;
  const { ids } = selectedObjectivePath(objectives, tracker);
  return objectives.find((o) => {
    const trackerObjective = tracker.goals.find((g) => g.id === o.id);
    return ids.includes(o.id) && !trackerObjective?.done;
  });
};

/**
 * Builds Cytoscape edge definitions for a list of quest objectives.
 *
 * If `consecutiveObjectives` is false, an empty array is returned. Otherwise the function
 * will look at the `nextObjectiveId` field of every objective and create an edge for each
 * valid connection (i.e. where the referenced objective exists in the provided array).
 *
 * Special handling is applied for the `dialog` objective type where `nextObjectiveId` is an
 * array of objects of shape `{ text: string; nextObjectiveId?: string }`. Each entry that
 * contains a `nextObjectiveId` will generate its own edge.
 *
 * @param objectives       All objectives in the quest.
 * @param consecutive      Whether the quest enforces consecutive objectives.
 * @returns                Array of Cytoscape `ElementDefinition` objects representing edges.
 */
export const buildObjectiveEdges = (
  objectives: AllObjectivesType[],
  consecutive: boolean,
): ElementDefinition[] => {
  if (!consecutive) return [];

  const validIds = new Set(objectives.map((o) => o.id));
  const edges: ElementDefinition[] = [];
  const seen = new Set<string>(); // Ensure unique edge ids

  for (const obj of objectives) {
    for (const { target, kind } of objectiveLinks(obj)) {
      const edgeId = `${obj.id}${EDGE_ID_SEPARATOR[kind]}${target}`;
      if (!validIds.has(target) || seen.has(edgeId)) continue;
      seen.add(edgeId);
      const data = { id: edgeId, source: obj.id, target };
      edges.push(
        kind === "next"
          ? { data: { ...data, label: "" } }
          : { data, classes: `${kind}-edge` },
      );
    }
  }

  return edges;
};

const EDGE_ID_SEPARATOR: Record<ObjectiveLink["kind"], string> = {
  next: "__to__",
  fail: "__fail_to__",
  reset: "__reset_to__",
};

/**
 * Summarize direct and packaged rewards in the same composition used for payout.
 * @param reward - Quest or objective rewards, including editable snapshots.
 * @returns Display entries for the combined reward payload, or an empty list.
 */
export const getRewardArray = (reward?: QuestRewardType) => {
  const rewards: string[] = [];
  if (!reward) return rewards;
  if (reward.reward_level) rewards.push(`level ${reward.reward_level}`);
  if (reward.reward_stats)
    rewards.push(`+${reward.reward_stats} to each combat stat (up to rank caps)`);
  const questReward = collapseRewards(
    rewardPayloads(reward, ObjectiveReward.parse(reward)),
  );
  if (questReward.reward_items.length > 0) {
    rewards.push(`${questReward.reward_items.length} items`);
  }
  if (questReward.reward_jutsus.length > 0) {
    rewards.push(`${questReward.reward_jutsus.length} jutsus`);
  }
  if (questReward.reward_titles.length > 0)
    rewards.push(`${questReward.reward_titles.length} titles`);
  if (questReward.reward_badges.length > 0) {
    rewards.push(`${questReward.reward_badges.length} badges`);
  }
  if (questReward.reward_rank && questReward.reward_rank !== "NONE") {
    rewards.push(`rank of ${questReward.reward_rank.toLowerCase()}`);
  }
  if (questReward.reward_village_membership !== "NONE") {
    rewards.push(
      `village membership of ${capitalizeFirstLetter(questReward.reward_village_membership)}`,
    );
  }
  if (questReward.reward_bloodlines.length > 0) {
    rewards.push(`${questReward.reward_bloodlines.length} bloodlines`);
  }
  if (questReward.reward_sage_modes.length > 0) {
    rewards.push(`${questReward.reward_sage_modes.length} sage modes`);
  }
  if (questReward.reward_money) {
    rewards.push(`${questReward.reward_money} ryo`);
  }
  if (questReward.reward_seichi_silver) {
    rewards.push(`${questReward.reward_seichi_silver} seichi silver`);
  }
  if (questReward.reward_clanpoints) {
    rewards.push(`${questReward.reward_clanpoints} clan points`);
  }
  if (questReward.reward_anbupoints) {
    rewards.push(`${questReward.reward_anbupoints} anbu points`);
  }
  if (questReward.reward_exp) {
    rewards.push(`${questReward.reward_exp} exp`);
  }
  if (questReward.reward_pet_experience) {
    rewards.push(`${questReward.reward_pet_experience} pet experience`);
  }
  if (questReward.reward_tokens) {
    rewards.push(`${questReward.reward_tokens} village tokens`);
  }
  if (questReward.reward_prestige) {
    rewards.push(`${questReward.reward_prestige} prestige`);
  }
  if (questReward.reward_reputation) {
    rewards.push(`${questReward.reward_reputation} reputation points`);
  }
  if (questReward.reward_skillpoints) {
    rewards.push(`${questReward.reward_skillpoints} skill points`);
  }
  if (questReward.reward_medical_experience) {
    rewards.push(`${questReward.reward_medical_experience} medical experience`);
  }
  if (questReward.reward_hunting_experience) {
    rewards.push(`${questReward.reward_hunting_experience} hunting experience`);
  }
  if (questReward.reward_crafting_experience) {
    rewards.push(`${questReward.reward_crafting_experience} crafting experience`);
  }
  if (questReward.reward_gathering_experience) {
    rewards.push(`${questReward.reward_gathering_experience} gathering experience`);
  }
  rewards.push(...masteryRewardLabels(questReward));
  if (questReward.reward_sage_mastery_experience) {
    rewards.push(`${questReward.reward_sage_mastery_experience} sage mode experience`);
  }
  if (questReward.reward_hunter_items) {
    if (questReward.reward_hunter_items_ids.length > 0) {
      rewards.push(`drop specific hunter materials`);
    } else {
      rewards.push(`drop any hunter materials`);
    }
  }
  if (questReward.reward_gathering_items) {
    if (questReward.reward_gathering_items_ids.length > 0) {
      rewards.push(`drop specific gathering materials`);
    } else {
      rewards.push(`drop any gathering materials`);
    }
  }
  if (questReward.reward_war_damage) {
    rewards.push(`${questReward.reward_war_damage} war damage to enemy`);
  }
  if (questReward.reward_war_healing) {
    rewards.push(`${questReward.reward_war_healing} war health restored`);
  }
  return rewards;
};

/**
 * The reward row shown on a quest card: the completion reward when it grants anything,
 * otherwise the rewards earned along its objectives, or undefined when neither grants any.
 */
export const getQuestRewardSummary = (content: {
  reward?: QuestRewardType;
  objectives?: AllObjectivesType[];
}): { label: string; rewards: string[] } | undefined => {
  const rewards = getRewardArray(content.reward);
  if (rewards.length > 0) return { label: "Reward", rewards };
  const objectiveRewards = (content.objectives ?? []).flatMap((objective) =>
    getRewardArray(objective),
  );
  if (objectiveRewards.length > 0) {
    return { label: "Objective rewards", rewards: objectiveRewards };
  }
  return undefined;
};

/**
 * Preview direct and packaged rewards while keeping invalid editor drafts recoverable.
 * @returns A comma-separated summary, an invalid-draft message, or null for empty rewards.
 */
export const getRewardPreview = (reward?: QuestRewardType | null): string | null => {
  if (!reward) return null;
  const parsed = QuestReward.safeParse(reward);
  if (!parsed.success) return "Correct the invalid reward values before saving";
  const rewardsList = getRewardArray(parsed.data);
  return rewardsList.length > 0 ? rewardsList.join(", ") : null;
};
