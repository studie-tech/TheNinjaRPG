import type { UserRank } from "@/drizzle/constants";
import {
  CLAN_BOOST_MAX_LEVEL,
  CLAN_BOOST_PERCENT_PER_LEVEL,
  CP_PER_LVL,
  getUserCaps,
  HomeTypeDetails,
  HP_PER_LVL,
  RANKS_RESTRICTED_FROM_PVP,
  SP_PER_LVL,
  XP_BRACKETS,
} from "@/drizzle/constants";
import type {
  Bloodline,
  Clan,
  GameSetting,
  UserData,
  Village,
  VillageStructure,
} from "@/drizzle/schema";
import { getGameSettingBoost } from "@/libs/gamesettings";
import { getReducedGainsDays } from "@/libs/train";
import { capitalizeFirstLetter } from "@/utils/sanitize";
import { getStrucBoost } from "@/utils/village";
import type { AssignableUserStats } from "@/validators/combat";

/**
 * Calculate the experience requirements for a given level
 * @param level - the level to calculate the requirements for
 * @returns the experience requirements for the given level
 */
export function calcLevelRequirements(level: number): number {
  const prevLvl = level - 1;
  const factor = level > 80 ? 950 : 500;
  const cost = factor + prevLvl * factor;
  const prevCost = prevLvl > 0 ? calcLevelRequirements(prevLvl) : 0;
  return cost + prevCost;
}

/**
 * Calculate the level for a given experience
 * @param experience - the experience to calculate the level for
 * @returns the level for the given experience
 */
export const calcLevel = (experience: number) => {
  let level = 1;
  let exp = 0;
  while (exp < experience) {
    const factor = level > 80 ? 950 : 500;
    exp += factor + level * factor;
    if (exp < experience) {
      level += 1;
    }
  }
  return Math.min(level, 100);
};

/**
 * Returns the PvP bracket number (0–7) for a given experience value and optional rank.
 * Academy students and Genin are always bracket 0 (PvP-restricted ranks).
 * Bracket 1 covers 0–500,000 XP; Bracket 7 covers 3,000,001+ XP.
 */
export const getExpBracket = (experience: number, rank?: UserRank): number => {
  if (rank && RANKS_RESTRICTED_FROM_PVP.includes(rank)) return 0;
  const xp = Math.max(0, experience);
  for (const b of XP_BRACKETS) {
    if (xp >= b.min && xp <= b.max) return b.bracket;
  }
  return XP_BRACKETS[XP_BRACKETS.length - 1]!.bracket;
};

/**
 * Whether an attacker may initiate PvP against a target based on XP brackets alone.
 * Allowed: same bracket, higher brackets, or exactly one bracket below.
 * Academy/Genin rank locks are enforced separately via RANKS_RESTRICTED_FROM_PVP.
 */
export const canAttackBracket = (
  attackerBracket: number,
  targetBracket: number,
): boolean => targetBracket >= attackerBracket - 1;

/**
 * Whether a user passes a scout/map bracket filter.
 * Matches the exact selected bracket when filterBracket >= 0;
 * use filterBracket < 0 to disable filtering entirely.
 * Unknown experience fails closed when a filter is active.
 */
export const passesBracketFilter = (
  user: { experience?: number | null; rank?: UserRank },
  filterBracket: number,
): boolean => {
  if (filterBracket < 0) return true;
  if (user.experience == null) return false;
  return getExpBracket(user.experience, user.rank) === filterBracket;
};

export const calcHP = (level: number) => {
  return 100 + HP_PER_LVL * (level - 1);
};

export const calcSP = (level: number) => {
  return 100 + SP_PER_LVL * (level - 1);
};

export const calcCP = (level: number) => {
  return 100 + CP_PER_LVL * (level - 1);
};

type CombatStatDistribution = {
  offence: number;
  defence: number;
  strength: number;
  intelligence: number;
  willpower: number;
  speed: number;
};

type MasteryDistribution = {
  ninjutsuMastery: number;
  genjutsuMastery: number;
  taijutsuMastery: number;
  bukijutsuMastery: number;
  bloodlineMastery: number;
  sageMastery: number;
};

/**
 * Cap user stats to the user's rank's caps
 * @param user - the user to cap the stats of
 * @returns void
 */
export function capUserStats(user: UserData) {
  const { stats_cap, gens_cap, mastery_cap } = getUserCaps(user.rank);
  if (user.offence > stats_cap) user.offence = stats_cap;
  if (user.defence > stats_cap) user.defence = stats_cap;
  if (user.strength > gens_cap) user.strength = gens_cap;
  if (user.speed > gens_cap) user.speed = gens_cap;
  if (user.intelligence > gens_cap) user.intelligence = gens_cap;
  if (user.willpower > gens_cap) user.willpower = gens_cap;
  if (user.ninjutsuMastery > mastery_cap) user.ninjutsuMastery = mastery_cap;
  if (user.genjutsuMastery > mastery_cap) user.genjutsuMastery = mastery_cap;
  if (user.taijutsuMastery > mastery_cap) user.taijutsuMastery = mastery_cap;
  if (user.bukijutsuMastery > mastery_cap) user.bukijutsuMastery = mastery_cap;
  if (user.bloodlineMastery > mastery_cap) user.bloodlineMastery = mastery_cap;
  if (user.sageMastery > mastery_cap) user.sageMastery = mastery_cap;
}

/**
 * Soft experience cap: one full offence, one full defence, and all 4 generals.
 * Masteries do not count toward experience.
 */
export function getSoftCappedExperience(user: UserData) {
  const { stats_cap, gens_cap } = getUserCaps(user.rank);
  return 2 * stats_cap + 4 * gens_cap;
}

/** Scale stats of user, and return total number of experience / stat points */
export function scaleUserStats(
  user: Pick<
    UserData,
    | "level"
    | "poolsMultiplier"
    | "statsMultiplier"
    | "curHealth"
    | "maxHealth"
    | "curStamina"
    | "maxStamina"
    | "curChakra"
    | "maxChakra"
    | "experience"
    | "offence"
    | "defence"
    | "ninjutsuMastery"
    | "genjutsuMastery"
    | "taijutsuMastery"
    | "bukijutsuMastery"
    | "bloodlineMastery"
    | "sageMastery"
    | "strength"
    | "intelligence"
    | "willpower"
    | "speed"
  >,
) {
  // Multipliers
  const poolMod = user.poolsMultiplier ?? 1;
  const statMod = user.statsMultiplier ?? 1;
  // Pools
  user.curHealth = calcHP(user.level) * poolMod;
  user.maxHealth = calcHP(user.level) * poolMod;
  user.curStamina = calcSP(user.level) * poolMod;
  user.maxStamina = calcSP(user.level) * poolMod;
  user.curChakra = calcCP(user.level) * poolMod;
  user.maxChakra = calcCP(user.level) * poolMod;
  // Combat stats + generals scale from experience. Masteries are scaled separately
  // so AI can use gated content, but they never contribute to experience.
  const exp = calcLevelRequirements(user.level) - 500;
  user.experience = exp;
  const combatSum = [
    user.offence ?? 0,
    user.defence ?? 0,
    user.strength ?? 0,
    user.intelligence ?? 0,
    user.willpower ?? 0,
    user.speed ?? 0,
  ].reduce((a, b) => a + b, 0);
  const calcCombatStat = (stat: keyof CombatStatDistribution) => {
    if (combatSum <= 0) return 10;
    return 10 + Math.floor(((user[stat] ?? 0) / combatSum) * exp * 100) / 100;
  };
  user.offence = calcCombatStat("offence") * statMod;
  user.defence = calcCombatStat("defence") * statMod;
  user.strength = calcCombatStat("strength") * statMod;
  user.intelligence = calcCombatStat("intelligence") * statMod;
  user.willpower = calcCombatStat("willpower") * statMod;
  user.speed = calcCombatStat("speed") * statMod;

  const masterySum = [
    user.ninjutsuMastery ?? 0,
    user.genjutsuMastery ?? 0,
    user.taijutsuMastery ?? 0,
    user.bukijutsuMastery ?? 0,
    user.bloodlineMastery ?? 0,
    user.sageMastery ?? 0,
  ].reduce((a, b) => a + b, 0);
  const calcMastery = (stat: keyof MasteryDistribution) => {
    if (masterySum <= 0) return 10;
    return 10 + Math.floor(((user[stat] ?? 0) / masterySum) * exp * 100) / 100;
  };
  user.ninjutsuMastery = calcMastery("ninjutsuMastery") * statMod;
  user.genjutsuMastery = calcMastery("genjutsuMastery") * statMod;
  user.taijutsuMastery = calcMastery("taijutsuMastery") * statMod;
  user.bukijutsuMastery = calcMastery("bukijutsuMastery") * statMod;
  user.bloodlineMastery = calcMastery("bloodlineMastery") * statMod;
  user.sageMastery = calcMastery("sageMastery") * statMod;
}

const roundCombatStat = (stat: number) => Math.round(stat * 100) / 100;

/** Sum of the six redistributable combat stats (offence, defence, generals). */
export const getAssignedCombatStatTotal = (
  user: Pick<
    UserData,
    "offence" | "defence" | "strength" | "speed" | "intelligence" | "willpower"
  >,
) =>
  roundCombatStat(user.offence) +
  roundCombatStat(user.defence) +
  roundCombatStat(user.strength) +
  roundCombatStat(user.speed) +
  roundCombatStat(user.intelligence) +
  roundCombatStat(user.willpower);

/** Assign stats of user, meant for the training dummy and ranked equalization */
export function manuallyAssignUserStats(user: UserData, stats: AssignableUserStats) {
  user.offence = stats.offence;
  user.defence = stats.defence;
  user.strength = stats.strength;
  user.intelligence = stats.intelligence;
  user.willpower = stats.willpower;
  user.speed = stats.speed;
  if (stats.ninjutsuMastery != null) user.ninjutsuMastery = stats.ninjutsuMastery;
  if (stats.genjutsuMastery != null) user.genjutsuMastery = stats.genjutsuMastery;
  if (stats.taijutsuMastery != null) user.taijutsuMastery = stats.taijutsuMastery;
  if (stats.bukijutsuMastery != null) user.bukijutsuMastery = stats.bukijutsuMastery;
  if (stats.bloodlineMastery != null) user.bloodlineMastery = stats.bloodlineMastery;
  if (stats.sageMastery != null) user.sageMastery = stats.sageMastery;
}

export const activityStreakRewards = (streak: number) => {
  const rewards = {
    money: streak * 100,
    reputationPoints: 0,
    jobExperience: 0,
    reskinSlot: 0,
  };
  if (streak % 10 === 0) {
    rewards.reputationPoints = Math.floor(streak / 10);
  }
  if (streak % 7 === 0) {
    rewards.jobExperience = 350;
  }
  if (streak % 60 === 0) {
    rewards.reskinSlot = 1;
  }
  return rewards;
};

export const showUserRank = (user?: { rank?: UserRank; isOutlaw?: boolean }) => {
  if (!user || !user.rank) return "Unknown";
  if (user.isOutlaw) {
    switch (user.rank) {
      case "CHUNIN":
        return "Lower Outlaw";
      case "JONIN":
        return "Higher Outlaw";
      case "ELITE JONIN":
        return "Warlord";
      case "ELDER":
        return "Outlaw Council";
    }
  } else if (user.rank === "ELITE JONIN") {
    return "Elite Jonin";
  }
  return capitalizeFirstLetter(user.rank);
};

// Calculate user stats
export const calcActiveUserRegen = (
  user: UserData & {
    clan?: Clan | null;
    bloodline?: Bloodline | null;
    village?: (Village & { structures?: VillageStructure[] }) | null;
  },
  settings: GameSetting[],
) => {
  let regeneration = user.regeneration;

  // Add home regeneration bonus when asleep
  if (user.status === "ASLEEP" && user.homeType !== "NONE") {
    regeneration += HomeTypeDetails[user.homeType].regen;
  }

  // // Bloodline
  if (user.bloodline?.regenIncrease) {
    regeneration = regeneration + user.bloodline.regenIncrease;
  }

  // Clan boost (in percentage) - only apply for real clans, not outlaw factions/towns
  const maxRegenBoost = CLAN_BOOST_MAX_LEVEL * CLAN_BOOST_PERCENT_PER_LEVEL;
  if (
    !user.isOutlaw &&
    user.clan?.regenBoost &&
    user.clan?.regenBoost > 0 &&
    user.clan?.regenBoost <= maxRegenBoost
  ) {
    regeneration *= (100 + user.clan.regenBoost) / 100;
  }

  // // Calculate percentage boost
  let boost = getStrucBoost("regenIncreasePerLvl", user?.village?.structures);
  if (user.status === "ASLEEP") {
    boost += getStrucBoost("sleepRegenPerLvl", user.village?.structures);
  }
  regeneration *= (100 + boost) / 100;

  // Reduce regen if just joined village
  const reducedDays = getReducedGainsDays(user);
  if (reducedDays > 0) {
    regeneration *= 0.5;
  }

  // Increase by event
  const setting = getGameSettingBoost("regenGainMultiplier", settings);
  const gameFactor = setting?.value || 1;
  regeneration *= gameFactor;

  // Increase by wartime winnings
  const warSetting = getGameSettingBoost(`war-${user.village?.id}-regen`, settings);
  const warFactor = warSetting?.value || 0;
  regeneration *= (100 + warFactor) / 100;

  return regeneration;
};
