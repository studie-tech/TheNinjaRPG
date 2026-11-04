import {
  HUNTING_ITEM_DROP_CHANCES,
  HUNTING_RANKS,
  HUNTING_REQUIRED_EXP,
} from "@/drizzle/constants";
import { createOccupationRanks } from "@/libs/occupationRank";

export const {
  getRank: getHuntingRank,
  getRankProgress: getHuntingRankProgress,
  getItemDrops: getHuntingItemDrops,
} = createOccupationRanks(
  HUNTING_RANKS,
  HUNTING_REQUIRED_EXP,
  HUNTING_ITEM_DROP_CHANCES,
);
