import type {
  BattleType,
  CombatStatName,
  ElementName,
  LetterRank,
  MasteryName,
  MasteryQueueKind,
  TimedMasteryName,
  TrainingSpeed,
} from "@/drizzle/constants";
import {
  BasicElementName,
  CombatStatNames,
  DURABILITY_USABILITY_THR,
  ELITE_JONIN_JUTSU_TRAIN_TIME_MULTIPLIER,
  ElementNames,
  FED_GOLD_JUTSU_SLOTS,
  FED_NORMAL_JUTSU_SLOTS,
  FED_SILVER_JUTSU_SLOTS,
  getUserCaps,
  ITEM_XP_BATTLE_TYPES,
  ITEM_XP_ON_LOSS,
  ITEM_XP_ON_WIN,
  JUTSU_TRAIN_TO_LEARN_RESTRICTED_TYPES,
  LetterRanks,
  MAX_DAILY_TRAININGS,
  MAX_EXTRA_JUTSU_SLOTS,
  MAX_JUTSU_TRAIN_TIME_MS,
  MasteryQueueKinds,
  REGEN_SECONDS,
  SENSEI_GENIN_TRAIN_EXP_BOOST_PERC,
  SENSEI_JUTSU_TRAIN_COST_REDUCTION_PERC,
  SENSEI_MAX_STUDENT_LEVEL,
  STATS_PER_ENERGY,
  VILLAGE_LEAVE_REQUIRED_RANK,
  VILLAGE_REDUCED_GAINS_DAYS,
  VILLAGE_SYNDICATE_ID,
} from "@/drizzle/constants";
import type {
  GameSetting,
  Jutsu,
  JutsuRank,
  UserData,
  UserItemWithItem,
  UserQueue,
  UserRank,
} from "@/drizzle/schema";
import type { CombatQueryUser } from "@/libs/combat/types";
import { elementalGainRoom } from "@/libs/elementalMastery";
import { isEvolution, meetsEvolutionStatRequirements } from "@/libs/evolution";
import { getGameSettingBoost } from "@/libs/gameSettingBoost";
import type { MasterySources, MasteryStatSource } from "@/libs/mastery";
import {
  effectiveMasteries,
  hasMasteryRequirements,
  missingMasteryRequirement,
} from "@/libs/mastery";
import { masteryGainRoom } from "@/libs/masteryProgression";
import { getPvpBoost } from "@/libs/pvpExperience";
import {
  liveQueueRows,
  queueHeadAfter,
  rescheduleQueue,
  toEnergyEntries,
  toMasteryEntries,
} from "@/libs/queue";
import { hasRequiredSkill } from "@/libs/skillRequirements";
import {
  getTerritoryWarBoost,
  getTerritoryWarPeriodBoost,
  type TerritoryBoostUser,
  territoryWarBoostWindows,
} from "@/libs/territoryWar";
import { calcIsInVillage } from "@/libs/travel";
import { getVillageLoyaltyBonuses, percentageMultiplier } from "@/libs/villageLoyalty";
import type { UserWithRelations } from "@/routers/profile";
import { isInArray } from "@/utils/array";
import { getUserFederalStatus } from "@/utils/paypal";
import { secondsFromDate, secondsPassed } from "@/utils/time";
import { countBoostingShrines, getShrineBoost, getStrucBoost } from "@/utils/village";
import type {
  EnergyTrainingQueueEntry,
  MasteryTrainingQueueEntry,
} from "@/validators/train";
import { getUserElements } from "@/validators/user";

type UserStatData = Pick<
  UserData,
  | "offence"
  | "defence"
  | "ninjutsuMastery"
  | "genjutsuMastery"
  | "taijutsuMastery"
  | "bukijutsuMastery"
  | "bloodlineMastery"
  | "sageMastery"
  | "strength"
  | "speed"
  | "intelligence"
  | "willpower"
>;

export type JutsuBloodlineItemUserItems = NonNullable<UserWithRelations>["items"];

export const availableJutsuLetterRanks = (userrank: UserRank): LetterRank[] => {
  switch (userrank) {
    case "STUDENT":
      return ["D"];
    case "GENIN":
      return ["D", "C"];
    case "CHUNIN":
      return ["D", "C", "B", "A"];
    case "JONIN":
      return ["D", "C", "B", "A", "S", "H"];
    case "ELDER":
      return ["D", "C", "B", "A", "S", "H"];
    case "ELITE JONIN":
      return ["D", "C", "B", "A", "S", "H"];
  }
  return ["D"];
};

export const availableQuestLetterRanks = (userrank: UserRank): LetterRank[] => {
  switch (userrank) {
    case "STUDENT":
      return ["D"];
    case "GENIN":
      return ["D", "C"];
    case "CHUNIN":
      return ["D", "C", "B"];
    case "JONIN":
      return ["D", "C", "B", "A", "S", "H"];
    case "ELDER":
      return ["D", "C", "B", "A", "S", "H"];
    case "ELITE JONIN":
      return ["D", "C", "B", "A", "S", "H"];
  }
  return ["D"];
};

export const hasRequiredLevel = (userLevel: number, requiredLevel: number) => {
  return userLevel >= requiredLevel;
};

export const hasRequiredRank = (userRank?: UserRank, requiredRank?: UserRank) => {
  if (!userRank) return false;
  if (!requiredRank) return true;
  switch (requiredRank) {
    case "STUDENT":
      return true;
    case "GENIN":
      return ["GENIN", "CHUNIN", "JONIN", "ELDER", "ELITE JONIN"].includes(userRank);
    case "CHUNIN":
      return ["CHUNIN", "JONIN", "ELDER", "ELITE JONIN"].includes(userRank);
    case "JONIN":
      return ["JONIN", "ELDER", "ELITE JONIN"].includes(userRank);
    case "ELDER":
      return ["ELDER", "ELITE JONIN"].includes(userRank);
    case "ELITE JONIN":
      return userRank === "ELITE JONIN";
  }
  return false;
};

export const getReducedGainsDays = (user: UserData) => {
  if (hasRequiredRank(user.rank, VILLAGE_LEAVE_REQUIRED_RANK)) {
    const daysPassed = secondsPassed(user.joinedVillageAt) / 86400;
    const daysLeft = VILLAGE_REDUCED_GAINS_DAYS - daysPassed;
    if (daysLeft > 0) {
      return daysLeft;
    }
  }
  return 0;
};

export const availableRanks = (letterRank?: LetterRank | UserRank): UserRank[] => {
  switch (letterRank) {
    case "D":
      return ["STUDENT"];
    case "C":
      return ["STUDENT", "GENIN"];
    case "B":
      return ["STUDENT", "GENIN", "CHUNIN"];
    case "A":
      return ["STUDENT", "GENIN", "CHUNIN", "JONIN", "ELDER"];
    case "S":
      return ["STUDENT", "GENIN", "CHUNIN", "JONIN", "ELDER", "ELITE JONIN"];
    case "STUDENT":
      return ["STUDENT"];
    case "GENIN":
      return ["STUDENT", "GENIN"];
    case "CHUNIN":
      return ["STUDENT", "GENIN", "CHUNIN"];
    case "JONIN":
      return ["STUDENT", "GENIN", "CHUNIN", "JONIN"];
    case "ELDER":
      return ["STUDENT", "GENIN", "CHUNIN", "JONIN", "ELDER"];
    case "ELITE JONIN":
      return ["STUDENT", "GENIN", "CHUNIN", "JONIN", "ELDER", "ELITE JONIN"];
    default:
      return ["STUDENT", "GENIN", "CHUNIN", "JONIN", "ELDER", "ELITE JONIN"];
  }
};

export const checkJutsuRank = (rank: JutsuRank | undefined, userrank: UserRank) => {
  if (!rank) return false;
  return availableJutsuLetterRanks(userrank).includes(rank);
};

export const checkJutsuVillage = (jutsu: Jutsu | undefined, userdata: UserData) => {
  if (!jutsu) return false;
  return (
    !jutsu.villageId ||
    jutsu.villageId === userdata.villageId ||
    (jutsu.villageId === VILLAGE_SYNDICATE_ID && userdata.isOutlaw)
  );
};

/**
 * Match any specified bloodline and reskin against the player's current selection.
 * A matching reskin never bypasses the parent bloodline requirement.
 */
export const checkJutsuBloodline = (jutsu: Jutsu | undefined, userdata: UserData) => {
  if (!jutsu) return false;
  return (
    (!jutsu.bloodlineId || jutsu.bloodlineId === userdata.bloodlineId) &&
    (!jutsu.bloodlineReskinId || jutsu.bloodlineReskinId === userdata.bloodlineReskinId)
  );
};

export const checkJutsuElements = (jutsu: Jutsu, userElements: Set<ElementName>) => {
  // A classification is an additional requirement; tag elements still gate legacy jutsu.
  if (
    jutsu.elementClassification &&
    jutsu.elementClassification !== "None" &&
    !userElements.has(jutsu.elementClassification)
  )
    return undefined;
  const jutsuElements: ElementName[] = [];
  jutsu.effects.forEach((effect) => {
    if ("elements" in effect && effect.elements) {
      jutsuElements.push(...effect.elements);
    }
  });
  if (jutsuElements.length === 0) jutsuElements.push("None");
  return jutsuElements.find((e) => userElements.has(e));
};

export const filterValidElementsTypeguard = (elements: string[]): ElementName[] => {
  return elements.filter((e): e is ElementName =>
    ElementNames.includes(e as ElementName),
  );
};

export const checkJutsuItems = (
  jutsu: Jutsu,
  userItems: UserItemWithItem[] | undefined,
) => {
  if (jutsu.jutsuWeapon !== "NONE") {
    const equippedItem = userItems?.find(
      (useritem) =>
        useritem.item.weaponType === jutsu.jutsuWeapon && useritem.equipped !== "NONE",
    );
    if (!equippedItem) return false;
  }
  return true;
};

export const checkJutsuBloodlineItem = (
  jutsu: Jutsu,
  userItems: JutsuBloodlineItemUserItems | undefined,
): boolean => {
  if (!jutsu.requiredBloodlineItemId) return true;
  return !!userItems?.some((ui) => {
    if (ui.itemId !== jutsu.requiredBloodlineItemId || ui.equipped === "NONE") {
      return false;
    }
    // Mirror combat's durability handling: ARMOR/ACCESSORY/KEYSTONE stop counting once
    // they hit the usability floor (processUsersForBattle forces them to "NONE"), but
    // weapons and other types stay equipped at low durability, so don't gate on it here.
    if (
      ui.item.itemType === "ARMOR" ||
      ui.item.itemType === "ACCESSORY" ||
      ui.item.itemType === "KEYSTONE"
    ) {
      return Math.min(ui.durability, ui.item.maxDurability) > DURABILITY_USABILITY_THR;
    }
    return true;
  });
};

export const canEvolveJutsu = (
  evolutionJutsu: Jutsu,
  userdata: UserStatData,
): boolean => {
  return meetsEvolutionStatRequirements(evolutionJutsu, userdata);
};

export const isJutsuEvolution = (jutsu: Jutsu): boolean => {
  return isEvolution(jutsu.parentJutsuId);
};

/** XP remaining until the next ownership level (jutsu, items, etc.). Never negative. */
export const remainingXpToLevel = (xpToLevel: number, experience: number): number =>
  Math.max(0, xpToLevel - experience);

export const canTrainJutsu = (
  jutsu: Jutsu,
  userdata: NonNullable<UserWithRelations>,
  masteries?: MasteryStatSource,
): boolean => {
  if (isJutsuEvolution(jutsu)) return false;
  // Bloodline items and activated skills gate use, while learning remains available.
  return canUseJutsu(jutsu, userdata, true, masteries, true);
};

/** True for jutsu types that cannot be initially learned via training (owned ones can still be leveled). */
export const isJutsuTrainToLearnRestricted = (jutsuType: Jutsu["jutsuType"]) =>
  (JUTSU_TRAIN_TO_LEARN_RESTRICTED_TYPES as readonly Jutsu["jutsuType"][]).includes(
    jutsuType,
  );

/**
 * Every requirement for using a jutsu, paired with the message shown when it fails. Single
 * source of truth for `canUseJutsu` and for the requirement labels and section grouping on
 * /jutsus, so a new requirement is one row here rather than three lists that can drift.
 */
const jutsuRequirementChecks = (
  jutsu: Jutsu,
  userdata: NonNullable<UserWithRelations>,
  opts?: {
    /**
     * Full user items. Required to evaluate the weapon requirement, because
     * `userdata.items` carries a narrowed `item` without `weaponType`. When omitted the
     * weapon check is skipped rather than silently failing.
     */
    userItems?: UserItemWithItem[];
    ignoreBloodlineItem?: boolean;
    ignoreSkill?: boolean;
    /** Activated skills, counted toward masteries as the server gates count them. */
    userSkills?: MasterySources["userSkills"];
    /** Masteries to gate on; defaults to effectiveMasteries over the bloodline, `userItems` and `userSkills`. */
    masteries?: MasteryStatSource;
  },
): { ok: boolean; warning: string }[] => {
  const bloodlineItems = opts?.userItems ?? userdata.items;
  const userElements = new Set(getUserElements(userdata));
  const masteries =
    opts?.masteries ??
    effectiveMasteries({
      ...userdata,
      items: opts?.userItems ?? [],
      userSkills: opts?.userSkills,
    });
  return [
    {
      ok: jutsu.jutsuType !== "PETS",
      warning: "Only companions can use this jutsu.",
    },
    {
      ok:
        !!opts?.ignoreSkill ||
        hasRequiredSkill(jutsu, {
          userSkills: opts?.userSkills ?? userdata.userSkills,
        }),
      warning: "Activate the required skill to use this jutsu.",
    },
    {
      ok: hasRequiredRank(userdata.rank, jutsu.requiredRank),
      warning: "You do not have the required rank to use this jutsu.",
    },
    {
      ok: hasRequiredLevel(userdata.level, jutsu.requiredLevel),
      warning: "You do not have the required level to use this jutsu.",
    },
    {
      ok: checkJutsuRank(jutsu.jutsuRank, userdata.rank),
      warning: "You do not have the required rank to use this jutsu.",
    },
    {
      ok: checkJutsuVillage(jutsu, userdata),
      warning: "You do not have the required village to use this jutsu.",
    },
    {
      ok: checkJutsuBloodline(jutsu, userdata),
      // A parent mismatch takes precedence over the more specific reskin warning.
      warning:
        jutsu.bloodlineId && jutsu.bloodlineId !== userdata.bloodlineId
          ? "You do not have the required bloodline to use this jutsu."
          : "Select the required bloodline reskin to use this jutsu.",
    },
    {
      ok: hasMasteryRequirements(masteries, jutsu),
      warning: "You do not have the required mastery to use this jutsu.",
    },
    {
      ok: !!checkJutsuElements(jutsu, userElements),
      warning: "You do not have the required elements to use this jutsu.",
    },
    {
      ok: !opts?.userItems || checkJutsuItems(jutsu, opts.userItems),
      warning: `No ${jutsu.jutsuWeapon.toLowerCase()} weapon equipped.`,
    },
    {
      ok: !!opts?.ignoreBloodlineItem || checkJutsuBloodlineItem(jutsu, bloodlineItems),
      warning: "You do not have the required bloodline item equipped.",
    },
  ];
};

/**
 * @param masteries - effectiveMasteries over every source the caller loaded; without it only
 *   the bloodline counts
 */
export const canUseJutsu = (
  jutsu: Jutsu,
  userdata: NonNullable<UserWithRelations>,
  ignoreBloodlineItem = false,
  masteries?: MasteryStatSource,
  ignoreSkill = false,
): boolean => {
  if (userdata.isAi) return true;
  // No userItems passed, so the weapon requirement is not checked: toggleEquip allows
  // equipping without the weapon, and non-ranked battles drop such jutsu via
  // checkJutsuItems.
  return jutsuRequirementChecks(jutsu, userdata, {
    ignoreBloodlineItem,
    ignoreSkill,
    masteries,
  }).every(({ ok }) => ok);
};

/**
 * Why battle initiation drops an owned jutsu, as "<name>: <reason>", or undefined when
 * it enters combat. The combat lobby applies the same gates when switching loadouts, so
 * jutsu combat would strip never fill equip slots. Battle usage (PvE/PvP) stays with the
 * caller because it depends on the encounter, not the player's build.
 * @param user - the combatant with `userSkills` and `items` as combat applies them
 * @param masteries - effectiveMasteries over the sources this battle applies
 */
export const battleJutsuGateFailure = (
  jutsu: Jutsu,
  user: Omit<CombatQueryUser, "jutsus">,
  battleType: BattleType,
  masteries: MasteryStatSource,
): string | undefined => {
  // Companion actions are installed separately; even AI loadouts must not inherit them.
  if (jutsu.jutsuType === "PETS")
    return `${jutsu.name}: only companions can use this jutsu`;
  if (user.isAi) return undefined;
  if (!hasRequiredSkill(jutsu, { userSkills: user.userSkills })) {
    return `${jutsu.name}: activate the required skill`;
  }
  // Ranked battles waive weapon and usability requirements, but not bloodline gates.
  if (battleType !== "RANKED_PVP" && battleType !== "RANKED_SPARRING") {
    if (!checkJutsuItems(jutsu, user.items)) {
      return `${jutsu.name}: no ${jutsu.jutsuWeapon.toLowerCase()} weapon equipped`;
    }
    const missing = missingMasteryRequirement(masteries, jutsu);
    if (missing) return `${jutsu.name}: requires ${missing.required} ${missing.label}`;
    // Provide defaults for optional fields required by the usability checks; the
    // bloodline item is enforced below for every battle type.
    const userForCheck = {
      ...user,
      userQuests: user.userQuests ?? [],
      completedQuests: user.completedQuests ?? [],
    };
    const failed = jutsuRequirementChecks(jutsu, userForCheck, {
      ignoreBloodlineItem: true,
      masteries,
    }).find(({ ok }) => !ok);
    if (failed) return `${jutsu.name}: ${failed.warning}`;
  }
  if (!checkJutsuBloodlineItem(jutsu, user.items)) {
    return `${jutsu.name}: required bloodline item is not equipped`;
  }
  // Only bloodline-bound jutsu are restricted; null and empty IDs are general jutsu.
  if (jutsu.bloodlineId && user.bloodlineId !== jutsu.bloodlineId) {
    return `${jutsu.name}: requires a different bloodline`;
  }
  return undefined;
};

/**
 * The first unmet requirement as a user-facing message, or "" when the jutsu is usable.
 * Passing `userItems` also evaluates the weapon requirement, which toggleEquip does not,
 * and counts worn gear toward masteries. Evolution acquisition ignores the skill use gate.
 */
export const jutsuRequirementWarning = (
  jutsu: Jutsu,
  userdata: NonNullable<UserWithRelations>,
  userItems?: UserItemWithItem[],
  userSkills?: MasterySources["userSkills"],
  ignoreSkill = false,
): string =>
  jutsuRequirementChecks(jutsu, userdata, { userItems, userSkills, ignoreSkill }).find(
    ({ ok }) => !ok,
  )?.warning ?? "";

export const SENSEI_JUTSU_TRAINING_BOOST_PERC = 5;

/**
 * Milliseconds to train from the current level to the next level.
 * Apply the required-rank multiplier after capping the base duration so it raises
 * both training time and its cap; the sensei discount applies to that final duration.
 */
export const calcJutsuTrainTime = (
  jutsu: Pick<Jutsu, "jutsuRank" | "requiredRank">,
  level: number,
  userdata: Pick<UserData, "senseiId" | "rank"> & TerritoryBoostUser,
  now = new Date(),
) => {
  let lvlIncrement = 7;
  if (jutsu.jutsuRank === "C") {
    lvlIncrement = 8;
  } else if (jutsu.jutsuRank === "B") {
    lvlIncrement = 9;
  } else if (jutsu.jutsuRank === "A") {
    lvlIncrement = 10;
  } else if (jutsu.jutsuRank === "S") {
    lvlIncrement = 11;
  }
  const trainTime = (1 + level * lvlIncrement) * 60 * 1000;

  const multiplier =
    jutsu.requiredRank === "ELITE JONIN" ? ELITE_JONIN_JUTSU_TRAIN_TIME_MULTIPLIER : 1;
  const cappedTrainTime =
    (Math.min(trainTime, MAX_JUTSU_TRAIN_TIME_MS) * multiplier) /
    (1 + getTerritoryWarBoost(userdata, now));

  if (userdata.senseiId && userdata.rank === "GENIN") {
    return cappedTrainTime * (1 - SENSEI_JUTSU_TRAINING_BOOST_PERC / 100);
  }
  return cappedTrainTime;
};

/**
 * Whether a jutsu is still in training at `serverNow` (epoch ms). `finishTraining` is a
 * server timestamp, so the browser must pass the server-synced clock
 * (`Date.now() - timeDiff`): a device clock that runs behind the server would otherwise
 * keep showing a training the server has already finished, and every action the server
 * gates on training would disagree with the UI.
 */
export const isJutsuInTraining = (
  userJutsu: { finishTraining: Date | null },
  serverNow: number,
) => !!userJutsu.finishTraining && userJutsu.finishTraining.getTime() > serverNow;

/** The user jutsu in training at `serverNow`, if any; see `isJutsuInTraining`. */
export const findJutsuInTraining = <T extends { finishTraining: Date | null }>(
  userJutsus: readonly T[] | undefined,
  serverNow: number,
) => userJutsus?.find((userJutsu) => isJutsuInTraining(userJutsu, serverNow));

/**
 * Fallback for training rows without a saved start. The stored level is the target
 * level; updatedAt cannot identify the start because equip rewrites it. New starts
 * persist trainingStartedAt to retain the duration even after a bonus expires.
 */
export const inferJutsuTrainingStartedAt = (
  finishTraining: Date,
  jutsu: Pick<Jutsu, "jutsuRank" | "requiredRank">,
  storedLevel: number,
  userdata: Pick<UserData, "senseiId" | "rank"> & TerritoryBoostUser,
) =>
  new Date(
    finishTraining.getTime() -
      calcJutsuTrainTime(jutsu, Math.max(0, storedLevel - 1), userdata),
  );

export const calcJutsuTrainCost = (
  jutsu: Jutsu,
  level: number,
  userdata?: UserData,
  students?: UserData[],
) => {
  let base = 50;
  if (jutsu.jutsuRank === "C") {
    base = 100;
  } else if (jutsu.jutsuRank === "B") {
    base = 150;
  } else if (jutsu.jutsuRank === "A") {
    base = 200;
  } else if (jutsu.jutsuRank === "S") {
    base = 250;
  }
  base += jutsu.extraBaseCost || 0;
  let cost = Math.floor(base ** (1 + level / 20));
  // Convenience checks
  const isStudent =
    userdata && !!userdata.senseiId && userdata.level <= SENSEI_MAX_STUDENT_LEVEL;
  const hasStudents = students && students.length > 0;
  // Apply discount
  if (isStudent || hasStudents) {
    cost = Math.floor(cost * (1 - SENSEI_JUTSU_TRAIN_COST_REDUCTION_PERC / 100));
  }
  return cost;
};

type JutsuEquipLimitUser = Pick<
  UserData,
  "rank" | "staffAccount" | "extraJutsuSlots" | "federalStatus"
>;

/** Combine rank, federal and extra-slot allowances; Elite grants one more rank slot than Jonin. */
export const calcJutsuEquipLimit = (userdata: JutsuEquipLimitUser) => {
  const rankContrib = (rank: UserRank) => {
    switch (rank) {
      case "GENIN":
        return 5 + 2;
      case "CHUNIN":
        return 6 + 2;
      case "JONIN":
        return 7 + 2;
      case "ELDER":
        return 7 + 2;
      case "ELITE JONIN":
        return 8 + 2;
    }
    return 4 + 2;
  };
  const fedContrib = (userdata: JutsuEquipLimitUser) => {
    const status = getUserFederalStatus(userdata);
    switch (status) {
      case "NORMAL":
        return FED_NORMAL_JUTSU_SLOTS;
      case "SILVER":
        return FED_SILVER_JUTSU_SLOTS;
      case "GOLD":
        return FED_GOLD_JUTSU_SLOTS;
    }
    return 0;
  };
  const extraSlots = !userdata.staffAccount
    ? userdata.extraJutsuSlots
    : MAX_EXTRA_JUTSU_SLOTS;
  return 1 + rankContrib(userdata.rank) + fedContrib(userdata) + extraSlots;
};

// For categorizing jutsu
/** Covert training and the sensei system share one training grounds section. */
export const getTrainingSections = (canUseSenseiSystem: boolean) => {
  const covertSection = canUseSenseiSystem ? "Covert & Sensei" : "Covert";
  return {
    covertSection,
    options: ["Stats", "Masteries", "Elements", "Jutsu", covertSection],
    /** Saved values from before the sections merged, or from the other rank variant. */
    aliases: {
      Covert: covertSection,
      Sensei: covertSection,
      "Covert & Sensei": covertSection,
    },
  };
};

export const mainFilters = [
  "No Filter",
  "Name",
  "Most Recent",
  "Bloodline",
  "Stat",
  "Effect",
  "Element",
  "AppearAnimation",
  "StaticAnimation",
  "DisappearAnimation",
] as const;
export const statFilters = [
  "Highest",
  "Ninjutsu",
  "Genjutsu",
  "Taijutsu",
  "Bukijutsu",
  "Strength",
  "Intelligence",
  "Willpower",
  "Speed",
] as const;
export const rarities = ["ALL", ...LetterRanks] as const;
/** Quick filters over the stat a jutsu scales with; "Highest" jutsu use the user's best stat. */
export const jutsuStatQuickFilters = [
  "All",
  "Ninjutsu",
  "Genjutsu",
  "Taijutsu",
  "Bukijutsu",
  "Highest",
] as const satisfies readonly ("All" | (typeof statFilters)[number])[];
export type JutsuStatQuickFilter = (typeof jutsuStatQuickFilters)[number];

/** The quick filter matching a stat selection, or null for a custom selection. */
export const getJutsuStatQuickFilter = (
  stat: readonly string[] | undefined,
): JutsuStatQuickFilter | null => {
  if (!stat?.length) return "All";
  const [only] = stat;
  if (stat.length !== 1 || only === "All") return null;
  return jutsuStatQuickFilters.find((option) => option === only) ?? null;
};

/** The stat selection a quick filter applies. */
export const jutsuStatQuickFilterSelection = (
  quickFilter: JutsuStatQuickFilter,
): StatGenType[] => (quickFilter === "All" ? [] : [quickFilter]);

export type FilterType = (typeof mainFilters)[number];
export type StatGenType = (typeof statFilters)[number];
export type RarityType = (typeof rarities)[number];

/**
 * Get training efficiency
 */
export const trainEfficiency = (user: UserData) => {
  switch (user.trainingSpeed) {
    case "15min":
      return 100;
    case "1hr":
      return 90;
    case "4hrs":
      return 80;
    case "8hrs":
      return 70;
    case "12hrs":
      return 60;
    case "24hrs":
      return 50;
    default:
      throw Error("Invalid training speed");
  }
};

/**
 * Get training multiplier
 */
export const trainingMultiplier = (user: UserData) => {
  const factor = getTrainingMultiplierBoost(user);
  switch (user.trainingSpeed) {
    case "15min":
      return 0.01 * factor;
    case "1hr":
      return 0.04 * factor;
    case "4hrs":
      return 0.16 * factor;
    case "8hrs":
      return 0.32 * factor;
    case "12hrs":
      return 0.48 * factor;
    case "24hrs":
      return 0.96 * factor;
    default:
      throw Error("Invalid training speed");
  }
};

/**
 * Player training modifiers independent of the selected training interval.
 */
export const getTrainingMultiplierBoost = (user: UserData) => {
  const factor = getReducedGainsDays(user) > 0 ? 0.5 : 1;
  return user.rank === "GENIN" && user.senseiId
    ? factor * (1 + SENSEI_GENIN_TRAIN_EXP_BOOST_PERC / 100)
    : factor;
};

/**
 * Convert training speeds to total time to completion in seconds
 */
export const trainingSpeedSeconds = (speed: TrainingSpeed) => {
  switch (speed) {
    case "15min":
      return 15 * 60;
    case "1hr":
      return 60 * 60;
    case "4hrs":
      return 4 * 60 * 60;
    case "8hrs":
      return 8 * 60 * 60;
    case "12hrs":
      return 12 * 60 * 60;
    case "24hrs":
      return 24 * 60 * 60;
    default:
      throw Error("Invalid training speed");
  }
};

/**
 * Get training energy per second
 */
export const energyPerSecond = (speed: TrainingSpeed) => {
  return 100 / trainingSpeedSeconds(speed);
};

// Jutsu experience gain based on battle type
export const battleJutsuExp = (
  battleType: BattleType,
  experienceGain: number,
  settings?: GameSetting[],
) => {
  let baseExp = 0;

  switch (battleType) {
    case "COMBAT":
      baseExp = 100;
      break;
    case "SHRINE_WAR":
      baseExp = experienceGain * 0.75;
      break;
    case "ARENA":
      baseExp = experienceGain * 0.5;
      break;
    case "QUEST":
      baseExp = experienceGain * 0.5;
      break;
    case "VILLAGE_PROTECTOR":
      baseExp = experienceGain * 0.0;
      break;
    case "TRAINING":
      baseExp = 10;
      break;
    default:
      baseExp = 0;
  }

  // Apply battle arena exp multiplier if available
  if (battleType === "ARENA" || battleType === "COMBAT") {
    baseExp = applyExpMultiplierSetting(baseExp, "battleExpMultiplier", settings);
  }
  // Apply jutsu exp multiplier if available
  baseExp = applyExpMultiplierSetting(baseExp, "jutsuExpMultiplier", settings);

  return Math.floor(baseExp);
};

/** Item ownership XP from eligible PvP battles, including active itemExpMultiplier. */
export const battleItemExp = (
  battleType: BattleType,
  didWin: boolean,
  settings?: GameSetting[],
) => {
  if (!(ITEM_XP_BATTLE_TYPES as readonly BattleType[]).includes(battleType)) {
    return 0;
  }
  const baseExp = didWin ? ITEM_XP_ON_WIN : ITEM_XP_ON_LOSS;
  return Math.floor(applyExpMultiplierSetting(baseExp, "itemExpMultiplier", settings));
};

/** Multiply exp by an active gain-multiplier game setting. */
const applyExpMultiplierSetting = (
  baseExp: number,
  settingName: string,
  settings?: GameSetting[],
): number => baseExp * (getGameSettingBoost(settingName, settings ?? [])?.value ?? 1);

type StatTrainingUser = UserStatData &
  Pick<
    UserData,
    | "status"
    | "isOutlaw"
    | "sector"
    | "longitude"
    | "latitude"
    | "dailyTrainings"
    | "rank"
    | "trainingSpeed"
    | "isBanned"
    | "currentlyTrainingMastery"
  > & { village?: { sector: number } | null };

/** Training is available while awake in the player's village. */
const trainingStartBlockMessage = (user: StatTrainingUser): string | null => {
  if (user.status !== "AWAKE") return "Must be awake to train";
  if (!user.isOutlaw) {
    if (!calcIsInVillage({ x: user.longitude, y: user.latitude }))
      return "Must be in your own village";
    if (user.sector !== user.village?.sector) return "Wrong sector";
  }
  return null;
};

export const statTrainingBlockMessage = (user: StatTrainingUser): string | null =>
  trainingStartBlockMessage(user) ??
  (user.isBanned ? "Cannot spend Energy while banned" : null);

/**
 * Why an amount of Energy cannot be spent on instant training, or null when it can.
 * Shared by the training page and `train.startTraining`, so a client that skips the
 * check still gets this message instead of a validation error.
 */
export const trainingEnergyMessage = (
  requested: number,
  available: number,
): string | null => {
  if (available <= 0)
    return "No Energy available. Wait for Energy to recover before training.";
  if (!Number.isFinite(requested) || requested <= 0)
    return "Enter an Energy amount greater than zero to train.";
  return null;
};

export const masteryTrainingBlockMessage = (
  user: StatTrainingUser,
  session = {
    stat: user.currentlyTrainingMastery as TimedMasteryName | null,
    speed: user.trainingSpeed,
  },
): string | null =>
  trainingStartBlockMessage(user) ??
  (session.speed !== "8hrs" && user.isBanned
    ? "Only 8hrs training interval allowed when banned"
    : null) ??
  (user.dailyTrainings >= MAX_DAILY_TRAININGS
    ? `Training more than ${MAX_DAILY_TRAININGS} times within 24 hours not allowed`
    : null) ??
  (session.stat
    ? isInArray(session.stat, BasicElementName)
      ? "You are already training an element"
      : "You are already training a mastery"
    : null);

export const isStatTrainingCapped = (
  user: UserStatData & Pick<UserData, "rank">,
  stat: CombatStatName,
) => {
  const { stats_cap, gens_cap } = getUserCaps(user.rank);
  return (
    user[stat] >= (stat === "offence" || stat === "defence" ? stats_cap : gens_cap)
  );
};

/** Offer training only when the player can start and at least one combat stat can gain. */
export const canStartStatTraining = (user: StatTrainingUser) =>
  !statTrainingBlockMessage(user) &&
  CombatStatNames.some((stat) => !isStatTrainingCapped(user, stat));

/** Independent session columns; both queues use the same training rules. */
export const masteryTrainingFields = {
  MASTERY: {
    stat: "currentlyTrainingMastery",
    startedAt: "masteryTrainingStartedAt",
    speed: "trainingSpeed",
    head: "masteryQueueHead",
  },
  ELEMENT: {
    stat: "currentlyTrainingElement",
    startedAt: "elementalTrainingStartedAt",
    speed: "elementalTrainingSpeed",
    head: "elementalQueueHead",
  },
} as const;

type MasteryTrainingUser = Pick<
  UserData,
  "masteryTrainingStartedAt" | "currentlyTrainingMastery" | "trainingSpeed"
> &
  Partial<
    Pick<
      UserData,
      | "elementalTrainingStartedAt"
      | "currentlyTrainingElement"
      | "elementalTrainingSpeed"
    >
  >;

export const getMasteryTrainingState = (
  user: MasteryTrainingUser,
  kind: MasteryQueueKind = "MASTERY",
) => {
  const fields = masteryTrainingFields[kind];
  return {
    stat: user[fields.stat] ?? null,
    startedAt: user[fields.startedAt] ?? null,
    speed: user[fields.speed] ?? "15min",
  };
};

export const masteryTrainingSessionUpdate = (
  kind: MasteryQueueKind,
  session: {
    stat: TimedMasteryName | null;
    startedAt: Date | null;
    speed: TrainingSpeed;
  },
) =>
  kind === "ELEMENT"
    ? {
        currentlyTrainingElement: session.stat as UserData["currentlyTrainingElement"],
        elementalTrainingStartedAt: session.startedAt,
        elementalTrainingSpeed: session.speed,
      }
    : {
        currentlyTrainingMastery: session.stat as UserData["currentlyTrainingMastery"],
        masteryTrainingStartedAt: session.startedAt,
        trainingSpeed: session.speed,
      };

export const masteryTrainingEndsAt = (
  user: MasteryTrainingUser,
  kind: MasteryQueueKind = "MASTERY",
) => {
  const session = getMasteryTrainingState(user, kind);
  return session.stat && session.startedAt
    ? secondsFromDate(trainingSpeedSeconds(session.speed), session.startedAt)
    : null;
};

/** Timed training keeps elemental progress independent of discipline caps. */
export const masteryTrainingGainRoom = (
  user: Parameters<typeof masteryGainRoom>[0] & Parameters<typeof elementalGainRoom>[0],
  stat: TimedMasteryName,
) =>
  isInArray(stat, BasicElementName)
    ? elementalGainRoom(user, stat)
    : masteryGainRoom(user, stat);

/** Stored balances after timed gains, shared by collection and queue settlement. */
export const applyMasteryTrainingGains = (
  user: Parameters<typeof masteryTrainingGainRoom>[0],
  gains: Partial<Record<TimedMasteryName, number>>,
) => ({
  ...Object.fromEntries(
    Object.entries(gains)
      .filter(([stat]) => !isInArray(stat, BasicElementName))
      .map(([stat, gain]) => [stat, (user[stat as MasteryName] ?? 0) + gain]),
  ),
  elementalMastery: {
    ...user.elementalMastery,
    ...Object.fromEntries(
      BasicElementName.filter((stat) => (gains[stat] ?? 0) > 0).map((stat) => [
        stat,
        (user.elementalMastery?.[stat] ?? 0) + (gains[stat] ?? 0),
      ]),
    ),
  },
});

/**
 * Shared training modifiers; `kind` selects stat or timed-mastery loyalty bonuses.
 * `now` evaluates loyalty at settlement, so offline sessions use their completion time.
 */
export const trainingBoost = (
  user: NonNullable<UserWithRelations>,
  settings: GameSetting[],
  kind: "STATS" | "MASTERY" = "STATS",
  now = new Date(),
  territoryBoost = getTerritoryWarBoost(user, now),
) => {
  const sectors = countBoostingShrines(user.village?.sectors);
  const shrineBoost = getShrineBoost(sectors, "Training", user.village);
  const trainSetting = getGameSettingBoost("trainingGainMultiplier", settings);
  const warSetting = getGameSettingBoost(`war-${user.villageId}-train`, settings);
  const boost = getStrucBoost("trainBoostPerLvl", user.village?.structures) / 100;
  const clanBoost = (user.clan?.trainingBoost ?? 0) / 100;
  const loyalty = getVillageLoyaltyBonuses(user, now);
  return (
    ((trainSetting?.value ?? 1) *
      (1 + boost + clanBoost + shrineBoost + territoryBoost) *
      (1 + getPvpBoost(user, settings).totalPercent / 100) *
      percentageMultiplier(
        kind === "STATS" ? loyalty.statGains : loyalty.masteryTraining,
      ) *
      (100 + (warSetting?.value ?? 0))) /
    100
  );
};

/** Raw timed-session gain at `now`; settlement applies discipline and shared-total caps. */
export const calcMasteryTrainingAmount = (
  user: NonNullable<UserWithRelations>,
  settings: GameSetting[],
  elapsedSeconds: number,
  now = new Date(),
) =>
  trainingBoost(
    user,
    settings,
    "MASTERY",
    now,
    getTerritoryWarPeriodBoost(
      user,
      new Date(now.getTime() - elapsedSeconds * 1000),
      now,
    ),
  ) *
  Math.min(Math.floor(energyPerSecond(user.trainingSpeed) * elapsedSeconds), 100) *
  trainEfficiency(user) *
  trainingMultiplier(user);

/** When each queued mastery session runs, chained from the end of the active one. */
export const getMasteryQueueSchedule = (
  user: MasteryTrainingUser,
  entries: readonly MasteryTrainingQueueEntry[],
  now = new Date(),
  kind: MasteryQueueKind = "MASTERY",
) =>
  rescheduleQueue(
    entries.map((entry) => ({
      ...entry,
      durationSeconds: trainingSpeedSeconds(entry.speed),
    })),
    masteryTrainingEndsAt(user, kind) ?? now,
  ).map(({ entry, startsAt, finishesAt }) => ({
    stat: entry.stat,
    speed: entry.speed,
    startsAt,
    finishesAt,
  }));

/** Why a queued mastery session cannot start in place of the finished one, or null. */
export const queuedMasteryStartBlockMessage = (
  user: Pick<UserData, "isBanned" | "dailyTrainings">,
  entry: MasteryTrainingQueueEntry,
) => {
  if (user.isBanned && entry.speed !== "8hrs")
    return "Only 8hrs training interval allowed when banned";
  if (user.dailyTrainings >= MAX_DAILY_TRAININGS)
    return `Training more than ${MAX_DAILY_TRAININGS} times within 24 hours not allowed`;
  return null;
};

/**
 * Advance the mastery queue (`entries`, oldest first) past every session that ran its
 * full interval, including the final session when nothing is queued behind it. Each
 * finished session is collected at its end, and the next entry starts at that moment,
 * so the result does not depend on when the account is next refreshed. Capped entries
 * are dropped; a blocked start (daily limit, banned interval) pauses the queue.
 */
export const settleMasteryTrainingQueue = (
  user: NonNullable<UserWithRelations>,
  entries: readonly MasteryTrainingQueueEntry[],
  settings: GameSetting[],
  now = new Date(),
  kind: MasteryQueueKind = "MASTERY",
) => {
  const queue = [...entries];
  const gains: Partial<Record<TimedMasteryName, number>> = {};
  const completed: {
    stat: TimedMasteryName;
    amount: number;
    minutes: number;
    speed: TrainingSpeed;
    finishedAt: Date;
  }[] = [];
  const session = getMasteryTrainingState(user, kind);
  let current: TimedMasteryName | null = session.stat;
  let startedAt = session.startedAt;
  let speed = session.speed;
  let dailyTrainings = user.dailyTrainings;
  const room = (stat: TimedMasteryName, pendingGains = gains) =>
    masteryTrainingGainRoom(
      {
        ...user,
        ...applyMasteryTrainingGains(user, pendingGains),
      },
      stat,
    );
  while (current && startedAt) {
    while (queue[0] && room(queue[0].stat) === 0) queue.shift();
    const seconds = trainingSpeedSeconds(speed);
    const finishedAt = secondsFromDate(seconds, startedAt);
    if (finishedAt > now) break;
    const amount =
      dailyTrainings < MAX_DAILY_TRAININGS
        ? Math.min(
            room(current),
            calcMasteryTrainingAmount(
              { ...user, trainingSpeed: speed },
              settings,
              seconds,
              finishedAt,
            ),
          )
        : 0;
    const nextDaily = dailyTrainings + (amount > 0 ? 1 : 0);
    // Both the discipline cap and shared total use the post-completion balance.
    // Keep these gains provisional until the successor's start guards pass.
    const gainsAfterCompletion = {
      ...gains,
      [current]: (gains[current] ?? 0) + amount,
    };
    const nextIndex = queue.findIndex(
      (entry) => room(entry.stat, gainsAfterCompletion) > 0,
    );
    const successor = queue[nextIndex];
    if (
      successor &&
      queuedMasteryStartBlockMessage({ ...user, dailyTrainings: nextDaily }, successor)
    )
      break;
    if (amount > 0) {
      gains[current] = (gains[current] ?? 0) + amount;
      completed.push({
        stat: current,
        amount,
        minutes: seconds / 60,
        speed,
        finishedAt,
      });
    }
    dailyTrainings = nextDaily;
    if (!successor) {
      queue.length = 0;
      current = null;
      startedAt = null;
      break;
    }
    queue.splice(0, nextIndex + 1);
    current = successor.stat;
    startedAt = finishedAt;
    speed = successor.speed;
  }
  return {
    /** Entries taken off the front of the queue: started or dropped as capped */
    consumed: entries.length - queue.length,
    remaining: queue,
    currentlyTrainingMastery: current,
    masteryTrainingStartedAt: startedAt,
    trainingSpeed: speed,
    dailyTrainings,
    gains,
    completed,
  };
};

/**
 * Settle one-time entries (`queue`, oldest first) chronologically, so offline spending
 * frees capacity for later ticks.
 * regenerationGain measures recovery over (fromTick, toTick] on the original clock.
 */
export const settleEnergyTrainingQueue = (
  user: NonNullable<UserWithRelations>,
  queue: readonly EnergyTrainingQueueEntry[],
  settings: GameSetting[],
  ticks: number,
  regenerationGain = (fromTick: number, toTick: number) =>
    (toTick - fromTick) * user.regeneration,
) => {
  const entries = [...queue];
  const gains: Partial<Record<CombatStatName, number>> = {};
  const completed: { stat: CombatStatName; amount: number }[] = [];
  let energy = Math.min(user.curEnergy, user.maxEnergy);
  let remainingTicks = ticks;
  const regenAt = user.regenAt?.getTime() ?? Date.now();
  const rateChangeTicks = territoryWarBoostWindows(user)
    .flatMap(({ startsAt, endsAt }) => [startsAt, endsAt])
    .map((date) =>
      Math.ceil((new Date(date).getTime() - regenAt) / (REGEN_SECONDS * 1000)),
    )
    .filter((tick) => tick > 0 && tick <= ticks)
    .sort((a, b) => a - b);
  const rateAtTick = (tick: number) =>
    STATS_PER_ENERGY *
    trainingBoost(
      user,
      settings,
      "STATS",
      new Date(regenAt + tick * REGEN_SECONDS * 1000),
    ) *
    getTrainingMultiplierBoost(user);
  let rate = rateAtTick(0);
  // Sleeping is permitted for a previously authorized queue; all other training guards apply.
  const canTrain = !statTrainingBlockMessage({
    ...user,
    status: user.status === "ASLEEP" ? "AWAKE" : user.status,
  });
  const { stats_cap, gens_cap } = getUserCaps(user.rank);
  while (canTrain && entries.length > 0 && rate > 0) {
    const entry = entries[0]!;
    const cap =
      entry.stat === "offence" || entry.stat === "defence" ? stats_cap : gens_cap;
    const room = Math.max(0, cap - user[entry.stat] - (gains[entry.stat] ?? 0));
    if (room === 0) {
      entries.shift();
      continue;
    }
    // A capacity reduction must not leave an entry waiting for an unreachable amount.
    let spent = Math.min(entry.energy, user.maxEnergy, room / rate);
    if (spent <= 0) break;
    if (energy < spent) {
      const fromTick = ticks - remainingTicks;
      const nextRateChangeTick = rateChangeTicks.find((tick) => tick > fromTick);
      // Recovery is monotone until the next bonus boundary, where the cost must be reevaluated.
      let low = 1;
      let high = (nextRateChangeTick ?? ticks) - fromTick;
      if (energy + regenerationGain(fromTick, fromTick + high) < spent) {
        if (nextRateChangeTick === undefined) break;
        low = high;
      }
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (energy + regenerationGain(fromTick, fromTick + middle) >= spent)
          high = middle;
        else low = middle + 1;
      }
      energy = Math.min(
        user.maxEnergy,
        energy + regenerationGain(fromTick, fromTick + low),
      );
      remainingTicks -= low;
    }
    rate = rateAtTick(ticks - remainingTicks);
    spent = Math.min(entry.energy, user.maxEnergy, room / rate);
    if (energy < spent) continue;
    if (energy - spent === energy) break;
    energy -= spent;
    const amount = Math.min(room, spent * rate);
    gains[entry.stat] = (gains[entry.stat] ?? 0) + amount;
    completed.push({ stat: entry.stat, amount });
    entries.shift();
  }
  return {
    /** Entries taken off the front of the queue: trained or dropped as capped */
    consumed: queue.length - entries.length,
    remaining: entries,
    curEnergy: Math.min(
      user.maxEnergy,
      energy + regenerationGain(ticks - remainingTicks, ticks),
    ),
    gains,
    completed,
  };
};

/**
 * The single in-memory settlement of active mastery and elemental training and ENERGY
 * queue rows, shared by account refresh and combat setup. Uses the already loaded rows, so it
 * costs no query; the caller persists the result together with the new queue heads,
 * which consume the settled rows in the same write as the gains.
 * An optional regenerationGain integrates timed bonuses as the Energy queue advances.
 */
export const settleQueuedTraining = (
  user: NonNullable<UserWithRelations>,
  rows: readonly UserQueue[],
  settings: GameSetting[],
  ticks: number,
  now = new Date(),
  regenerationGain?: (fromTick: number, toTick: number) => number,
) => {
  const energyRows = liveQueueRows(rows, "ENERGY", user.energyQueueHead);
  const energy = energyRows.length
    ? settleEnergyTrainingQueue(
        user,
        toEnergyEntries(energyRows),
        settings,
        ticks,
        regenerationGain,
      )
    : null;
  const update: Partial<UserData> = {};
  const gains: Partial<Record<TimedMasteryName, number>> = {};
  const completed: ReturnType<typeof settleMasteryTrainingQueue>["completed"] = [];
  const queues = MasteryQueueKinds.map((kind) => ({
    kind,
    rows: liveQueueRows(rows, kind, user[masteryTrainingFields[kind].head]),
  })).filter(({ kind }) => user[masteryTrainingFields[kind].stat]);
  // Each handoff shares the daily allowance; equal finishes use MasteryQueueKinds order.
  let dailyTrainings = user.dailyTrainings;
  while (queues.length) {
    const currentUser = {
      ...user,
      ...applyMasteryTrainingGains(user, gains),
      ...update,
      dailyTrainings,
    };
    const [next] = queues
      .map((queue) => ({
        queue,
        endsAt: masteryTrainingEndsAt(currentUser, queue.kind),
      }))
      .sort(
        (a, b) =>
          (a.endsAt?.getTime() ?? Number.POSITIVE_INFINITY) -
          (b.endsAt?.getTime() ?? Number.POSITIVE_INFINITY),
      );
    if (!next) break;
    const { queue, endsAt } = next;
    const { kind, rows: liveRows } = queue;
    const fields = masteryTrainingFields[kind];
    const result = settleMasteryTrainingQueue(
      currentUser,
      toMasteryEntries(liveRows),
      settings,
      // One handoff per pass lets the other queue's earlier finish claim the allowance.
      endsAt && endsAt < now ? endsAt : now,
      kind,
    );
    if (
      !result.consumed &&
      result.currentlyTrainingMastery === currentUser[fields.stat]
    ) {
      queues.splice(queues.indexOf(queue), 1);
      continue;
    }
    Object.assign(
      update,
      masteryTrainingSessionUpdate(kind, {
        stat: result.currentlyTrainingMastery,
        startedAt: result.masteryTrainingStartedAt,
        speed: result.trainingSpeed,
      }),
      {
        [fields.head]: queueHeadAfter(
          liveRows,
          result.consumed,
          currentUser[fields.head],
        ),
      },
    );
    for (const entry of result.completed) {
      gains[entry.stat] = (gains[entry.stat] ?? 0) + entry.amount;
    }
    completed.push(...result.completed);
    dailyTrainings = result.dailyTrainings;
    queue.rows = liveRows.slice(result.consumed);
    if (!result.currentlyTrainingMastery) queues.splice(queues.indexOf(queue), 1);
  }
  return {
    energy: energy && {
      ...energy,
      head: queueHeadAfter(energyRows, energy.consumed, user.energyQueueHead),
    },
    mastery: Object.keys(update).length
      ? { update: { ...update, dailyTrainings }, gains, completed }
      : null,
  };
};
