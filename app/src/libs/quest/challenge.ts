import { isQuestObjectiveAvailable } from "@/libs/objectives";
import { isObjectiveLocationSatisfied } from "@/libs/quest";
import type { UserWithRelations } from "@/routers/profile";
import type { AllObjectivesType, QuestChallengeTask } from "@/validators/objectives";
import type { QuestChallengeRequest } from "@/validators/questChallenge";

/**
 * The minigame challenge objective a request names, resolved for this player: its
 * location as rolled for them, whether it is done, whether the quest has reached it and
 * whether the player stands on it. Null when no active quest has such an objective.
 */
export const findQuestChallenge = <Task extends QuestChallengeTask>(
  user: Pick<
    NonNullable<UserWithRelations>,
    "userQuests" | "questData" | "sector" | "longitude" | "latitude"
  >,
  request: QuestChallengeRequest,
  task: Task,
) => {
  const userQuest = user.userQuests.find((entry) => entry.questId === request.questId);
  const objectives = userQuest?.quest.content.objectives ?? [];
  const index = objectives.findIndex((entry) => entry.id === request.objectiveId);
  const authored = objectives[index];
  if (!userQuest || authored?.task !== task) return null;
  const tracker = user.questData?.find((entry) => entry.id === request.questId);
  const goal = tracker?.goals.find((entry) => entry.id === authored.id);
  const objective = {
    ...(authored as Extract<AllObjectivesType, { task: Task }>),
    sector: goal?.sector ?? authored.sector,
    longitude: goal?.longitude ?? authored.longitude,
    latitude: goal?.latitude ?? authored.latitude,
  };
  return {
    quest: userQuest.quest,
    objective,
    done: !!goal?.done,
    available: !tracker || isQuestObjectiveAvailable(userQuest.quest, tracker, index),
    atLocation: isObjectiveLocationSatisfied(user, objective),
  };
};
