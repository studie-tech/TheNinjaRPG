import type { UserRole } from "@/drizzle/constants";
import type { UserData, UserQuest } from "@/drizzle/schema";
import { canPlayHiddenQuests } from "@/utils/permissions";
import type { QuestContentType, QuestTrackerType } from "@/validators/objectives";

/** Shared feedback for server rejections and the isolated-run boundary. */
export const ISOLATED_PYRAMID_MESSAGE =
  "Complete or abandon your isolated Battle Pyramid before starting outside activities.";

/** History owns isolation so hidden content and discarded checkpoint trackers cannot unlock it. */
export const getIsolatedPyramid = (
  user: { userQuests?: readonly UserQuest[] } | null | undefined,
) =>
  user?.userQuests?.find((entry) => entry.isolated && !entry.endAt && !entry.completed);

/** A Pyramid attempt in progress; `endAt` is absent on rows without an attempt. */
export const isOpenPyramidRun = (entry: {
  questType: string;
  completed?: number | null;
  endAt?: Date | string | null;
}) => entry.questType === "battlepyramid" && entry.endAt === null && !entry.completed;

/** A run's saved tracker; without one it renders from the first objective. */
export const getPyramidRunTracker = (
  run: Pick<UserQuest, "questId" | "startedAt" | "quest">,
  questData: readonly QuestTrackerType[] | null | undefined,
): QuestTrackerType =>
  questData?.find((entry) => entry.id === run.questId) ?? {
    id: run.questId,
    startAt: run.startedAt?.toISOString() ?? run.quest.createdAt.toISOString(),
    goals: [],
  };

/** BATTLE without a fight keeps the run locked while its own quest can advance or end. */
export const isBetweenPyramidBattles = (
  user:
    | (Pick<UserData, "status" | "battleId"> & { userQuests?: readonly UserQuest[] })
    | null
    | undefined,
) => user?.status === "BATTLE" && user.battleId === null && !!getIsolatedPyramid(user);

/** Versioned runs must restart after authored edits; visibility-only edits keep the run valid. */
export const hasQuestContentChanged = (
  entry: Pick<UserQuest, "questType" | "isolated" | "questVersion"> & {
    quest: Pick<UserQuest["quest"], "updatedAt">;
  },
) =>
  (entry.questType === "battlepyramid" || entry.isolated) &&
  !!entry.questVersion &&
  new Date(entry.questVersion).getTime() !== new Date(entry.quest.updatedAt).getTime();

/** Rejection for an attempt that cannot continue, or null while it remains playable. */
export const questAttemptBlockMessage = (
  attempt: Parameters<typeof hasQuestContentChanged>[0] & {
    quest: Pick<UserQuest["quest"], "hidden">;
  },
  role: UserRole,
) => {
  if (
    !hasQuestContentChanged(attempt) &&
    (!attempt.quest.hidden || canPlayHiddenQuests(role))
  )
    return null;
  return attempt.questType === "battlepyramid"
    ? "This Pyramid is paused or changed. Return to the Battle Arena to resume or abandon it."
    : "This quest is currently unavailable.";
};

/** Runs with a lifecycle of their own: start guards, recovery and battle version checks. */
export const isManagedQuestRun = (quest: {
  questType: string;
  content: Pick<QuestContentType, "entryItems">;
}) => quest.questType === "battlepyramid" || !!quest.content.entryItems?.length;

/** The open attempt of a managed run; battles started for it carry its lifecycle guards. */
export const findManagedQuestAttempt = <
  T extends {
    questId: string;
    questType: string;
    endAt?: Date | null;
    quest: { content: Pick<QuestContentType, "entryItems"> };
  },
>(
  userQuests: readonly T[],
  questId: string,
) =>
  userQuests.find(
    (entry) =>
      entry.questId === questId &&
      !entry.endAt &&
      isManagedQuestRun({ questType: entry.questType, content: entry.quest.content }),
  );

/** Every selected item is required; duplicate selections add to the required quantity. */
export const getQuestEntryRequirements = (
  content: Pick<QuestContentType, "entryItems">,
) => {
  const quantities = new Map<string, number>();
  for (const group of content.entryItems ?? []) {
    for (const itemId of group.ids)
      quantities.set(itemId, (quantities.get(itemId) ?? 0) + group.number);
  }
  return [...quantities].map(([itemId, quantity]) => ({ itemId, quantity }));
};

/** "2× Pyramid Ticket, 1× Key" — the entry cost as players read it. */
export const formatQuestEntryCost = (
  requirements: readonly { quantity: number; name: string }[],
) =>
  requirements.map((required) => `${required.quantity}× ${required.name}`).join(", ");

/** These handlers check isolation with their opening reads, before any side effects. */
export const SELF_GUARDED_PYRAMID_PROCEDURES = [
  "travel.moveInSector",
  "quests.checkLocationQuest",
  "home.toggleSleep",
] as const;

/** Self-guarded handlers enforce isolation; message delivery and run controls remain usable. */
export const isPyramidRestrictedProcedure = (path: string) =>
  ![
    ...SELF_GUARDED_PYRAMID_PROCEDURES,
    "quests.checkRewards",
    "quests.retryBattle",
    "quests.abandon",
    "combat.performAction",
    "combat.toggleAutoCombat",
    "combat.iAmHere",
    "combat.updateCombatLoadout",
    "profile.updatePreferences",
    "comments.fetchConversationComment",
    "staff.forceAwake",
  ].includes(path);
