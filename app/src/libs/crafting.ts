import {
  CRAFTING_REQUIRED_EXP,
  CRAFTING_MAX_IMBUED_ITEMS,
  CRAFTING_RANKS,
} from "@/drizzle/constants";
import type { CRAFTING_RANK } from "@/drizzle/constants";
import type { UserData, UserItem, Item } from "@/drizzle/schema";

/**
 * Get the crafting rank based on the experience
 * @param experience - The experience of the user
 * @returns The crafting rank
 */
export const getCraftingRank = (experience: number): CRAFTING_RANK => {
  if (experience >= CRAFTING_REQUIRED_EXP.FORGEMASTER) return "FORGEMASTER";
  if (experience >= CRAFTING_REQUIRED_EXP.MASTER) return "MASTER";
  if (experience >= CRAFTING_REQUIRED_EXP.APPRENTICE) return "APPRENTICE";
  return "NOVICE";
};

/**
 * Get the next crafting rank
 * @param craftingRank - The current crafting rank
 * @returns The next crafting rank
 */
export const getNextCraftingRank = (craftingRank: CRAFTING_RANK) => {
  const currentIndex = CRAFTING_RANKS.indexOf(craftingRank);
  if (currentIndex === CRAFTING_RANKS.length - 1) return null;
  return CRAFTING_RANKS[currentIndex + 1];
};

/**
 * Get the experience required for a crafting rank
 * @param craftingRank - The crafting rank
 * @returns The experience required for the crafting rank
 */
export const getRankExperienceRequirement = (craftingRank: CRAFTING_RANK) => {
  return CRAFTING_REQUIRED_EXP[craftingRank];
};

/**
 * Get the experience required for the next rank
 * @param craftingRank - The current crafting rank
 * @returns The experience required for the next rank
 */
export const getNextRankExperience = (craftingRank: CRAFTING_RANK) => {
  const nextRank = getNextCraftingRank(craftingRank);
  if (!nextRank) return null;
  return CRAFTING_REQUIRED_EXP[nextRank];
};

/**
 * Get the total quantity of a specific item the user has
 * @param userItems - The user items
 * @param itemId - The item ID to check
 * @returns The total quantity of the item
 */
export const getTotalItemQuantity = (
  userItems: (UserItem & { item: Item })[],
  itemId: string,
) => {
  return userItems
    .filter(
      (item) =>
        item.itemId === itemId &&
        item.quantity !== 0 &&
        !item.isInAuction &&
        (!item.craftingFinishedAt || item.craftingFinishedAt < new Date()),
    )
    .reduce((total, item) => total + item.quantity, 0);
};

/**
 * Calculate how to consume items for crafting
 * @param userItems - The user items
 * @param itemId - The item ID to consume
 * @param requiredQuantity - The quantity needed
 * @returns Array of consumption instructions
 */
export const calculateItemConsumption = (
  userItems: (UserItem & { item: Item })[],
  itemId: string,
  requiredQuantity: number,
) => {
  const availableItems = userItems
    .filter(
      (item) =>
        item.itemId === itemId &&
        item.quantity !== 0 &&
        !item.isInAuction &&
        (!item.craftingFinishedAt || item.craftingFinishedAt < new Date()),
    )
    .sort((a, b) => a.quantity - b.quantity); // Consume smaller stacks first

  const consumptions: {
    userItemId: string;
    consumeQuantity: number;
    newQuantity: number;
  }[] = [];
  let remaining = requiredQuantity;

  for (const userItem of availableItems) {
    if (remaining <= 0) break;

    const toConsume = Math.min(userItem.quantity, remaining);
    const newQuantity = userItem.quantity - toConsume;

    consumptions.push({
      userItemId: userItem.id,
      consumeQuantity: toConsume,
      newQuantity,
    });

    remaining -= toConsume;
  }

  return { consumptions, hasEnough: remaining === 0 };
};

/**
 * Get the current crafting status
 * @param userData - The user data
 * @param userItems - The user items
 * @returns The current crafting status
 */
export const getCurrentCraftingStatus = (
  userData: UserData,
  userItems: (UserItem & { item: Item })[],
) => {
  if (!userData || userData.occupation !== "CRAFTING") {
    return {
      isCurrentlyCrafting: false,
      craftingRank: null,
      craftingExperience: 0,
      currentCraftingItem: null,
      craftingFinishedAt: null,
      nextRankExperience: 0,
    };
  } else {
    const craftingRank = getCraftingRank(userData.craftingExperience);

    // Find current crafting item (still in progress)
    const currentCraftingItem = userItems?.find(
      (item) =>
        item.craftingFinishedAt && new Date(item.craftingFinishedAt) > new Date(),
    );

    const nextRankExperience = getNextRankExperience(craftingRank);

    return {
      isCurrentlyCrafting: !!currentCraftingItem,
      craftingRank,
      craftingExperience: userData.craftingExperience,
      currentCraftingItem: currentCraftingItem?.item || null,
      craftingFinishedAt: currentCraftingItem?.craftingFinishedAt || null,
      nextRankExperience,
    };
  }
};

/**
 * Get the crafting rank progress
 * @param experience - The experience of the user
 * @returns The crafting rank progress
 */
export const getCraftingRankProgress = (experience: number) => {
  const currentRank = getCraftingRank(experience);
  const nextRankExp = getNextRankExperience(currentRank);

  if (!nextRankExp) {
    return { progress: 100, nextRank: null };
  }
  const currentRankExp = CRAFTING_REQUIRED_EXP[currentRank];
  const progress =
    ((experience - currentRankExp) / (nextRankExp - currentRankExp)) * 100;

  return {
    progress: Math.max(0, Math.min(100, progress)),
    nextRank: getNextRankExperience(currentRank),
  };
};

/**
 * Calculate the effective max imbuements for an item
 * @param craftingRank - The user's crafting rank
 * @param itemMaxImbueNumber - The item's max imbue number
 * @returns The effective max imbuements (minimum of rank limit and item limit)
 */
export const getEffectiveMaxImbuements = (
  craftingRank: CRAFTING_RANK,
  itemMaxImbueNumber: number,
): number => {
  const rankLimit = CRAFTING_MAX_IMBUED_ITEMS[craftingRank];
  return Math.min(rankLimit, itemMaxImbueNumber);
};
