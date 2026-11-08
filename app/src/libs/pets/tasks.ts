/** Shared eligibility for Content-authored companion profession contracts. */
import {
  isPetTaskQuestType,
  PET_TASK_MAX_MINUTES,
  PET_TASK_MIN_RANK,
  type PET_TASK_QUEST_TYPES,
} from "@/drizzle/constants";
import type { Quest, UserData, UserPet } from "@/drizzle/schema";
import {
  getMaxPetRank,
  getPetRank,
  isPetAppearanceReady,
} from "@/libs/pets/progression";
import type { PetTask } from "@/validators/petTasks";

/** Name of the lowest companion rank that can take profession contracts. */
export const PET_TASK_MIN_RANK_NAME = getPetRank(PET_TASK_MIN_RANK).name;

/** Why a dispatched companion cannot return yet; the task panel shows its countdown instead. */
export const PET_TASK_IN_PROGRESS_MESSAGE =
  "Your companion is still working on this task.";

/** Only opted-in hunting and gathering contracts have an unattended completion contract. */
export const isPetTaskContract = <
  T extends Pick<Quest, "questType" | "petTaskMinutes">,
>(
  quest: T,
): quest is T & {
  petTaskMinutes: number;
  questType: (typeof PET_TASK_QUEST_TYPES)[number];
} =>
  isPetTaskQuestType(quest.questType) &&
  quest.petTaskMinutes !== null &&
  Number.isInteger(quest.petTaskMinutes) &&
  quest.petTaskMinutes >= 1 &&
  quest.petTaskMinutes <= PET_TASK_MAX_MINUTES;

/** History rows are reused on restart, so both the row and its accepted start must match. */
export const isPetTaskAttempt = (
  task: PetTask,
  attempt: { id: string; questId: string; startedAt?: Date } | null | undefined,
) =>
  !!attempt &&
  attempt.id === task.questHistoryId &&
  attempt.questId === task.questId &&
  attempt.startedAt?.getTime() === task.startedAt;

/** Away companions stay owned but cannot start another task or accompany their owner. */
export const petTaskDispatchBlockMessage = (
  user: Pick<
    UserData,
    "rank" | "status" | "battleId" | "isBanned" | "isAi" | "petTask" | "occupation"
  >,
  pet:
    | Pick<UserPet, "rank" | "generationStatus" | "artRank" | "avatar">
    | null
    | undefined,
) => {
  if (user.isBanned || user.isAi)
    return "This account cannot send companions on tasks.";
  if (user.status !== "AWAKE" || user.battleId)
    return "You must be awake and out of combat to send a companion.";
  if (user.petTask) return "Return your companion before starting another task.";
  if (user.occupation !== "HUNTER" && user.occupation !== "GATHERING")
    return "Become a Hunter or Gatherer to send companions on profession tasks.";
  if (!pet) return "Choose an owned companion.";
  if (pet.rank < PET_TASK_MIN_RANK)
    return `Companion tasks require ${PET_TASK_MIN_RANK_NAME} rank or higher.`;
  if (pet.rank > getMaxPetRank(user.rank))
    return "Your rank does not support this companion rank.";
  if (!isPetAppearanceReady(pet))
    return "Finish your companion's appearance before sending it on a task.";
  return null;
};
