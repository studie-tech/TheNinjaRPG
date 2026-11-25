import { RANKED_ENTRY_COST, RANKED_ENTRY_LP } from "@/drizzle/constants";

/** Publish queue admission when ranked selection cleanup did not change cached equipment/loadouts. */
export const getRankedQueueUserUpdate = (changedSelections: boolean) => ({
  userPatch: changedSelections ? undefined : { status: "QUEUED" as const },
});

/** Publish the ranked exit only when its guarded wake confirmed the resulting status. */
export const getLeaveRankedQueueUserUpdate = (hasWoken: boolean) => ({
  userPatch: hasWoken ? { status: "AWAKE" as const } : undefined,
});

/** Set the ranked season's starting LP and debit the configured village-prestige entry cost. */
export const getEnterRankedSeasonUserUpdate = () => ({
  userPatch: { rankedLp: RANKED_ENTRY_LP },
  userDelta: { villagePrestige: -RANKED_ENTRY_COST },
});
