import type { UserQuest } from "@/drizzle/schema";
import type { ObjectiveTrackerTaskInput } from "@/libs/quest";
import { isMockQuestHistoryRow } from "@/libs/quest";
import { questHasOverworldObjectives } from "@/libs/quest/projection";
import { CombatActivityTasks } from "@/validators/objectives";

/** Tasks emitted by combat settlement; the emitters use this union to keep preload complete. */
export const COMBAT_QUEST_TASKS = [
  ...CombatActivityTasks,
  "pvp_kills",
  "arena_kills",
  "random_encounter_wins",
  "spars_won",
  "defeat_opponents",
  "start_battle",
  "win_encounter_at_location",
  "use_specific_jutsu_combat",
  "use_specific_item_combat",
  "damage_dealt",
  "creatures_hunted",
  "tag_usage_win",
  "hunting_experience_gained",
] as const satisfies readonly ObjectiveTrackerTaskInput["task"][];

export type CombatQuestTrackerTask = ObjectiveTrackerTaskInput & {
  task: (typeof COMBAT_QUEST_TASKS)[number];
};

const combatTasks = new Set<string>(COMBAT_QUEST_TASKS);

/** Retain runs and private map objectives while omitting unrelated achievement definitions. */
export const filterCombatQuests = (
  quests: readonly UserQuest[],
  requiredQuestIds: readonly string[] = [],
) =>
  quests.filter(
    (entry) =>
      entry.quest?.questType !== "achievement" ||
      (!isMockQuestHistoryRow(entry) && !entry.completed && !entry.endAt) ||
      entry.isolated ||
      requiredQuestIds.includes(entry.questId) ||
      questHasOverworldObjectives(entry.quest) ||
      entry.quest.content.objectives.some((objective) =>
        combatTasks.has(objective.task),
      ),
  );
