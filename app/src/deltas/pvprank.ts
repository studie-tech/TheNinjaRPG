import { RANKED_ENTRY_COST } from "@/drizzle/constants";

/** Set the ranked season's starting LP and debit the configured village-prestige entry cost. */
export const getEnterRankedSeasonUserUpdate = () => ({
  userPatch: { rankedLp: 150 },
  userDelta: { villagePrestige: -RANKED_ENTRY_COST },
});
