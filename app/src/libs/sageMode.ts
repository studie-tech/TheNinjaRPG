import { eq, inArray, isNull, or } from "drizzle-orm";
import type { SAGE_MASTERY_RANK } from "@/drizzle/constants";
import {
  IMG_MANUAL_SAGE_MODE,
  SAGE_MASTERY_DAILY_ACTIVATIONS,
  SAGE_MASTERY_RANKS,
  SAGE_MASTERY_REQUIRED_EXP,
  SAGE_MODE_ACTIVATION_JUTSU_ID,
  SAGE_MODE_DEFAULT_ACTION_COST_PERC,
  SAGE_MODE_DEFAULT_ACTIVATION_MESSAGE,
  SAGE_MODE_MAX_LEVEL,
} from "@/drizzle/constants";
import type { Jutsu, SageMode, UserData } from "@/drizzle/schema";
import { quest, sageMode, sageModeRolls } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import type { ZodAllTags } from "@/validators/combat";

/**
 * Item-roll pool: visible, village-compatible, level-1 modes the user has never rolled.
 * Catalog `level` is a roll-pool gate only; combat level 2 is `requiredSageMastery`.
 *
 * @param props.sageModes - Catalog rows to filter (typically all non-hidden modes).
 * @param props.user - Village and identity used for village-locked modes.
 * @param props.previousRolls - `SageModeRolls` history; any prior id is excluded.
 * @returns Modes that may be granted by a `rollsagemode` item.
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
 * Maps accumulated sage mastery experience to a mastery rank via
 * `SAGE_MASTERY_REQUIRED_EXP`. Floor is INITIATE — NONE is reserved for
 * "no sage mode equipped" and shares INITIATE's daily cap.
 *
 * @param exp - `userData.sageMasteryExperience`.
 * @returns Rank used for daily-cap lookup; never `NONE`.
 */
export const getSageMasteryRank = (exp: number): SAGE_MASTERY_RANK => {
  if (exp >= SAGE_MASTERY_REQUIRED_EXP.LEGENDARY) return "LEGENDARY";
  if (exp >= SAGE_MASTERY_REQUIRED_EXP.MASTER) return "MASTER";
  if (exp >= SAGE_MASTERY_REQUIRED_EXP.ADEPT) return "ADEPT";
  return "INITIATE";
};

/**
 * Ordinal of a mastery rank in `SAGE_MASTERY_RANKS` (higher = more mastery).
 *
 * @param rank - Rank to locate.
 * @returns Index, or `-1` if the rank is unknown.
 */
export const getSageRankIndex = (rank: SAGE_MASTERY_RANK): number =>
  SAGE_MASTERY_RANKS.indexOf(rank);

/**
 * Whether `userRank` meets or exceeds `requiredRank` on the mastery ladder.
 *
 * @param userRank - Player's current display or computed rank.
 * @param requiredRank - Quest or content minimum.
 */
export const isSageRankAtLeast = (
  userRank: SAGE_MASTERY_RANK,
  requiredRank: SAGE_MASTERY_RANK,
): boolean => getSageRankIndex(userRank) >= getSageRankIndex(requiredRank);

/**
 * Inclusive rank prefix for SQL `inArray` quest availability
 * (`requiredSageRank` is a minimum, so every rank at or below the user qualifies).
 *
 * @param userRank - Player's current display rank.
 */
export const sageRanksAtOrBelow = (userRank: SAGE_MASTERY_RANK): SAGE_MASTERY_RANK[] =>
  SAGE_MASTERY_RANKS.slice(0, getSageRankIndex(userRank) + 1);

/**
 * Profile / quest display rank. Unequipped players are `NONE`; INITIATE+ only apply
 * once a mode is worn. Combat daily-cap (`getSageDailyCap`) stays on the raw
 * experience mapping because NONE and INITIATE share a cap and activation already
 * requires an equipped mode.
 *
 * @param exp - `userData.sageMasteryExperience`.
 * @param hasSageMode - Whether `userData.sageModeId` is set.
 */
export const getSageMasteryDisplayRank = (
  exp: number,
  hasSageMode: boolean,
): SAGE_MASTERY_RANK => (hasSageMode ? getSageMasteryRank(exp) : "NONE");

/**
 * SQL predicates shared by mission-hall and uncompleted-quest fetches: exact
 * `requiredSageModeId` (or unset) and minimum `requiredSageRank` (or unset).
 *
 * @param user - Equipped mode and mastery experience from the questing player.
 */
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
 * Daily activation allowance at the user's experience-mapped rank
 * (`SAGE_MASTERY_DAILY_ACTIVATIONS`). NONE and INITIATE share the same cap.
 *
 * @param exp - `userData.sageMasteryExperience` (or the battle-state copy).
 */
export const getSageDailyCap = (exp: number): number =>
  SAGE_MASTERY_DAILY_ACTIVATIONS[getSageMasteryRank(exp)];

/**
 * Flat chakra/stamina cost of activating a mode, from max pools and the mode's
 * percentage costs. Shared by the offer gate (`handleInjectedJutsus`) and
 * `applyActivateSageMode` so an unaffordable Activation is never offered and
 * the charge never disagrees with that gate.
 *
 * @param sageMode - Equipped mode's `chakraCostPerc` / `staminaCostPerc`.
 * @param maxChakra - Actor's current max chakra.
 * @param maxStamina - Actor's current max stamina.
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
 * Combat level of the equipped mode. Catalog `level` only gates the roll pool;
 * level 2 unlocks when mastery experience meets `requiredSageMastery` (0 = no
 * Tier 2, stays 1 regardless of experience).
 *
 * @param exp - Actor's `sageMasteryExperience`.
 * @param sageMode - Equipped catalog row (threshold only).
 * @returns `1` or `SAGE_MODE_MAX_LEVEL` (2).
 */
export const getActiveSageLevel = (
  exp: number,
  sageMode: Pick<SageMode, "requiredSageMastery">,
): number =>
  sageMode.requiredSageMastery > 0 && exp >= sageMode.requiredSageMastery
    ? SAGE_MODE_MAX_LEVEL
    : 1;

/**
 * Item and quest acquisition share this history so a mode cannot be rolled twice.
 *
 * @param client - Drizzle client.
 * @param userId - Player whose `SageModeRolls` rows to load.
 */
export const fetchSageModeRolls = async (client: DrizzleClient, userId: string) => {
  return await client.query.sageModeRolls.findMany({
    where: eq(sageModeRolls.userId, userId),
    with: { sageMode: true },
  });
};

/**
 * Visible catalog rows for item-roll pooling. Hidden modes are staff-only and
 * are never granted by `rollsagemode`.
 *
 * @param client - Drizzle client.
 */
export const fetchSageModes = async (client: DrizzleClient) => {
  return await client.query.sageMode.findMany({ where: eq(sageMode.hidden, false) });
};

/**
 * Synthetic jutsu stuffed into `extraState.jutsus` at battle start. Combat only
 * knows how to offer jutsu/item/basic actions, so Activation is a jutsu-shaped
 * trigger whose sole effect is `activatesagemode`. No `Jutsu` row is seeded —
 * staff cannot author that tag, and the real costs/effects live on `SageMode`.
 *
 * Image, AP cost, and battle description are overwritten from the equipped mode
 * when the action list is built. Pool costs on this object stay 0; CP/SP are
 * charged from the mode in `applyActivateSageMode`.
 */
export const SAGE_MODE_ACTIVATION_JUTSU: Jutsu = {
  id: SAGE_MODE_ACTIVATION_JUTSU_ID,
  name: "Activation",
  description:
    "Channel natural energy to enter sage mode. Activation costs and combat effects are defined on your sage mode.",
  createdAt: new Date(0),
  updatedAt: new Date(0),
  extraBaseCost: 0,
  effects: [
    {
      type: "activatesagemode",
      description: "Enter sage mode",
      target: "SELF",
      direction: "offence",
      calculation: "static",
      power: 1,
      powerPerLevel: 0,
      rounds: 0,
      staticAssetPath: "",
      staticAnimation: "",
      appearAnimation: "",
      disappearAnimation: "",
      appearSfx: "",
      disappearSfx: "",
    } satisfies ZodAllTags,
  ],
  target: "SELF",
  range: 0,
  cooldown: 0,
  bloodlineId: null,
  requiredSkillId: null,
  requiredLevel: 1,
  requiredRank: "STUDENT",
  jutsuType: "SPECIAL",
  image: IMG_MANUAL_SAGE_MODE,
  jutsuWeapon: "NONE",
  statClassification: "Ninjutsu",
  battleDescription: SAGE_MODE_DEFAULT_ACTIVATION_MESSAGE,
  jutsuRank: "D",
  actionCostPerc: SAGE_MODE_DEFAULT_ACTION_COST_PERC,
  staminaCost: 0,
  chakraCost: 0,
  staminaCostReducePerLvl: 0,
  chakraCostReducePerLvl: 0,
  healthCostReducePerLvl: 0,
  healthCost: 0,
  villageId: null,
  method: "SINGLE",
  hidden: true,
  injectableInBattle: true,
  battleUsageType: "BOTH",
  parentJutsuId: null,
  requiredNinjutsuOffence: null,
  requiredNinjutsuDefence: null,
  requiredGenjutsuOffence: null,
  requiredGenjutsuDefence: null,
  requiredTaijutsuOffence: null,
  requiredTaijutsuDefence: null,
  requiredBukijutsuOffence: null,
  requiredBukijutsuDefence: null,
  requiredStrength: null,
  requiredSpeed: null,
  requiredIntelligence: null,
  requiredWillpower: null,
  requiredBloodlineItemId: null,
};
