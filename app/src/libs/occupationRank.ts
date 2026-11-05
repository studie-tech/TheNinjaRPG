import type { ItemRarity } from "@/drizzle/constants";
import { calculatePercent } from "@/utils/math";

export type RankDropCandidate = { id: string; name: string; rarity: ItemRarity };

/**
 * Highest rank whose required experience is met, falling back to the lowest rank.
 * @param ranks - Ranks ordered from lowest to highest
 * @param requiredExp - Experience required per rank
 * @param experience - The experience of the user
 */
export const getRankForExperience = <Rank extends string>(
  ranks: readonly [Rank, ...Rank[]],
  requiredExp: Record<Rank, number>,
  experience: number,
): Rank =>
  [...ranks].reverse().find((rank) => experience >= requiredExp[rank]) ?? ranks[0];

/** Rank following `rank`, or null at the top of the ladder. */
export const getNextRank = <Rank extends string>(
  ranks: readonly Rank[],
  rank: Rank,
): Rank | null => ranks[ranks.indexOf(rank) + 1] ?? null;

/** Experience required for the rank following `rank`, or null at the top of the ladder. */
export const getNextRankExperience = <Rank extends string>(
  ranks: readonly Rank[],
  requiredExp: Record<Rank, number>,
  rank: Rank,
) => {
  const nextRank = getNextRank(ranks, rank);
  return nextRank === null ? null : requiredExp[nextRank];
};

/** Percentage between the current and next rank thresholds; 100 at the top rank. */
export const getRankProgress = <Rank extends string>(
  ranks: readonly [Rank, ...Rank[]],
  requiredExp: Record<Rank, number>,
  experience: number,
) => {
  const currentRank = getRankForExperience(ranks, requiredExp, experience);
  const nextRank = getNextRank(ranks, currentRank);
  if (nextRank === null) {
    return { progress: 100, nextRank: null, nextRankExperience: null };
  }
  const currentRankExp = requiredExp[currentRank];
  const nextRankExperience = requiredExp[nextRank];
  return {
    progress: calculatePercent(
      experience - currentRankExp,
      nextRankExperience - currentRankExp,
    ),
    nextRank,
    nextRankExperience,
  };
};

/**
 * Roll each candidate against its rarity's chance for the user's rank.
 * @param rankChances - Drop chance in percent per rarity
 * @param items - Candidate items, optionally restricted by validIds
 * @param validIds - An empty list allows all candidates
 * @param bonusQuantity - Extra units per successful drop; does not change its chance
 * @returns One entry per awarded unit
 */
export const rollRankItemDrops = (
  rankChances: Record<ItemRarity, number>,
  items: RankDropCandidate[],
  validIds: string[] = [],
  bonusQuantity = 0,
) => {
  const drops: RankDropCandidate[] = [];
  const filteredItems =
    validIds && validIds.length > 0
      ? items.filter((item) => validIds.includes(item.id))
      : items;
  for (const item of filteredItems) {
    const chance = rankChances[item.rarity] / 100;
    if (chance > 0 && Math.random() < chance) {
      // Repeat successful drops so reward insertion and progress count every unit.
      for (let quantity = 0; quantity <= bonusQuantity; quantity++) drops.push(item);
    }
  }
  return drops;
};
