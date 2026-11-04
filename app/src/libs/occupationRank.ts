import type { GATHERING_RANK, HUNTING_RANK, ItemRarity } from "@/drizzle/constants";
import { clamp } from "@/utils/math";

type OccupationRank = HUNTING_RANK | GATHERING_RANK;
type DroppedItem = { id: string; name: string; rarity: ItemRarity };

/** Build the rank, progress and drop rules of an occupation from its balance tables. */
export const createOccupationRanks = (
  ranks: readonly OccupationRank[],
  requiredExp: Record<OccupationRank, number>,
  dropChances: Record<OccupationRank, Record<ItemRarity, number>>,
) => {
  const getRank = (experience: number): OccupationRank => {
    if (experience >= requiredExp["S RANK"]) return "S RANK";
    if (experience >= requiredExp["A RANK"]) return "A RANK";
    if (experience >= requiredExp["B RANK"]) return "B RANK";
    if (experience >= requiredExp["C RANK"]) return "C RANK";
    if (experience >= requiredExp["D RANK"]) return "D RANK";
    return "NONE";
  };

  const getNextRank = (rank: OccupationRank) => {
    const currentIndex = ranks.indexOf(rank);
    if (currentIndex === ranks.length - 1) return null;
    return ranks[currentIndex + 1];
  };

  /** Experience required for the next rank; null at the top rank. */
  const getNextRankExperience = (rank: OccupationRank) => {
    switch (rank) {
      case "S RANK":
        return null;
      case "A RANK":
        return requiredExp["S RANK"];
      case "B RANK":
        return requiredExp["A RANK"];
      case "C RANK":
        return requiredExp["B RANK"];
      default:
        return requiredExp["C RANK"];
    }
  };

  const getRankProgress = (experience: number) => {
    const currentRank = getRank(experience);
    const nextRankExp = getNextRankExperience(currentRank);
    if (!nextRankExp) return { progress: 100, nextRank: null };
    const currentRankExp = requiredExp[currentRank];
    const progress =
      ((experience - currentRankExp) / (nextRankExp - currentRankExp)) * 100;
    return { progress: clamp(progress, 0, 100), nextRank: getNextRank(currentRank) };
  };

  /**
   * Roll rank-based drop chances, then add the whole-unit bonus to successful drops.
   * @param experience - Occupation experience used to choose the drop chances.
   * @param items - Candidate materials, optionally restricted by validIds.
   * @param validIds - An empty list allows all candidate materials.
   * @param bonusQuantity - Extra units per successful material; does not change its chance.
   * @returns One entry per awarded unit, used by inventory grants and occupation progress.
   */
  const getItemDrops = (
    experience: number,
    items: DroppedItem[],
    validIds: string[] = [],
    bonusQuantity = 0,
  ) => {
    const rankChances = dropChances[getRank(experience)];
    const drops: DroppedItem[] = [];
    const filteredItems =
      validIds && validIds.length > 0
        ? items.filter((item) => validIds.includes(item.id))
        : items;
    for (const item of filteredItems) {
      const chance = rankChances[item.rarity] / 100;
      if (chance > 0 && Math.random() < chance) {
        for (let quantity = 0; quantity <= bonusQuantity; quantity++) drops.push(item);
      }
    }
    return drops;
  };

  return { getRank, getNextRankExperience, getRankProgress, getItemDrops };
};
