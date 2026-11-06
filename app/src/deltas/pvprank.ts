import { RANKED_ENTRY_COST } from "@/drizzle/constants";

/** Publish queue admission when ranked selection cleanup did not change cached equipment/loadouts. */
export const getRankedQueueUserUpdate = (changedSelections: boolean) => ({
  userPatch: changedSelections ? undefined : { status: "QUEUED" as const },
});

/** Set the ranked season's starting LP and debit the configured village-prestige entry cost. */
export const getEnterRankedSeasonUserUpdate = () => ({
  userPatch: { rankedLp: 150 },
  userDelta: { villagePrestige: -RANKED_ENTRY_COST },
});
