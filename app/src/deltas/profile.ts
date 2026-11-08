import {
  COST_CHANGE_USERNAME,
  MAX_SKILL_POINTS,
  MEDNIN_EXP_CAP,
  SAGE_MASTERY_EXP_CAP,
  SHRINE_BOOST_TYPES,
  UserRanks,
  VOTE_REWARD_REPUTATION,
} from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import { activeDungeonNotification } from "@/libs/dungeon";
import { GLOBAL_GAME_BOOSTS } from "@/libs/gameSettingBoost";
import { effectiveMasteries } from "@/libs/mastery";
import type { NavBarDropdownLink } from "@/libs/menus";
import { calcMaxEnergy, canAssignExperience } from "@/libs/profile";
import { getQuestMaxLevel } from "@/libs/quest/availability";
import { getPublicQuestUser } from "@/libs/quest/projection";
import { hasEnergyQueue } from "@/libs/queue";
import { getReducedGainsDays } from "@/libs/train";
import { getUserFactionNotifications } from "@/libs/userNotifications";
import type { fetchUser, findUserDataForQueryUpdatedUser } from "@/queries/profile";
import type { fetchQuestBootstrap } from "@/routers/profile";
import type {
  AchievementProgress,
  fetchUpdatedUser,
  UserWithRelations,
} from "@/server/api/routers/profile";
import { mergeQueryChanges, type QueryPatch } from "@/utils/queryCache";
import { countBoostingShrines, getShrineBoost } from "@/utils/village";
import type { UserRecovery } from "@/validators/base";
import type {
  TavernColorChangeSchema,
  UpdateUserPreferencesSchema,
} from "@/validators/user";
import type {
  UserCachePatch,
  UserDelta,
  UserDeltaResponse,
  UserExpected,
} from "@/validators/userCache";

type User = NonNullable<UserWithRelations>;

/** Cached profile query envelope, including public progression and derived navigation notices. */
export type UserCache = {
  userData?: User | null;
  achievementProgress?: AchievementProgress[];
  notifications?: NavBarDropdownLink[];
};
type KnownUserPatch = Partial<User> | UserCachePatch;

/** Profile fields, or a pure projection that withholds unsafe state with undefined. */
export type UserPatch =
  | KnownUserPatch
  | ((current: User) => KnownUserPatch | undefined);

/** Standard mutation responses carry their confirmed profile fields and metadata together. */
type UserResponse = Pick<
  UserDeltaResponse,
  | "success"
  | "userDelta"
  | "userExpected"
  | "achievementProgress"
  | "userNotifications"
  | "userRecovery"
> & {
  userPatch?: KnownUserPatch;
};

/** Local projections and server responses share the same identity and revision checks. */
export type UserUpdate = UserPatch | UserResponse;

/** Cache metadata bound to the profile revision captured before a mutation. */
export type UserUpdateOptions = {
  /** Omit for local patches; pass the captured revision for confirmed mutation results. */
  revision?: number;
  /** Leave unknown or superseded results to existing refreshes instead of starting another read. */
  refetch?: boolean;
  /** Apply committed waking/checkout before evaluating the action's own projection. */
  userRecovery?: UserRecovery;
  // Omit delta for a known patch; an explicitly missing server delta requires a refresh.
  delta?: UserDelta;
  achievementProgress?: AchievementProgress[];
  /** Server-known scalar state that must already match the captured cache. */
  expected?: UserExpected;
  /** Server-known scalar state that must match the complete projected user. */
  expectedAfter?: UserExpected;
  userNotifications?: UserDeltaResponse["userNotifications"];
  notifications?: (
    current: NavBarDropdownLink[] | undefined,
  ) => NavBarDropdownLink[] | undefined;
};

/** Apply only a confirmed recovery activity when the action's other cache effects are unavailable. */
export const applyUserRecoveryActivity = (
  current: UserCache,
  recovery: UserRecovery | undefined,
): UserCache | undefined => {
  if (!recovery?.activity || current.userData?.userId !== recovery.userId) return;
  return applyUserChanges(current, recovery.activity);
};

/**
 * Apply confirmed fields, numeric deltas and scalar guards, then refresh derived navigation
 * and notices. Return undefined when missing data, mismatched guards or unsafe relation
 * changes require reconciliation.
 */
export const applyUserChanges = (
  current: UserCache,
  patch: UserPatch | undefined,
  delta: UserDelta = {},
  mutation?: UserUpdateOptions,
): UserCache | undefined => {
  if (mutation?.userRecovery) {
    const recovery = mutation.userRecovery;
    // Non-refetching actions can apply the known snapshot fields; unmodelled effects stay untouched.
    if (
      current.userData?.userId !== recovery.userId ||
      !recovery.userPatch ||
      (recovery.requiresUserRefresh && mutation.refetch !== false)
    )
      return;
    const recovered = applyUserChanges(current, recovery.userPatch);
    if (!recovered) return;
    current = recovered;
  }
  if (!current.userData) return;
  if (
    mutation &&
    Object.entries(mutation.expected ?? {}).some(
      ([field, value]) =>
        value !== undefined && current.userData?.[field as keyof User] !== value,
    )
  )
    return;
  const known = typeof patch === "function" ? patch(current.userData) : patch;
  if (patch && known === undefined) return;
  const user = mergeQueryChanges(
    current.userData,
    (known ?? {}) as QueryPatch<User>,
    delta,
    mutation ? USER_DELTA_CAPS : undefined,
    {
      relations: USER_RELATIONS,
      replace: (field, value) =>
        field === "activeMission" ||
        field === "warMission" ||
        field === "kageSchedule" ||
        (field === "shrineSettings" &&
          Array.isArray(value.unlockedAiIds) &&
          Array.isArray(value.activeAiIds) &&
          typeof value.activeBoosts === "object" &&
          value.activeBoosts !== null),
    },
  );
  if (
    !user ||
    (mutation &&
      Object.entries(mutation.expectedAfter ?? {}).some(
        ([field, value]) => value !== undefined && user[field as keyof User] !== value,
      ))
  )
    return;
  const result = mergeUserCache(current, user, mutation?.achievementProgress);
  if (mutation?.userNotifications && result.notifications) {
    const { setting, notice } = mutation.userNotifications.globalBoost;
    const { href, label } = GLOBAL_GAME_BOOSTS[setting];
    result.notifications = [
      ...result.notifications.filter(
        (entry) =>
          entry.color !== "toast" &&
          !(
            entry.href === href &&
            entry.group === "Active boosts" &&
            entry.name.startsWith("Global: ") &&
            entry.name.includes(`X ${label} | `)
          ),
      ),
      ...(notice ? [notice] : []),
    ];
  }
  if (mutation?.notifications)
    result.notifications = mutation.notifications(result.notifications);
  return result;
};

/** Foreign-key changes require replacement of the matching embedded relation. */
const USER_RELATIONS = {
  anbuSquad: "anbuId",
  clan: "clanId",
  village: "villageId",
  bloodline: "bloodlineId",
  activeReskin: "bloodlineReskinId",
  sageMode: "sageModeId",
  questParty: "questPartyId",
} as const;

/** Mirror server-side caps when applying confirmed numeric deltas locally. */
const USER_DELTA_CAPS = {
  skillPoints: MAX_SKILL_POINTS,
  medicalExperience: MEDNIN_EXP_CAP,
  sageMasteryExperience: SAGE_MASTERY_EXP_CAP,
};

/**
 * Partition loaded quest rows by catalogue membership without changing the supplied rows.
 * Published progress omits static definitions supplied by `quests.getAchievementCatalogue`;
 * unpublished rows retain their definitions for active quests and overworld objectives.
 */
export const splitAchievementProgress = <
  T extends AchievementProgress & { quest?: unknown },
>(
  rows: readonly T[],
  publishedIds: ReadonlySet<string>,
) => {
  const userQuests: T[] = [];
  const achievementProgress: AchievementProgress[] = [];
  for (const userQuest of rows) {
    if (publishedIds.has(userQuest.questId)) {
      const { quest: _definition, ...progress } = userQuest;
      achievementProgress.push(progress);
    } else {
      userQuests.push(userQuest);
    }
  }
  return { userQuests, achievementProgress };
};

/** Project confirmed progression while keeping hidden quest targets and catalogue definitions private. */
export const getUserProgressionUpdate = (
  user: NonNullable<Awaited<ReturnType<typeof fetchUpdatedUser>>["user"]>,
  publishedAchievementIds: readonly string[],
) => {
  const publicUser = getPublicQuestUser(user);
  const { userQuests, achievementProgress } = splitAchievementProgress(
    publicUser.userQuests,
    new Set(publishedAchievementIds),
  );
  return {
    achievementProgress,
    userPatch: {
      updatedAt: publicUser.updatedAt,
      regenAt: publicUser.regenAt,
      curHealth: publicUser.curHealth,
      curChakra: publicUser.curChakra,
      curStamina: publicUser.curStamina,
      curEnergy: publicUser.curEnergy,
      experience: publicUser.experience,
      earnedExperience: publicUser.earnedExperience,
      level: publicUser.level,
      rank: publicUser.rank,
      status: publicUser.status,
      battleId: publicUser.battleId,
      activeNpcQuestId: publicUser.activeNpcQuestId,
      senseiId: publicUser.senseiId,
      maxHealth: publicUser.maxHealth,
      maxChakra: publicUser.maxChakra,
      maxStamina: publicUser.maxStamina,
      regeneration: publicUser.regeneration,
      regenerationWithoutTimedBuffs: publicUser.regenerationWithoutTimedBuffs,
      cookingExperience: publicUser.cookingExperience,
      cookingJobs: publicUser.cookingJobs,
      elementalMastery: publicUser.elementalMastery,
      activeTrainedElement: publicUser.activeTrainedElement,
      primaryElement: publicUser.primaryElement,
      secondaryElement: publicUser.secondaryElement,
      ...(publicUser.queue ? { queue: publicUser.queue } : {}),
      energyQueueHead: publicUser.energyQueueHead,
      energyQueueTail: publicUser.energyQueueTail,
      masteryQueueHead: publicUser.masteryQueueHead,
      elementalQueueHead: publicUser.elementalQueueHead,
      currentlyTrainingElement: publicUser.currentlyTrainingElement,
      elementalTrainingStartedAt: publicUser.elementalTrainingStartedAt,
      elementalTrainingSpeed: publicUser.elementalTrainingSpeed,
      trainingSpeed: publicUser.trainingSpeed,
      currentlyTrainingMastery: publicUser.currentlyTrainingMastery,
      masteryTrainingStartedAt: publicUser.masteryTrainingStartedAt,
      dailyTrainings: publicUser.dailyTrainings,
      dailyMissions: publicUser.dailyMissions,
      dailyErrands: publicUser.dailyErrands,
      dailyMedicalMissions: publicUser.dailyMedicalMissions,
      dailyWarMissions: publicUser.dailyWarMissions,
      dailyArenaFights: publicUser.dailyArenaFights,
      dailyPvpMissions: publicUser.dailyPvpMissions,
      dailySageActivations: publicUser.dailySageActivations,
      questFinishAt: publicUser.questFinishAt,
      skillPoints: publicUser.skillPoints,
      missionsD: publicUser.missionsD,
      missionsC: publicUser.missionsC,
      missionsB: publicUser.missionsB,
      missionsA: publicUser.missionsA,
      missionsS: publicUser.missionsS,
      missionsH: publicUser.missionsH,
      crimesD: publicUser.crimesD,
      crimesC: publicUser.crimesC,
      crimesB: publicUser.crimesB,
      crimesA: publicUser.crimesA,
      crimesS: publicUser.crimesS,
      crimesH: publicUser.crimesH,
      errands: publicUser.errands,
      pveFights: publicUser.pveFights,
      pvpFights: publicUser.pvpFights,
      pvpExperience: publicUser.pvpExperience,
      pvpStreak: publicUser.pvpStreak,
      offence: user.offence,
      defence: user.defence,
      strength: user.strength,
      speed: user.speed,
      intelligence: user.intelligence,
      willpower: user.willpower,
      ninjutsuMastery: user.ninjutsuMastery,
      genjutsuMastery: user.genjutsuMastery,
      taijutsuMastery: user.taijutsuMastery,
      bukijutsuMastery: user.bukijutsuMastery,
      bloodlineMastery: user.bloodlineMastery,
      sageMastery: user.sageMastery,

      questData: publicUser.questData,
      userQuests,
      completedQuests: publicUser.completedQuests,
      effectiveMasteries: effectiveMasteries(user),
      maxEnergy: calcMaxEnergy(user),
    },
  };
};

/** Keep confirmed profile state and derived navigation in the same cache update. */
const mergeUserCache = (
  old: UserCache,
  user: User,
  achievementProgress?: AchievementProgress[],
): UserCache => {
  const factionNotifications = getUserFactionNotifications(user);
  const previousFactionNames = new Set(
    getUserFactionNotifications(old.userData ?? undefined).map((entry) => entry.name),
  );
  const desired: NavBarDropdownLink[] = [...factionNotifications];
  if (user.activeDungeonRunId) desired.push(activeDungeonNotification);
  if (
    UserRanks.includes(user.rank) &&
    user.earnedExperience > 0 &&
    canAssignExperience(user)
  )
    desired.push({
      id: "tutorial-unassigned-stats",
      href: "/profile/experience",
      name: "Assign XP",
      color: "blue",
    });
  if (user.status === "BATTLE")
    desired.push({ href: "/combat", name: "In combat", color: "red" });
  if (user.status === "HOSPITALIZED")
    desired.push({ href: "/hospital", name: "In hospital", color: "red" });
  if (user.deletionAt)
    desired.push({
      href: "/profile?tab=edit&settings=deletion&setting=character",
      name: "Deletion requested",
      color: "red",
    });
  if (user.isBanned) desired.push({ href: "/reports", name: "Banned!", color: "red" });
  if (user.isTradeBanned)
    desired.push({ href: "/reports", name: "Trade Banned!", color: "red" });
  const reducedDays = getReducedGainsDays(user);
  if (reducedDays > 0)
    desired.push({
      href: "/village",
      name: `Slowed ${Math.ceil(reducedDays)} days`,
      color: "red",
    });
  for (const boostType of SHRINE_BOOST_TYPES) {
    const boost =
      getShrineBoost(
        countBoostingShrines(user.village?.sectors),
        boostType,
        user.village,
      ) * 100;
    if (boost > 0)
      desired.push({
        href: "/shrine",
        name: `Shrine: +${boost}% ${boostType} gains`,
        color: "green",
        group: "Active boosts",
      });
  }
  let notifications = old.notifications?.flatMap((entry) => {
    if (
      entry.id !== "tutorial-unassigned-stats" &&
      ![
        "Assign XP",
        "In combat",
        "In hospital",
        "Deletion requested",
        "Banned!",
        "Trade Banned!",
        activeDungeonNotification.name,
      ].includes(entry.name) &&
      !(entry.href === "/village" && /^Slowed \d+ days$/.test(entry.name)) &&
      !previousFactionNames.has(entry.name) &&
      !(
        entry.href === "/shrine" &&
        entry.group === "Active boosts" &&
        entry.name.startsWith("Shrine: +")
      )
    )
      return [entry];
    const index = desired.findIndex((next) => next.name === entry.name);
    if (index < 0) return [];
    const next = desired.splice(index, 1)[0]!;
    const unchanged = Object.entries({ ...entry, ...next }).every(
      ([field]) =>
        entry[field as keyof NavBarDropdownLink] ===
        next[field as keyof NavBarDropdownLink],
    );
    return [unchanged ? entry : next];
  });
  if (notifications) {
    notifications.push(...desired);
    if (
      notifications.length === old.notifications?.length &&
      notifications.every((entry, index) => entry === old.notifications?.[index])
    )
      notifications = old.notifications;
    // Existing toast entries have already been displayed by UserContext. Changing
    // navigation must not replay them through its notification effect.
    else notifications = notifications.filter((entry) => entry.color !== "toast");
  }
  return {
    ...old,
    userData: user,
    ...(achievementProgress ? { achievementProgress } : {}),
    ...(notifications ? { notifications } : {}),
  };
};

/** Project the saved tutorial step. */
export const getUpdateTutorialStepUserUpdate = ({
  inputStep,
}: {
  inputStep: number;
}) => ({
  userPatch: { tutorialStep: inputStep },
});

/**
 * Project preferences only after a successful guarded write; an unchanged row requires
 * reconciliation.
 */
export const getUpdatePreferencesUserUpdate = ({
  resultRowsAffected,
  input,
}: {
  resultRowsAffected: number;
  input: UpdateUserPreferencesSchema;
}) => ({
  userPatch: resultRowsAffected > 0 ? input : undefined,
});

/** Project only the confirmed automatic-wake choice for the character that saved it. */
export const getActionPreferenceUserUpdate = (
  current: User,
  userId: string | undefined,
  autoWakeUp: boolean | undefined,
) =>
  current.userId === userId && typeof autoWakeUp === "boolean"
    ? { autoWakeUp }
    : undefined;

/** Project the saved cosmetic sprite body style. */
export const getUpdateSpriteBodyUserUpdate = ({
  inputBody,
}: {
  inputBody: "male" | "female";
}) => ({
  userPatch: { spriteBodyStyle: inputBody },
});

/** Project the saved username and the reputation balance remaining after its change fee. */
export const getUpdateUsernameUserUpdate = ({
  inputUsername,
  userReputationPoints,
}: {
  inputUsername: string;
  userReputationPoints: number;
}) => ({
  userPatch: {
    username: inputUsername,
    reputationPoints: userReputationPoints - COST_CHANGE_USERNAME,
  },
});

/** Project the selected tavern color fields and debit their reputation cost separately. */
export const getUpdateTavernColorUserUpdate = ({
  colorUpdate,
  cost,
}: {
  colorUpdate: ReturnType<typeof getTavernColorPatch>;
  cost: number;
}) => ({
  userPatch: {
    ...colorUpdate,
  },
  userDelta: { reputationPoints: -cost },
});

/**
 * Project the committed XP assignment, revision and derived mastery and energy limits. Omit
 * the projection while energy work is queued.
 */
export const getUseUnusedExperiencePointsUserUpdate = ({
  data,
  resultClaimedAt,
  user,
}: {
  data: AssignedExperiencePatch;
  resultClaimedAt: Date;
  user: NonNullable<Awaited<ReturnType<typeof findUserDataForQueryUpdatedUser>>>;
}) => {
  if (hasEnergyQueue(user)) return {};
  return {
    userPatch: {
      ...data,
      updatedAt: resultClaimedAt,
      effectiveMasteries: effectiveMasteries({ ...user, ...data }),
      maxEnergy: calcMaxEnergy({ ...user, ...data }),
    },
  };
};

/** Credit the daily vote reward that `claimVotes` adds with its guarded increment. */
export const getClaimVotesUserUpdate = () => ({
  userDelta: {
    reputationPoints: VOTE_REWARD_REPUTATION,
    reputationPointsTotal: VOTE_REWARD_REPUTATION,
  },
});

/** Mark the cached vote record claimed, keeping its other fields. */
export const getClaimedVotesPatch = (user: Pick<User, "votes">) => ({
  votes: user.votes && { ...user.votes, claimed: true },
});

/**
 * Project the deletion timer only when the caller is the target; this action has no balance
 * delta.
 */
export const getToggleDeletionTimerUserUpdate = ({
  inputUserId,
  ctxUserId,
  deletionAt,
}: {
  inputUserId: string;
  ctxUserId: string;
  deletionAt: Date | null;
}) => ({
  userPatch: inputUserId === ctxUserId ? { deletionAt } : {},
  userDelta: {},
});

/**
 * Project an integer XP award to the caller only when unassigned XP already exists and no
 * energy work is queued. Other cases require progression reconciliation.
 */
export const getAwardExperienceUserUpdate = ({
  inputTargetUserId,
  ctxUserId,
  target,
  inputAmount,
}: {
  inputTargetUserId: string;
  ctxUserId: string;
  target: NonNullable<Awaited<ReturnType<typeof fetchUser>>>;
  inputAmount: number;
}) => ({
  userDelta:
    inputTargetUserId === ctxUserId &&
    target.earnedExperience > 0 &&
    !hasEnergyQueue(target) &&
    Number.isInteger(inputAmount)
      ? { earnedExperience: inputAmount }
      : undefined,
});

/**
 * Project the caller's integer share of a global XP award only with existing unassigned XP
 * and no queued energy work.
 */
export const getAwardExperienceToAllUserUpdate = ({
  awarder,
  inputAmount,
}: {
  awarder: NonNullable<Awaited<ReturnType<typeof fetchUser>>>;
  inputAmount: number;
}) => ({
  userDelta:
    hasEnergyQueue(awarder) ||
    awarder.earnedExperience <= 0 ||
    !Number.isInteger(inputAmount)
      ? undefined
      : { earnedExperience: inputAmount },
});

type AssignedExperiencePatch = Pick<
  UserData,
  | "offence"
  | "defence"
  | "strength"
  | "speed"
  | "intelligence"
  | "willpower"
  | "ninjutsuMastery"
  | "genjutsuMastery"
  | "taijutsuMastery"
  | "bukijutsuMastery"
  | "experience"
  | "earnedExperience"
> &
  Partial<Pick<UserData, "elementalMastery">>;

/**
 * Check whether an uncompleted tier or exam candidate covers the current level and can
 * require canonical quest admission.
 */
export const canBootstrapQuestType = (
  candidates: Awaited<ReturnType<typeof fetchQuestBootstrap>>,
  questType: "tier" | "exam",
  level: number,
) =>
  candidates.some(
    (candidate) =>
      candidate.questType === questType &&
      candidate.completed === null &&
      candidate.requiredLevel <= level &&
      getQuestMaxLevel(candidate) >= level,
  );

/** Select the username or title color field for a confirmed tavern color change. */
export const getTavernColorPatch = (
  input: Pick<TavernColorChangeSchema, "target" | "color">,
) =>
  input.target === "username"
    ? { tavernUsernameColor: input.color }
    : { tavernTitleColor: input.color };

/** Loaded energy queue pointers used to decide whether a profile delta needs reconciliation. */
export type UserQueueState = Pick<UserData, "energyQueueHead" | "energyQueueTail">;
