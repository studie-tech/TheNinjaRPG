import type { RouterOutputs } from "@/app/_trpc/client";
import type { UserQueueState } from "@/deltas/profile";
import { getUserProgressionUpdate } from "@/deltas/profile";
import type { UserData, UserItem, UserItemWithRelations } from "@/drizzle/schema";
import {
  effectiveMasteries,
  type MasteryBuffUser,
  type MasterySources,
} from "@/libs/mastery";
import { calcMaxEnergy } from "@/libs/profile";
import { hasEnergyQueue } from "@/libs/queue";
import type { fetchItem, fetchUserEquipmentSnapshot } from "@/queries/item";
import type { fetchUser } from "@/queries/profile";
import type { InventoryQuantityChange } from "@/validators/inventory";
import type { UserCachePatch } from "@/validators/userCache";

type EquipmentSnapshot = Omit<MasteryBuffUser, "items"> &
  Pick<UserData, "energyQueueHead" | "energyQueueTail" | "itemLoadout"> & {
    items: UserItemWithRelations[];
  };

/**
 * Project confirmed equipment, loadout and derived mastery and energy limits from loaded
 * sources. Return undefined while energy work is queued; currency changes belong in a
 * separate delta.
 */
export const getUserEquipmentPatch = (user: EquipmentSnapshot) => {
  if (hasEnergyQueue(user)) return;
  return {
    items: user.items,
    itemLoadout: user.itemLoadout,
    maxEnergy: calcMaxEnergy(user),
    effectiveMasteries: effectiveMasteries(user),
  };
};

/**
 * Apply confirmed repairs to matching equipment snapshots and debit their cost. A stale
 * repair baseline omits the projection; queued energy work withholds equipment and balance
 * changes.
 */
export const getRepairedEquipmentUpdate = (
  user: EquipmentSnapshot,
  changes: {
    before: Pick<
      UserItem,
      "id" | "durability" | "quantity" | "equipped" | "level" | "experience"
    >;
    durability?: number;
    quantity?: number;
  }[],
  cost = 0,
) => {
  if (
    changes.some(({ before }) => {
      const original = user.items.find((entry) => entry.id === before.id);
      return original
        ? original.durability !== before.durability ||
            original.quantity !== before.quantity ||
            original.equipped !== before.equipped ||
            original.level !== before.level ||
            original.experience !== before.experience
        : before.equipped !== "NONE";
    })
  )
    return {};
  const items = user.items.flatMap((entry) => {
    const updated = { ...entry };
    for (const change of changes) {
      if (change.before.id !== entry.id) continue;
      if (change.durability !== undefined) updated.durability = change.durability;
      if (change.quantity !== undefined) updated.quantity = change.quantity;
    }
    return updated.quantity > 0 ? [updated] : [];
  });
  const userPatch = getUserEquipmentPatch({ ...user, items });
  return {
    userPatch,
    userDelta: userPatch ? { money: cost > 0 ? -cost : 0 } : undefined,
  };
};

/**
 * Debit a variant purchase in its supported currency. Queued energy work and positive
 * village-prestige costs require reconciliation; a free variant has an empty delta.
 */
export const getPurchaseVariantUserUpdate = ({
  user,
  variantCost,
  variantCostType,
}: {
  user: UserQueueState;
  variantCost: number;
  variantCostType: "MONEY" | "REPUTATION" | "SEICHI_SILVER" | "VILLAGE_PRESTIGE";
}) => ({
  userDelta:
    hasEnergyQueue(user) || (variantCost > 0 && variantCostType === "VILLAGE_PRESTIGE")
      ? undefined
      : variantCost === 0
        ? {}
        : {
            [variantCostType === "MONEY"
              ? "money"
              : variantCostType === "REPUTATION"
                ? "reputationPoints"
                : "seichiSilver"]: -variantCost,
          },
});

/**
 * Confirm unchanged equipment and balances only when no energy work is queued; otherwise
 * withhold both fields for reconciliation.
 */
export const getUnchangedEquipmentUserUpdate = ({
  user,
}: {
  user: UserQueueState;
}) => ({
  userPatch: hasEnergyQueue(user) ? undefined : {},
  userDelta: hasEnergyQueue(user) ? undefined : {},
});

/**
 * Remove confirmed unequipped rows and recompute derived gear values only when every guarded
 * write succeeded. Partial writes or queued energy work require reconciliation.
 */
export const getUnequippedUserUpdate = ({
  outcomes,
  user,
  equippedItems,
}: {
  outcomes: {
    rowsAffected: number;
  }[];
  user: NonNullable<Awaited<ReturnType<typeof fetchUserEquipmentSnapshot>>>;
  equippedItems: NonNullable<
    NonNullable<Awaited<ReturnType<typeof fetchUserEquipmentSnapshot>>>["items"]
  >;
}) => ({
  userPatch: outcomes.every((outcome) => outcome.rowsAffected === 1)
    ? getUserEquipmentPatch({
        ...user,
        items: user.items.filter(
          (entry) => !equippedItems.some((row) => row.id === entry.id),
        ),
      })
    : undefined,
  userDelta:
    outcomes.every((outcome) => outcome.rowsAffected === 1) && !hasEnergyQueue(user)
      ? {}
      : undefined,
});

/** Combine the confirmed progression and meal projections without additional balance changes. */
export const getConsumedMealUserUpdate = ({
  progressionUserPatch,
  userPatch,
}: {
  progressionUserPatch: UserCachePatch | undefined;
  userPatch: UserCachePatch | undefined;
}) => ({
  userPatch: { ...progressionUserPatch, ...userPatch },
  userDelta: {},
});

/**
 * Project simple item consumption, integer pool values, slot grants and stack removal from a
 * settled snapshot. Omit the projection for content rewards or progression requiring a
 * refresh, and leave the SQL-owned revision to the caller.
 */
export const getConsumedItemUserUpdate = ({
  user,
  updates,
  useritem,
  jutsuSlotIncrease,
  requiresProgressionRefresh,
  hasReward,
  hasPetReward,
  hasQuestReward,
  hasBloodlineChange,
  hasSageModeReward,
  publishedAchievementIds,
}: {
  user: Parameters<typeof getUserProgressionUpdate>[0];
  updates: Pick<
    UserData,
    "curHealth" | "curChakra" | "curStamina" | "marriageSlots" | "extraReskinSlots"
  > &
    Partial<UserData>;
  useritem: Pick<UserItem, "id" | "itemId" | "quantity">;
  jutsuSlotIncrease: number;
  requiresProgressionRefresh: boolean;
  hasReward: boolean;
  hasPetReward: boolean;
  hasQuestReward: boolean;
  hasBloodlineChange: boolean;
  hasSageModeReward: boolean;
  publishedAchievementIds: readonly string[];
}) => {
  if (
    requiresProgressionRefresh ||
    hasReward ||
    hasPetReward ||
    hasQuestReward ||
    hasBloodlineChange ||
    hasSageModeReward
  )
    return {};
  const projection = getUserProgressionUpdate(
    {
      ...user,
      ...updates,
      curHealth: Math.round(updates.curHealth),
      curStamina: Math.round(updates.curStamina),
      curChakra: Math.round(updates.curChakra),
    },
    publishedAchievementIds,
  );
  // The joined write owns the new stamp, which is not available in this snapshot.
  const { updatedAt: _updatedAt, ...userPatch } = projection.userPatch;
  return {
    ...projection,
    userDelta: {},
    inventoryChanges: getInventoryQuantityChanges(
      [useritem],
      [{ id: useritem.id, quantity: useritem.quantity - 1 }],
    ),
    userPatch: {
      ...userPatch,
      items: user.items.flatMap((entry) =>
        entry.id !== useritem.id
          ? [entry]
          : useritem.quantity > 1
            ? [{ ...entry, quantity: useritem.quantity - 1 }]
            : [],
      ),
      marriageSlots: Math.round(updates.marriageSlots),
      extraReskinSlots: Math.round(updates.extraReskinSlots),
      extraJutsuSlots: user.extraJutsuSlots + jutsuSlotIncrease,
    },
  };
};

/**
 * Project purchase currency debits and any automatically equipped item from the saved row.
 * Quest objectives and queued energy work withhold affected fields for reconciliation.
 */
export const getBuyUserUpdate = ({
  advancesBuyItemObjective,
  user,
  ryoCost,
  repsCost,
  seichiSilverCost,
  equipped,
  purchasedItem,
  info,
}: {
  advancesBuyItemObjective: boolean | undefined;
  user: NonNullable<Awaited<ReturnType<typeof fetchUserEquipmentSnapshot>>>;
  ryoCost: number;
  repsCost: number;
  seichiSilverCost: number;
  equipped: UserItem["equipped"];
  purchasedItem: UserItem;
  info: NonNullable<Awaited<ReturnType<typeof fetchItem>>>;
}) => ({
  userDelta:
    advancesBuyItemObjective || hasEnergyQueue(user)
      ? undefined
      : {
          money: -ryoCost,
          reputationPoints: -repsCost,
          seichiSilver: -seichiSilverCost,
        },
  userPatch:
    !advancesBuyItemObjective && equipped !== "NONE"
      ? getUserEquipmentPatch({
          ...user,
          items: [...user.items, { ...purchasedItem, item: info, imbuements: [] }],
        })
      : undefined,
});

/**
 * Project the selected loadout and derived values from confirmed equipped items only when the
 * write result permits cache updates.
 */
export const getSelectItemLoadoutUserUpdate = ({
  result,
  user,
  masterySources,
  id,
  useritems,
}: {
  result: {
    success: boolean;
    message: string;
    userCacheEligible: boolean;
    items: UserItemWithRelations[];
  };
  user: NonNullable<Awaited<ReturnType<typeof fetchUser>>>;
  masterySources: Required<MasterySources>;
  id: string;
  useritems: UserItemWithRelations[];
}) => ({
  userPatch:
    "userCacheEligible" in result && result.userCacheEligible
      ? getUserEquipmentPatch({
          ...user,
          ...masterySources,
          itemLoadout: id,
          items: useritems.filter(
            (entry) => entry.equipped !== "NONE" && entry.quantity > 0,
          ),
        })
      : undefined,
});

/** Return changed equipment slots and their loaded baselines after the guarded write succeeds. */
export const getInventoryEquipmentChanges = (
  before: Pick<UserItem, "id" | "equipped">[],
  after: Pick<UserItem, "id" | "equipped">[],
) =>
  after.flatMap((row) => {
    const previous = before.find((entry) => entry.id === row.id);
    return previous && previous.equipped !== row.equipped
      ? [{ id: row.id, equipped: row.equipped, beforeEquipped: previous.equipped }]
      : [];
  });

/** Loadout readbacks may expose a raced stack change; only slot-only results can reuse inventory rows. */
export const getLoadoutInventoryChanges = (before: UserItem[], after: UserItem[]) => {
  if (
    after.some((row) => {
      const original = before.find((entry) => entry.id === row.id);
      return (
        !original ||
        original.quantity !== row.quantity ||
        original.durability !== row.durability ||
        original.level !== row.level ||
        original.experience !== row.experience
      );
    })
  )
    return;
  return getInventoryEquipmentChanges(before, after);
};

/** Apply saved equipment slots without replacing variant data; stale or missing rows refetch. */
export const getEquippedInventory = <T extends Pick<UserItem, "id" | "equipped">>(
  rows: T[],
  changes:
    | (Pick<UserItem, "id" | "equipped"> & { beforeEquipped: UserItem["equipped"] })[]
    | undefined,
): T[] | undefined => {
  if (
    !changes ||
    changes.some(
      (change) =>
        !rows.some(
          (row) => row.id === change.id && row.equipped === change.beforeEquipped,
        ),
    )
  )
    return;
  return rows.map((row) => {
    const change = changes.find((entry) => entry.id === row.id);
    return change ? { ...row, equipped: change.equipped } : row;
  });
};

/** Remove the confirmed sold stack by its instance ID, preserving other stacks and variants. */
export const getSoldInventory = <T extends { id: string }>(
  rows: T[],
  userItemId: string,
): T[] | undefined =>
  rows.some((row) => row.id === userItemId)
    ? rows.filter((row) => row.id !== userItemId)
    : undefined;

/** Describe committed stack writes using a matching loaded baseline for every target. */
export const getInventoryQuantityChanges = (
  before: Pick<UserItem, "id" | "itemId" | "quantity">[],
  after: { id: string; quantity: number }[],
  updatedAt?: Date,
): InventoryQuantityChange[] =>
  after.map((row) => {
    const original = before.find((entry) => entry.id === row.id)!;
    return {
      id: row.id,
      itemId: original.itemId,
      beforeQuantity: original.quantity,
      quantity: row.quantity,
      ...(updatedAt ? { updatedAt } : {}),
    };
  });

/**
 * Apply confirmed quantities while preserving row extensions. An empty change list confirms
 * no stack changes; withheld metadata or a changed baseline returns undefined for refetch.
 */
export const getInventoryQuantities = <
  T extends Pick<UserItem, "id" | "itemId" | "quantity">,
>(
  rows: T[],
  changes: InventoryQuantityChange[] | undefined,
): T[] | undefined => {
  if (
    !changes ||
    new Set(changes.map((change) => change.id)).size !== changes.length ||
    changes.some(
      (change) =>
        !rows.some(
          (row) =>
            row.id === change.id &&
            row.itemId === change.itemId &&
            row.quantity === change.beforeQuantity,
        ),
    )
  )
    return;
  return rows.flatMap((row) => {
    const change = changes.find((entry) => entry.id === row.id);
    if (!change) return [row];
    return change.quantity > 0
      ? [
          {
            ...row,
            quantity: change.quantity,
            ...(change.updatedAt ? { updatedAt: change.updatedAt } : {}),
          },
        ]
      : [];
  });
};

/** Reuse existing buff labels for a confirmed meal extension; new buff identities require their relations. */
export const getConsumedRaidBuffs = (
  current: RouterOutputs["raids"]["getUserRaidBuffs"],
  result: RouterOutputs["item"]["consume"],
): RouterOutputs["raids"]["getUserRaidBuffs"] | undefined => {
  const patch = result.userPatch;
  if (!patch?.raidBuffs || !patch.updatedAt) return;
  const buffs = patch.raidBuffs.filter((buff) => buff.expiresAt > patch.updatedAt!);
  if (
    buffs.some(
      (buff) =>
        !current.buffs.some(
          (row) =>
            row.id === buff.id &&
            row.itemId === buff.itemId &&
            row.questId === buff.questId,
        ),
    )
  )
    return;
  return {
    ...current,
    buffs: buffs.map((buff) => ({
      ...current.buffs.find((row) => row.id === buff.id)!,
      ...buff,
    })),
  };
};
