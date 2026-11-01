import type { UserQueueState } from "@/delta/profile";
import { getUserProgressionUpdate } from "@/delta/profile";
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

import type { UserCachePatch } from "@/validators/userCache";

type EquipmentSnapshot = Omit<MasteryBuffUser, "items"> &
  Pick<UserData, "energyQueueHead" | "energyQueueTail" | "itemLoadout"> & {
    items: UserItemWithRelations[];
  };

/** Derive only the gear fields affected by a confirmed write; balances remain deltas. */
export const getUserEquipmentPatch = (user: EquipmentSnapshot) => {
  if (hasEnergyQueue(user)) return;
  return {
    items: user.items,
    itemLoadout: user.itemLoadout,
    maxEnergy: calcMaxEnergy(user),
    effectiveMasteries: effectiveMasteries(user),
  };
};

/** A mismatched initial gear read cannot describe the target claimed by a repair. */
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

export const getUnchangedEquipmentUserUpdate = ({
  user,
}: {
  user: UserQueueState;
}) => ({
  userPatch: hasEnergyQueue(user) ? undefined : {},
  userDelta: hasEnergyQueue(user) ? undefined : {},
});

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
  useritem: Pick<UserItem, "id" | "quantity">;
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
