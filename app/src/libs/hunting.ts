import {
  HUNTING_ITEM_DROP_CHANCES,
  HUNTING_RANKS,
  HUNTING_REQUIRED_EXP,
} from "@/drizzle/constants";
import {
  getRankForExperience,
  getRankProgress,
  type RankDropCandidate,
  rollRankItemDrops,
} from "@/libs/occupationRank";

/**
 * Get the hunting rank based on the experience
 * @param experience - The experience of the user
 * @returns The hunting rank
 */
export const getHuntingRank = (experience: number) =>
  getRankForExperience(HUNTING_RANKS, HUNTING_REQUIRED_EXP, experience);

/**
 * Get the hunting rank progress
 * @param experience - The experience of the user
 * @returns The hunting rank progress
 */
export const getHuntingRankProgress = (experience: number) =>
  getRankProgress(HUNTING_RANKS, HUNTING_REQUIRED_EXP, experience);

/**
 * Get the item drops for a hunting experience
 * @param huntingExperience - The hunting experience of the user
 * @param items - The items to get the drops for
 * @param validIds - An empty list allows all candidate items
 * @returns The item drops
 */
export const getHuntingItemDrops = (
  huntingExperience: number,
  items: RankDropCandidate[],
  validIds: string[] = [],
) =>
  rollRankItemDrops(
    HUNTING_ITEM_DROP_CHANCES[getHuntingRank(huntingExperience)],
    items,
    validIds,
  );
