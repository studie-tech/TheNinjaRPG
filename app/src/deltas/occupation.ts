import type { RouterOutputs } from "@/app/_trpc/client";
import { getInventoryQuantities, getInventoryQuantityChanges } from "@/deltas/item";
import { getUserProgressionUpdate } from "@/deltas/profile";
import type { Item, UserItem } from "@/drizzle/schema";
import type { toCraftingQueueEntry } from "@/libs/crafting";
import type { QuestConsequence } from "@/libs/quest";
import type { findCraftingQueueState } from "@/queries/occupation";
import type { fetchUpdatedUser } from "@/routers/profile";
import type { QuestTrackerType } from "@/validators/objectives";
import type { CraftingQueueMaterial } from "@/validators/train";

/** Project confirmed imbuing XP and public quest progress; consumed cached equipment still requires reconciliation. */
export const getImbuedItemUserUpdate = ({
  user,
  updatedUser,
  trackers,
  consequences,
  questIdsUpdated,
  crystalUserItemId,
  experience,
  claimedAt,
}: {
  user: Parameters<typeof getCraftingUserUpdate>[0]["user"];
  updatedUser: Parameters<typeof getCraftingUserUpdate>[0]["updatedUser"];
  trackers: QuestTrackerType[];
  consequences: QuestConsequence[];
  questIdsUpdated: string[];
  crystalUserItemId: string;
  experience: number;
  claimedAt: Date;
}) =>
  getCraftingUserUpdate({
    user: {
      ...user,
      craftingExperience: Math.round(user.craftingExperience + experience),
      questData: trackers,
      updatedAt: claimedAt,
    },
    updatedUser,
    consequences,
    questIdsUpdated,
    allConsumptions: [{ userItemId: crystalUserItemId }],
  });

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

/**
 * Describe what a confirmed craft changed in the crafter's views: the material stacks it
 * took, the output stacks it started with their inventory relations, and the queue entry
 * of a waiting craft. Withhold it when the request settled queued crafts or restored stale
 * stack claims, which changed rows the client has not loaded.
 */
export const getCraftItemCacheUpdate = ({
  updatedUser,
  restoredStaleClaims,
  useritems,
  allConsumptions,
  craftedItems,
  item,
  queuedCraft,
}: {
  updatedUser: { craftingItemsChanged: boolean; startedQueuedJobs: number };
  restoredStaleClaims: boolean;
  useritems: Pick<UserItem, "id" | "itemId" | "quantity">[];
  allConsumptions: { userItemId: string; newQuantity: number }[];
  craftedItems: UserItem[];
  item: Item;
  queuedCraft?: ReturnType<typeof toCraftingQueueEntry>;
}) => {
  if (
    updatedUser.craftingItemsChanged ||
    updatedUser.startedQueuedJobs > 0 ||
    restoredStaleClaims
  )
    return undefined;
  return {
    inventoryChanges: getInventoryQuantityChanges(
      useritems,
      allConsumptions.map((consumption) => ({
        id: consumption.userItemId,
        quantity: consumption.newQuantity,
      })),
    ),
    craftedItems: craftedItems.map((row) => ({
      ...row,
      item,
      activeVariant: null,
      imbuements: [],
    })),
    queuedCraft,
  };
};

/**
 * Take a confirmed craft's materials and add its started stacks. A stack that no longer
 * matches the craft's baseline, or a withheld update, requires a read.
 */
export const getCraftedInventory = (
  rows: RouterOutputs["item"]["getUserItems"],
  update: CraftItemCacheUpdate | undefined,
): RouterOutputs["item"]["getUserItems"] | undefined => {
  const consumed = update && getInventoryQuantities(rows, update.inventoryChanges);
  if (!update || !consumed) return;
  return [...consumed, ...update.craftedItems];
};

/**
 * Take a confirmed craft's materials from the variant view. Started stacks lack their
 * variant relations, so a craft that started output requires a read.
 */
export const getCraftedVariantInventory = (
  rows: RouterOutputs["item"]["getUserItemsWithVariants"],
  update: CraftItemCacheUpdate | undefined,
): RouterOutputs["item"]["getUserItemsWithVariants"] | undefined =>
  update && update.craftedItems.length === 0
    ? getInventoryQuantities(rows, update.inventoryChanges)
    : undefined;

/** Append a confirmed waiting craft; a craft that started at once leaves the queue as it is. */
export const getQueuedCrafts = (
  current: RouterOutputs["occupation"]["getCraftingQueue"],
  update: CraftItemCacheUpdate | undefined,
): RouterOutputs["occupation"]["getCraftingQueue"] | undefined => {
  if (!update) return;
  const entry = update.queuedCraft;
  if (!entry) return current;
  if (current.waiting.some((waiting) => waiting.id === entry.id)) return;
  return { ...current, waiting: [...current.waiting, entry] };
};

/**
 * Show a craft that started at once as the running craft; a waiting craft leaves the timer
 * on the craft ahead of it.
 */
export const getCraftingTimers = (
  current: RouterOutputs["profile"]["getSidebarTimers"],
  update: CraftItemCacheUpdate | undefined,
): RouterOutputs["profile"]["getSidebarTimers"] | undefined => {
  if (!update) return;
  const [started] = update.craftedItems;
  if (update.queuedCraft || !started?.craftingFinishedAt) return current;
  return {
    ...current,
    crafting: {
      itemName: started.item.name,
      craftingStartedAt: started.createdAt,
      craftingFinishedAt: started.craftingFinishedAt,
    },
  };
};

type CraftItemCacheUpdate = NonNullable<ReturnType<typeof getCraftItemCacheUpdate>>;
