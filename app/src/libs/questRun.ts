import type { UserData, UserQuest } from "@/drizzle/schema";
import type { QuestContentType } from "@/validators/objectives";

/** Shared feedback for server rejections and the isolated-run boundary. */
export const ISOLATED_PYRAMID_MESSAGE =
  "Complete or abandon your isolated Battle Pyramid before starting outside activities.";

/** History owns isolation so hidden content and discarded checkpoint trackers cannot unlock it. */
export const getIsolatedPyramid = (
  user: { userQuests?: readonly UserQuest[] } | null | undefined,
) =>
  user?.userQuests?.find((entry) => entry.isolated && !entry.endAt && !entry.completed);

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
