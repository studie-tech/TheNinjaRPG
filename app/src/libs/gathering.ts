import {
  GATHERING_ITEM_DROP_CHANCES,
  GATHERING_RANKS,
  GATHERING_REQUIRED_EXP,
} from "@/drizzle/constants";
import { createOccupationRanks } from "@/libs/occupationRank";

export const {
  getRank: getGatheringRank,
  getNextRankExperience,
  getRankProgress: getGatheringRankProgress,
  getItemDrops: getGatheringItemDrops,
} = createOccupationRanks(
  GATHERING_RANKS,
  GATHERING_REQUIRED_EXP,
  GATHERING_ITEM_DROP_CHANCES,
);
