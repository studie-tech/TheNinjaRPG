/**
 * Database access for profile; authorization and transaction scopes stay in callers.
 */

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  ne,
  notExists,
  notInArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { nanoid } from "nanoid";
import type { UploadedFileData } from "uploadthing/types";
import {
  ACTIVE_VOTING_SITES,
  ALLIANCEHALL_LAT,
  ALLIANCEHALL_LONG,
  COST_CHANGE_USERNAME,
  type CombatStatName,
  IMG_AVATAR_DEFAULT,
  KAGE_PRESTIGE_REQUIREMENT,
  ONLINE_WINDOW_MINUTES,
  STRONGEST_USERS_COUNT,
  type StaffApprovalGroup,
  type TavernColorPreset,
  type TimedMasteryName,
  type TrainingSpeed,
  type UserRole,
  VOTE_REWARD_REPUTATION,
} from "@/drizzle/constants";
import {
  abEvent,
  actionLog,
  battleHistory,
  contentProposal,
  farmPlot,
  historicalIp,
  item,
  jutsu,
  jutsuReskin,
  mpvpBattleQueue,
  notification,
  poll,
  quest,
  questHistory,
  questParty,
  raidParticipation,
  recruitmentRewards,
  sageMode,
  staffApplication,
  staffApplicationApproval,
  supportTicket,
  trainingLog,
  type UserRank,
  userAttribute,
  userBlackList,
  userData,
  userItem,
  userItemImbuement,
  userJutsu,
  userNindo,
  userPet,
  userPollVote,
  userQueue,
  userReport,
  userSkill,
  userUpload,
  userVote,
  village,
  war,
} from "@/drizzle/schema";
import { bloodrightSwapRefund } from "@/libs/bloodright";
import { petExperienceGainSql } from "@/libs/pets/experience";
import { servedUfsUrl } from "@/libs/uploadthing";
import { withoutDungeonReservation } from "@/queries/dungeonReservation";
import { listCachedGameSettings } from "@/queries/gamesettings";
import { questPartyRelations } from "@/queries/questParty";
import { userCardColumns } from "@/queries/userColumns";
import { activeWarAllyWhere } from "@/queries/war";
import { serverError } from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { scopedRead } from "@/server/requestScope";
import {
  activityCompletionExtras,
  completedQuestHistoryRelation,
  userQuestHistoryRelation,
} from "@/server/utils/achievementObjectives";
import type { ActionReadinessWrite } from "@/server/utils/actionReadiness";
import { createInstanceCache } from "@/server/utils/instanceCache";
import { hashIp } from "@/server/utils/ipHash";
import { fetchPvpExperienceAverage } from "@/server/utils/pvpExperience";
import { missingUserMessage } from "@/server/utils/sentry";
import { territoryWarBoostWindowsSql } from "@/server/utils/territoryWar";
import { displayTitleSql } from "@/server/utils/titleDisplay";
import { clampActionLogText } from "@/utils/actionLog";
import { periodStart, secondsFromNow } from "@/utils/time";
import type { GetPublicUsersSchema, TavernColorChangeSchema } from "@/validators/user";

/** Build the `userData` update for `GET`. */
export const updateUserDataForGET = (client: Pick<DrizzleClient, "update">) =>
  client.update(userData).set({
    villagePrestige: sql`${userData.villagePrestige} + 1`,
    dailyArenaFights: 0,
    dailyMissions: 0,
    dailyErrands: 0,
    dailyMedicalMissions: 0,
    dailyPvpMissions: 0,
    dailyWarMissions: 0,
    dailyTrainings: 0,
    dailyOverworldQuestRolls: 0,
    dailySageActivations: 0,
    aiCalls: 0,
  });

/** Build the `userVote` update for `GET`, setting `claimed`. */
export const updateUserVoteForGET = (client: Pick<DrizzleClient, "update">) =>
  client.update(userVote).set({
    claimed: false,
    ...Object.fromEntries(ACTIVE_VOTING_SITES.map((site) => [site, false])),
  });

/** Build the `userData` lookup for `GET`, selecting only `username`. */
export const findUserDataForGET = (client: Pick<DrizzleClient, "query">) =>
  client.query.userData.findFirst({
    columns: { username: true },
  });

/** Build the `userUpload` insert for `tavernUploader`. */
export const insertUserUploadForTavernUploader = (
  client: Pick<DrizzleClient, "insert">,
  metadata: { userId: string },
  file: UploadedFileData,
) =>
  client.insert(userUpload).values({
    id: nanoid(),
    userId: metadata.userId,
    imageUrl: servedUfsUrl(file),
  });

/** Build the `userVote` update for `handleVote`, setting `lastVoteAt`, using predicates on `secret`. */
export const updateUserVoteForHandleVote = (
  client: Pick<DrizzleClient, "update">,
  siteId: string,
  now: Date,
  secret: string,
) => {
  const site = VOTE_POSTBACK_SITES[siteId];
  return client
    .update(userVote)
    .set({ ...(site ? { [site]: true } : {}), lastVoteAt: now })
    .where(eq(userVote.secret, secret));
};

/** Postback site ids, as the vote sites send them, mapped to their UserVote column. */
const VOTE_POSTBACK_SITES: Record<string, (typeof ACTIVE_VOTING_SITES)[number]> = {
  mmohub: "mmoHub",
  arenaTop100: "arenaTop100",
  topWebGames: "topWebGames",
};

/**
 * Fetch a user by id
 * @param client - The database client
 * @param userId - The id of the user
 * @returns The user, never null or undefined
 * @throws A NOT_FOUND error if the user does not exist
 *
 * NOTE: This function is used across the codebase. Use fetchUpdatedUser
 * if more information is required on the user object, so that we keep this method "light"
 */
export const fetchUser = async (client: DrizzleClient, userId: string) => {
  const user = await client.query.userData.findFirst({
    where: eq(userData.userId, userId),
  });
  if (!user) {
    throw serverError("NOT_FOUND", missingUserMessage(userId));
  }
  return user;
};

// Achievements change only when staff edit quests, which invalidate this instance at
// once; other instances serve an edit within the TTL. Rows stay complete because they
// become the `quest` of each player's achievement entries.
const ACHIEVEMENT_CATALOGUE_TTL_MS = 60 * 1000;
const achievementCatalogue = createInstanceCache(
  ACHIEVEMENT_CATALOGUE_TTL_MS,
  (client: Pick<DrizzleClient, "select">) =>
    client
      .select()
      .from(quest)
      .where(and(eq(quest.questType, "achievement"), eq(quest.hidden, false))),
);

/**
 * Visible achievements from the instance cache. Each caller receives a clone, so per-user
 * rewrites such as hidden quest locations operate on private copies.
 */
export const fetchAchievementCatalogue = (client: Pick<DrizzleClient, "select">) =>
  achievementCatalogue.read(client);

/** Make this instance read achievements again; call after quest definition writes. */
export const invalidateAchievementCatalogue = achievementCatalogue.invalidate;

/** Load persisted settings from the instance cache, followed by the computed PvP average. */
export const fetchAllGameSettings = async (client: DrizzleClient) => {
  const [settings, average] = await Promise.all([
    listCachedGameSettings(client),
    fetchPvpExperienceAverage(client),
  ]);
  return [...settings, average];
};

/*
 * Wars, shrine lobbies and raids gate actions or change with combat, so they stay fresh
 * per request: {@link scopedRead} shares one read across the tRPC batch and hands each
 * caller a clone for its own subset. The lobby and raid cutoffs are evaluated against
 * the first caller's `now`, which is well inside the minute-scale windows they describe.
 */

/** Load a request-scoped active-poll lookup excluding polls already voted on by this user. */
export const fetchHasUnvotedPolls = (
  client: DrizzleClient,
  userId: string,
  now: Date,
) =>
  scopedRead(`unvotedPolls:${userId}`, () =>
    client
      .select({ id: poll.id })
      .from(poll)
      .leftJoin(
        userPollVote,
        and(eq(userPollVote.pollId, poll.id), eq(userPollVote.userId, userId)),
      )
      .where(
        and(
          eq(poll.isActive, true),
          // Either endDate is null or endDate is in the future
          or(isNull(poll.endDate), gt(poll.endDate, now)),
          // User hasn't voted on this poll
          isNull(userPollVote.id),
        ),
      )
      .limit(1),
  );

/** All active wars, for enemy_village sector type resolution. */
export const fetchAllActiveWars = (client: DrizzleClient) =>
  scopedRead("allActiveWars", () =>
    client.query.war.findMany({
      where: isNull(war.endedAt),
      columns: {
        id: true,
        type: true,
        status: true,
        defenderShrineHp: true,
        attackerVillageId: true,
        defenderVillageId: true,
        sector: true,
      },
      with: {
        attackerVillage: { columns: { id: true, name: true, sector: true } },
        defenderVillage: { columns: { id: true, name: true, sector: true } },
        warAllies: { where: activeWarAllyWhere() },
      },
    }),
  );

/** Shrine battle lobbies whose battle has not started and that are not yet stale. */
export const fetchActiveShrineLobbies = (client: DrizzleClient, staleBefore: Date) =>
  scopedRead("activeShrineLobbies", () =>
    client.query.mpvpBattleQueue.findMany({
      where: and(
        eq(mpvpBattleQueue.battleType, "SHRINE_BATTLE"),
        isNull(mpvpBattleQueue.battleId),
        gt(mpvpBattleQueue.createdAt, staleBefore),
      ),
    }),
  );

/** All raids whose boss is still standing and whose window has not closed. */
export const fetchActiveRaids = (client: DrizzleClient, now: Date) =>
  scopedRead("activeRaids", () =>
    client.query.quest.findMany({
      where: and(
        eq(quest.questType, "raid"),
        eq(quest.hidden, false),
        gte(quest.raidBossCurrentHealth, 1),
        or(isNull(quest.raidEndsAt), gte(quest.raidEndsAt, now)),
      ),
    }),
  );

/** Build the filtered and ordered public-user row query. The caller must authorize IP searches and redact returned IPs. */
export const listPublicUserRows = (
  client: DrizzleClient,
  input: GetPublicUsersSchema,
  skip: number,
  includeEffects?: boolean,
) => {
  const getOrder = () => {
    switch (input.orderBy) {
      case "Online":
        return [desc(userData.updatedAt)];
      case "Strongest":
        return [desc(userData.level), desc(userData.experience)];
      case "Weakest":
        return [asc(userData.level), asc(userData.experience)];
      case "Crafting":
        return [desc(userData.craftingExperience), desc(userData.experience)];
      case "Farming":
        return [desc(userData.farmingExperience), desc(userData.experience)];
      case "Medical":
        return [desc(userData.medicalExperience), desc(userData.experience)];
      case "PvP":
        // Rank by PvP XP, with character XP as the tie-breaker.
        return [desc(userData.pvpExperience), desc(userData.experience)];
      case "Ranked":
        return [desc(userData.rankedLp), desc(userData.experience)];
      case "Staff":
        return [desc(userData.tavernMessages)];
      case "Outlaws":
        return [desc(userData.villagePrestige)];
      case "Community":
        return [desc(userData.tavernMessages)];
      case "Dailies":
        return [
          desc(
            sql`${userData.dailyArenaFights} + ${userData.dailyMissions} + ${userData.dailyErrands}`,
          ),
          desc(userData.experience),
        ];
      case "Recruiters":
        // Most efficient: use denormalized counter maintained on userData
        return [desc(userData.nRecruited), desc(userData.experience)];
    }
  };
  return client.query.userData.findMany({
    where: and(
      eq(userData.isAi, input.isAi),
      ...(input.username !== undefined
        ? [like(userData.username, `%${input.username}%`)]
        : []),
      ...(input.bloodline !== undefined
        ? [eq(userData.bloodlineId, input.bloodline)]
        : []),
      ...(input.ip ? [like(userData.lastIp, `%${input.ip}%`)] : []),
      ...(input.village !== undefined ? [eq(userData.villageId, input.village)] : []),
      ...(input.recruiterId ? [eq(userData.recruiterId, input.recruiterId)] : []),
      ...(input.orderBy === "Staff" ? [notInArray(userData.role, ["USER"])] : []),
      ...(input.orderBy === "Outlaws" ? [eq(userData.isOutlaw, true)] : []),
      ...(input.inArena !== undefined ? [eq(userData.inArena, !!input.inArena)] : []),
      ...(input.isEvent !== undefined ? [eq(userData.isEvent, !!input.isEvent)] : []),
      ...(input.isWarCamp !== undefined
        ? [eq(userData.isWarCamp, !!input.isWarCamp)]
        : []),
      ...(input.isSummon !== undefined
        ? [eq(userData.isSummon, !!input.isSummon)]
        : []),
      ...(input.inShrines !== undefined
        ? [eq(userData.inShrines, !!input.inShrines)]
        : []),
      ...(input.minLevel !== undefined ? [gte(userData.level, input.minLevel)] : []),
      ...(input.maxLevel !== undefined ? [lte(userData.level, input.maxLevel)] : []),
      ...(input.activeWithinMinutes !== undefined
        ? [gte(userData.updatedAt, secondsFromNow(-input.activeWithinMinutes * 60))]
        : []),
    ),
    columns: {
      avatar: true,
      avatarLight: true,
      experience: true,
      nRecruited: true,
      inArena: true,
      inShrines: true,
      isAi: true,
      isEvent: true,
      isWarCamp: true,
      isOutlaw: true,
      isSummon: true,
      lastIp: true,
      level: true,
      pvpExperience: true,
      rankedLp: true,
      rank: true,
      reputationPointsTotal: true,
      role: true,
      updatedAt: true,
      userId: true,
      username: true,
      villageId: true,
      craftingExperience: true,
      farmingExperience: true,
      medicalExperience: true,
      villagePrestige: true,
      tavernMessages: true,
      dailyArenaFights: true,
      dailyMissions: true,
      dailyErrands: true,
      effects: true,
    },
    // If AI, also include relations information
    with: {
      village: { columns: { name: true } },
      ...(input.isAi && includeEffects
        ? {
            jutsus: {
              columns: { level: true },
              with: {
                jutsu: {
                  columns: {
                    name: true,
                    effects: true,
                  },
                },
              },
            },
            items: {
              columns: {
                itemId: true,
              },
              with: {
                item: {
                  columns: {
                    effects: true,
                  },
                },
              },
            },
          }
        : {}),
    },
    offset: skip,
    limit: input.limit,
    orderBy: getOrder(),
  });
};

/** Load the named attribute values belonging to one account. */
export const fetchAttributes = async (client: DrizzleClient, userId: string) => {
  return await client.query.userAttribute.findMany({
    where: eq(userAttribute.userId, userId),
  });
};

/** Table alias for imbued item joins, keeping its columns distinct from other participants. */
const imbuedItem = alias(item, "imbuedItem");

/** Table alias for recruiter data joins, keeping its columns distinct from other participants. */
const recruiterData = alias(userData, "recruiter");

/**
 * Build the `raidParticipation` listing for `getDashboard`, selecting row fields
 * `damageDealt` and `rewardsClaimed`, using predicates on `userId`.
 */
export const listRaidParticipationForGetDashboard = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.raidParticipation.findMany({
    where: eq(raidParticipation.userId, ctx.userId),
    columns: {
      damageDealt: true,
      rewardsClaimed: true,
    },
    with: {
      quest: {
        columns: { id: true, name: true },
        with: {
          raidDamageThresholds: {
            columns: { id: true, damageRequired: true },
          },
        },
      },
    },
  });

/** Build the `userJutsu` selection for `fetchJutsuTimers`, using predicates on `userId` and `finishTraining`. */
export const selectUserJutsuForFetchJutsuTimers = (
  client: Pick<DrizzleClient, "select">,
  ctx: { userId: string },
  now: SQL<unknown>,
) =>
  client
    .select({
      name: sql<string>`COALESCE(${jutsuReskin.name}, ${jutsu.name})`,
      level: userJutsu.level,
      jutsuRank: jutsu.jutsuRank,
      requiredRank: jutsu.requiredRank,
      trainingStartedAt: userJutsu.trainingStartedAt,
      finishTraining: userJutsu.finishTraining,
      senseiId: userData.senseiId,
      rank: userData.rank,
    })
    .from(userJutsu)
    .innerJoin(jutsu, eq(userJutsu.jutsuId, jutsu.id))
    .innerJoin(userData, eq(userJutsu.userId, userData.userId))
    .leftJoin(jutsuReskin, eq(userJutsu.reskinId, jutsuReskin.id))
    .where(and(eq(userJutsu.userId, ctx.userId), gt(userJutsu.finishTraining, now)))
    .orderBy(asc(userJutsu.finishTraining))
    .limit(1);

/** Build the `userItem` selection for `getSidebarTimers`, using predicates on `userId` and `craftingFinishedAt`. */
export const selectUserItemForGetSidebarTimers = (
  client: Pick<DrizzleClient, "select">,
  ctx: { userId: string },
  now: SQL<unknown>,
) =>
  client
    .select({
      itemName: item.name,
      craftingStartedAt: userItem.createdAt,
      craftingFinishedAt: userItem.craftingFinishedAt,
    })
    .from(userItem)
    .innerJoin(item, eq(userItem.itemId, item.id))
    .where(and(eq(userItem.userId, ctx.userId), gt(userItem.craftingFinishedAt, now)))
    .orderBy(asc(userItem.craftingFinishedAt))
    .limit(1);

/** Build the `userItemImbuement` selection for `getSidebarTimers`, using predicates on `userId` and `craftingFinishedAt`. */
export const selectUserItemImbuementForGetSidebarTimers = (
  client: Pick<DrizzleClient, "select">,
  ctx: { userId: string },
  now: SQL<unknown>,
) =>
  client
    .select({
      imbuedName: imbuedItem.name,
      targetName: item.name,
      craftingStartedAt: userItemImbuement.createdAt,
      craftingFinishedAt: userItemImbuement.craftingFinishedAt,
    })
    .from(userItemImbuement)
    .innerJoin(userItem, eq(userItemImbuement.userItemId, userItem.id))
    .innerJoin(item, eq(userItem.itemId, item.id))
    .innerJoin(imbuedItem, eq(userItemImbuement.imbuementItemId, imbuedItem.id))
    .where(
      and(
        eq(userItem.userId, ctx.userId),
        gt(userItemImbuement.craftingFinishedAt, now),
      ),
    )
    .orderBy(asc(userItemImbuement.craftingFinishedAt))
    .limit(1);

/**
 * Build the `userData` update for `updateBattleDescription`, setting
 * `showBattleDescription`, using predicates on `userId`.
 */
export const updateUserDataForUpdateBattleDescription = (
  client: Pick<DrizzleClient, "update">,
  input: { showBattleDescription: false | true },
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({ showBattleDescription: input.showBattleDescription })
    .where(eq(userData.userId, ctx.userId));

/** Build the `userData` update for `updateTutorialStep`, setting `tutorialStep`, using predicates on `userId`. */
export const updateUserDataForUpdateTutorialStep = (
  client: Pick<DrizzleClient, "update">,
  input: { step: number },
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({ tutorialStep: input.step })
    .where(eq(userData.userId, ctx.userId));

/** Build the `abEvent` lookup for `updateTutorialStep`, using predicates on `ipHash`, `experiment`, `event`. */
export const findAbEventForUpdateTutorialStep = (
  client: Pick<DrizzleClient, "query">,
  ipHash: string,
  experiment: { experiment: string },
) =>
  client.query.abEvent.findFirst({
    where: and(
      eq(abEvent.ipHash, ipHash),
      eq(abEvent.experiment, experiment.experiment),
      eq(abEvent.event, "loaded"),
    ),
  });

/** Build the `abEvent` insert for `updateTutorialStep`, updating duplicate keys. */
export const insertAbEventForUpdateTutorialStep = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  experiment: { experiment: string },
  abLoadedEvent: { variant: string; source: null | string; userAgent: null | string },
  ipHash: string,
) =>
  client
    .insert(abEvent)
    .values({
      id: nanoid(),
      userId: ctx.userId,
      experiment: experiment.experiment,
      variant: abLoadedEvent.variant,
      event: "success",
      source: abLoadedEvent.source,
      ipHash,
      userAgent: abLoadedEvent.userAgent,
    })
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });

/** Build the `userData` update for `updatePreferences`, using predicates on `userId`. */
export const updateUserDataForUpdatePreferences = (
  client: Pick<DrizzleClient, "update">,
  input: import("@/validators/user").UpdateUserPreferencesSchema,
  ctx: { userId: string },
) => client.update(userData).set(input).where(eq(userData.userId, ctx.userId));

/** Build the `userBlackList` listing for `getBlacklist`, using predicates on `creatorUserId`. */
export const listUserBlackListForGetBlacklist = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.userBlackList.findMany({
    where: eq(userBlackList.creatorUserId, ctx.userId),
    with: {
      target: { columns: { username: true, userId: true, avatar: true } },
    },
  });

/** Build the `userBlackList` lookup for `toggleBlacklistEntry`, using predicates on `creatorUserId` and `targetUserId`. */
export const findUserBlackListForToggleBlacklistEntry = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
  input: { userId: string },
) =>
  client.query.userBlackList.findFirst({
    where: and(
      eq(userBlackList.creatorUserId, ctx.userId),
      eq(userBlackList.targetUserId, input.userId),
    ),
  });

/** Build a full user-row lookup by ID; unlike fetchUser, a missing account yields undefined. */
export const findUserById = (client: Pick<DrizzleClient, "query">, userId: string) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, userId),
  });

/** Build the `userBlackList` insert for `toggleBlacklistEntry`. */
export const insertUserBlackListForToggleBlacklistEntry = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: { userId: string },
) =>
  client.insert(userBlackList).values({
    creatorUserId: ctx.userId,
    targetUserId: input.userId,
  });

/** Build the `userBlackList` deletion for `toggleBlacklistEntry`, using predicates on `creatorUserId` and `targetUserId`. */
export const deleteUserBlackListForToggleBlacklistEntry = (
  client: Pick<DrizzleClient, "delete">,
  ctx: { userId: string },
  input: { userId: string },
) =>
  client
    .delete(userBlackList)
    .where(
      and(
        eq(userBlackList.creatorUserId, ctx.userId),
        eq(userBlackList.targetUserId, input.userId),
      ),
    );

/** Build the `userData` listing for `getAllAiNames`, including predicates on `isAi`, `rank`, `inArena`. */
export const listUserDataForGetAllAiNames = (
  client: Pick<DrizzleClient, "query">,
  input: { arenaOnly?: undefined | false | true } | undefined | null,
) =>
  client.query.userData.findMany({
    where: and(
      eq(userData.isAi, true),
      ne(userData.rank, "ELDER"),
      input?.arenaOnly ? eq(userData.inArena, true) : undefined,
      input?.arenaOnly ? eq(userData.isSummon, false) : undefined,
    ),
    columns: {
      userId: true,
      username: true,
      level: true,
      avatar: true,
      isSummon: true,
      inArena: true,
      aiProfileId: true,
    },
    orderBy: asc(userData.level),
  });

/** Build the `userData` selection for `levelUp`, using predicates on `userId`. */
export const selectUserDataForLevelUp = (
  client: Pick<DrizzleClient, "select">,
  ctx: { userId: string },
) =>
  client
    .select({
      pvpExperience: recruiterData.pvpExperience,
      weeklyPvpKills: recruiterData.weeklyPvpKills,
      weeklyPvpKillsAt: recruiterData.weeklyPvpKillsAt,
      isAi: recruiterData.isAi,
    })
    .from(userData)
    .innerJoin(recruiterData, eq(userData.recruiterId, recruiterData.userId))
    .where(eq(userData.userId, ctx.userId));

/** Build the `recruitmentRewards` insert for `levelUp`. */
export const insertRecruitmentRewardsForLevelUp = (
  client: Pick<DrizzleClient, "insert">,
  user: { recruiterId: string },
  ctx: { userId: string },
  amount: number,
) =>
  client.insert(recruitmentRewards).values({
    id: nanoid(),
    userId: user.recruiterId,
    recruitedUserId: ctx.userId,
    amount: amount,
    type: "MONEY",
  });

/** Build the `farmPlot` selection for `getUser`, using predicates on `userId`, `seedItemId`, `finishAt`. */
export const selectFarmPlotForGetUser = (
  client: Pick<DrizzleClient, "select">,
  ctx: { userId: string },
  now: Date,
) =>
  client
    .select({ count: count() })
    .from(farmPlot)
    .where(
      and(
        eq(farmPlot.userId, ctx.userId),
        isNotNull(farmPlot.seedItemId),
        isNotNull(farmPlot.finishAt),
        lte(farmPlot.finishAt, now),
      ),
    );

/** Build the `farmPlot` selection for `getUser`, including predicates on `userId`, `seedItemId`, `finishAt`. */
export const selectFarmPlotForGetUser2 = (
  client: Pick<DrizzleClient, "select">,
  ctx: { userId: string },
  now: Date,
  currentDayCycleStartedAt: Date,
) =>
  client
    .select({ count: count() })
    .from(farmPlot)
    .where(
      and(
        eq(farmPlot.userId, ctx.userId),
        isNotNull(farmPlot.seedItemId),
        isNotNull(farmPlot.finishAt),
        gt(farmPlot.finishAt, now),
        or(
          isNull(farmPlot.lastWateredAt),
          lt(farmPlot.lastWateredAt, currentDayCycleStartedAt),
        ),
      ),
    );

/** Build the `questParty` listing for `getUser`, using predicates on `invitedUserIds`. */
export const listQuestPartyForGetUser = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.questParty.findMany({
    where: sql`JSON_CONTAINS(${questParty.invitedUserIds}, JSON_QUOTE(${ctx.userId}))`,
    with: { quest: true },
  });

/** Build the `userReport` selection for `getUser`, using predicates on `status`. */
export const selectUserReportForGetUser = (client: Pick<DrizzleClient, "select">) =>
  client
    .select({ count: count() })
    .from(userReport)
    .innerJoin(userData, eq(userData.userId, userReport.reportedUserId))
    .where(inArray(userReport.status, ["UNVIEWED", "BAN_ESCALATED"]));

/** Build the `supportTicket` selection for `getUser`, using predicates on `status`. */
export const selectSupportTicketForGetUser = (client: Pick<DrizzleClient, "select">) =>
  client
    .select({ count: count() })
    .from(supportTicket)
    .where(inArray(supportTicket.status, ["OPEN", "IN_PROGRESS", "WAITING_FOR_STAFF"]));

/** Build the `staffApplication` selection for `getUser`, using predicates on `state` and `applicationId`. */
export const selectStaffApplicationForGetUser = (
  client: Pick<DrizzleClient, "select">,
  approvalGroup: StaffApprovalGroup,
  user: { userId: string },
) =>
  client
    .select({ count: count() })
    .from(staffApplication)
    .leftJoin(
      staffApplicationApproval,
      and(
        eq(staffApplication.id, staffApplicationApproval.applicationId),
        eq(staffApplicationApproval.group, approvalGroup),
        eq(staffApplicationApproval.approverUserId, user.userId),
      ),
    )
    .where(
      and(
        eq(staffApplication.state, "PENDING"),
        isNull(staffApplicationApproval.applicationId),
      ),
    );

/** Build the `contentProposal` selection for `getUser`, using predicates on `status`. */
export const selectContentProposalForGetUser = (
  client: Pick<DrizzleClient, "select">,
) =>
  client
    .select({ count: count() })
    .from(contentProposal)
    .where(eq(contentProposal.status, "PENDING"));

/** Claim only the loaded announcement counters so competing delivery or new feedback cannot be erased. */
export const claimUserAnnouncements = (
  client: Pick<DrizzleClient, "update">,
  user: { userId: string; unreadNotifications: number; unreadRecruitRewards: number },
  claimedAt: Date,
) =>
  client
    .update(userData)
    .set({ unreadNotifications: 0, unreadRecruitRewards: 0, updatedAt: claimedAt })
    .where(
      and(
        eq(userData.userId, user.userId),
        eq(userData.unreadNotifications, user.unreadNotifications),
        eq(userData.unreadRecruitRewards, user.unreadRecruitRewards),
      ),
    );

/** Build the notification listing for the loaded unread count. */
export const listNotificationForGetUser = (
  client: Pick<DrizzleClient, "query">,
  user: { unreadNotifications: number },
) =>
  client.query.notification.findMany({
    limit: user.unreadNotifications,
    orderBy: desc(notification.createdAt),
  });

/** Build the `userData` lookup for `getAi`, using predicates on `userId` and `isAi`. */
export const findUserDataForGetAi = (
  client: Pick<DrizzleClient, "query">,
  input: { userId: string },
) =>
  client.query.userData.findFirst({
    where: and(eq(userData.userId, input.userId), eq(userData.isAi, true)),
    with: { jutsus: { with: { jutsu: true } }, items: { with: { item: true } } },
  });

/** Build the `userData` insert for `create`. */
export const insertUserDataForCreate = (
  client: Pick<DrizzleClient, "insert">,
  id: string,
) =>
  client.insert(userData).values({
    userId: id,
    username: `New AI - ${id}`,
    gender: "Unknown",
    avatar: IMG_AVATAR_DEFAULT,
    avatarLight: IMG_AVATAR_DEFAULT,
    villageId: null,
    approvedTos: true,
    sector: 0,
    level: 100,
    isAi: true,
  });

/** Build the jutsu listing for a user. */
export const listUserJutsuByUserId = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.userJutsu.findMany({
    where: eq(userJutsu.userId, userId),
  });

/** Build the item listing for a user. */
export const listUserItemsByUserId = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) => client.query.userItem.findMany({ where: eq(userItem.userId, userId) });

/** Usernames among `candidates` that are already taken, for `cloneAi`. */
export const listTakenUsernamesForCloneAi = async (
  client: Pick<DrizzleClient, "query">,
  candidates: string[],
) =>
  (
    await client.query.userData.findMany({
      columns: { username: true },
      where: inArray(userData.username, candidates),
    })
  ).map((row) => row.username);

/** Build the `userData` insert for `cloneAi`. */
export const insertUserDataForCloneAi = (
  client: Pick<DrizzleClient, "insert">,
  aiData: import("@/drizzle/schema").UserData,
) => client.insert(userData).values(aiData);

/** Build the `userJutsu` insert for `cloneAi`. */
export const insertUserJutsuForCloneAi = (
  client: Pick<DrizzleClient, "insert">,
  jutsuData: import("@/drizzle/schema").UserJutsu[],
  aiData: { userId: string },
) =>
  client.insert(userJutsu).values(
    jutsuData.map((jutsu) => ({
      id: nanoid(),
      userId: aiData.userId,
      jutsuId: jutsu.jutsuId,
      level: jutsu.level,
    })),
  );

/** Build the `userItem` insert for `cloneAi`. */
export const insertUserItemForCloneAi = (
  client: Pick<DrizzleClient, "insert">,
  itemData: import("@/drizzle/schema").UserItem[],
  aiData: { userId: string },
) =>
  client.insert(userItem).values(
    itemData.map((item) => ({
      id: nanoid(),
      userId: aiData.userId,
      itemId: item.itemId,
      quantity: item.quantity,
    })),
  );

/** Build the `userNindo` insert for `cloneAi`, copying the content onto the clone. */
export const insertUserNindoForCloneAi = (
  client: Pick<DrizzleClient, "insert">,
  nindoData: { content: string },
  aiData: { userId: string },
) =>
  client
    .insert(userNindo)
    .values({ id: nanoid(), userId: aiData.userId, content: nindoData.content });

/** Build the `userData` lookup for `updateUser`, using predicates on `userId`. */
export const findUserDataForUpdateUser = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, input.id),
    with: { jutsus: true, items: true },
  });

/** Build the `sageMode` lookup for `updateUser`, selecting only `id`, using predicates on `id`. */
export const findSageModeForUpdateUser = (
  client: Pick<DrizzleClient, "query">,
  input: { data: { sageModeId: string } },
) =>
  client.query.sageMode.findFirst({
    where: eq(sageMode.id, input.data.sageModeId),
    columns: { id: true },
  });

/** Build the `actionLog` insert for `updateUser`. */
export const insertActionLogForUpdateUser = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  target: { userId: string; avatarLight: null | string },
  input: { data: { reason: string } },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "user",
    // relatedMsg is clamped to the column width; keep the full reason here.
    changes: [`Rejected reason: ${input.data.reason}`],
    relatedId: target.userId,
    relatedMsg: clampActionLogText(
      `Updated attempted. Reason rejected by AI: ${input.data.reason}`,
    ),
    relatedImage: target.avatarLight,
  });

/** Build the `userData` update for `updateUser`, setting `userId`, using predicates on `userId`. */
export const updateUserDataForUpdateUser = (
  client: Pick<DrizzleClient, "update">,
  target: { userId: string },
  usernameChanged: false | true,
  input: {
    data: {
      username: string;
      bloodlineId: null | string;
      villageId: null | string;
      rank: UserRank;
      bloodlineReskinId?: undefined | null | string;
      sageModeId: null | string;
      staffAccount?: undefined | false | true;
      rankedLp?: undefined | number;
      role: UserRole;
    };
  },
  bloodlineChanged: false | true,
  villageChanged: false | true,
  rankChanged: false | true,
  bloodlineReskinChanged: false | true,
  sageModeChanged: false | true,
  staffAccountChanged: false | true,
  rankedLpChanged: false | true,
  roleChanged: false | true,
  village: {
    type: "VILLAGE" | "OUTLAW" | "SAFEZONE" | "HIDEOUT" | "STRONGHOLD";
    sector: number;
  },
) =>
  client
    .update(userData)
    .set({
      userId: target.userId,
      ...(usernameChanged ? { username: input.data.username } : {}),
      ...(bloodlineChanged
        ? {
            ...bloodrightSwapRefund(input.data.bloodlineId),
            bloodlineId: input.data.bloodlineId,
          }
        : {}),
      ...(villageChanged
        ? {
            villageId: input.data.villageId,
            villageDutyVillageId: null,
            villageDutyStartedAt: null,
          }
        : {}),
      ...(rankChanged ? { rank: input.data.rank } : {}),
      ...(bloodlineReskinChanged
        ? { bloodlineReskinId: input.data.bloodlineReskinId ?? null }
        : {}),
      ...(sageModeChanged ? { sageModeId: input.data.sageModeId } : {}),
      ...(staffAccountChanged ? { staffAccount: input.data.staffAccount } : {}),
      ...(rankedLpChanged ? { rankedLp: input.data.rankedLp } : {}),
      ...(roleChanged ? { role: input.data.role } : {}),
      ...(villageChanged
        ? {
            isOutlaw: village.type === "OUTLAW",
            sector: village.sector,
            longitude: ALLIANCEHALL_LONG,
            latitude: ALLIANCEHALL_LAT,
          }
        : {}),
    })
    .where(eq(userData.userId, target.userId));

/** Build the `actionLog` insert for `updateUser`. */
export const insertActionLogForUpdateUser2 = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  diff: string[],
  target: { userId: string; avatarLight: null | string },
  input: { data: { reason: string } },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "user",
    // relatedMsg is clamped to the column width; keep the full reason in
    // changes when it would otherwise be cut off.
    changes:
      clampActionLogText(input.data.reason) === input.data.reason
        ? diff
        : [...diff, `Reason: ${input.data.reason}`],
    relatedId: target.userId,
    relatedMsg: clampActionLogText(input.data.reason),
    relatedImage: target.avatarLight,
  });

/** Build the `userData` lookup for `updateAi`, selecting only `userId`, using predicates on `username` and `userId`. */
export const findUserDataForUpdateAi = (
  client: Pick<DrizzleClient, "query">,
  newUsername: string,
  input: { id: string },
) =>
  client.query.userData.findFirst({
    columns: { userId: true },
    where: and(eq(userData.username, newUsername), ne(userData.userId, input.id)),
  });

/** Build the `userData` update for `updateAi`, using predicates on `userId`. */
export const updateUserDataForUpdateAi = (
  client: Pick<DrizzleClient, "update">,
  newAi: import("@/drizzle/schema").UserData,
  input: { id: string },
) => client.update(userData).set(newAi).where(eq(userData.userId, input.id));

/** Build the `actionLog` insert for `updateAi`. */
export const insertActionLogForUpdateAi = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  diff: string[],
  ai: { userId: string; username: string; avatar: null | string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "ai",
    changes: diff,
    relatedId: ai.userId,
    relatedMsg: `Update: ${ai.username}`,
    relatedImage: ai.avatar,
  });

/** Build the `userItem` update for `updateAi`, setting `dropChancePerc`, using predicates on `userId` and `itemId`. */
export const updateUserItemForUpdateAi = (
  client: Pick<DrizzleClient, "update">,
  chance: number,
  ai: { userId: string },
  id: string,
) =>
  client
    .update(userItem)
    .set({ dropChancePerc: chance })
    .where(and(eq(userItem.userId, ai.userId), eq(userItem.itemId, id)));

/** Look up username and user ID by username; execution stays with the caller. */
export const findUserDataForGetUsername = (
  client: Pick<DrizzleClient, "query">,
  input: { username: string },
) =>
  client.query.userData.findFirst({
    columns: { username: true, userId: true },
    where: eq(userData.username, input.username),
  });

/** Build the `userData` lookup for `updateUsername`, selecting only `username`, using predicates on `username`. */
export const findUserDataForUpdateUsername = (
  client: Pick<DrizzleClient, "query">,
  input: { username: string },
) =>
  client.query.userData.findFirst({
    columns: { username: true },
    where: eq(userData.username, input.username),
  });

/**
 * Build the `userData` update for `updateUsername`, setting `username` and
 * `reputationPoints`, using predicates on `userId`, `username`, `reputationPoints`.
 */
export const updateUserDataForUpdateUsername = (
  client: Pick<DrizzleClient, "update">,
  input: { username: string },
  ctx: { userId: string },
  user: { username: string; reputationPoints: number },
) =>
  client
    .update(userData)
    .set({
      username: input.username,
      reputationPoints: sql`${userData.reputationPoints} - ${COST_CHANGE_USERNAME}`,
    })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        eq(userData.username, user.username),
        eq(userData.reputationPoints, user.reputationPoints),
        gte(userData.reputationPoints, COST_CHANGE_USERNAME),
      ),
    );

/** Build the `actionLog` insert for `updateUsername`. */
export const insertActionLogForUpdateUsername = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  user: { username: string; avatarLight: null | string },
  input: { username: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "user",
    changes: [`Username changed from ${user.username} to ${input.username}`],
    relatedId: ctx.userId,
    relatedMsg: `Update: ${user.username} -> ${input.username}`,
    relatedImage: user.avatarLight,
  });

/**
 * Build the `userData` update for `updateTavernColor`, setting `reputationPoints`,
 * including predicates on `userId`, `isBanned`, `tavernUsernameColor`.
 */
export const updateUserDataForUpdateTavernColor = (
  client: Pick<DrizzleClient, "update">,
  colorUpdate:
    | {
        tavernUsernameColor: TavernColorPreset;
        tavernTitleColor?: undefined;
      }
    | {
        tavernTitleColor: TavernColorPreset;
        tavernUsernameColor?: undefined;
      },
  cost: number,
  ctx: { userId: string },
  input: {
    target: "username" | "title";
    currentColor: TavernColorPreset;
  },
) =>
  client
    .update(userData)
    .set({
      ...colorUpdate,
      reputationPoints: sql`${userData.reputationPoints} - ${cost}`,
    })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        eq(userData.isBanned, false),
        eq(
          input.target === "username"
            ? userData.tavernUsernameColor
            : userData.tavernTitleColor,
          input.currentColor,
        ),
        // FLOAT balances do not round-trip through exact SQL equality. The
        // floor and SQL debit preserve concurrent earnings and prevent overspending.
        gte(userData.reputationPoints, cost),
      ),
    );

/** Build the `actionLog` insert for `updateTavernColor`. */
export const insertActionLogForUpdateTavernColor = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: TavernColorChangeSchema,
  cost: number,
  user: { username: string; avatarLight: null | string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "user",
    changes: [
      `Tavern ${input.target} color changed from ${input.currentColor} to ${input.color} (-${cost} reputation)`,
    ],
    relatedId: ctx.userId,
    relatedMsg: `${user.username} changed their tavern ${input.target} color`,
    relatedImage: user.avatarLight,
  });

/** Build the `userAttribute` insert for `insertAttribute`, updating duplicate keys. */
export const insertUserAttributeForInsertAttribute = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  name: string,
) =>
  client
    .insert(userAttribute)
    .values({
      id: nanoid(),
      userId: ctx.userId,
      attribute: name,
    })
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });

/** Remove selected attribute rows for one account, including replaced exclusive choices. */
export const deleteUserAttributeForDeleteAttribute = (
  client: Pick<DrizzleClient, "delete">,
  names: readonly string[],
  ctx: { userId: string },
) =>
  client
    .delete(userAttribute)
    .where(
      and(
        inArray(userAttribute.attribute, [...names]),
        eq(userAttribute.userId, ctx.userId),
      ),
    );

/** Build the `userData` listing for `searchUsers`, including predicates on `username`, `approvedTos`, `isAi`. */
export const listUserDataForSearchUsers = (
  client: Pick<DrizzleClient, "query">,
  input: { username: string; showAi: false | true; showYourself: false | true },
  ctx: { userId: string },
) =>
  client.query.userData.findMany({
    extras: (table) => ({
      displayTitle: displayTitleSql(table).as("displayTitle"),
    }),
    columns: {
      ...userCardColumns,
      isAi: true,

      nRecruited: true,
      tavernMessages: true,
      tavernUsernameColor: true,
      tavernTitleColor: true,
    },
    with: {
      village: {
        columns: { name: true, hexColor: true, kageId: true },
      },
    },
    where: and(
      like(userData.username, `%${input.username}%`),
      eq(userData.approvedTos, true),
      ...(input.showAi ? [] : [eq(userData.isAi, false)]),
      ...(input.showYourself ? [] : [ne(userData.userId, ctx.userId)]),
    ),
    orderBy: [sql`LENGTH(${userData.username}) asc`],
    limit: 5,
  });

/** Build the `userData` lookup for `getPublicUser`, including predicates on `userId`, `attackedId`, `battleType`. */
export const findUserDataForGetPublicUser2 = (
  client: Pick<DrizzleClient, "query">,
  input: { userId: string },
) =>
  client.query.userData.findFirst({
    where: and(eq(userData.userId, input.userId)),
    extras: (table) => ({
      displayTitle: displayTitleSql(table).as("displayTitle"),
    }),
    columns: {
      aiProfileId: true,
      avatar: true,
      avatarLight: true,
      bloodlineId: true,
      sageModeId: true,
      curChakra: true,
      curHealth: true,
      curStamina: true,

      deletionAt: true,
      earnedExperience: true,
      experience: true,
      federalStatus: true,
      gender: true,
      isAi: true,
      isBanned: true,
      isSilenced: true,
      isOutlaw: true,
      lastIp: true,
      level: true,
      maxChakra: true,
      maxHealth: true,
      maxStamina: true,
      movedTooFastCount: true,
      pveFights: true,
      pvpWins: true,
      pvpLosses: true,
      showPvpRecord: true,
      rank: true,
      rankedLp: true,
      reputationPoints: true,
      role: true,
      senseiId: true,
      status: true,
      userId: true,
      username: true,
      villageId: true,
      tavernMessages: true,
      staffAccount: true,
      bloodlineReskinId: true,
      bracketImmunityLiftedUntil: true,
      warParticipantUntil: true,
    },
    with: {
      village: true,
      bloodline: true,
      sageMode: true,
      nindo: true,
      clan: true,
      jutsus: { with: { jutsu: { columns: { id: true, name: true } } } },
      items: { with: { item: { columns: { id: true, name: true } } } },
      badges: { with: { badge: true } },
      activeReskin: true,
      recruitedUsers: {
        columns: {
          userId: true,
          username: true,
          level: true,
          rank: true,
          isOutlaw: true,
          avatar: true,
        },
      },
      students: {
        columns: {
          userId: true,
          username: true,
          level: true,
          rank: true,
          isOutlaw: true,
          avatar: true,
        },
      },
      sensei: {
        columns: {
          userId: true,
          username: true,
        },
      },
      anbuSquad: {
        columns: {
          name: true,
        },
      },
      battleHistory: {
        columns: {
          battleType: true,
          createdAt: true,
        },
        where: and(
          eq(battleHistory.attackedId, input.userId),
          notInArray(battleHistory.battleType, ["SPARRING", "COMBAT"]),
          gte(battleHistory.createdAt, periodStart("daily", new Date())),
        ),
      },
    },
  });

/** Build the `userData` update for `getPublicUser`, setting `avatarLight`, using predicates on `userId`. */
export const updateUserDataForGetPublicUser = (
  client: Pick<DrizzleClient, "update">,
  thumbnail: null | string,
  user: { userId: string },
) =>
  client
    .update(userData)
    .set({ avatarLight: thumbnail })
    .where(eq(userData.userId, user.userId));

/** Build the `userData` selection for `countOnlineUsers`, using predicates on `updatedAt`. */
export const selectUserDataForCountOnlineUsers = (
  client: Pick<DrizzleClient, "select">,
) =>
  client
    .select({ count: count() })
    .from(userData)
    .where(gte(userData.updatedAt, secondsFromNow(-ONLINE_WINDOW_MINUTES * 60)));

/** Build the active-account count using a rolling one-day updatedAt cutoff. */
export const countUsersActiveInLastDay = (client: Pick<DrizzleClient, "select">) =>
  client
    .select({ count: count() })
    .from(userData)
    .where(gte(userData.updatedAt, secondsFromNow(-3600 * 24)));

/** Build the `userData` listing for `getStrongestUsers`, using predicates on `isAi`. */
export const listUserDataForGetStrongestUsers = (
  client: Pick<DrizzleClient, "query">,
) =>
  client.query.userData.findMany({
    extras: (table) => ({
      displayTitle: displayTitleSql(table).as("displayTitle"),
    }),
    columns: {
      userId: true,
      username: true,
      avatar: true,
      avatarLight: true,
      rankedLp: true,
    },
    where: eq(userData.isAi, false),
    orderBy: [desc(userData.rankedLp), desc(userData.experience)],
    limit: STRONGEST_USERS_COUNT,
  });

/** Build the `recruitmentRewards` listing for `getRecruitmentRewards`, using predicates on `userId`. */
export const listRecruitmentRewardsForGetRecruitmentRewards = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
  skip: number,
  input: { limit: number },
) =>
  client.query.recruitmentRewards.findMany({
    where: eq(recruitmentRewards.userId, ctx.userId),
    with: {
      recruitedUser: {
        columns: { userId: true, username: true, avatar: true },
      },
    },
    offset: skip,
    limit: input.limit,
    orderBy: desc(recruitmentRewards.createdAt),
  });

/**
 * Build a timer-only update from the caller's authorized snapshot.
 * Concurrent toggles can restart or cancel the reversible wait; permanent deletion
 * remains a separate guarded operation.
 */
export const updateUserDataForToggleDeletionTimer = (
  client: Pick<DrizzleClient, "update">,
  deletionAt: null | Date,
  input: { userId: string },
) =>
  client
    .update(userData)
    .set({
      deletionAt,
    })
    .where(eq(userData.userId, input.userId));

/** Build the `userVote` lookup for `claimVotes`, using predicates on `userId`. */
export const findUserVoteForClaimVotes = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.userVote.findFirst({
    where: eq(userVote.userId, ctx.userId),
  });

/**
 * Execute the claim of a completed vote set together with its reputation credit. One
 * guarded multi-table UPDATE flips `claimed` and credits the voter atomically, so only the
 * request that claims the votes is credited; zero affected rows means nothing was claimed.
 */
export const executeClaimVotes = (
  client: Pick<DrizzleClient, "execute">,
  secret: string,
  ctx: { userId: string },
) =>
  client.execute(sql`
    UPDATE ${userVote} INNER JOIN ${userData} ON ${userData.userId} = ${userVote.userId}
    SET ${userVote.claimed} = true,
        ${userVote.totalClaims} = ${userVote.totalClaims} + 1,
        ${userVote.secret} = ${secret},
        ${userData.reputationPoints} = ${userData.reputationPoints} + ${VOTE_REWARD_REPUTATION},
        ${userData.reputationPointsTotal} = ${userData.reputationPointsTotal} + ${VOTE_REWARD_REPUTATION}
    WHERE ${and(
      eq(userVote.userId, ctx.userId),
      eq(userVote.claimed, false),
      ...ACTIVE_VOTING_SITES.map((site) => eq(userVote[site], true)),
    )}
  `);

/** Build the `userPet` listing for `getPetImageGenerationForStaff`, using predicates on `userId`. */
export const listUserPetForGetPetImageGenerationForStaff = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) =>
  client.query.userPet.findMany({
    where: eq(userPet.userId, input.id),
    columns: {
      id: true,
      name: true,
      generationStatus: true,
      generationAttempts: true,
    },
  });

/** Build a pet lookup constrained to its owner. */
export const findOwnedUserPet = (
  client: Pick<DrizzleClient, "query">,
  petId: string,
  userId: string,
) =>
  client.query.userPet.findFirst({
    where: and(eq(userPet.id, petId), eq(userPet.userId, userId)),
  });

/** Build the `userPet` update for `resetPetImageGeneration`, using predicates on `id`, `userId`, `revision`. */
export const updateUserPetForResetPetImageGeneration = (
  client: Pick<DrizzleClient, "update">,
  pet: {
    generationStatus: "PENDING" | "GENERATING" | "READY" | "FAILED";
    avatar: null | string;
    artRank: number;
    rank: number;
    id: string;
    revision: number;
  },
  now: Date,
  input: { userId: string },
) =>
  client
    .update(userPet)
    .set({
      generationAttempts: 0,
      generationStartedAt: null,
      generationToken: null,
      // Expired redraws retain usable art; unfinished evolutions remain retryable.
      generationStatus:
        pet.generationStatus === "GENERATING"
          ? pet.avatar && pet.artRank === pet.rank
            ? "READY"
            : "FAILED"
          : pet.generationStatus,
      revision: sql`${userPet.revision} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(userPet.id, pet.id),
        eq(userPet.userId, input.userId),
        eq(userPet.revision, pet.revision),
      ),
    );

/** Build the `actionLog` insert for `resetPetImageGeneration`. */
export const insertActionLogForResetPetImageGeneration = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: { userId: string; reason: string },
  pet: { name: string; id: string; generationAttempts: number; avatar: null | string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "user",
    relatedId: input.userId,
    relatedMsg: clampActionLogText(input.reason),
    changes: [
      `Reset companion image attempts for ${pet.name} (${pet.id}) from ${pet.generationAttempts} to 0`,
    ],
    relatedImage: pet.avatar,
  });

/**
 * Build the `userData` lookup for `getSeichiSilverForStaff`, selecting only
 * `seichiSilver`, using predicates on `userId`.
 */
export const findUserDataForGetSeichiSilverForStaff = (
  client: Pick<DrizzleClient, "query">,
  input: { userId: string },
) =>
  client.query.userData.findFirst({
    columns: { seichiSilver: true },
    where: eq(userData.userId, input.userId),
  });

/** Build the `actionLog` insert for `adjustSeichiSilver`. */
export const insertActionLogForAdjustSeichiSilver = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  target: { userId: string; avatarLight: null | string },
  input: { reason: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "user",
    changes: [],
    relatedId: target.userId,
    relatedMsg: clampActionLogText(
      `Seichi Silver adjustment rejected by AI: ${input.reason}`,
    ),
    relatedImage: target.avatarLight,
  });

/** Build the `actionLog` insert for `adjustSeichiSilver`. */
export const insertActionLogForAdjustSeichiSilver2 = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  change: string,
  target: { userId: string; avatarLight: null | string },
  input: { reason: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "user",
    changes: [change],
    relatedId: target.userId,
    relatedMsg: clampActionLogText(input.reason),
    relatedImage: target.avatarLight,
  });

/**
 * Build the `userData` update for `awardExperience`, setting `earnedExperience` and
 * `petExperience`, using predicates on `userId`.
 */
export const updateUserDataForAwardExperience = (
  client: Pick<DrizzleClient, "update">,
  input: { amount: number; targetUserId: string },
) =>
  client
    .update(userData)
    .set({
      earnedExperience: sql`${userData.earnedExperience} + ${input.amount}`,
      petExperience: petExperienceGainSql(input.amount),
    })
    .where(eq(userData.userId, input.targetUserId));

/** Build the `actionLog` insert for `awardExperience`. */
export const insertActionLogForAwardExperience = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: { amount: number },
  target: { userId: string; username: string; avatarLight: null | string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "user",
    changes: [`Awarded ${input.amount} experience points`],
    relatedId: target.userId,
    relatedMsg: `Experience awarded to ${target.username}`,
    relatedImage: target.avatarLight,
  });

/** Build the `userData` update for `awardExperienceToAll`, setting `earnedExperience` and `petExperience`. */
export const updateUserDataForAwardExperienceToAll = (
  client: Pick<DrizzleClient, "update">,
  input: { amount: number },
) =>
  client.update(userData).set({
    earnedExperience: sql`${userData.earnedExperience} + ${input.amount}`,
    petExperience: petExperienceGainSql(input.amount),
  });

/** Build the `actionLog` insert for `awardExperienceToAll`. */
export const insertActionLogForAwardExperienceToAll = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: { amount: number },
  awarder: { avatarLight: null | string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "user",
    changes: [`Mass awarded ${input.amount} experience points to all users`],
    relatedId: null,
    relatedMsg: `Mass experience awarded`,
    relatedImage: awarder.avatarLight,
  });

/** Build a user’s nindo lookup. */
export const findUserNindoByUserId = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.userNindo.findFirst({
    where: eq(userNindo.userId, userId),
  });

/** Build the `userNindo` update for `updateNindo`, setting `content`, using predicates on `userId`. */
export const updateUserNindoForUpdateNindo = (
  client: Pick<DrizzleClient, "update">,
  sanitized: string,
  userId: string,
) =>
  client
    .update(userNindo)
    .set({ content: sanitized })
    .where(eq(userNindo.userId, userId));

/** Build the `userNindo` insert for `updateNindo`. */
export const insertUserNindoForUpdateNindo = (
  client: Pick<DrizzleClient, "insert">,
  userId: string,
  sanitized: string,
) =>
  client.insert(userNindo).values({
    id: nanoid(),
    userId: userId,
    content: sanitized,
  });

/** Build the `jutsu` listing for `computeUserContentChanges`, selecting only `id` and `name`, using predicates on `id`. */
export const listJutsuForComputeUserContentChanges = (
  client: Pick<DrizzleClient, "query">,
  oldJutsuIds: string[],
  newJutsuIds: string[],
) =>
  client.query.jutsu.findMany({
    where: inArray(jutsu.id, oldJutsuIds.concat(newJutsuIds)),
    columns: { id: true, name: true },
  });

/** Build the `item` listing for `computeUserContentChanges`, selecting only `id` and `name`, using predicates on `id`. */
export const listItemForComputeUserContentChanges = (
  client: Pick<DrizzleClient, "query">,
  oldItemIds: string[],
  newItemIds: string[],
) =>
  client.query.item.findMany({
    where: inArray(item.id, oldItemIds.concat(newItemIds)),
    columns: { id: true, name: true },
  });

/** Build the `userJutsu` deletion for `applyUserContentChanges`, using predicates on `userId` and `jutsuId`. */
export const deleteUserJutsuForApplyUserContentChanges = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
  deletedJutsuIds: string[],
) =>
  client
    .delete(userJutsu)
    .where(
      and(eq(userJutsu.userId, userId), inArray(userJutsu.jutsuId, deletedJutsuIds)),
    );

/** Build the `userItem` deletion for `applyUserContentChanges`, using predicates on `userId` and `itemId`. */
export const deleteUserItemForApplyUserContentChanges = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
  deletedItemIds: string[],
) =>
  client
    .delete(userItem)
    .where(and(eq(userItem.userId, userId), inArray(userItem.itemId, deletedItemIds)));

/** Build the `userJutsu` insert for `applyUserContentChanges`, updating duplicate keys. */
export const insertUserJutsuForApplyUserContentChanges = (
  client: Pick<DrizzleClient, "insert">,
  insertedJutsuIds: string[],
  userId: string,
) =>
  client
    .insert(userJutsu)
    .values(
      insertedJutsuIds.map((jutsuId) => ({
        id: nanoid(),
        userId: userId,
        jutsuId: jutsuId,
        level: 1,
        equipped: true,
      })),
    )
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });

/** Build the `userItem` insert for `applyUserContentChanges`. */
export const insertUserItemForApplyUserContentChanges = (
  client: Pick<DrizzleClient, "insert">,
  insertedItemIds: string[],
  userId: string,
) =>
  client.insert(userItem).values(
    insertedItemIds.map((itemId) => ({
      id: nanoid(),
      userId: userId,
      itemId: itemId,
      equipped: "CHEST" as const,
    })),
  );

/** Build the `userData` lookup for `queryUpdatedUser`, including predicates on `userId`, `equipped`, `quantity`. */
export const findUserDataForQueryUpdatedUser = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, userId),
    extras: (table) => ({
      territoryWarBoostWindows: territoryWarBoostWindowsSql(table).as(
        "territoryWarBoostWindows",
      ),
      ...activityCompletionExtras(table.userId),
      displayTitle: displayTitleSql(table).as("displayTitle"),
    }),
    with: {
      attributes: true,
      bloodline: true,
      questParty: { with: questPartyRelations },
      sageMode: true,
      activeReskin: true,
      clan: true,
      village: {
        with: {
          structures: true,
          relationshipA: true,
          relationshipB: true,
          sectors: {
            columns: { sector: true, boostLockedUntil: true, shrineLevel: true },
          },
        },
      },
      anbuSquad: {
        columns: { id: true, name: true, points: true, stealthLevel: true },
      },
      loadout: {
        columns: { jutsuIds: true },
      },
      promotions: {
        limit: 1,
      },
      items: {
        where: and(ne(userItem.equipped, "NONE"), gt(userItem.quantity, 0)),
        with: {
          activeVariant: true,
          item: true,
          imbuements: { with: { item: true } },
        },
      },
      userQuests: {
        ...userQuestHistoryRelation,
        orderBy: sql`FIELD(${questHistory.questType}, 'daily', 'tier') ASC`,
      },
      completedQuests: completedQuestHistoryRelation,
      votes: true,
      titles: { with: { title: true } },
      userSkills: { where: eq(userSkill.activated, true), with: { skill: true } },
      cookingJobs: true,
      raidBuffs: true,
      // Every queue entry, in the same query: users without queues pay nothing extra.
      queue: { orderBy: asc(userQueue.position) },
    },
  });

/** Build the `userVote` insert for `fetchUpdatedUserOnce`. */
export const insertUserVoteForFetchUpdatedUserOnce = (
  client: Pick<DrizzleClient, "insert">,
  user: { userId: string },
  smallNanoid: (size?: number) => string,
) =>
  client.insert(userVote).values({
    id: nanoid(),
    userId: user.userId,
    lastVoteAt: new Date(),
    secret: smallNanoid(),
  });

/**
 * Build the `questHistory` update for `fetchUpdatedUserOnce`, setting `endAt`,
 * including predicates on `id`, `userId`, `isolated`.
 */
export const updateQuestHistoryForFetchUpdatedUserOnce = (
  client: Pick<DrizzleClient, "update" | "select">,
  now: Date,
  orphanedIsolatedIds: string[],
  userId: string,
) =>
  client
    .update(questHistory)
    .set({ endAt: now })
    .where(
      and(
        inArray(questHistory.id, orphanedIsolatedIds),
        eq(questHistory.userId, userId),
        eq(questHistory.isolated, true),
        eq(questHistory.completed, 0),
        isNull(questHistory.endAt),
        notExists(
          client
            .select({ one: sql`1` })
            .from(quest)
            .where(eq(quest.id, questHistory.questId)),
        ),
      ),
    );

/** Build the `questHistory` selection for `where`, including predicates on `userId`, `isolated`, `completed`. */
export const selectQuestHistoryForWhere = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
) =>
  client
    .select({ one: sql`1` })
    .from(questHistory)
    .innerJoin(quest, eq(quest.id, questHistory.questId))
    .where(
      and(
        eq(questHistory.userId, userId),
        eq(questHistory.isolated, true),
        eq(questHistory.completed, 0),
        isNull(questHistory.endAt),
      ),
    );

/**
 * Build the `userData` lookup for `fetchUpdatedUserOnce`, selecting only
 * `bracketImmunityLiftedUntil` and `bracketImmunityPausedAt`, using predicates on
 * `userId`.
 */
export const findUserDataForFetchUpdatedUserOnce = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.userData.findFirst({
    columns: { bracketImmunityLiftedUntil: true, bracketImmunityPausedAt: true },
    where: eq(userData.userId, userId),
  });

/** Build the `village` lookup for `fetchUpdatedUserOnce`, using predicates on `type`. */
export const findVillageForFetchUpdatedUserOnce = (
  client: Pick<DrizzleClient, "query">,
) =>
  client.query.village.findFirst({
    where: eq(village.type, "OUTLAW"),
    with: { structures: true },
  });

/** Build the `userData` update for `fetchUpdatedUserOnce`, using predicates on `userId`, `villagePrestige`, `isOutlaw`. */
export const updateUserDataForFetchUpdatedUserOnce = (
  client: Pick<DrizzleClient, "update">,
  kickUpdate: {
    villagePrestige: number;
    villageId: string;
    isOutlaw: false | true;
    joinedVillageAt: Date;
  },
  user: { userId: string; villagePrestige: number },
  expectedVillage: SQL<unknown>,
) =>
  client
    .update(userData)
    .set(kickUpdate)
    .where(
      and(
        eq(userData.userId, user.userId),
        eq(userData.villagePrestige, user.villagePrestige),
        eq(userData.isOutlaw, false),
        expectedVillage,
      ),
    );

/**
 * Build the `village` update for `fetchUpdatedUserOnce`, setting `kageId` and
 * `leaderUpdatedAt`, using predicates on `id`.
 */
export const updateVillageForFetchUpdatedUserOnce = (
  client: Pick<DrizzleClient, "update">,
  elder: { userId: string },
  previousVillageId: string,
) =>
  client
    .update(village)
    .set({ kageId: elder.userId, leaderUpdatedAt: new Date() })
    .where(eq(village.id, previousVillageId));

/** Build the `userData` update for `fetchUpdatedUserOnce`, setting `villagePrestige`, using predicates on `userId`. */
export const updateUserDataForFetchUpdatedUserOnce2 = (
  client: Pick<DrizzleClient, "update">,
  user: { userId: string },
) =>
  client
    .update(userData)
    .set({ villagePrestige: KAGE_PRESTIGE_REQUIREMENT })
    .where(eq(userData.userId, user.userId));

/** Build the `historicalIp` upsert recording that a user was seen on an IP. */
export const upsertHistoricalIp = (
  client: Pick<DrizzleClient, "insert">,
  userId: string,
  userIp: string,
) =>
  client
    .insert(historicalIp)
    .values({
      userId,
      ip: userIp,
      ipHash: hashIp(userIp),
    })
    .onDuplicateKeyUpdate({
      set: { usedAt: new Date(), ipHash: hashIp(userIp) },
    });

/** Build the `trainingLog` insert for `persistPassiveRegenToDb`. */
export const insertTrainingLogForPersistPassiveRegenToDb = (
  client: Pick<DrizzleClient, "insert">,
  queuedTraining: {
    completed: {
      stat: CombatStatName;
      amount: number;
    }[];
  },
  userId: string,
  user: { trainingSpeed: TrainingSpeed },
  claim: { claimedAt: Date },
) =>
  client.insert(trainingLog).values(
    queuedTraining.completed.map((entry) => ({
      userId,
      stat: entry.stat,
      amount: entry.amount,
      speed: user.trainingSpeed,
      trainingFinishedAt: claim.claimedAt,
    })),
  );

/** Build the `trainingLog` insert for `persistPassiveRegenToDb`. */
export const insertTrainingLogForPersistPassiveRegenToDb2 = (
  client: Pick<DrizzleClient, "insert">,
  queuedMastery: {
    completed: {
      stat: TimedMasteryName;
      amount: number;
      minutes: number;
      speed: TrainingSpeed;
      finishedAt: Date;
    }[];
  },
  userId: string,
) =>
  client.insert(trainingLog).values(
    queuedMastery.completed.map((entry) => ({
      userId,
      stat: entry.stat,
      amount: entry.amount,
      speed: entry.speed,
      trainingFinishedAt: entry.finishedAt,
    })),
  );

/** Build the `quest` selection for `fetchQuestBootstrap`, using predicates on `questType`. */
export const selectQuestForFetchQuestBootstrap = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
  BOOTSTRAP_QUEST_TYPES: readonly ["tier", "exam"],
) =>
  client
    .select({
      id: quest.id,
      questType: quest.questType,
      requiredLevel: quest.requiredLevel,
      maxLevel: quest.maxLevel,
      completed: questHistory.completed,
    })
    .from(quest)
    .leftJoin(
      questHistory,
      and(eq(questHistory.questId, quest.id), eq(questHistory.userId, userId)),
    )
    .where(inArray(quest.questType, [...BOOTSTRAP_QUEST_TYPES]));

/** Build deletion of all attributes belonging to one user. */
export const deleteUserAttributes = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(userAttribute).where(eq(userAttribute.userId, userId));

/** Build the AWAKE-to-QUEUED state change; the caller owns queue admission and must check rowsAffected. */
export const queueAwakeUser = (
  client: Pick<DrizzleClient, "update">,
  ctx: { userId: string },
  readiness?: ActionReadinessWrite,
) =>
  client
    .update(userData)
    .set({ ...readiness?.set, status: "QUEUED" })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        readiness?.where ?? eq(userData.status, "AWAKE"),
      ),
    );

/** Build a wake-up update guarded by the user still being queued. */
export const wakeQueuedUser = (client: Pick<DrizzleClient, "update">, userId: string) =>
  client
    .update(userData)
    .set({ status: "AWAKE" })
    .where(
      and(
        eq(userData.userId, userId),
        eq(userData.status, "QUEUED"),
        withoutDungeonReservation(),
      ),
    );

/** Build an atomic money increment for one user. */
export const incrementUserMoney = (
  client: Pick<DrizzleClient, "update">,
  amount: number,
  userId: string,
) =>
  client
    .update(userData)
    .set({ money: sql`${userData.money} + ${amount}` })
    .where(eq(userData.userId, userId));

/** Build a money debit guarded by the user’s available balance. */
export const debitUserMoney = (
  client: Pick<DrizzleClient, "update">,
  amountRyo: number,
  ctx: { userId: string },
  readiness?: ActionReadinessWrite,
) =>
  client
    .update(userData)
    .set({ ...readiness?.set, money: sql`${userData.money} - ${amountRyo}` })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        gte(userData.money, amountRyo),
        readiness?.where,
      ),
    );

/** Build the `userData` lookup, using predicates on `userId`. */
export const findUserWithBloodline = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, ctx.userId),
    with: { bloodline: true },
  });

/** Build an account-existence lookup selecting only userId, without loading the full profile. */
export const findUserIdentityById = (
  client: Pick<DrizzleClient, "query">,
  targetUserId: string,
) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, targetUserId),
    columns: { userId: true },
  });

/** Build a role-only account lookup for server-side permission checks; a missing account yields undefined. */
export const findUserRoleById = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.userData.findFirst({
    columns: { role: true },
    where: eq(userData.userId, userId),
  });

/**
 * Role of a possibly signed-out viewer of a public endpoint. Defaults to "USER" so an
 * unauthenticated visitor is treated exactly like an ordinary player.
 */
export const fetchViewerRole = async (
  client: Pick<DrizzleClient, "query">,
  userId: string | null | undefined,
): Promise<UserRole> => {
  if (!userId) return "USER";
  const viewer = await findUserRoleById(client, userId);
  return viewer?.role ?? "USER";
};

/** Build a public-profile row by ID with its display title and village; callers apply indexability checks. */
export const findPublicProfileById = (
  client: Pick<DrizzleClient, "query">,
  userid: string,
) =>
  client.query.userData.findFirst({
    extras: (table) => ({ displayTitle: displayTitleSql(table).as("displayTitle") }),
    columns: {
      username: true,
      level: true,
      rank: true,
      isOutlaw: true,
      avatar: true,

      updatedAt: true,
      isAi: true,
      isBanned: true,
      deletionAt: true,
    },
    with: { village: { columns: { name: true } } },
    where: eq(userData.userId, userid),
  });

/**
 * Build a public-profile row for a URI-decoded username, including its ID, display
 * title and village. Malformed encodings retain decodeURIComponent errors.
 */
export const findPublicProfileByUsername = (
  client: Pick<DrizzleClient, "query">,
  username: string,
) =>
  client.query.userData.findFirst({
    extras: (table) => ({ displayTitle: displayTitleSql(table).as("displayTitle") }),
    columns: {
      userId: true,
      username: true,
      level: true,
      rank: true,
      isOutlaw: true,
      avatar: true,

      updatedAt: true,
      isAi: true,
      isBanned: true,
      deletionAt: true,
    },
    with: { village: { columns: { name: true } } },
    where: eq(userData.username, decodeURIComponent(username)),
  });

/**
 * Thin userData fetch for the loadout endpoints: only the columns needed to
 * derive the federal loadout allowance and read the active-loadout pointers,
 * instead of the full row that fetchUser returns.
 */
export const fetchLoadoutUser = async (client: DrizzleClient, userId: string) => {
  return await client.query.userData.findFirst({
    where: eq(userData.userId, userId),
    columns: {
      userId: true,
      federalStatus: true,
      staffAccount: true,
      itemLoadout: true,
      jutsuLoadout: true,
    },
  });
};

/** Build deletion of a user’s nindo by owner ID; moderation and account cleanup keep their guards in callers. */
export const deleteUserNindo = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(userNindo).where(eq(userNindo.userId, userId));

/** Build an atomic reputation-points refund to one user; callers determine the amount and eligibility. */
export const refundUserReputationPoints = (
  client: Pick<DrizzleClient, "update">,
  amount: number,
  userId: string,
) =>
  client
    .update(userData)
    .set({ reputationPoints: sql`${userData.reputationPoints} + ${amount}` })
    .where(eq(userData.userId, userId));

/** Build an atomic village-prestige increment for one user; callers determine reward or transfer eligibility. */
export const incrementUserVillagePrestige = (
  client: Pick<DrizzleClient, "update">,
  amount: number,
  userId: string,
) =>
  client
    .update(userData)
    .set({ villagePrestige: sql`${userData.villagePrestige} + ${amount}` })
    .where(eq(userData.userId, userId));
