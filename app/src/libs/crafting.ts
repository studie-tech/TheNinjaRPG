import type { CRAFTING_RANK } from "@/drizzle/constants";
import {
  CLAN_BOOST_MAX_LEVEL,
  CLAN_BOOST_PERCENT_PER_LEVEL,
  CONSUMABLE_CRAFTING_TIMES_MINS,
  CRAFTING_MAX_IMBUED_ITEMS,
  CRAFTING_RANKS,
  CRAFTING_REQUIRED_EXP,
  CRAFTING_TIMES_MINS,
  MAP_WAKE_ISLAND_SECTOR,
} from "@/drizzle/constants";
import type { Item, UserData, UserItem } from "@/drizzle/schema";
import { capitalizeFirstLetter } from "@/utils/string";
import { reduceActivitySeconds } from "@/utils/time";

/**
 * Complete non-meal job duration, including quantity, rounded before the passive reduction.
 * Shrine/Territory War boosts are fractions; clan and passive reductions are percentages.
 * Queued submissions pass no Territory War boost; it is evaluated when the job starts.
 */
export const getCraftingSeconds = (
  item: Pick<Item, "itemType" | "rarity">,
  rank: CRAFTING_RANK,
  quantity: number,
  shrineBoost: number,
  clanBoost = 0,
  craftingReductionPercent = 0,
  territoryBoost = 0,
) => {
  const minutes =
    item.itemType === "CONSUMABLE"
      ? CONSUMABLE_CRAFTING_TIMES_MINS[rank]
      : CRAFTING_TIMES_MINS[rank][item.rarity];
  const clanFactor =
    1 -
    Math.min(
      clanBoost / 100,
      (CLAN_BOOST_MAX_LEVEL * CLAN_BOOST_PERCENT_PER_LEVEL) / 100,
    );
  return reduceActivitySeconds(
    Math.round(
      minutes *
        60 *
        (shrineBoost ? 1 - shrineBoost : 1) *
        clanFactor *
        quantity *
        (1 - territoryBoost),
    ),
    craftingReductionPercent,
  );
};

/** Shared state and location gates for starting a craft. */
export const craftingStartBlockMessage = (
  user: Pick<UserData, "status" | "sector">,
) => {
  if (user.status !== "AWAKE") return "User is not awake";
  if (user.sector === MAP_WAKE_ISLAND_SECTOR)
    return "Cannot craft items on Wake Island";
  return null;
};

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
 * Crafting rank a user still needs before crafting an item, or null when the
 * current rank is enough. A zero entry in `CRAFTING_TIMES_MINS` marks a rarity
 * the rank cannot craft; this applies to every item type except meals, which
 * follow the cooking rules instead.
 * @param item - The item to craft
 * @param craftingRank - The user's current crafting rank
 * @returns The lowest rank able to craft the item, or null when allowed
 */
export const getMissingCraftingRank = (
  item: Pick<Item, "itemType" | "rarity">,
  craftingRank: CRAFTING_RANK,
): CRAFTING_RANK | "UNKNOWN" | null => {
  if (item.itemType === "MEAL") return null;
  if (CRAFTING_TIMES_MINS[craftingRank][item.rarity] !== 0) return null;
  return (
    CRAFTING_RANKS.find((rank) => CRAFTING_TIMES_MINS[rank][item.rarity] !== 0) ??
    "UNKNOWN"
  );
};

/**
 * Display name for a crafting rank, e.g. "FORGEMASTER" -> "Forgemaster"
 * @param craftingRank - The crafting rank
 * @returns The rank name for display
 */
export const formatCraftingRank = (craftingRank: CRAFTING_RANK | "UNKNOWN") =>
  capitalizeFirstLetter(craftingRank);

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

/**
 * Explain why an item cannot take another crystal yet when the crafting rank, not the item,
 * is the limit (e.g. an Apprentice holding an item that allows 2 imbuements).
 * @param craftingRank - The user's crafting rank
 * @param itemMaxImbueNumber - The item's max imbue number
 * @param currentImbuements - Crystals already on the item
 * @returns A player-facing explanation, or null when the rank is not what blocks the item
 */
export const getImbuementRankCapMessage = (
  craftingRank: CRAFTING_RANK,
  itemMaxImbueNumber: number,
  currentImbuements: number,
): string | null => {
  const rankLimit = CRAFTING_MAX_IMBUED_ITEMS[craftingRank];
  if (rankLimit >= itemMaxImbueNumber) return null;
  if (currentImbuements < rankLimit || currentImbuements >= itemMaxImbueNumber) {
    return null;
  }
  const nextRank = CRAFTING_RANKS.find(
    (rank) => CRAFTING_MAX_IMBUED_ITEMS[rank] > currentImbuements,
  );
  const reach = nextRank
    ? ` Reach ${formatCraftingRank(nextRank)} to add another.`
    : "";
  return `${currentImbuements}/${itemMaxImbueNumber} imbuements: your crafting rank (${formatCraftingRank(craftingRank)}) allows ${rankLimit}.${reach}`;
};
