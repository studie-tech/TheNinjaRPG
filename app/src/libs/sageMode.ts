import { and, eq } from "drizzle-orm";
import type { LetterRank } from "@/drizzle/constants";
import type { SageMode, UserData } from "@/drizzle/schema";
import { sageMode, sageModeRolls } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/**
 * Fetch item-based sage mode rolls (pity / black market tracking).
 */
export const fetchItemSageModeRolls = async (client: DrizzleClient, userId: string) => {
  return await client.query.sageModeRolls.findMany({
    where: and(eq(sageModeRolls.userId, userId), eq(sageModeRolls.type, "ITEM")),
    with: { sageMode: true },
  });
};

export const fetchSageModes = async (client: DrizzleClient) => {
  return await client.query.sageMode.findMany({ where: eq(sageMode.hidden, false) });
};

/**
 * Filter sage modes eligible for rolling (natural, item, pity).
 */
export const filterRollableSageModes = (props: {
  sageModes: SageMode[];
  user: UserData;
  previousRolls: { sageModeId: string | null }[];
  rank?: LetterRank | null;
}) => {
  const { sageModes, user, previousRolls, rank } = props;
  const previousSageModeIds = new Set(
    previousRolls.map((r) => r.sageModeId).filter((id): id is string => id !== null),
  );
  return sageModes.filter((sm) => {
    if (rank && sm.rank !== rank) return false;
    if (sm.hidden) return false;
    if (sm.villageId && sm.villageId !== user.villageId) return false;
    if (previousSageModeIds.has(sm.id)) return false;
    if (sm.level !== 1) return false;
    return true;
  });
};
