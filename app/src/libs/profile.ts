import type {
  UserData,
  Bloodline,
  Village,
  VillageStructure,
  GameSetting,
  Clan,
} from "@/drizzle/schema";
import { USER_CAPS, HP_PER_LVL, SP_PER_LVL, CP_PER_LVL } from "@/drizzle/constants";
import { CLAN_MAX_REGEN_BOOST } from "@/drizzle/constants";
import { capitalizeFirstLetter } from "@/utils/sanitize";
import { getStrucBoost } from "@/utils/village";
import { getReducedGainsDays } from "@/libs/train";
import { getGameSettingBoost } from "@/libs/gamesettings";
import { HomeTypeDetails } from "@/drizzle/constants";
import type { UserRank } from "@/drizzle/constants";
import type { StatSchemaType } from "./combat/types";

export function calcLevelRequirements(level: number): number {
  const prevLvl = level - 1;
  const factor = level > 80 ? 950 : 500;
  const cost = factor + prevLvl * factor;
  const prevCost = prevLvl > 0 ? calcLevelRequirements(prevLvl) : 0;
  return cost + prevCost;
}

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

export const calcHP = (level: number) => {
  return 100 + HP_PER_LVL * (level - 1);
};

export const calcSP = (level: number) => {
  return 100 + SP_PER_LVL * (level - 1);
};

export const calcCP = (level: number) => {
  return 100 + CP_PER_LVL * (level - 1);
};

type StatDistribution = {
  ninjutsuOffence: number;
  ninjutsuDefence: number;
  genjutsuOffence: number;
  genjutsuDefence: number;
  taijutsuOffence: number;
  taijutsuDefence: number;
  bukijutsuOffence: number;
  bukijutsuDefence: number;
  strength: number;
  intelligence: number;
  willpower: number;
  speed: number;
};

/**
 * Cap user stats to the user's rank's caps
 * @param user - the user to cap the stats of
 * @returns void
 */
export function capUserStats(user: UserData) {
  const stats_cap = USER_CAPS[user.rank].STATS_CAP;
  const gens_cap = USER_CAPS[user.rank].GENS_CAP;
  if (user.ninjutsuOffence > stats_cap) user.ninjutsuOffence = stats_cap;
  if (user.genjutsuOffence > stats_cap) user.genjutsuOffence = stats_cap;
  if (user.taijutsuOffence > stats_cap) user.taijutsuOffence = stats_cap;
  if (user.bukijutsuOffence > stats_cap) user.bukijutsuOffence = stats_cap;
  if (user.ninjutsuDefence > stats_cap) user.ninjutsuDefence = stats_cap;
  if (user.genjutsuDefence > stats_cap) user.genjutsuDefence = stats_cap;
  if (user.taijutsuDefence > stats_cap) user.taijutsuDefence = stats_cap;
  if (user.bukijutsuDefence > stats_cap) user.bukijutsuDefence = stats_cap;
  if (user.strength > gens_cap) user.strength = gens_cap;
  if (user.speed > gens_cap) user.speed = gens_cap;
  if (user.intelligence > gens_cap) user.intelligence = gens_cap;
  if (user.willpower > gens_cap) user.willpower = gens_cap;
}

/**
 * The purpose of this function is to calculate the user experience, capped at the soft experience cap
 * i.e. the point where the user has one full offence, all 4 defences, and all 4 generals.
 * @param user
 * @returns
 */
export function getSoftCappedExperience(user: UserData) {
  const stats_cap = USER_CAPS[user.rank].STATS_CAP;
  const gens_cap = USER_CAPS[user.rank].GENS_CAP;
  return 5 * stats_cap + 4 * gens_cap;
}

/** Scale stats of user, and return total number of experience / stat points */
export function scaleUserStats(user: UserData) {
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
  // Stats
  const exp = calcLevelRequirements(user.level) - 500;
  user.experience = exp;
  const sum = [
    user.ninjutsuOffence ?? 0,
    user.ninjutsuDefence ?? 0,
    user.genjutsuOffence ?? 0,
    user.genjutsuDefence ?? 0,
    user.taijutsuOffence ?? 0,
    user.taijutsuDefence ?? 0,
    user.bukijutsuOffence ?? 0,
    user.bukijutsuDefence ?? 0,
    user.strength ?? 0,
    user.intelligence ?? 0,
    user.willpower ?? 0,
    user.speed ?? 0,
  ].reduce((a, b) => a + b, 0);
  const calcStat = (stat: keyof StatDistribution) => {
    return 10 + Math.floor(((user[stat] ?? 0) / sum) * exp * 100) / 100;
  };
  user.ninjutsuOffence = calcStat("ninjutsuOffence") * statMod;
  user.ninjutsuDefence = calcStat("ninjutsuDefence") * statMod;
  user.genjutsuOffence = calcStat("genjutsuOffence") * statMod;
  user.genjutsuDefence = calcStat("genjutsuDefence") * statMod;
  user.taijutsuOffence = calcStat("taijutsuOffence") * statMod;
  user.taijutsuDefence = calcStat("taijutsuDefence") * statMod;
  user.bukijutsuOffence = calcStat("bukijutsuOffence") * statMod;
  user.bukijutsuDefence = calcStat("bukijutsuDefence") * statMod;
  user.strength = calcStat("strength") * statMod;
  user.intelligence = calcStat("intelligence") * statMod;
  user.willpower = calcStat("willpower") * statMod;
  user.speed = calcStat("speed") * statMod;
}

/** Assign stats of user, meant for the training dummy */
export function manuallyAssignUserStats(user: UserData, stats: StatSchemaType) {
  // Stats
  user.ninjutsuOffence = stats.ninjutsuOffence;
  user.ninjutsuDefence = stats.ninjutsuDefence;
  user.genjutsuOffence = stats.genjutsuOffence;
  user.genjutsuDefence = stats.genjutsuDefence;
  user.taijutsuOffence = stats.taijutsuOffence;
  user.taijutsuDefence = stats.taijutsuDefence;
  user.bukijutsuOffence = stats.bukijutsuOffence;
  user.bukijutsuDefence = stats.bukijutsuDefence;
  user.strength = stats.strength;
  user.intelligence = stats.intelligence;
  user.willpower = stats.willpower;
  user.speed = stats.speed;
}

export const activityStreakRewards = (streak: number) => {
  const rewards = { money: streak * 100, reputationPoints: 0, jobExperience: 0, reskinSlot: 0 };
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

  // Clan boost (in percentage)
  if (
    user.clan?.regenBoost &&
    user.clan?.regenBoost > 0 &&
    user.clan?.regenBoost <= CLAN_MAX_REGEN_BOOST
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
