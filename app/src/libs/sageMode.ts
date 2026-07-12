import { and, eq } from "drizzle-orm";
import type { LetterRank, SAGE_MASTERY_RANK } from "@/drizzle/constants";
import {
  SAGE_MASTERY_DAILY_ACTIVATIONS,
  SAGE_MASTERY_REQUIRED_EXP,
} from "@/drizzle/constants";
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

/**
 * Maps accumulated sage mastery experience to a mastery rank, using the shared
 * SAGE_MASTERY_REQUIRED_EXP thresholds. Floor is INITIATE (NONE is reserved for
 * "no sage mode" and shares the same cap).
 */
export const getSageMasteryRank = (exp: number): SAGE_MASTERY_RANK => {
  if (exp >= SAGE_MASTERY_REQUIRED_EXP.LEGENDARY) return "LEGENDARY";
  if (exp >= SAGE_MASTERY_REQUIRED_EXP.MASTER) return "MASTER";
  if (exp >= SAGE_MASTERY_REQUIRED_EXP.ADEPT) return "ADEPT";
  return "INITIATE";
};

/**
 * The number of sage mode activations allowed per day at the user's mastery rank.
 */
export const getSageDailyCap = (exp: number): number =>
  SAGE_MASTERY_DAILY_ACTIVATIONS[getSageMasteryRank(exp)];
