import { getUserProgressionUpdate } from "@/deltas/profile";
import type { QuestConsequence } from "@/libs/quest";
import type { findCraftingQueueState } from "@/queries/occupation";
import type { fetchUpdatedUser } from "@/routers/profile";
import type { CraftingQueueMaterial } from "@/validators/train";

/** Project the saved occupation and its signup timestamp. */
export const getSelectOccupationUserUpdate = ({
  inputOccupation,
  occupationSignupAt,
}: {
  inputOccupation: "GATHERING" | "HUNTER" | "CRAFTING";
  occupationSignupAt: Date;
}) => ({
  userPatch: { occupation: inputOccupation, occupationSignupAt },
});

/**
 * Remove a fully cancelled craft from the public queue only when returned materials do not
 * affect cached gear. Remaining work or affected gear requires reconciliation.
 */
export const getCancelQueuedCraftUserUpdate = ({
  cancelledRemaining,
  cancelledEntryMaterials,
  snapshotItems,
  snapshotQueue,
  cancelledEntryId,
}: {
  cancelledRemaining: number;
  cancelledEntryMaterials: CraftingQueueMaterial[] | null;
  snapshotItems: {
    id: string;
  }[];
  snapshotQueue: NonNullable<
    NonNullable<Awaited<ReturnType<typeof findCraftingQueueState>>>["queue"]
  >;
  cancelledEntryId: string;
}) => ({
  userPatch:
    cancelledRemaining === 0 &&
    !cancelledEntryMaterials?.some((material) =>
      snapshotItems.some((entry) => entry.id === material.userItemId),
    )
      ? {
          queue: snapshotQueue
            .filter((row) => row.id !== cancelledEntryId)
            .map(({ item: _item, ...row }) => row),
        }
      : undefined,
});

/**
 * Project settled crafting progression and experience from loaded sources. Omit the
 * projection for unresolved progression, passive or team quest effects, or consumed cached
 * equipment.
 */
export const getCraftingUserUpdate = ({
  user,
  updatedUser,
  consequences,
  questIdsUpdated,
  allConsumptions,
}: {
  user: Parameters<typeof getUserProgressionUpdate>[0];
  updatedUser: Pick<
    Awaited<ReturnType<typeof fetchUpdatedUser>>,
    "requiresProgressionRefresh" | "publishedAchievementIds"
  >;
  consequences: QuestConsequence[];
  questIdsUpdated: string[];
  allConsumptions: { userItemId: string }[];
}) => {
  if (
    updatedUser.requiresProgressionRefresh ||
    consequences.some(
      (consequence) =>
        consequence.type !== "update_user" ||
        consequence.ids.some((id) => id !== "activity_completion"),
    ) ||
    // Passive rewards and team quest navigation use the authoritative profile flow.
    user.userQuests.some(
      (entry) =>
        questIdsUpdated.some((id) => id === entry.questId) &&
        (entry.quest.teamEnabled ||
          ["tier", "daily", "achievement"].includes(entry.quest.questType)),
    ) ||
    allConsumptions.some((consumption) =>
      user.items.some((entry) => entry.id === consumption.userItemId),
    )
  )
    return {};
  const progression = getUserProgressionUpdate(
    user,
    updatedUser.publishedAchievementIds,
  );
  return {
    ...progression,
    userPatch: {
      ...progression.userPatch,
      craftingExperience: user.craftingExperience,
    },
  };
};
