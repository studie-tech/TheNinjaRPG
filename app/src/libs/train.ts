import type {
  BattleType,
  CombatStatName,
  ElementName,
  LetterRank,
  MasteryName,
  TrainingSpeed,
} from "@/drizzle/constants";
import {
  CombatStatNames,
  DURABILITY_USABILITY_THR,
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
import { isEvolution, meetsEvolutionStatRequirements } from "@/libs/evolution";
import { getGameSettingBoost } from "@/libs/gameSettingBoost";
import type { MasterySources, MasteryStatSource } from "@/libs/mastery";
import { effectiveMasteries, hasMasteryRequirements } from "@/libs/mastery";
import { masteryGainRoom } from "@/libs/masteryProgression";
import {
  liveQueueRows,
  queueHeadAfter,
  rescheduleQueue,
  toEnergyEntries,
  toMasteryEntries,
} from "@/libs/queue";
import { calcIsInVillage } from "@/libs/travel";
import type { UserWithRelations } from "@/routers/profile";
import { getUserFederalStatus } from "@/utils/paypal";
import { secondsFromDate, secondsPassed } from "@/utils/time";
import { getShrineBoost, getStrucBoost } from "@/utils/village";
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

export const getAvailableLetterRanks = (rank: LetterRank) => {
  const ranks = LetterRanks.slice(0, LetterRanks.indexOf(rank) + 1);
  return ranks;
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

export const checkJutsuBloodline = (jutsu: Jutsu | undefined, userdata: UserData) => {
  if (!jutsu) return false;
  return !jutsu.bloodlineId || jutsu.bloodlineId === userdata.bloodlineId;
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
  // Learning a jutsu is intentionally allowed without the required bloodline item;
  // the item only gates equipping and in-combat use, so skip that check here.
  return canUseJutsu(jutsu, userdata, true, masteries);
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
      warning: "You do not have the required bloodline to use this jutsu.",
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
): boolean => {
  if (userdata.isAi) return true;
  // No userItems passed, so the weapon requirement is not checked: toggleEquip allows
  // equipping without the weapon, and non-ranked battles drop such jutsu via
  // checkJutsuItems.
  return jutsuRequirementChecks(jutsu, userdata, {
    ignoreBloodlineItem,
    masteries,
  }).every(({ ok }) => ok);
};

/**
 * The first unmet requirement as a user-facing message, or "" when the jutsu is usable.
 * Passing `userItems` also evaluates the weapon requirement, which toggleEquip does not,
 * and counts worn gear toward masteries.
 */
export const jutsuRequirementWarning = (
  jutsu: Jutsu,
  userdata: NonNullable<UserWithRelations>,
  userItems?: UserItemWithItem[],
  userSkills?: MasterySources["userSkills"],
): string =>
  jutsuRequirementChecks(jutsu, userdata, { userItems, userSkills }).find(
    ({ ok }) => !ok,
  )?.warning ?? "";

export const SENSEI_JUTSU_TRAINING_BOOST_PERC = 5;

export const calcJutsuTrainTime = (
  jutsu: Pick<Jutsu, "jutsuRank">,
  level: number,
  userdata: Pick<UserData, "senseiId" | "rank">,
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

  // Cap training time at maximum allowed time (1 hour)
  const cappedTrainTime = Math.min(trainTime, MAX_JUTSU_TRAIN_TIME_MS);

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
 * Training stores the target level and finish time. Later actions such as equip
 * rewrite updatedAt without changing finishTraining, so the start is the finish
 * minus the duration of the level training began at.
 */
export const inferJutsuTrainingStartedAt = (
  finishTraining: Date,
  jutsu: Pick<Jutsu, "jutsuRank">,
  storedLevel: number,
  userdata: Pick<UserData, "senseiId" | "rank">,
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
        return 7 + 2;
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

export const masteryTrainingBlockMessage = (user: StatTrainingUser): string | null =>
  trainingStartBlockMessage(user) ??
  (user.trainingSpeed !== "8hrs" && user.isBanned
    ? "Only 8hrs training interval allowed when banned"
    : null) ??
  (user.dailyTrainings >= MAX_DAILY_TRAININGS
    ? `Training more than ${MAX_DAILY_TRAININGS} times within 24 hours not allowed`
    : null) ??
  (user.currentlyTrainingMastery ? "You are already training a mastery" : null);

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

export const masteryTrainingEndsAt = (
  user: Pick<
    UserData,
    "masteryTrainingStartedAt" | "currentlyTrainingMastery" | "trainingSpeed"
  >,
) =>
  user.masteryTrainingStartedAt && user.currentlyTrainingMastery
    ? secondsFromDate(
        trainingSpeedSeconds(user.trainingSpeed),
        user.masteryTrainingStartedAt,
      )
    : null;

export const trainingBoost = (
  user: NonNullable<UserWithRelations>,
  settings: GameSetting[],
) => {
  const sectors = user.village?.sectors?.length ?? 0;
  const shrineBoost = getShrineBoost(sectors, "Training", user.village);
  const trainSetting = getGameSettingBoost("trainingGainMultiplier", settings);
  const warSetting = getGameSettingBoost(`war-${user.villageId}-train`, settings);
  const boost = getStrucBoost("trainBoostPerLvl", user.village?.structures) / 100;
  const clanBoost = user.isOutlaw ? 0 : (user.clan?.trainingBoost ?? 0) / 100;
  return (
    ((trainSetting?.value ?? 1) *
      (1 + boost + clanBoost + shrineBoost) *
      (100 + (warSetting?.value ?? 0))) /
    100
  );
};

/** Raw timed-session mastery gain; settlement applies discipline and shared-total caps. */
export const calcMasteryTrainingAmount = (
  user: NonNullable<UserWithRelations>,
  settings: GameSetting[],
  elapsedSeconds: number,
) =>
  trainingBoost(user, settings) *
  Math.min(Math.floor(energyPerSecond(user.trainingSpeed) * elapsedSeconds), 100) *
  trainEfficiency(user) *
  trainingMultiplier(user);

/** When each queued mastery session runs, chained from the end of the active one. */
export const getMasteryQueueSchedule = (
  user: Pick<
    UserData,
    "masteryTrainingStartedAt" | "currentlyTrainingMastery" | "trainingSpeed"
  >,
  entries: readonly MasteryTrainingQueueEntry[],
  now = new Date(),
) =>
  rescheduleQueue(
    entries.map((entry) => ({
      ...entry,
      durationSeconds: trainingSpeedSeconds(entry.speed),
    })),
    masteryTrainingEndsAt(user) ?? now,
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
 * full interval. Each finished
 * session is collected as if stopped at its end, and the next entry starts at that moment,
 * so the result does not depend on when the account is next refreshed. A session with
 * nothing queued behind it stays active for the player to collect. Capped entries are
 * dropped; a blocked start (daily limit, banned interval) pauses the queue.
 */
export const settleMasteryTrainingQueue = (
  user: NonNullable<UserWithRelations>,
  entries: readonly MasteryTrainingQueueEntry[],
  settings: GameSetting[],
  now = new Date(),
) => {
  const queue = [...entries];
  const gains: Partial<Record<MasteryName, number>> = {};
  const completed: {
    stat: MasteryName;
    amount: number;
    minutes: number;
    speed: TrainingSpeed;
    finishedAt: Date;
  }[] = [];
  let current = user.currentlyTrainingMastery;
  let startedAt = user.masteryTrainingStartedAt;
  let speed = user.trainingSpeed;
  let dailyTrainings = user.dailyTrainings;
  const room = (stat: MasteryName, pendingGains = gains) =>
    masteryGainRoom(
      {
        ...user,
        ...Object.fromEntries(
          Object.entries(pendingGains).map(([name, gain]) => [
            name,
            user[name as MasteryName] + gain,
          ]),
        ),
      },
      stat,
    );
  while (current && startedAt) {
    while (queue[0] && room(queue[0].stat) === 0) queue.shift();
    const next = queue[0];
    if (!next) break;
    const seconds = trainingSpeedSeconds(speed);
    const finishedAt = secondsFromDate(seconds, startedAt);
    if (finishedAt > now) break;
    const amount = Math.min(
      room(current),
      calcMasteryTrainingAmount({ ...user, trainingSpeed: speed }, settings, seconds),
    );
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
 */
export const settleEnergyTrainingQueue = (
  user: NonNullable<UserWithRelations>,
  queue: readonly EnergyTrainingQueueEntry[],
  settings: GameSetting[],
  ticks: number,
) => {
  const entries = [...queue];
  const gains: Partial<Record<CombatStatName, number>> = {};
  const completed: { stat: CombatStatName; amount: number }[] = [];
  let energy = Math.min(user.curEnergy, user.maxEnergy);
  let remainingTicks = ticks;
  const rate =
    STATS_PER_ENERGY * trainingBoost(user, settings) * getTrainingMultiplierBoost(user);
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
    const spent = Math.min(entry.energy, user.maxEnergy, room / rate);
    if (spent <= 0) break;
    if (energy < spent) {
      if (user.regeneration <= 0) break;
      const neededTicks = Math.ceil((spent - energy) / user.regeneration);
      if (neededTicks > remainingTicks) break;
      energy = Math.min(user.maxEnergy, energy + neededTicks * user.regeneration);
      remainingTicks -= neededTicks;
    }
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
    curEnergy: Math.min(user.maxEnergy, energy + remainingTicks * user.regeneration),
    gains,
    completed,
  };
};

/**
 * The single in-memory settlement of a user's MASTERY and ENERGY queue rows, shared by
 * the account refresh and combat setup. Works on the user and rows already loaded, so it
 * costs no query; the caller persists the result together with the new queue heads,
 * which consume the settled rows in the same write as the gains.
 */
export const settleQueuedTraining = (
  user: NonNullable<UserWithRelations>,
  rows: readonly UserQueue[],
  settings: GameSetting[],
  ticks: number,
  now = new Date(),
) => {
  const energyRows = liveQueueRows(rows, "ENERGY", user.energyQueueHead);
  const masteryRows = liveQueueRows(rows, "MASTERY", user.masteryQueueHead);
  const energy = energyRows.length
    ? settleEnergyTrainingQueue(user, toEnergyEntries(energyRows), settings, ticks)
    : null;
  const mastery =
    masteryRows.length && user.currentlyTrainingMastery
      ? settleMasteryTrainingQueue(user, toMasteryEntries(masteryRows), settings, now)
      : null;
  return {
    energy: energy && {
      ...energy,
      head: queueHeadAfter(energyRows, energy.consumed, user.energyQueueHead),
    },
    mastery: mastery?.consumed
      ? {
          ...mastery,
          head: queueHeadAfter(masteryRows, mastery.consumed, user.masteryQueueHead),
        }
      : null,
  };
};
