import type { HUNTING_RANK, ItemRarity } from "@/drizzle/constants";
import {
  HUNTING_ITEM_DROP_CHANCES,
  HUNTING_RANKS,
  HUNTING_REQUIRED_EXP,
} from "@/drizzle/constants";

/**
 * Get the hunting rank based on the experience
 * @param experience - The experience of the user
 * @returns The hunting rank
 */
export const getHuntingRank = (experience: number): HUNTING_RANK => {
  if (experience >= HUNTING_REQUIRED_EXP["S RANK"]) return "S RANK";
  if (experience >= HUNTING_REQUIRED_EXP["A RANK"]) return "A RANK";
  if (experience >= HUNTING_REQUIRED_EXP["B RANK"]) return "B RANK";
  if (experience >= HUNTING_REQUIRED_EXP["C RANK"]) return "C RANK";
  if (experience >= HUNTING_REQUIRED_EXP["D RANK"]) return "D RANK";
  return "NONE";
};

/**
 * Get the next hunting rank
 * @param huntingRank - The current hunting rank
 * @returns The next hunting rank
 */
export const getNextHuntingRank = (huntingRank: HUNTING_RANK) => {
  const currentIndex = HUNTING_RANKS.indexOf(huntingRank);
  if (currentIndex === HUNTING_RANKS.length - 1) return null;
  return HUNTING_RANKS[currentIndex + 1];
};

/**
 * Get the experience required for the next rank
 * @param huntingRank - The current hunting rank
 * @returns The experience required for the next rank
 */
export const getNextRankExperience = (huntingRank: HUNTING_RANK) => {
  switch (huntingRank) {
    case "S RANK":
      return null;
    case "A RANK":
      return HUNTING_REQUIRED_EXP["S RANK"];
    case "B RANK":
      return HUNTING_REQUIRED_EXP["A RANK"];
    case "C RANK":
      return HUNTING_REQUIRED_EXP["B RANK"];
    default:
      return HUNTING_REQUIRED_EXP["C RANK"];
  }
};

/**
 * Get the hunting rank progress
 * @param experience - The experience of the user
 * @returns The hunting rank progress
 */
export const getHuntingRankProgress = (experience: number) => {
  const currentRank = getHuntingRank(experience);
  const nextRankExp = getNextRankExperience(currentRank);

  if (!nextRankExp) {
    return { progress: 100, nextRank: null };
  }

  const currentRankExp = HUNTING_REQUIRED_EXP[currentRank];
  const progress =
    ((experience - currentRankExp) / (nextRankExp - currentRankExp)) * 100;

  return {
    progress: Math.max(0, Math.min(100, progress)),
    nextRank: getNextHuntingRank(currentRank),
  };
};

/**
 * Get the item drops for a hunting experience
 * @param huntingExperience - The hunting experience of the user
 * @param items - The items to get the drops for
 * @returns The item drops
 */
type DroppedItem = { id: string; name: string; rarity: ItemRarity };
export const getHuntingItemDrops = (
  huntingExperience: number,
  items: DroppedItem[],
  validIds: string[] = [],
) => {
  const currentRank = getHuntingRank(huntingExperience);
  const rankChances = HUNTING_ITEM_DROP_CHANCES[currentRank];
  const drops: DroppedItem[] = [];
  const filteredItems =
    validIds && validIds.length > 0
      ? items.filter((item) => validIds.includes(item.id))
      : items;
  for (const item of filteredItems) {
    const chance = rankChances[item.rarity] / 100;
    if (chance > 0 && Math.random() < chance) {
      drops.push(item);
    }
  }
  return drops;
};
