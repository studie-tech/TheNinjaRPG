import {
  IMG_BADGE_PVPKILLS,
  IMG_BADGE_ARENAKILLS,
  IMG_BADGE_MINUTES_PASSED,
  IMG_BADGE_ERRANDS_TOTAL,
  IMG_BADGE_D_MISSION_TOTAL,
  IMG_BADGE_C_MISSION_TOTAL,
  IMG_BADGE_B_MISSION_TOTAL,
  IMG_BADGE_A_MISSION_TOTAL,
  IMG_BADGE_D_CRIME_TOTAL,
  IMG_BADGE_C_CRIME_TOTAL,
  IMG_BADGE_B_CRIME_TOTAL,
  IMG_BADGE_A_CRIME_TOTAL,
  IMG_BADGE_MINUTES_TRAINING,
  IMG_BADGE_JUTSUS_MASTERED,
  IMG_BADGE_STATS_TRAINED,
  IMG_BADGE_DAYS_IN_VILLAGE,
  IMG_BADGE_REPUTATION_POINTS,
  IMG_BADGE_USER_LEVEL,
  IMG_BADGE_MEDICAL_EXPERIENCE,
  IMG_BADGE_GATHERING_EXPERIENCE,
  IMG_BADGE_HUNTING_EXPERIENCE,
  IMG_BADGE_CRAFTING_EXPERIENCE,
  IMG_BADGE_MOVE_TO_LOCATION,
  IMG_BADGE_COLLECT_ITEM,
  IMG_BADGE_DEFEAT_OPPONENTS,
  IMG_BADGE_RANDOM_ENCOUNTER_WINS,
  IMG_BADGE_DIALOG,
  IMG_BADGE_FAIL_QUEST,
  IMG_BADGE_RESET_QUEST,
  IMG_BADGE_WIN_QUEST,
  IMG_BADGE_NEW_QUEST,
  IMG_BADGE_START_BATTLE,
} from "@/drizzle/constants";
import { ObjectiveReward } from "@/validators/objectives";
import type { Quest } from "@/drizzle/schema";
import type { AllObjectivesType, ObjectiveRewardType } from "@/validators/objectives";
import type { QuestTrackerType } from "@/validators/objectives";
import type { ElementDefinition } from "cytoscape";
import { capitalizeFirstLetter } from "@/utils/sanitize";

export const getObjectiveImage = (objective: AllObjectivesType) => {
  switch (objective.task) {
    case "pvp_kills":
      return { image: IMG_BADGE_PVPKILLS, title: "PVP kills" };
    case "arena_kills":
      return { image: IMG_BADGE_ARENAKILLS, title: "Arena kills" };
    case "minutes_passed":
      return { image: IMG_BADGE_MINUTES_PASSED, title: "Minutes passed" };
    case "errands_total":
      return { image: IMG_BADGE_ERRANDS_TOTAL, title: "Errands" };
    case "d_missions_total":
      return { image: IMG_BADGE_D_MISSION_TOTAL, title: "D-rank Missions" };
    case "c_missions_total":
      return { image: IMG_BADGE_C_MISSION_TOTAL, title: "C-rank Missions" };
    case "b_missions_total":
      return { image: IMG_BADGE_B_MISSION_TOTAL, title: "B-rank Missions" };
    case "a_missions_total":
      return { image: IMG_BADGE_A_MISSION_TOTAL, title: "A-rank Missions" };
    case "d_crimes_total":
      return { image: IMG_BADGE_D_CRIME_TOTAL, title: "D-rank crimes" };
    case "c_crimes_total":
      return { image: IMG_BADGE_C_CRIME_TOTAL, title: "C-rank crimes" };
    case "b_crimes_total":
      return { image: IMG_BADGE_B_CRIME_TOTAL, title: "B-rank crimes" };
    case "a_crimes_total":
      return { image: IMG_BADGE_A_CRIME_TOTAL, title: "A-rank crimes" };
    case "minutes_training":
      return { image: IMG_BADGE_MINUTES_TRAINING, title: "Minutes Training" };
    case "jutsus_mastered":
      return { image: IMG_BADGE_JUTSUS_MASTERED, title: "Jutsus Mastered" };
    case "stats_trained":
      return { image: IMG_BADGE_STATS_TRAINED, title: "Stats Trained" };
    case "days_in_village":
      return { image: IMG_BADGE_DAYS_IN_VILLAGE, title: "Days in Village" };
    case "days_as_kage":
      return { image: IMG_BADGE_DAYS_IN_VILLAGE, title: "Days as Kage" };
    case "reputation_points":
      return { image: IMG_BADGE_REPUTATION_POINTS, title: "Reputation Bought" };
    case "user_level":
      return { image: IMG_BADGE_USER_LEVEL, title: "User Level" };
    case "medical_experience":
      return { image: IMG_BADGE_MEDICAL_EXPERIENCE, title: "Medical Experience" };
    case "medical_experience_gained":
      return {
        image: IMG_BADGE_MEDICAL_EXPERIENCE,
        title: "Medical Experience Gained",
      };
    case "crafting_experience":
      return { image: IMG_BADGE_CRAFTING_EXPERIENCE, title: "Crafting Experience" };
    case "crafting_experience_gained":
      return {
        image: IMG_BADGE_CRAFTING_EXPERIENCE,
        title: "Crafting Experience Gained",
      };
    case "hunting_experience":
      return { image: IMG_BADGE_HUNTING_EXPERIENCE, title: "Hunting Experience" };
    case "hunting_experience_gained":
      return {
        image: IMG_BADGE_HUNTING_EXPERIENCE,
        title: "Hunting Experience Gained",
      };
    case "gathering_experience":
      return { image: IMG_BADGE_GATHERING_EXPERIENCE, title: "Gathering Experience" };
    case "gathering_experience_gained":
      return {
        image: IMG_BADGE_GATHERING_EXPERIENCE,
        title: "Gathering Experience Gained",
      };
    case "move_to_location":
      return { image: IMG_BADGE_MOVE_TO_LOCATION, title: "Travel" };
    case "collect_item":
      return { image: IMG_BADGE_COLLECT_ITEM, title: "Collect Item" };
    case "deliver_item":
      return { image: IMG_BADGE_COLLECT_ITEM, title: "Deliver Item" };
    case "defeat_opponents":
      return { image: IMG_BADGE_DEFEAT_OPPONENTS, title: "Defeat" };
    case "random_encounter_wins":
      return { image: IMG_BADGE_RANDOM_ENCOUNTER_WINS, title: "Encounter Wins" };
    case "spars_won":
      return { image: IMG_BADGE_ARENAKILLS, title: "Spars Won" };
    case "win_encounter_at_location":
      return {
        image: IMG_BADGE_RANDOM_ENCOUNTER_WINS,
        title: "Encounters at Location",
      };
    case "fail_quest":
      return { image: IMG_BADGE_FAIL_QUEST, title: "Fail Quest" };
    case "reset_quest":
      return { image: IMG_BADGE_RESET_QUEST, title: "Reset Quest" };
    case "win_quest":
      return { image: IMG_BADGE_WIN_QUEST, title: "Win Quest" };
    case "new_quest":
      return { image: IMG_BADGE_NEW_QUEST, title: "New Quest" };
    case "start_battle":
      return { image: IMG_BADGE_START_BATTLE, title: "Start Battle" };
    case "dialog":
      return { image: IMG_BADGE_DIALOG, title: "Dialog" };
    default:
      return { image: "", title: "???" };
  }
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
 * Finds the predecessor objective for a given target objective id.
 * @param objectives - The list of all objectives.
 * @param targetId - The id of the objective whose predecessor to find.
 * @returns The predecessor objective, or undefined if none exists.
 */
export const findPredecessor = (
  objectives: AllObjectivesType[],
  targetId: string,
): AllObjectivesType | undefined => {
  return objectives.find((obj) => {
    if ((obj as { failObjectiveId?: string }).failObjectiveId === targetId) {
      return true;
    }
    if (obj.task === "dialog" && Array.isArray(obj.nextObjectiveId)) {
      return obj.nextObjectiveId.some(
        (entry: { nextObjectiveId?: string }) => entry.nextObjectiveId === targetId,
      );
    } else {
      return (obj as { nextObjectiveId?: string }).nextObjectiveId === targetId;
    }
  });
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

    // Check if it is a predecessor
    let isPredecessor = false;
    if (obj.task === "dialog" && Array.isArray(obj.nextObjectiveId)) {
      isPredecessor = obj.nextObjectiveId.some(
        (entry) => entry.nextObjectiveId === targetId,
      );
    } else if ("nextObjectiveId" in obj && typeof obj.nextObjectiveId === "string") {
      isPredecessor = obj.nextObjectiveId === targetId;
    } else if ("failObjectiveId" in obj && typeof obj.failObjectiveId === "string") {
      isPredecessor = obj.failObjectiveId === targetId;
    }
    if (!isPredecessor) return false;

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
export const isQuestComplete = (quest: Quest, tracker: QuestTrackerType) => {
  const objectives = quest.content.objectives;
  if (!quest.consecutiveObjectives) {
    // All objectives must be complete
    return objectives.every(
      (objective) => isObjectiveComplete(tracker, objective).done,
    );
  }

  // Find the starting objective (no predecessor)
  const startingObjective = objectives.find(
    (obj) => !findPredecessor(objectives, obj.id),
  );
  if (!startingObjective) return false;

  // Traverse the selectedNextObjectiveId path in tracker.goals
  let currentId = startingObjective.id;
  const visited = new Set<string>();
  while (true) {
    const currentObjective = objectives.find((obj) => obj.id === currentId);
    if (!currentObjective) return false;
    if (!isObjectiveComplete(tracker, currentObjective).done) return false;
    const goal = tracker.goals.find((g) => g.id === currentId);
    if (!goal?.selectedNextObjectiveId) break;
    if (visited.has(currentId)) return false; // Prevent infinite loops
    visited.add(currentId);
    currentId = goal.selectedNextObjectiveId;
  }
  return true;
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

  // Build a map of id -> objective
  const idToObjective = new Map<string, AllObjectivesType>();
  objectives.forEach((obj) => idToObjective.set(obj.id, obj));

  // Find the starting objective (no predecessor)
  const startingObjective = objectives.find(
    (obj) => !findPredecessor(objectives, obj.id),
  );
  if (!startingObjective) return false;

  // Traverse the selectedNextObjectiveId path in tracker.goals
  let currentId = startingObjective.id;
  const visited = new Set<string>();
  while (true) {
    if (currentId === currentObjective.id) return true;
    if (visited.has(currentId)) return false; // Prevent infinite loops
    visited.add(currentId);
    const goal = tracker.goals.find((g) => g.id === currentId);
    if (!goal?.selectedNextObjectiveId) return false;
    currentId = goal.selectedNextObjectiveId;
  }
};

/**
 * Returns the active objective for a quest.
 * @param quest - The quest object.
 * @param tracker - The quest tracker object.
 * @returns The active objective.
 */
export const getActiveObjective = (quest: Quest, tracker: QuestTrackerType) => {
  if (!quest.consecutiveObjectives) return null;
  return quest.content.objectives.find((o, i) => {
    const isAvailable = isQuestObjectiveAvailable(quest, tracker, i);
    const trackerObjective = tracker.goals.find((g) => g.id === o.id);
    return isAvailable && !trackerObjective?.done;
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

  objectives.forEach((obj) => {
    // Handle dialog objectives where nextObjectiveId is an array of objects
    if (obj.task === "dialog") {
      const nextList = Array.isArray(obj.nextObjectiveId) ? obj.nextObjectiveId : [];
      nextList.forEach((entry) => {
        const targetId = entry.nextObjectiveId;
        if (!targetId || !validIds.has(targetId)) return;
        const edgeId = `${obj.id}__to__${targetId}`;
        if (seen.has(edgeId)) return;
        seen.add(edgeId);
        edges.push({
          data: {
            id: edgeId,
            source: obj.id,
            target: targetId,
            label: "",
          },
        });
      });
    } else {
      // Non-dialog objectives – expect a single string id
      const nextId = (obj as { nextObjectiveId?: string }).nextObjectiveId;
      if (nextId && validIds.has(nextId)) {
        const edgeId = `${obj.id}__to__${nextId}`;
        if (!seen.has(edgeId)) {
          seen.add(edgeId);
          edges.push({
            data: {
              id: edgeId,
              source: obj.id,
              target: nextId,
              label: "",
            },
          });
        }
      }
    }

    // Handle Fail Edges
    if ("failObjectiveId" in obj && obj.failObjectiveId) {
      const failId = obj.failObjectiveId;
      if (failId && validIds.has(failId)) {
        const edgeId = `${obj.id}__fail_to__${failId}`;
        if (!seen.has(edgeId)) {
          seen.add(edgeId);
          edges.push({
            data: {
              id: edgeId,
              source: obj.id,
              target: failId,
            },
            classes: "fail-edge",
          });
        }
      }
    }

    // Handle Reset Edges
    if ("resetObjectiveId" in obj && obj.resetObjectiveId) {
      const resetId = obj.resetObjectiveId;
      if (resetId && validIds.has(resetId)) {
        const edgeId = `${obj.id}__reset_to__${resetId}`;
        if (!seen.has(edgeId)) {
          seen.add(edgeId);
          edges.push({
            data: {
              id: edgeId,
              source: obj.id,
              target: resetId,
            },
            classes: "reset-edge",
          });
        }
      }
    }
  });

  return edges;
};

/**
 * Returns a string array of rewards from an objective reward object.
 * @param reward - The objective reward object.
 * @returns A string array of rewards.
 */
export const getRewardArray = (reward?: ObjectiveRewardType) => {
  const rewards: string[] = [];
  if (!reward) return rewards;
  const questReward = ObjectiveReward.parse(reward);
  if (questReward.reward_items.length > 0) {
    rewards.push(`${questReward.reward_items.length} items`);
  }
  if (questReward.reward_jutsus.length > 0) {
    rewards.push(`${questReward.reward_jutsus.length} jutsus`);
  }
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
