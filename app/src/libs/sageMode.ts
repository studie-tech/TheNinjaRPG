import { and, eq } from "drizzle-orm";
import type { LetterRank, SAGE_MASTERY_RANK } from "@/drizzle/constants";
import {
  PITY_SAGE_MODE_ROLLS,
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

/**
 * The chakra/stamina cost of activating a sage mode, as a flat amount derived from
 * the user's max pools and the mode's percentage costs. Shared by the combat
 * availability gate (so an unaffordable Activation is never offered) and the
 * activation processor (which charges the pools), so the two never disagree.
 */
export const getSageModeActivationCost = (
  sageMode: Pick<SageMode, "chakraCostPerc" | "staminaCostPerc">,
  maxChakra: number,
  maxStamina: number,
) => ({
  cpCost: Math.floor((maxChakra * sageMode.chakraCostPerc) / 100),
  spCost: Math.floor((maxStamina * sageMode.staminaCostPerc) / 100),
});

/**
 * A mode's ACTIVE level is computed, not stored: the catalog `level` column only
 * gates the roll pool. A user unlocks level 2 once their sage mastery experience
 * reaches the equipped mode's `requiredSageMastery` threshold (0 means no level-2
 * variant is defined, so it stays level 1 regardless of experience).
 */
export const getActiveSageLevel = (
  exp: number,
  sageMode: Pick<SageMode, "requiredSageMastery">,
): number =>
  sageMode.requiredSageMastery > 0 && exp >= sageMode.requiredSageMastery ? 2 : 1;

/**
 * The number of guaranteed ("pity") rolls a user has earned for a given item-roll
 * accumulator: one per PITY_SAGE_MODE_ROLLS rolls, minus any already claimed. Shared
 * by the pity-claim server check and the client's claim button so they never disagree.
 */
export const getSageModePityRolls = (roll: { pityRolls: number; used: number }) => {
  const unusedRolls = roll.used - PITY_SAGE_MODE_ROLLS * roll.pityRolls;
  return Math.floor(unusedRolls / PITY_SAGE_MODE_ROLLS);
};
