import type { CombatStatName, MasteryName, UserRank } from "@/drizzle/constants";
import {
  AI_MAX_HEALTH,
  BasicElementName,
  CLAN_BOOST_MAX_LEVEL,
  CLAN_BOOST_PERCENT_PER_LEVEL,
  CombatStatNames,
  CP_PER_LVL,
  ELITE_JONIN_BRACKET,
  ENERGY_PER_LVL,
  getUserCaps,
  HomeTypeDetails,
  HP_PER_LVL,
  MAX_EXPERIENCE_LEVEL,
  MAX_MASTERY_CAP,
  MasteryNames,
  PLAYER_LEVEL_XP_BASE_FACTOR,
  PLAYER_LEVEL_XP_HIGH_FACTOR,
  PLAYER_LEVEL_XP_HIGH_THRESHOLD,
  RANKS_RESTRICTED_FROM_PVP,
  SCALED_AI_STAT_BUDGET_SHARE,
  SP_PER_LVL,
  XP_BRACKETS,
} from "@/drizzle/constants";
import type {
  Bloodline,
  Clan,
  GameSetting,
  UserData,
  UserTitle,
  Village,
  VillageStructure,
} from "@/drizzle/schema";
import {
  type ElementalMasterySource,
  elementalGainRoom,
} from "@/libs/elementalMastery";
import { getGameSettingBoost } from "@/libs/gameSettingBoost";
import {
  gearMissingMastery,
  isActiveWornGear,
  type MasteryBuffUser,
  wornGearTags,
} from "@/libs/mastery";
import { masteryGainRoom } from "@/libs/masteryProgression";
import { getPvpBoost } from "@/libs/pvpExperience";
import type { SectorUser } from "@/libs/sector-map/world-types";
import { hasRequiredSkill } from "@/libs/skillRequirements";
import { getTimedRegeneration, type TimedBuff } from "@/libs/timedBuffs";
import { regenerationBuffs } from "@/libs/titles";
import { getReducedGainsDays } from "@/libs/train";
import { getVillageLoyaltyBonuses, percentageMultiplier } from "@/libs/villageLoyalty";
import { capitalizeFirstLetter } from "@/utils/string";
import { getStrucBoost } from "@/utils/village";
import type { AssignableUserStats } from "@/validators/combat";
import { assignableMasteryNames } from "@/validators/user";

/**
 * Calculate the experience requirements for a given level
 * @param level - the level to calculate the requirements for
 * @returns the experience requirements for the given level
 */
export function calcLevelRequirements(level: number): number {
  const prevLvl = level - 1;
  const factor =
    level > PLAYER_LEVEL_XP_HIGH_THRESHOLD
      ? PLAYER_LEVEL_XP_HIGH_FACTOR
      : PLAYER_LEVEL_XP_BASE_FACTOR;
  const cost = factor + prevLvl * factor;
  const prevCost = prevLvl > 0 ? calcLevelRequirements(prevLvl) : 0;
  return cost + prevCost;
}

/** Rank and village progression gates shared by the level-up action and its previews. */
export const levelUpBlockMessage = (
  user: Pick<UserData, "rank" | "level" | "experience"> & {
    village?: Pick<Village, "name"> | null;
  },
): string | null => {
  if (user.level >= getUserCaps(user.rank).lvl_cap)
    return "User at max level for this rank!";
  if (user.rank === "ELITE JONIN")
    return "Complete an Elite Jonin milestone at the academy to level up. Assigned experience cannot increase your level.";
  if (user.experience < calcLevelRequirements(user.level))
    return "Not enough experience for level";
  if (user.village?.name === "Horizon" && user.level > 9) {
    return "Horizon users cannot level beyond level 9. To progress, go to the academy to take a quest for joining one of the main villages.";
  }
  return null;
};

/**
 * Calculate the level for a given experience
 * @param experience - the experience to calculate the level for
 * @returns The XP-derived level, capped at MAX_EXPERIENCE_LEVEL.
 */
export const calcLevel = (experience: number) => {
  let level = 1;
  let exp = 0;
  while (exp < experience) {
    const factor =
      level > PLAYER_LEVEL_XP_HIGH_THRESHOLD
        ? PLAYER_LEVEL_XP_HIGH_FACTOR
        : PLAYER_LEVEL_XP_BASE_FACTOR;
    exp += factor + level * factor;
    if (exp < experience) {
      level += 1;
    }
  }
  return Math.min(level, MAX_EXPERIENCE_LEVEL);
};

/** Elite Jonin levels come from milestones; XP still prevents level holding for other ranks. */
export const getEffectiveLevel = (user: {
  level: number;
  experience: number;
  rank: UserRank;
}) => (user.rank === "ELITE JONIN" ? user.level : calcLevel(user.experience));

/** Exams require all six stored combat stats at the Jonin caps, without equipment bonuses. */
export const eliteJoninExamBlockMessage = (
  user: Pick<
    UserData,
    | "rank"
    | "level"
    | "offence"
    | "defence"
    | "strength"
    | "speed"
    | "intelligence"
    | "willpower"
  >,
): string | null => {
  if (user.rank !== "JONIN" || user.level !== MAX_EXPERIENCE_LEVEL)
    return `The Elite Jonin exam requires level ${MAX_EXPERIENCE_LEVEL} and Jonin rank.`;
  const caps = getUserCaps("JONIN");
  if (
    user.offence < caps.stats_cap ||
    user.defence < caps.stats_cap ||
    [user.strength, user.speed, user.intelligence, user.willpower].some(
      (value) => value < caps.gens_cap,
    )
  )
    return "Cap your offence, defence and all four generals before taking the Elite Jonin exam.";
  return null;
};

/**
 * Returns the PvP bracket number (0–8) for a given experience value and optional rank.
 * Academy students and Genin are always bracket 0 (PvP-restricted ranks).
 * Bracket 1 covers 0–500,000 XP; Bracket 7 covers 3,000,001+ XP. Elite Jonin always use 8.
 */
export const getExpBracket = (experience: number, rank?: UserRank): number => {
  if (rank === "ELITE JONIN") return ELITE_JONIN_BRACKET;
  if (rank && RANKS_RESTRICTED_FROM_PVP.includes(rank)) return 0;
  const xp = Math.max(0, experience);
  for (const b of XP_BRACKETS) {
    if (xp >= b.min && xp <= b.max) return b.bracket;
  }
  return XP_BRACKETS.at(-1)?.bracket ?? 0;
};

/**
 * Whether an attacker may initiate PvP against a target based on combat brackets.
 * Allowed: same bracket, higher brackets, or exactly one bracket below.
 * Elite Jonin pairs require brackets 7–8. Academy/Genin locks are enforced separately.
 */
export const canAttackBracket = (
  attackerBracket: number,
  targetBracket: number,
): boolean =>
  attackerBracket === ELITE_JONIN_BRACKET || targetBracket === ELITE_JONIN_BRACKET
    ? Math.min(attackerBracket, targetBracket) >= ELITE_JONIN_BRACKET - 1
    : targetBracket >= attackerBracket - 1;

/**
 * Whether a user passes a scout/map bracket filter.
 * Matches the exact selected bracket when filterBracket >= 0;
 * use filterBracket < 0 to disable filtering entirely.
 * Unknown XP fails closed unless Elite rank already determines the bracket.
 */
export const passesBracketFilter = (
  user: { experience?: number | null; rank?: UserRank },
  filterBracket: number,
): boolean => {
  if (filterBracket < 0) return true;
  if (user.rank === "ELITE JONIN") return filterBracket === ELITE_JONIN_BRACKET;
  if (user.experience == null) return false;
  return getExpBracket(user.experience, user.rank) === filterBracket;
};

/** Awake players in the selected bracket, ordered by displayed level then name. */
export const getScoutingUsers = <
  T extends Pick<
    SectorUser,
    "userId" | "username" | "level" | "experience" | "rank" | "status" | "isNpc"
  >,
>(
  users: readonly T[],
  currentUserId: string,
  filterBracket: number,
) =>
  users
    .filter(
      (user) =>
        !user.isNpc &&
        user.userId !== currentUserId &&
        user.status === "AWAKE" &&
        passesBracketFilter(user, filterBracket),
    )
    .sort((a, b) => {
      // Partial map updates can omit XP; keep unknown levels after known levels.
      const aLevel =
        a.rank === "ELITE JONIN"
          ? a.level
          : a.experience == null
            ? Infinity
            : calcLevel(a.experience);
      const bLevel =
        b.rank === "ELITE JONIN"
          ? b.level
          : b.experience == null
            ? Infinity
            : calcLevel(b.experience);
      return aLevel - bLevel || a.username.localeCompare(b.username);
    });

export const calcHP = (level: number) => {
  return 100 + HP_PER_LVL * (level - 1);
};

export const calcSP = (level: number) => {
  return 100 + SP_PER_LVL * (level - 1);
};

export const calcCP = (level: number) => {
  return 100 + CP_PER_LVL * (level - 1);
};

export const calcEnergy = (level: number) => 100 + ENERGY_PER_LVL * (level - 1);

/** Copy of the user with stats capped to its rank; the original stays untouched */
export const withCappedStats = <T extends UserData>(user: T): T => {
  const capped = { ...user };
  capUserStats(capped);
  return capped;
};

/**
 * Clamp an in-memory user's combat stats to the character rank and masteries to the
 * individual maximum. Mastery rank and shared-total caps restrict earned gains only;
 * callers must not persist this display/battle copy over stored mastery entitlement.
 * @param user - the user to cap the stats of
 * @param rank - the rank whose caps apply, the user's own by default
 * @returns void
 */
export function capUserStats(user: UserData, rank: UserRank = user.rank) {
  const { stats_cap, gens_cap } = getUserCaps(rank);
  if (user.offence > stats_cap) user.offence = stats_cap;
  if (user.defence > stats_cap) user.defence = stats_cap;
  if (user.strength > gens_cap) user.strength = gens_cap;
  if (user.speed > gens_cap) user.speed = gens_cap;
  if (user.intelligence > gens_cap) user.intelligence = gens_cap;
  if (user.willpower > gens_cap) user.willpower = gens_cap;
  if (user.ninjutsuMastery > MAX_MASTERY_CAP) user.ninjutsuMastery = MAX_MASTERY_CAP;
  if (user.genjutsuMastery > MAX_MASTERY_CAP) user.genjutsuMastery = MAX_MASTERY_CAP;
  if (user.taijutsuMastery > MAX_MASTERY_CAP) user.taijutsuMastery = MAX_MASTERY_CAP;
  if (user.bukijutsuMastery > MAX_MASTERY_CAP) user.bukijutsuMastery = MAX_MASTERY_CAP;
  if (user.bloodlineMastery > MAX_MASTERY_CAP) user.bloodlineMastery = MAX_MASTERY_CAP;
  if (user.sageMastery > MAX_MASTERY_CAP) user.sageMastery = MAX_MASTERY_CAP;
}

/** Largest value the UserData chakra and stamina columns can store. */
export const MAX_STORED_POOL = 65_535;

/** Highest pools multiplier whose HP, CP and SP at this level still fit the pool columns. */
export const maxPoolsMultiplier = (level: number) =>
  Math.floor(MAX_STORED_POOL / Math.max(calcHP(level), calcCP(level), calcSP(level)));

/** Cap pools to what the UserData columns can store, so saving the row cannot overflow. */
export const clampStoredPools = (
  user: Pick<
    UserData,
    "curHealth" | "maxHealth" | "curStamina" | "maxStamina" | "curChakra" | "maxChakra"
  >,
) => {
  user.curHealth = Math.min(user.curHealth, AI_MAX_HEALTH);
  user.maxHealth = Math.min(user.maxHealth, AI_MAX_HEALTH);
  user.curStamina = Math.min(user.curStamina, MAX_STORED_POOL);
  user.maxStamina = Math.min(user.maxStamina, MAX_STORED_POOL);
  user.curChakra = Math.min(user.curChakra, MAX_STORED_POOL);
  user.maxChakra = Math.min(user.maxChakra, MAX_STORED_POOL);
};

/** Which scale a unit's stored stats are on; see scaleUserStats. */
export type StatScale = "ai" | "player";

/**
 * Scale pools, combat stats and masteries to the user's level. Each stat's points above
 * the base 10 scale by `share * levelBudget / (share * experience + points beyond
 * experience)`: stats the experience paid for stay exact at their own level however
 * uneven, and unpaid ones (a new AI at 0 experience) land on the budget and then stay.
 * Masteries scale by the level budget over the experience, apart from the combat stats.
 * @param statScale - "ai" takes SCALED_AI_STAT_BUDGET_SHARE of the budget, "player" all.
 * @param options.reweight - treat the combat stats as unpaid weights, so the whole
 *   budget is spread by their points above the base.
 */
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
    | CombatStatName
    | MasteryName
  > &
    Partial<Pick<UserData, "aiHealthOverride">>,
  statScale: StatScale,
  options: { reweight?: boolean } = {},
) {
  // Multipliers
  const poolMod = user.poolsMultiplier ?? 1;
  const statMod = user.statsMultiplier ?? 1;
  // Pools
  const health =
    (statScale === "ai" ? user.aiHealthOverride : null) ?? calcHP(user.level) * poolMod;
  user.curHealth = health;
  user.maxHealth = health;
  user.curStamina = calcSP(user.level) * poolMod;
  user.maxStamina = calcSP(user.level) * poolMod;
  user.curChakra = calcCP(user.level) * poolMod;
  user.maxChakra = calcCP(user.level) * poolMod;
  // Combat stats
  const levelBudget = calcLevelRequirements(user.level) - 500;
  const experience = user.experience ?? 0;
  user.experience = levelBudget;
  const share = statScale === "ai" ? SCALED_AI_STAT_BUDGET_SHARE : 1;
  const budget = share * levelBudget;
  const combatSum = CombatStatNames.reduce((sum, stat) => sum + (user[stat] ?? 0), 0);
  const earned = combatSum / statMod - CombatStatNames.length * 10;
  const paid = options.reweight ? 0 : experience;
  const divisor = share * paid + Math.max(0, earned - paid);
  for (const stat of CombatStatNames) {
    const points =
      earned > 0
        ? (Math.max(0, (user[stat] ?? 0) / statMod - 10) * budget) / divisor
        : budget / CombatStatNames.length;
    user[stat] = (10 + roundCombatStat(points)) * statMod;
  }
  // Masteries
  const masteryFactor = experience > 0 ? levelBudget / experience : 1;
  for (const mastery of MasteryNames) {
    user[mastery] = Math.max(10, roundCombatStat((user[mastery] ?? 0) * masteryFactor));
  }
}

// Scaling can produce scientific-notation values, which the exponent-string round helper cannot accept.
const roundCombatStat = (stat: number) => Math.round(stat * 100) / 100;

/** Sum of the six redistributable combat stats (offence, defence, generals). */
export const getAssignedCombatStatTotal = (
  user: Pick<
    UserData,
    "offence" | "defence" | "strength" | "speed" | "intelligence" | "willpower"
  >,
) => CombatStatNames.reduce((sum, stat) => sum + roundCombatStat(user[stat]), 0);

/**
 * Points a paid stat reset redistributes: every assigned point, including any stored above
 * a rank cap (it counts again after a rank-up), limited to what the rank's caps can hold.
 * Resets must be rejected when the assigned total exceeds this capacity.
 */
export const getRedistributableStatTotal = (
  user: Pick<
    UserData,
    "rank" | "offence" | "defence" | "strength" | "speed" | "intelligence" | "willpower"
  >,
) => {
  const { stats_cap, gens_cap } = getUserCaps(user.rank);
  return Math.min(getAssignedCombatStatTotal(user), 2 * stats_cap + 4 * gens_cap);
};

/**
 * Whether unused experience can still go anywhere on /profile/experience: one of the six
 * combat stats has rank capacity, or an assignable mastery has room under both its
 * discipline-rank cap and the shared earned total, or an eligible elemental track.
 * Elite Jonin cannot assign XP even when their stats or masteries have capacity.
 */
export const canAssignExperience = (
  user: Pick<
    UserData,
    | "rank"
    | "masteryRanks"
    | (typeof CombatStatNames)[number]
    | (typeof MasteryNames)[number]
  > &
    ElementalMasterySource,
) => {
  if (experienceAssignmentBlockMessage(user)) return false;
  const { stats_cap, gens_cap } = getUserCaps(user.rank);
  return (
    CombatStatNames.some(
      (stat) =>
        user[stat] < (stat === "offence" || stat === "defence" ? stats_cap : gens_cap),
    ) ||
    assignableMasteryNames.some((name) => masteryGainRoom(user, name) > 0) ||
    (user.elementalMastery !== undefined &&
      BasicElementName.some((element) => elementalGainRoom(user, element) > 0))
  );
};

/** Elite milestone progression forbids XP assignment while preserving earned XP. */
export const experienceAssignmentBlockMessage = (user: Pick<UserData, "rank">) =>
  user.rank === "ELITE JONIN"
    ? "Elite Jonin cannot assign experience. Complete academy milestones to increase your combat stats and level."
    : null;

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

export const showUserRank = (user?: { rank?: UserRank; isOutlaw?: boolean }) => {
  if (!user?.rank) return "Unknown";
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

/**
 * Current regeneration, including active timed bonuses by default. Interval settlement
 * excludes them here and integrates their activation/expiry against the retained clock.
 */
export const calcActiveUserRegen = (
  user: UserData & {
    raidBuffs?: TimedBuff[];
    titles?: Pick<UserTitle, "effects" | "createdAt">[];
    clan?: Clan | null;
    bloodline?: Bloodline | null;
    village?: (Village & { structures?: VillageStructure[] }) | null;
  },
  settings: GameSetting[],
  includeTimedBuffs = true,
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

  // Clan boost (in percentage) - only apply for real clans, not outlaw factions/strongholds
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

  regeneration *= percentageMultiplier(getVillageLoyaltyBonuses(user).regen);

  // Increase by event
  const setting = getGameSettingBoost("regenGainMultiplier", settings);
  const gameFactor = setting?.value || 1;
  regeneration *= gameFactor;

  // Increase by wartime winnings
  const warSetting = getGameSettingBoost(`war-${user.village?.id}-regen`, settings);
  const warFactor = warSetting?.value || 0;
  regeneration *= (100 + warFactor) / 100;

  const base = regeneration * (1 + getPvpBoost(user, settings).totalPercent / 100);
  return includeTimedBuffs ? getTimedRegeneration(base, regenerationBuffs(user)) : base;
};

/** Energy capacity includes usable worn gear, bloodline and activated skill pool effects. */
export const calcMaxEnergy = (user: MasteryBuffUser) => {
  const base = calcEnergy(user.level);
  const sources = [
    { tags: user.bloodline?.effects ?? [], level: user.level },
    ...(user.userSkills ?? []).map(({ skill }) => ({
      tags: skill.effects.filter(
        (tag) => skill.target === "SELF" || tag.friendlyFire !== "ENEMIES",
      ),
      level: user.level,
    })),
    ...(user.items ?? [])
      .filter(
        (ui) =>
          isActiveWornGear(ui, user.bloodlineId) &&
          (user.isAi || hasRequiredSkill(ui.item, user)) &&
          !gearMissingMastery(ui, user),
      )
      .map((ui) => ({
        tags: wornGearTags(ui),
        level: user.isAi ? user.level : ui.level,
      })),
  ];
  let maximum = base;
  for (const { tags, level } of sources)
    for (const tag of tags) {
      if (
        (tag.type !== "increasemaxpools" && tag.type !== "decreasemaxpools") ||
        tag.rounds === 0 ||
        !tag.poolsAffected.includes("Energy")
      )
        continue;
      const signed =
        tag.type === "decreasemaxpools"
          ? -(Math.abs(tag.power) + level * Math.abs(tag.powerPerLevel))
          : tag.power + level * tag.powerPerLevel;
      maximum +=
        tag.calculation === "percentage"
          ? Math.floor((base * Math.min(signed, 100)) / 100)
          : signed;
    }
  return Math.max(1, maximum);
};
