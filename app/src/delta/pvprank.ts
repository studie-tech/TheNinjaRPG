import { RANKED_ENTRY_COST } from "@/drizzle/constants";

export const getEnterRankedSeasonUserUpdate = () => ({
  userPatch: { rankedLp: 150 },
  userDelta: { villagePrestige: -RANKED_ENTRY_COST },
});
