import { eq, inArray, isNull, or } from "drizzle-orm";
import type { SAGE_MASTERY_RANK } from "@/drizzle/constants";
import {
  SAGE_MASTERY_DAILY_ACTIVATIONS,
  SAGE_MASTERY_RANKS,
  SAGE_MASTERY_REQUIRED_EXP,
  SAGE_MODE_MAX_LEVEL,
} from "@/drizzle/constants";
import type { SageMode, UserData } from "@/drizzle/schema";
import { quest, sageMode, sageModeRolls } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/**
 * Filter sage modes eligible for rolling from items.
 */
export const filterRollableSageModes = (props: {
  sageModes: SageMode[];
  user: UserData;
  previousRolls: { sageModeId: string | null }[];
}) => {
  const { sageModes, user, previousRolls } = props;
  const previousSageModeIds = new Set(
    previousRolls.map((r) => r.sageModeId).filter((id): id is string => id !== null),
  );
  return sageModes.filter((sm) => {
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

/** Index of a mastery rank within SAGE_MASTERY_RANKS (higher = more mastery). */
export const getSageRankIndex = (rank: SAGE_MASTERY_RANK): number =>
  SAGE_MASTERY_RANKS.indexOf(rank);

/** True when userRank meets or exceeds requiredRank by SAGE_MASTERY_RANKS order. */
export const isSageRankAtLeast = (
  userRank: SAGE_MASTERY_RANK,
  requiredRank: SAGE_MASTERY_RANK,
): boolean => getSageRankIndex(userRank) >= getSageRankIndex(requiredRank);

/** All ranks at or below userRank — used for SQL `inArray` availability filtering. */
export const sageRanksAtOrBelow = (userRank: SAGE_MASTERY_RANK): SAGE_MASTERY_RANK[] =>
  SAGE_MASTERY_RANKS.slice(0, getSageRankIndex(userRank) + 1);

/**
 * Display-facing mastery rank. A ninja who has not yet attained a sage mode has no
 * mastery at all (NONE); INITIATE and above only apply once a mode is equipped. This
 * realizes the NONE tier that getSageMasteryRank reserves but never returns. Combat
 * gating (getSageDailyCap) intentionally stays on the raw experience mapping — NONE and
 * INITIATE share the same daily cap, and activation already requires an equipped mode.
 */
export const getSageMasteryDisplayRank = (
  exp: number,
  hasSageMode: boolean,
): SAGE_MASTERY_RANK => (hasSageMode ? getSageMasteryRank(exp) : "NONE");

/** Quest availability predicates shared by mission-hall and uncompleted-quest fetches. */
export const sageQuestFilters = (
  user: Pick<UserData, "sageModeId" | "sageMasteryExperience">,
) => [
  or(
    isNull(quest.requiredSageModeId),
    eq(quest.requiredSageModeId, user.sageModeId ?? ""),
  ),
  or(
    isNull(quest.requiredSageRank),
    inArray(
      quest.requiredSageRank,
      sageRanksAtOrBelow(
        getSageMasteryDisplayRank(user.sageMasteryExperience, !!user.sageModeId),
      ),
    ),
  ),
];

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
  sageMode.requiredSageMastery > 0 && exp >= sageMode.requiredSageMastery
    ? SAGE_MODE_MAX_LEVEL
    : 1;

/**
 * Fetch all sage mode rolls for a user so item and quest acquisition share one history.
 */
export const fetchSageModeRolls = async (client: DrizzleClient, userId: string) => {
  return await client.query.sageModeRolls.findMany({
    where: eq(sageModeRolls.userId, userId),
    with: { sageMode: true },
  });
};

export const fetchSageModes = async (client: DrizzleClient) => {
  return await client.query.sageMode.findMany({ where: eq(sageMode.hidden, false) });
};
