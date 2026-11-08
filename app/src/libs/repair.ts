import type { UserItemWithItem, UserItemWithRelations } from "@/drizzle/schema";
import { calcItemRepairCost } from "@/libs/item";
import { hasRequiredSkill, type SkillRequirementUser } from "@/libs/skillRequirements";

/**
 * Repair kit with its power/repair amount
 */
export interface RepairKit {
  userItem: UserItemWithRelations;
  repairAmount: number;
}

/**
 * Result of calculating which kits to use for repair
 */
export interface RepairKitCalculationResult {
  kitsToUse: Array<{
    repairItemId: string;
    repairItemName: string;
    quantityUsed: number;
  }>;
  totalDurabilityNeeded: number;
  canRepairAll: boolean;
}

/**
 * Whether a user item is eligible for inventory / crafting-occupation repair flows.
 * Excludes furniture, home-stored and auction-listed items so bulk repair only
 * charges for equipment available on the inventory page.
 */
export const needsInventoryRepair = (ui: {
  storedAtHome: boolean;
  isInAuction: boolean;
  durability: number;
  item: { maxDurability: number; itemType?: string };
}): boolean =>
  ui.item.itemType !== "FURNITURE" &&
  !ui.storedAtHome &&
  !ui.isInAuction &&
  ui.item.maxDurability > 0 &&
  ui.durability < ui.item.maxDurability;

/**
 * The items a bulk ryo repair covers and its total cost, shared by the repair previews
 * and `item.repairAll`.
 */
export const calcRepairAllCost = <
  T extends UserItemWithItem & Parameters<typeof needsInventoryRepair>[0],
>(
  userItems: T[] | undefined,
) => {
  const itemsNeedingRepair = (userItems ?? []).filter(needsInventoryRepair);
  const totalCost = itemsNeedingRepair.reduce(
    (total, userItem) => total + calcItemRepairCost(userItem),
    0,
  );
  return { itemsNeedingRepair, totalCost };
};

/**
 * Gets all repair kits from user items. Shared by the inventory UI and
 * `item.useRepairAll` so preview and mutation pick the same stacks.
 * Excludes home-stored and auction-listed kits — `item.useRepairItem` rejects
 * those, and bulk repair must never consume a stack backing a live listing.
 */
export const getRepairKits = (
  userItems: UserItemWithRelations[] | undefined,
  user: SkillRequirementUser = {},
): RepairKit[] => {
  return (userItems || [])
    .filter(
      (userItem) =>
        userItem.item?.itemType !== "FURNITURE" &&
        userItem.item?.effects?.some((e) => e.type === "repair") &&
        hasRequiredSkill(userItem.item, user) &&
        userItem.quantity > 0 &&
        !userItem.storedAtHome &&
        !userItem.isInAuction &&
        (!userItem.craftingFinishedAt || userItem.craftingFinishedAt < new Date()),
    )
    .map((userItem) => {
      const repairEffect = userItem.item.effects.find((e) => e.type === "repair");
      return {
        userItem,
        repairAmount: Math.floor(repairEffect?.power || 0),
      };
    })
    .filter((kit) => kit.repairAmount > 0)
    .sort((a, b) => a.repairAmount - b.repairAmount);
};

/**
 * Calculates which repair kits to use for repairing all items needing repair.
 * Uses a pooled durability approach, prioritizing lowest power kits first to minimize waste.
 * Shared by the inventory UI and `item.useRepairAll`.
 *
 * @param itemsNeedingRepair - Items that need repair
 * @param repairKits - Available stacks with unique inventory IDs and positive integer repair
 * amounts, in any order
 * @returns Calculation result with kits to use, total durability needed, and whether all items can be repaired
 */
export const calculateKitsToUse = (
  itemsNeedingRepair: UserItemWithRelations[],
  repairKits: RepairKit[],
): RepairKitCalculationResult => {
  // If nothing needs repair, all items are already repaired (vacuously true)
  if (itemsNeedingRepair.length === 0) {
    return { kitsToUse: [], totalDurabilityNeeded: 0, canRepairAll: true };
  }

  const totalDurabilityNeeded = itemsNeedingRepair.reduce(
    (total, useritem) => total + (useritem.item.maxDurability - useritem.durability),
    0,
  );

  // If no repair kits available, cannot repair
  if (repairKits.length === 0) {
    return { kitsToUse: [], totalDurabilityNeeded, canRepairAll: false };
  }

  const kitsToUse: RepairKitCalculationResult["kitsToUse"] = [];
  // Stable sorting preserves inventory order among stacks with equal power.
  const sortedKits = [...repairKits].sort((a, b) => a.repairAmount - b.repairAmount);
  let remainingDurability = totalDurabilityNeeded;
  for (const { userItem, repairAmount } of sortedKits) {
    if (remainingDurability <= 0) break;

    const quantityUsed = Math.min(
      userItem.quantity,
      Math.ceil(remainingDurability / repairAmount),
    );
    if (quantityUsed > 0) {
      kitsToUse.push({
        repairItemId: userItem.id,
        repairItemName: userItem.item.name,
        quantityUsed,
      });
      remainingDurability -= quantityUsed * repairAmount;
    }
  }

  return {
    kitsToUse,
    totalDurabilityNeeded,
    canRepairAll: remainingDurability <= 0,
  };
};
