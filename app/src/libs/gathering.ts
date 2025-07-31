import {
  GATHERING_ITEM_DROP_CHANCES,
  GATHERING_RANKS,
  GATHERING_REQUIRED_EXP,
} from "@/drizzle/constants";
import type { GATHERING_RANK } from "@/drizzle/constants";
import type { ItemRarity } from "@/drizzle/constants";

/**
 * Get the gathering rank based on the experience
 * @param experience - The experience of the user
 * @returns The gathering rank
 */
export const getGatheringRank = (experience: number): GATHERING_RANK => {
  if (experience >= GATHERING_REQUIRED_EXP["S RANK"]) return "S RANK";
  if (experience >= GATHERING_REQUIRED_EXP["A RANK"]) return "A RANK";
  if (experience >= GATHERING_REQUIRED_EXP["B RANK"]) return "B RANK";
  if (experience >= GATHERING_REQUIRED_EXP["C RANK"]) return "C RANK";
  if (experience >= GATHERING_REQUIRED_EXP["D RANK"]) return "D RANK";
  return "NONE";
};

/**
 * Get the next gathering rank
 * @param gatheringRank - The current gathering rank
 * @returns The next gathering rank
 */
export const getNextGatheringRank = (gatheringRank: GATHERING_RANK) => {
  const currentIndex = GATHERING_RANKS.indexOf(gatheringRank);
  if (currentIndex === GATHERING_RANKS.length - 1) return null;
  return GATHERING_RANKS[currentIndex + 1];
};

/**
 * Get the experience required for the next rank
 * @param gatheringRank - The current gathering rank
 * @returns The experience required for the next rank
 */
export const getNextRankExperience = (gatheringRank: GATHERING_RANK) => {
  switch (gatheringRank) {
    case "S RANK":
      return GATHERING_REQUIRED_EXP["S RANK"];
    case "A RANK":
      return GATHERING_REQUIRED_EXP["S RANK"];
    case "B RANK":
      return GATHERING_REQUIRED_EXP["A RANK"];
    case "C RANK":
      return GATHERING_REQUIRED_EXP["B RANK"];
    default:
      return GATHERING_REQUIRED_EXP["C RANK"];
  }
};

/**
 * Get the gathering rank progress
 * @param experience - The experience of the user
 * @returns The gathering rank progress
 */
export const getGatheringRankProgress = (experience: number) => {
  const currentRank = getGatheringRank(experience);
  const nextRankExp = getNextRankExperience(currentRank);

  if (!nextRankExp) {
    return { progress: 100, nextRank: null };
  }

  const currentRankExp = GATHERING_REQUIRED_EXP[currentRank];
  const progress =
    ((experience - currentRankExp) / (nextRankExp - currentRankExp)) * 100;

  return {
    progress: Math.max(0, Math.min(100, progress)),
    nextRank: getNextGatheringRank(currentRank),
  };
};

/**
 * Get the item drops for a gathering experience
 * @param gatheringExperience - The gathering experience of the user
 * @param items - The items to get the drops for
 * @returns The item drops
 */
type DroppedItem = { id: string; name: string; rarity: ItemRarity };
export const getGatheringItemDrops = (
  experience: number,
  items: DroppedItem[],
  validIds: string[] = [],
) => {
  const currentRank = getGatheringRank(experience);
  const rankChances = GATHERING_ITEM_DROP_CHANCES[currentRank];
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
