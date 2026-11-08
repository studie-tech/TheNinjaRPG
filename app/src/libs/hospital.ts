import type { MEDNIN_RANK, PoolType } from "@/drizzle/constants";
import {
  ANBU_HOSPITAL_DISCOUNT_PERC,
  HOSPITAL_BASE_HEAL_SECONDS,
  HOSPITAL_RYO_PER_100_HP,
  MEDNIN_BASE_CHAKRA_FACTOR,
  MEDNIN_CHAKRA_FACTOR_REDUCTION,
  MEDNIN_CHAKRA_REDUCTION_PER_IMPROVEMENT,
  MEDNIN_COMBAT_HEAL_PERC,
  MEDNIN_EXP_CAP,
  MEDNIN_EXP_PER_IMPROVEMENT,
  MEDNIN_HEAL_TO_EXP,
  MEDNIN_MIN_CHAKRA_FACTOR,
  MEDNIN_MIN_RANK,
  MEDNIN_REQUIRED_EXP,
} from "@/drizzle/constants";
import type { UserData, VillageStructure } from "@/drizzle/schema";
import { hasRequiredRank } from "@/libs/rank";
import { secondsFromDate } from "@/utils/time";
import { getStrucBoost } from "@/utils/village";

/**
 * Calculates the cost of healing for a user.
 * @param user - The user data.
 * @returns The cost of healing.
 */
export const calcHealCost = (user: UserData) => {
  const missingHp = Math.max(0, user.maxHealth - user.curHealth);
  let cost = (missingHp / 100) * HOSPITAL_RYO_PER_100_HP;
  if (user.anbuId) {
    cost *= 1 - ANBU_HOSPITAL_DISCOUNT_PERC / 100;
  }
  return Math.ceil(cost);
};

/** The recovery deadline, shifted to the client's clock when a time difference is supplied. */
export const calcHealFinish = (info: {
  user: Pick<UserData, "regenAt">;
  timeDiff?: number;
  boost?: number;
}) => {
  const { user, timeDiff = 0, boost = 0 } = info;
  const factor = (100 - Math.min(100, Math.max(0, boost))) / 100;
  // Apply the village bonus to the full stay so recomputing cannot move the deadline.
  return secondsFromDate(
    HOSPITAL_BASE_HEAL_SECONDS * factor + timeDiff / 1000,
    new Date(user.regenAt),
  );
};

/** Heal finish for a user whose loaded village carries its own hospital structures. */
export const calcUserHealFinish = (
  user: Pick<UserData, "regenAt"> & {
    village?: { structures?: VillageStructure[] } | null;
  },
  timeDiff?: number,
) =>
  calcHealFinish({
    user,
    timeDiff,
    boost: getStrucBoost("hospitalSpeedupPerLvl", user.village?.structures),
  });

// Minimal user type for calculating mednin things
type Healer = Pick<UserData, "medicalExperience" | "rank">;

/**
 * Calculates medical experience awarded for a hospital heal.
 *
 * Self-healing awards half the experience of healing another user. The award is a whole
 * number (the column is an integer, so flooring here keeps the reported and stored values
 * identical) and is capped by the healer's remaining medical experience capacity.
 */
export const calcHospitalHealExperience = ({
  healerId,
  targetId,
  toHeal,
  medicalExperience,
}: {
  healerId: string;
  targetId: string;
  toHeal: number;
  medicalExperience: number;
}) => {
  const experienceMultiplier = healerId === targetId ? 0.5 : 1;
  const rawExperience = Math.floor(MEDNIN_HEAL_TO_EXP * toHeal * experienceMultiplier);
  return rawExperience > 0
    ? Math.min(rawExperience, Math.max(0, MEDNIN_EXP_CAP - medicalExperience))
    : 0;
};

/**
 * Calculates the MEDNIN rank based on the healer's medical experience.
 * @param healer - The healer's user data.
 * @returns The MEDNIN rank of the healer.
 */
export const calcMedninRank = (healer?: Partial<Healer>): MEDNIN_RANK => {
  if (!healer) return "NONE";
  if (!healer.rank || !hasRequiredRank(healer.rank, MEDNIN_MIN_RANK)) return "NONE";
  const exp = healer.medicalExperience ?? 0;
  if (exp >= MEDNIN_REQUIRED_EXP.LEGENDARY) {
    return "LEGENDARY";
  } else if (exp >= MEDNIN_REQUIRED_EXP.MASTER) {
    return "MASTER";
  } else if (exp >= MEDNIN_REQUIRED_EXP.APPRENTICE) {
    return "APPRENTICE";
  }
  return "NOVICE";
};

/**
 * Calculates the healing factor for a user based on the healer's rank.
 * @param healer - The healer's user data.
 * @returns The calculated healing factor.
 */
export const calcUserHealFactor = (healer: Healer) => {
  const rank = calcMedninRank(healer);
  if (rank === "NONE") return 0;
  const factor = MEDNIN_BASE_CHAKRA_FACTOR - MEDNIN_CHAKRA_FACTOR_REDUCTION[rank];
  if (
    rank !== "LEGENDARY" ||
    healer.medicalExperience <= MEDNIN_REQUIRED_EXP.LEGENDARY
  ) {
    return factor;
  }
  // Apply progressive chakra cost reduction for experience above legendary
  const expAboveLegendary = Math.min(
    healer.medicalExperience - MEDNIN_REQUIRED_EXP.LEGENDARY,
    MEDNIN_EXP_CAP - MEDNIN_REQUIRED_EXP.LEGENDARY,
  );
  const additionalReduction =
    Math.floor(expAboveLegendary / MEDNIN_EXP_PER_IMPROVEMENT) *
    MEDNIN_CHAKRA_REDUCTION_PER_IMPROVEMENT;
  return Math.max(MEDNIN_MIN_CHAKRA_FACTOR, factor - additionalReduction);
};

/**
 * Calculates the combat heal percentage based on the healer's mednin rank.
 * @param healer - The healer's user data.
 * @returns The combat heal percentage.
 */
export const calcCombatHealPercentage = (healer?: Partial<Healer>) =>
  MEDNIN_COMBAT_HEAL_PERC[calcMedninRank(healer)];

/**
 * Calculates the pools that a mednin can heal.
 * @param healer - The healer's user data.
 * @returns The pools that a mednin can heal.
 */
export const calcMedninHealablePool = (healer?: Healer): PoolType[] =>
  calcMedninRank(healer) === "LEGENDARY" ? ["Health", "Chakra", "Stamina"] : ["Health"];

/**
 * Pools a hospital heal may restore. A heal is paid in chakra, so a self-heal never
 * restores Chakra: for a LEGENDARY healer the restore would exceed the cost and refund it.
 */
export const calcHospitalHealPools = (
  healer: Healer,
  isSelfHeal: boolean,
): PoolType[] =>
  calcMedninHealablePool(healer).filter((pool) => !isSelfHeal || pool !== "Chakra");

/**
 * Calculates the amount of health restored based on the healer's healing factor and the amount of chakra used.
 *
 * @param healer - The healer's user data.
 * @param chakra - The amount of chakra used for healing.
 * @returns The amount of health restored.
 */
export const calcChakraToPools = (healer?: Healer, chakra?: number) => {
  if (!healer || !chakra) return 0;
  const factor = calcUserHealFactor(healer);
  return chakra / factor;
};

/**
 * Calculates the chakra value based on the healer's heal factor and the health value.
 * @param healer - The healer's user data.
 * @param health - The health value to calculate the chakra from.
 * @returns The calculated chakra value.
 */
export const calcHealthToChakra = (healer: Healer, health: number) => {
  const factor = calcUserHealFactor(healer);
  return health * factor;
};

/**
 * The amount to heal: the largest share of `percentage` any of `pools` can still take.
 * @param target - The target's user data.
 * @param percentage - The percentage of each pool to heal.
 * @param pools - The pools the heal restores.
 * @returns The amount to heal.
 */
export const calcHowMuchToHeal = (
  target: UserData,
  percentage: number,
  pools: PoolType[],
) =>
  Math.max(
    ...pools.map((pool) => {
      const [max, cur] = POOL_FIELDS[pool];
      return Math.min(target[max] * (percentage / 100), target[max] - target[cur]);
    }),
  );

const POOL_FIELDS = {
  Health: ["maxHealth", "curHealth"],
  Chakra: ["maxChakra", "curChakra"],
  Stamina: ["maxStamina", "curStamina"],
} as const;

/**
 * Snaps a healing capacity down to the largest value in `thresholds` that it still covers.
 *
 * The heal buttons only ever ask whether the capacity clears a threshold, so a value snapped this
 * way answers every one of those questions identically to the raw capacity — while changing only
 * when a button actually becomes usable, instead of on every tick of the regen clock.
 */
export const snapToThresholds = (capacity: number, thresholds: number[]) =>
  thresholds.reduce(
    (best, threshold) => (threshold <= capacity && threshold > best ? threshold : best),
    0,
  );
