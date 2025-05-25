import { tagTypes } from "./combat/types";
import { getUserFederalStatus } from "@/utils/paypal";
import { LetterRanks } from "@/drizzle/constants";
import { VILLAGE_SYNDICATE_ID } from "@/drizzle/constants";
import { FED_NORMAL_JUTSU_SLOTS } from "@/drizzle/constants";
import { FED_SILVER_JUTSU_SLOTS } from "@/drizzle/constants";
import { FED_GOLD_JUTSU_SLOTS } from "@/drizzle/constants";
import { VILLAGE_REDUCED_GAINS_DAYS } from "@/drizzle/constants";
import { MAX_EXTRA_JUTSU_SLOTS } from "@/drizzle/constants";
import { VILLAGE_LEAVE_REQUIRED_RANK } from "@/drizzle/constants";
import { secondsPassed } from "@/utils/time";
import { getUserElements } from "@/validators/user";
import type { UserWithRelations } from "@/server/api/routers/profile";
import type { LetterRank } from "@/drizzle/constants";
import type { TrainingSpeed, BattleType } from "@/drizzle/constants";
import type { Item, Jutsu, UserItem, JutsuRank } from "@/drizzle/schema";
import type { UserData, UserRank } from "@/drizzle/schema";
import type { ElementName } from "@/drizzle/constants";

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

export const availableRanks = (letterRank?: LetterRank): UserRank[] => {
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
  }
  return ["STUDENT", "GENIN", "CHUNIN", "JONIN", "ELDER", "ELITE JONIN"];
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
  const jutsuElements: ElementName[] = [];
  jutsu.effects.map((effect) => {
    if ("elements" in effect && effect.elements) {
      jutsuElements.push(...effect.elements);
    }
  });
  if (jutsuElements.length === 0) jutsuElements.push("None");
  return jutsuElements.find((e) => userElements.has(e));
};

export const checkJutsuItems = (
  jutsu: Jutsu,
  userItems: (UserItem & { item: Item })[] | undefined,
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

export const canTrainJutsu = (
  jutsu: Jutsu,
  userdata: NonNullable<UserWithRelations>,
) => {
  const userElements = new Set(getUserElements(userdata));
  if (userdata.isAi) return true;
  return (
    hasRequiredRank(userdata.rank, jutsu.requiredRank) &&
    hasRequiredLevel(userdata.level, jutsu.requiredLevel) &&
    checkJutsuRank(jutsu.jutsuRank, userdata.rank) &&
    checkJutsuVillage(jutsu, userdata) &&
    checkJutsuBloodline(jutsu, userdata) &&
    checkJutsuElements(jutsu, userElements)
  );
};

export const SENSEI_JUTSU_TRAINING_BOOST_PERC = 5;

export const calcJutsuTrainTime = (jutsu: Jutsu, level: number, userdata: UserData) => {
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
  if (userdata.senseiId && userdata.rank === "GENIN") {
    return trainTime * (1 - SENSEI_JUTSU_TRAINING_BOOST_PERC / 100);
  }
  return trainTime;
};

export const calcJutsuTrainCost = (jutsu: Jutsu, level: number) => {
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
  return Math.floor(Math.pow(base, 1 + level / 20));
};

export const calcJutsuEquipLimit = (userdata: UserData) => {
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
  const fedContrib = (userdata: UserData) => {
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
  const extraSlots =
    userdata.role === "USER" ? userdata.extraJutsuSlots : MAX_EXTRA_JUTSU_SLOTS;
  return 1 + rankContrib(userdata.rank) + fedContrib(userdata) + extraSlots;
};

// For categorizing jutsu
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
export const effectFilters = tagTypes;
export const rarities = ["ALL", ...LetterRanks] as const;
export type FilterType = (typeof mainFilters)[number];
export type StatGenType = (typeof statFilters)[number];
export type EffectType = (typeof effectFilters)[number];
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
    default:
      throw Error("Invalid training speed");
  }
};

/**
 * Get training multiplier
 */
export const trainingMultiplier = (user: UserData) => {
  const reducedDays = getReducedGainsDays(user);
  const factor = reducedDays > 0 ? 0.5 : 1;
  switch (user.trainingSpeed) {
    case "15min":
      return 0.01 * factor;
    case "1hr":
      return 0.04 * factor;
    case "4hrs":
      return 0.16 * factor;
    case "8hrs":
      return 0.32 * factor;
    default:
      throw Error("Invalid training speed");
  }
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
  userData: UserData,
) => {
  switch (battleType) {
    case "COMBAT":
      return experienceGain * (1 + userData.pvpStreak * 0.05);
    case "SHRINE_WAR":
      return experienceGain * (1 + userData.pvpStreak * 0.05);
    case "ARENA":
      return experienceGain * 0.5;
    case "QUEST":
      return experienceGain * 0.5;
    case "VILLAGE_PROTECTOR":
      return experienceGain * 0.0;
    case "TRAINING":
      return 10;
    case "RANKED":
      return 0;
  }
  return 0;
};
