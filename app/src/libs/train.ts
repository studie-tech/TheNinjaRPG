import type {
  BattleType,
  CombatStatName,
  MasteryName,
  MasteryQueueKind,
  TimedMasteryName,
  TrainingSpeed,
} from "@/drizzle/constants";
import {
  BasicElementName,
  CombatStatNames,
  ELITE_JONIN_JUTSU_TRAIN_TIME_MULTIPLIER,
  FED_JUTSU_SLOTS,
  getCombatStatCap,
  getUserCaps,
  ITEM_XP_BATTLE_TYPES,
  ITEM_XP_ON_LOSS,
  ITEM_XP_ON_WIN,
  MAX_DAILY_TRAININGS,
  MAX_JUTSU_TRAIN_TIME_MS,
  MasteryQueueKinds,
  REGEN_SECONDS,
  SENSEI_GENIN_TRAIN_EXP_BOOST_PERC,
  SENSEI_JUTSU_TRAIN_COST_REDUCTION_PERC,
  SENSEI_JUTSU_TRAINING_BOOST_PERC,
  SENSEI_MAX_STUDENT_LEVEL,
  STATS_PER_ENERGY,
  TRAINING_SPEED_CONFIG,
  VILLAGE_LEAVE_REQUIRED_RANK,
  VILLAGE_REDUCED_GAINS_DAYS,
  VILLAGE_REDUCED_GAINS_FACTOR,
} from "@/drizzle/constants";
import type { GameSetting, Jutsu, UserData, UserQueue } from "@/drizzle/schema";
import { actionStatusMessage } from "@/libs/actionReadiness";
import { elementalGainRoom } from "@/libs/elementalMastery";
import {
  applyGameSettingMultiplier,
  getGameSettingBoost,
} from "@/libs/gameSettingBoost";
import { masteryGainRoom } from "@/libs/masteryProgression";
import { getPvpBoost } from "@/libs/pvpExperience";
import {
  liveQueueRows,
  queueHeadAfter,
  rescheduleQueue,
  toEnergyEntries,
  toMasteryEntries,
} from "@/libs/queue";
import { hasRequiredRank } from "@/libs/rank";
import {
  getTerritoryWarBoost,
  getTerritoryWarPeriodBoost,
  type TerritoryBoostUser,
  territoryWarBoostWindows,
} from "@/libs/territoryWar";
import { getVillageLoyaltyBonuses, percentageMultiplier } from "@/libs/villageLoyalty";
import type { UserWithRelations } from "@/routers/profile";
import { isInArray } from "@/utils/array";
import { secondsFromDate, secondsPassed } from "@/utils/time";
import { countBoostingShrines, getShrineBoost, getStrucBoost } from "@/utils/village";
import type {
  EnergyTrainingQueueEntry,
  MasteryTrainingQueueEntry,
} from "@/validators/train";

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

/** Sign-up stamps `joinedVillageAt` and `createdAt` together; only a later village change counts. */
const joinedVillageAtSignup = (user: Pick<UserData, "joinedVillageAt" | "createdAt">) =>
  !!user.createdAt &&
  Math.abs(
    new Date(user.joinedVillageAt).getTime() - new Date(user.createdAt).getTime(),
  ) < 60_000;

export const getReducedGainsDays = (user: UserData) => {
  if (
    hasRequiredRank(user.rank, VILLAGE_LEAVE_REQUIRED_RANK) &&
    !joinedVillageAtSignup(user)
  ) {
    const daysPassed = secondsPassed(user.joinedVillageAt) / 86400;
    const daysLeft = VILLAGE_REDUCED_GAINS_DAYS - daysPassed;
    if (daysLeft > 0) {
      return daysLeft;
    }
  }
  return 0;
};

/** XP remaining until the next ownership level (jutsu, items, etc.). Never negative. */
export const remainingXpToLevel = (xpToLevel: number, experience: number): number =>
  Math.max(0, xpToLevel - experience);

/**
 * Milliseconds to train from the current level to the next level.
 * Apply the required-rank multiplier after capping the base duration so it raises
 * both training time and its cap; the sensei discount applies to that final duration.
 * `now` is the logical start, so queued work uses the bonus active when it actually begins.
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
  students?: readonly unknown[],
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

/**
 * Get training efficiency
 */
export const trainEfficiency = (user: Pick<UserData, "trainingSpeed">) =>
  trainingSpeedConfig(user.trainingSpeed).efficiency;

/**
 * Get training multiplier
 */
export const trainingMultiplier = (user: UserData) => {
  const factor = getTrainingMultiplierBoost(user);
  return trainingSpeedConfig(user.trainingSpeed).multiplier * factor;
};

/**
 * Player training modifiers independent of the selected training interval.
 */
export const getTrainingMultiplierBoost = (user: UserData) => {
  const factor = getReducedGainsDays(user) > 0 ? VILLAGE_REDUCED_GAINS_FACTOR : 1;
  return user.rank === "GENIN" && user.senseiId
    ? factor * (1 + SENSEI_GENIN_TRAIN_EXP_BOOST_PERC / 100)
    : factor;
};

/**
 * Convert training speeds to total time to completion in seconds
 */
export const trainingSpeedSeconds = (speed: TrainingSpeed) =>
  trainingSpeedConfig(speed).seconds;

/** Stored training speeds come from the database, so an unknown value is rejected. */
const trainingSpeedConfig = (speed: TrainingSpeed) => {
  if (!Object.hasOwn(TRAINING_SPEED_CONFIG, speed)) {
    throw Error("Invalid training speed");
  }
  return TRAINING_SPEED_CONFIG[speed];
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
    baseExp = applyGameSettingMultiplier(baseExp, "battleExpMultiplier", settings);
  }
  // Apply jutsu exp multiplier if available
  baseExp = applyGameSettingMultiplier(baseExp, "jutsuExpMultiplier", settings);

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
  return Math.floor(applyGameSettingMultiplier(baseExp, "itemExpMultiplier", settings));
};

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
  if (user.status !== "AWAKE") return actionStatusMessage(user.status);
  if (!user.isOutlaw && user.sector !== user.village?.sector) return "Wrong sector";
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
  return user[stat] >= getCombatStatCap(getUserCaps(user.rank), stat);
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
 * `territoryBoost` is an additive fraction; timed sessions override the instantaneous
 * default with their period average, while Energy spending uses its actual tick.
 */
/** Stat points one Energy buys at `at`, shared by instant and queued training. */
export const statsPerEnergy = (
  user: NonNullable<UserWithRelations>,
  settings: GameSetting[],
  at = new Date(),
) =>
  STATS_PER_ENERGY *
  trainingBoost(user, settings, "STATS", at) *
  getTrainingMultiplierBoost(user);

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
 * Bonus boundaries change the Energy needed to fill a stat cap, so affordability
 * must be reevaluated at those ticks before advancing to a later affordable spend.
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
    statsPerEnergy(user, settings, new Date(regenAt + tick * REGEN_SECONDS * 1000));
  let rate = rateAtTick(0);
  // Sleeping is permitted for a previously authorized queue; all other training guards apply.
  const canTrain = !statTrainingBlockMessage({
    ...user,
    status: user.status === "ASLEEP" ? "AWAKE" : user.status,
  });
  const caps = getUserCaps(user.rank);
  while (canTrain && entries.length > 0 && rate > 0) {
    const entry = entries[0]!;
    const cap = getCombatStatCap(caps, entry.stat);
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
