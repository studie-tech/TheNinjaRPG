import type { CRAFTING_RANK } from "@/drizzle/constants";
import { CRAFTING_REPAIR_BONUS, CRAFTING_TIMES_MINS } from "@/drizzle/constants";
import type { Item, UserItemWithRelations } from "@/drizzle/schema";
import { getEffectiveMaxImbuements, getMissingCraftingRank } from "@/libs/crafting";
import type { SkillRequirementUser } from "@/libs/skillRequirements";
import { hasRequiredSkill } from "@/libs/skillRequirements";

/** An available, unequipped copy can be escrowed; live imbuements remain unavailable. */
export const isServiceEquipmentAvailable = (
  row: UserItemWithRelations,
  now = new Date(),
) =>
  row.quantity === 1 &&
  row.equipped === "NONE" &&
  !row.storedAtHome &&
  !row.isInAuction &&
  (!row.craftingFinishedAt || row.craftingFinishedAt <= now) &&
  row.imbuements.every((imb) => imb.craftingFinishedAt <= now);
/** Repair adds temporary durability above the item's normal maximum. */
export const getServiceRepairDurability = (maximum: number, rank: CRAFTING_RANK) =>
  Math.min(65535, maximum + Math.ceil(maximum * CRAFTING_REPAIR_BONUS[rank]));
/** Apply the normal recipe visibility, occupation rarity and skill gates to service work. */
export const serviceRecipeError = (
  recipe: Item & { craftingRequirements: unknown[] },
  rank: CRAFTING_RANK,
  user: SkillRequirementUser,
) => {
  if (
    !recipe.canBeCrafted ||
    recipe.hidden ||
    recipe.parentItemId ||
    recipe.itemType === "MEAL" ||
    !recipe.craftingRequirements.length
  )
    return "This recipe is unavailable for crafting services";
  if (getMissingCraftingRank(recipe, rank))
    return "The crafter's rank cannot craft this rarity";
  if (!hasRequiredSkill(recipe, user)) return "The crafter needs the required skill";
  return null;
};
/** Validate crystal compatibility and rank using the equipment and public offer. */
export const serviceImbueCompatibilityError = (
  target: UserItemWithRelations,
  crystal: Item,
  rank: CRAFTING_RANK,
) => {
  if (!target.item.canBeImbued || crystal.itemType !== "CRYSTAL")
    return "Select an imbuable item and a crystal";
  if (!CRAFTING_TIMES_MINS[rank][crystal.rarity])
    return "The crafter's rank cannot imbue this crystal rarity";
  if (crystal.crystalTargetTypes && crystal.crystalTargetTypes !== target.item.itemType)
    return "This crystal is incompatible with the item type";
  if (crystal.battleUsageType === "PVE" && target.item.battleUsageType !== "PVE")
    return "PvE-only crystals require PvE-only equipment";
  if (
    target.imbuements.length >=
    getEffectiveMaxImbuements(rank, target.item.maxImbueNumber)
  )
    return "This item is at the crafter's imbuement limit";
  if (target.imbuements.some((imb) => imb.imbuementItemId === crystal.id))
    return "This item already has that crystal";
  return null;
};

/** Validate a submitted imbuement against compatibility and the crafter's private skills. */
export const serviceImbueError = (
  target: UserItemWithRelations,
  crystal: Item,
  rank: CRAFTING_RANK,
  user: SkillRequirementUser,
) => {
  const compatibilityError = serviceImbueCompatibilityError(target, crystal, rank);
  if (compatibilityError) return compatibilityError;
  if (!hasRequiredSkill(crystal, user))
    return "The crafter needs the crystal's required skill";
  return null;
};
