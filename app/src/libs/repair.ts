import type { UserItemWithRelations } from "@/drizzle/schema";

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
 * Calculates which repair kits to use for repairing all items needing repair.
 * Uses a pooled durability approach, prioritizing lowest power kits first to minimize waste.
 * This mirrors the backend algorithm in @/server/api/routers/item.ts
 *
 * @param itemsNeedingRepair - Items that need repair
 * @param repairKits - Available repair kits with their repair amounts
 * @param userItems - All user items (used to look up kit names)
 * @returns Calculation result with kits to use, total durability needed, and whether all items can be repaired
 */
/**
 * Gets all repair kits from user items
 */
export const getRepairKits = (
  userItems: UserItemWithRelations[] | undefined,
): RepairKit[] => {
  return (userItems || [])
    .filter(
      (userItem) =>
        userItem.item?.effects?.some((e) => e.type === "repair") &&
        userItem.quantity > 0 &&
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
 * This mirrors the backend algorithm in @/server/api/routers/item.ts
 *
 * @param itemsNeedingRepair - Items that need repair
 * @param repairKits - Available repair kits with their repair amounts
 * @param userItems - All user items (used to look up kit names)
 * @returns Calculation result with kits to use, total durability needed, and whether all items can be repaired
 */
export const calculateKitsToUse = (
  itemsNeedingRepair: UserItemWithRelations[],
  repairKits: RepairKit[],
  userItems: UserItemWithRelations[] | undefined,
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

  const kitUsage: Map<string, number> = new Map();
  const kitAvailability: Map<string, number> = new Map();
  for (const kit of repairKits) {
    kitAvailability.set(kit.userItem.id, kit.userItem.quantity);
  }

  // Pool all durability together and use kits starting with lowest power first
  // Group kits by power level and aggregate quantities
  const kitsByPower = new Map<
    number,
    Array<{ kitId: string; available: number; power: number }>
  >();
  for (const kit of repairKits) {
    const available = kitAvailability.get(kit.userItem.id) || 0;
    if (available <= 0) continue;

    if (!kitsByPower.has(kit.repairAmount)) {
      kitsByPower.set(kit.repairAmount, []);
    }
    kitsByPower.get(kit.repairAmount)?.push({
      kitId: kit.userItem.id,
      available,
      power: kit.repairAmount,
    });
  }

  // Sort by power (smallest first)
  const sortedPowers = Array.from(kitsByPower.keys()).sort((a, b) => a - b);

  // Use kits starting with lowest power first until all durability is covered
  let remainingDurability = totalDurabilityNeeded;
  for (const power of sortedPowers) {
    if (remainingDurability <= 0) break;

    const kitsWithThisPower = kitsByPower.get(power);
    if (!kitsWithThisPower) continue;
    const totalAvailable = kitsWithThisPower.reduce((sum, k) => sum + k.available, 0);

    if (totalAvailable <= 0) continue;

    const kitsNeeded = Math.ceil(remainingDurability / power);
    let kitsToUse = Math.min(kitsNeeded, totalAvailable);

    // Distribute across all stacks of this power level
    for (const { kitId, available } of kitsWithThisPower) {
      if (kitsToUse <= 0) break;
      const useFromThisStack = Math.min(kitsToUse, available);
      if (useFromThisStack > 0) {
        const currentUsage = kitUsage.get(kitId) || 0;
        kitUsage.set(kitId, currentUsage + useFromThisStack);
        const currentAvailable = kitAvailability.get(kitId) || 0;
        kitAvailability.set(kitId, currentAvailable - useFromThisStack);
        kitsToUse -= useFromThisStack;
        remainingDurability -= useFromThisStack * power;
      }
    }
  }

  const canRepairAll = remainingDurability <= 0;

  const kitsToUseArray: Array<{
    repairItemId: string;
    repairItemName: string;
    quantityUsed: number;
  }> = [];
  for (const [repairItemId, quantityUsed] of kitUsage.entries()) {
    if (quantityUsed > 0) {
      const repairUserItem = userItems?.find((ui) => ui.id === repairItemId);
      const repairItemName = repairUserItem?.item.name ?? "Unknown Repair Kit";
      kitsToUseArray.push({
        repairItemId,
        repairItemName,
        quantityUsed,
      });
    }
  }

  return {
    kitsToUse: kitsToUseArray,
    totalDurabilityNeeded,
    canRepairAll,
  };
};
