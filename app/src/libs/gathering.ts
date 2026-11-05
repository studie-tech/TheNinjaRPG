import {
  GATHERING_ITEM_DROP_CHANCES,
  GATHERING_RANKS,
  GATHERING_REQUIRED_EXP,
} from "@/drizzle/constants";
import {
  getRankForExperience,
  getRankProgress,
  type RankDropCandidate,
  rollRankItemDrops,
} from "@/libs/occupationRank";

/**
 * Get the gathering rank based on the experience
 * @param experience - The experience of the user
 * @returns The gathering rank
 */
export const getGatheringRank = (experience: number) =>
  getRankForExperience(GATHERING_RANKS, GATHERING_REQUIRED_EXP, experience);

/**
 * Get the gathering rank progress
 * @param experience - The experience of the user
 * @returns The gathering rank progress
 */
export const getGatheringRankProgress = (experience: number) =>
  getRankProgress(GATHERING_RANKS, GATHERING_REQUIRED_EXP, experience);

/**
 * Roll rank-based drop chances, then add the captured whole-unit bonus to successful drops.
 * @param experience - Gathering experience used to choose the drop chances.
 * @param items - Candidate materials, optionally restricted by validIds.
 * @param validIds - An empty list allows all candidate materials.
 * @param bonusQuantity - Extra units per successful material; does not change its drop chance.
 * @returns One entry per awarded unit, used by inventory grants and gathering progress.
 */
export const getGatheringItemDrops = (
  experience: number,
  items: RankDropCandidate[],
  validIds: string[] = [],
  bonusQuantity = 0,
) =>
  rollRankItemDrops(
    GATHERING_ITEM_DROP_CHANCES[getGatheringRank(experience)],
    items,
    validIds,
    bonusQuantity,
  );
