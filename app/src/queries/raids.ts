/**
 * Database access for raids; authorization and transaction scopes stay in callers.
 */
import {
  and,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  like,
  lt,
  lte,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  RAID_CLAIMING_TIMEOUT_MS,
  RAID_MAX_CONCURRENT_TEAMS,
} from "@/drizzle/constants";
import {
  conversation,
  mpvpBattleQueue,
  mpvpBattleUser,
  quest,
  raidDamageThreshold,
  raidParticipation,
  sector,
  user2conversation,
  userData,
  userRaidBuff,
  userRequest,
  war,
} from "@/drizzle/schema";
import { RAID_CHAT_CONVERSATION_LIKE_PATTERN } from "@/libs/raids";
import { withoutDungeonReservation } from "@/queries/dungeonReservation";
import { activeWarAllyWhere } from "@/queries/war";
import type { DrizzleClient } from "@/server/db";

/** Build the `quest` listing for `getCompletedRaids`, including predicates on `questType`, `hidden`, `raidEndsAt`. */
export const listQuestForGetCompletedRaids = (
  client: Pick<DrizzleClient, "query">,
  now: Date,
  ctx: { userId: string },
  limit: number,
) =>
  client.query.quest.findMany({
    where: and(
      eq(quest.questType, "raid"),
      eq(quest.hidden, false),
      sql`(${quest.raidEndsAt} < ${now} OR ${quest.raidBossCurrentHealth} <= 0)`,
    ),
    with: {
      raidParticipations: {
        where: eq(raidParticipation.userId, ctx.userId),
        limit: 1,
      },
    },
    orderBy: desc(quest.raidEndsAt),
    limit,
  });

/**
 * Build the `quest` listing for `getAvailableRaids`, including predicates on
 * `questType`, `hidden`, `raidBossCurrentHealth`.
 */
export const listQuestForGetAvailableRaids = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.quest.findMany({
    where: and(
      eq(quest.questType, "raid"),
      eq(quest.hidden, false),
      gte(quest.raidBossCurrentHealth, 1),
    ),
    with: {
      raidParticipations: {
        where: eq(raidParticipation.userId, ctx.userId),
        limit: 1,
      },
    },
    orderBy: desc(quest.createdAt),
  });

/** Build the `war` listing for `getAvailableRaids`, including predicates on `type`, `endedAt`, `defenderShrineHp`. */
export const listWarForGetAvailableRaids = (
  client: Pick<DrizzleClient, "query">,
  input: { sector?: undefined | number } | undefined | null,
) =>
  client.query.war.findMany({
    where: and(
      eq(war.type, "SECTOR_WAR"),
      isNull(war.endedAt),
      lte(war.defenderShrineHp, 0),
      input?.sector !== undefined ? eq(war.sector, input.sector) : undefined,
    ),
    columns: { id: true, sector: true, attackerVillageId: true },
    with: {
      warAllies: {
        where: activeWarAllyWhere(),
        columns: { villageId: true, supportVillageId: true },
      },
    },
  });

/** Build the `quest` lookup for `getRaidDetails`, using predicates on `id` and `questType`. */
export const findQuestForGetRaidDetails = (
  client: Pick<DrizzleClient, "query">,
  input: { questId: string },
) =>
  client.query.quest.findFirst({
    where: and(eq(quest.id, input.questId), eq(quest.questType, "raid")),
  });

/** Build the `raidParticipation` lookup for `getRaidDetails`, using predicates on `questId` and `userId`. */
export const findRaidParticipationForGetRaidDetails = (
  client: Pick<DrizzleClient, "query">,
  input: { questId: string },
  ctx: { userId: string },
) =>
  client.query.raidParticipation.findFirst({
    where: and(
      eq(raidParticipation.questId, input.questId),
      eq(raidParticipation.userId, ctx.userId),
    ),
  });

/** Build the `raidDamageThreshold` listing for `getRaidDetails`, using predicates on `questId`. */
export const listRaidDamageThresholdForGetRaidDetails = (
  client: Pick<DrizzleClient, "query">,
  input: { questId: string },
) =>
  client.query.raidDamageThreshold.findMany({
    where: eq(raidDamageThreshold.questId, input.questId),
    orderBy: raidDamageThreshold.sortOrder,
  });

/**
 * Build the `user2conversation` lookup for `getRaidDetails`, selecting only
 * `conversationId`, using predicates on `conversationId` and `userId`.
 */
export const findUser2conversationForGetRaidDetails = (
  client: Pick<DrizzleClient, "query">,
  raidChatConversationId: string,
  ctx: { userId: string },
) =>
  client.query.user2conversation.findFirst({
    where: and(
      eq(user2conversation.conversationId, raidChatConversationId),
      eq(user2conversation.userId, ctx.userId),
    ),
    columns: { conversationId: true },
  });

/** Build the `raidParticipation` listing for `getRaidLeaderboard`, using predicates on `questId`. */
export const listRaidParticipationForGetRaidLeaderboard = (
  client: Pick<DrizzleClient, "query">,
  input: { questId: string; limit: number },
  offset: number,
) =>
  client.query.raidParticipation.findMany({
    where: eq(raidParticipation.questId, input.questId),
    orderBy: desc(raidParticipation.damageDealt),
    limit: input.limit + 1,
    offset,
    with: {
      user: {
        columns: {
          username: true,
          avatar: true,
          rank: true,
          level: true,
        },
      },
    },
  });

/** Build the `mpvpBattleUser` lookup for `getUserRaidQueue`, using predicates on `userId`. */
export const findMpvpBattleUserForGetUserRaidQueue = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.mpvpBattleUser.findFirst({
    where: eq(mpvpBattleUser.userId, ctx.userId),
    with: {
      clanBattle: {
        with: {
          queue: {
            with: {
              user: {
                columns: {
                  username: true,
                  avatar: true,
                },
              },
            },
          },
        },
      },
    },
  });

/**
 * Build the `quest` lookup for `getUserRaidQueue`, selecting only `raidEndsAt` and
 * `raidBossCurrentHealth`, using predicates on `id`.
 */
export const findQuestForGetUserRaidQueue = (
  client: Pick<DrizzleClient, "query">,
  queue: { clanBattle: { attackerEntityId: string } },
) =>
  client.query.quest.findFirst({
    where: eq(quest.id, queue.clanBattle.attackerEntityId),
    columns: { raidEndsAt: true, raidBossCurrentHealth: true },
  });

/** Build the `userRaidBuff` listing for `getUserRaidBuffs`, using predicates on `userId` and `expiresAt`. */
export const listUserRaidBuffForGetUserRaidBuffs = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
  now: Date,
) =>
  client.query.userRaidBuff.findMany({
    where: and(eq(userRaidBuff.userId, ctx.userId), gt(userRaidBuff.expiresAt, now)),
    with: {
      item: { columns: { name: true, image: true } },
      quest: {
        columns: {
          name: true,
          image: true,
        },
      },
    },
  });

/** Build the `raidDamageThreshold` insert for `createDamageThreshold`. */
export const insertRaidDamageThresholdForCreateDamageThreshold = (
  client: Pick<DrizzleClient, "insert">,
  input: {
    questId: string;
    damageRequired: number;
    sortOrder: number;
    rewards: import("@/validators/rewards").ObjectiveRewardType;
    effects: import("@/validators/combat").ZodAllTags[];
    effectDurationMinutes: number;
  },
) =>
  client.insert(raidDamageThreshold).values({
    id: nanoid(),
    questId: input.questId,
    damageRequired: input.damageRequired,
    sortOrder: input.sortOrder,
    rewards: input.rewards,
    effects: input.effects,
    effectDurationMinutes: input.effectDurationMinutes,
  });

/** Build the `raidDamageThreshold` update for `updateDamageThreshold`, using predicates on `id`. */
export const updateRaidDamageThresholdForUpdateDamageThreshold = (
  client: Pick<DrizzleClient, "update">,
  input: {
    damageRequired: number;
    sortOrder: number;
    rewards: import("@/validators/rewards").ObjectiveRewardType;
    effects: import("@/validators/combat").ZodAllTags[];
    effectDurationMinutes: number;
    thresholdId: string;
  },
) =>
  client
    .update(raidDamageThreshold)
    .set({
      damageRequired: input.damageRequired,
      sortOrder: input.sortOrder,
      rewards: input.rewards,
      effects: input.effects,
      effectDurationMinutes: input.effectDurationMinutes,
    })
    .where(eq(raidDamageThreshold.id, input.thresholdId));

/** Build the `raidDamageThreshold` deletion for `deleteDamageThreshold`, using predicates on `id`. */
export const deleteRaidDamageThresholdForDeleteDamageThreshold = (
  client: Pick<DrizzleClient, "delete">,
  input: { thresholdId: string },
) =>
  client
    .delete(raidDamageThreshold)
    .where(eq(raidDamageThreshold.id, input.thresholdId));

/**
 * Build the `mpvpBattleQueue` listing for `getActiveRaidTeams`, using predicates on
 * `battleType`, `attackerEntityId`, `battleId`.
 */
export const listMpvpBattleQueueForGetActiveRaidTeams = (
  client: Pick<DrizzleClient, "query">,
  input: { questId: string },
) =>
  client.query.mpvpBattleQueue.findMany({
    where: and(
      eq(mpvpBattleQueue.battleType, "RAID_BATTLE"),
      eq(mpvpBattleQueue.attackerEntityId, input.questId),
      sql`(${mpvpBattleQueue.battleId} IS NULL OR ${mpvpBattleQueue.battleId} LIKE 'claiming-%')`,
    ),
    with: {
      queue: {
        with: {
          user: {
            columns: {
              userId: true,
              username: true,
              avatar: true,
            },
          },
        },
      },
    },
    orderBy: mpvpBattleQueue.createdAt,
  });

/** Build the `mpvpBattleUser` lookup for `readyToQueue`, using predicates on `userId`. */
export const findMpvpBattleUserForReadyToQueue = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.mpvpBattleUser.findFirst({
    where: eq(mpvpBattleUser.userId, ctx.userId),
    with: {
      clanBattle: {
        columns: { sector: true, battleType: true, attackerEntityId: true },
      },
    },
  });

/** Build the `userData` update for `readyToQueue`, using predicates on `userId` and `status`. */
export const updateUserDataForReadyToQueue = (
  client: Pick<DrizzleClient, "update">,
  userId: string,
  user: { status: "QUEUED" },
) =>
  client
    .update(userData)
    .set({ status: "AWAKE", travelFinishAt: null, battleId: null })
    .where(
      and(
        eq(userData.userId, userId),
        eq(userData.status, user.status),
        withoutDungeonReservation(),
      ),
    );

/**
 * Build the `userData` update for `readyToQueue`, setting `travelFinishAt` and
 * `battleId`, using predicates on `userId` and `status`.
 */
export const updateUserDataForReadyToQueue2 = (
  client: Pick<DrizzleClient, "update">,
  userId: string,
) =>
  client
    .update(userData)
    .set({ travelFinishAt: null, battleId: null })
    .where(and(eq(userData.userId, userId), eq(userData.status, "AWAKE")));

/** Build the `mpvpBattleUser` deletion for `readyToQueue`, using predicates on `userId` and `id`. */
export const deleteMpvpBattleUserForReadyToQueue = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
  queueEntry: { id: string },
) =>
  client
    .delete(mpvpBattleUser)
    .where(
      and(eq(mpvpBattleUser.userId, userId), eq(mpvpBattleUser.id, queueEntry.id)),
    );

/** Build the `userRequest` update for `readyToQueue`, setting `status`, using predicates on `senderId`, `type`, `status`. */
export const updateUserRequestForReadyToQueue = (
  client: Pick<DrizzleClient, "update">,
  userId: string,
) =>
  client
    .update(userRequest)
    .set({ status: "CANCELLED" })
    .where(
      and(
        eq(userRequest.senderId, userId),
        eq(userRequest.type, "SPAR"),
        eq(userRequest.status, "PENDING"),
      ),
    );

/**
 * Build the `userRequest` update for `readyToQueue`, setting `status`, using
 * predicates on `receiverId`, `type`, `status`.
 */
export const updateUserRequestForReadyToQueue2 = (
  client: Pick<DrizzleClient, "update">,
  userId: string,
) =>
  client
    .update(userRequest)
    .set({ status: "REJECTED" })
    .where(
      and(
        eq(userRequest.receiverId, userId),
        eq(userRequest.type, "SPAR"),
        eq(userRequest.status, "PENDING"),
      ),
    );

/** Build the `mpvpBattleQueue` deletion for `readyToQueue`, using predicates on `id`, `battleType`, `clanBattleId`. */
export const deleteMpvpBattleQueueForReadyToQueue = (
  client: Pick<DrizzleClient, "delete" | "select">,
  queueEntry: { clanBattleId: string },
) =>
  client
    .delete(mpvpBattleQueue)
    .where(
      and(
        eq(mpvpBattleQueue.id, queueEntry.clanBattleId),
        eq(mpvpBattleQueue.battleType, "RAID_BATTLE"),
        notExists(
          client
            .select({ id: mpvpBattleUser.id })
            .from(mpvpBattleUser)
            .where(eq(mpvpBattleUser.clanBattleId, queueEntry.clanBattleId)),
        ),
      ),
    );

/**
 * Build the `mpvpBattleQueue` update for `readyToQueue`, setting `battleId`, including
 * predicates on `id`, `battleType`, `battleId`.
 */
export const updateMpvpBattleQueueForReadyToQueue = (
  client: Pick<DrizzleClient, "update">,
  queueEntry: { clanBattleId: string },
) =>
  client
    .update(mpvpBattleQueue)
    .set({ battleId: null })
    .where(
      and(
        eq(mpvpBattleQueue.id, queueEntry.clanBattleId),
        eq(mpvpBattleQueue.battleType, "RAID_BATTLE"),
        like(mpvpBattleQueue.battleId, "claiming-%"),
        lt(mpvpBattleQueue.createdAt, new Date(Date.now() - RAID_CLAIMING_TIMEOUT_MS)),
      ),
    );

/**
 * Build the `mpvpBattleQueue` lookup for `joinRaidQueue`, including predicates on
 * `id`, `battleType`, `attackerEntityId`.
 */
export const findMpvpBattleQueueForJoinRaidQueue = (
  client: Pick<DrizzleClient, "query">,
  input: { teamId: string; questId: string },
) =>
  client.query.mpvpBattleQueue.findFirst({
    where: and(
      eq(mpvpBattleQueue.id, input.teamId),
      eq(mpvpBattleQueue.battleType, "RAID_BATTLE"),
      eq(mpvpBattleQueue.attackerEntityId, input.questId),
      isNull(mpvpBattleQueue.battleId),
    ),
    with: { queue: true },
  });

/** Build the `sector` lookup for `joinRaidQueue`, using predicates on `sector` and `villageId`. */
export const findSectorForJoinRaidQueue = (
  client: Pick<DrizzleClient, "query">,
  raidData: { sector: number },
  user: { villageId: string },
) =>
  client.query.sector.findFirst({
    where: and(
      eq(sector.sector, raidData.sector),
      eq(sector.villageId, user.villageId),
    ),
  });

/**
 * Build the `war` lookup for `joinRaidQueue`, selecting row fields
 * `attackerVillageId`, including predicates on `type`, `sector`, `endedAt`.
 */
export const findWarForJoinRaidQueue = (
  client: Pick<DrizzleClient, "query">,
  raidData: { sector: number },
) =>
  client.query.war.findFirst({
    where: and(
      eq(war.type, "SECTOR_WAR"),
      eq(war.sector, raidData.sector),
      isNull(war.endedAt),
      lte(war.defenderShrineHp, 0),
    ),
    columns: { attackerVillageId: true },
    with: {
      warAllies: {
        where: activeWarAllyWhere(),
        columns: { villageId: true, supportVillageId: true },
      },
    },
  });

/** Execute the database statement for `joinRaidQueue`. */
export const executeInsertResultForJoinRaidQueue = (
  client: Pick<DrizzleClient, "execute">,
  teamId: string,
  input: { questId: string },
  raidData: { sector: number },
) =>
  client.execute(sql`
          INSERT INTO ${mpvpBattleQueue} (id, battleType, attackerEntityId, defenderEntityId, sector)
          SELECT ${teamId}, 'RAID_BATTLE', ${input.questId}, 'RAID_AI', ${raidData.sector ?? null}
          FROM (SELECT 1) AS dummy
          WHERE (
            SELECT COUNT(*)
            FROM ${mpvpBattleQueue} AS mq
            WHERE mq.battleType = 'RAID_BATTLE'
            AND mq.attackerEntityId = ${input.questId}
            AND mq.battleId IS NULL
          ) < ${RAID_MAX_CONCURRENT_TEAMS}
        `);

/** Build deletion of a multiplayer battle queue guarded by it having no battle claim. */
export const deleteUnclaimedBattleQueue = (
  client: Pick<DrizzleClient, "delete">,
  teamId: string,
) =>
  client
    .delete(mpvpBattleQueue)
    .where(and(eq(mpvpBattleQueue.id, teamId), isNull(mpvpBattleQueue.battleId)));

/** Build the `mpvpBattleQueue` lookup for `joinRaidQueue`, using predicates on `id`. */
export const findMpvpBattleQueueForJoinRaidQueue2 = (
  client: Pick<DrizzleClient, "query">,
  teamId: string,
) =>
  client.query.mpvpBattleQueue.findFirst({
    where: eq(mpvpBattleQueue.id, teamId),
    with: { queue: true },
  });

/** Build the `mpvpBattleUser` insert for `joinRaidQueue`. */
export const insertMpvpBattleUserForJoinRaidQueue = (
  client: Pick<DrizzleClient, "insert">,
  teamId: string,
  ctx: { userId: string },
  availableSlot: number,
) =>
  client.insert(mpvpBattleUser).values({
    id: nanoid(),
    clanBattleId: teamId,
    userId: ctx.userId,
    side: "ATTACKER",
    slot: availableSlot,
  });

/** Build the `mpvpBattleUser` lookup for `leaveRaidQueue`, using predicates on `userId`. */
export const findMpvpBattleUserForLeaveRaidQueue = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.mpvpBattleUser.findFirst({
    where: eq(mpvpBattleUser.userId, ctx.userId),
    with: { clanBattle: true },
  });

/** Build the battle-ID reset for a multiplayer battle queue. */
export const clearQueueBattleId = (
  client: Pick<DrizzleClient, "update">,
  teamId: string,
) =>
  client
    .update(mpvpBattleQueue)
    .set({ battleId: null })
    .where(eq(mpvpBattleQueue.id, teamId));

/** Build the multiplayer battle roster lookup by team ID. */
export const listQueueMembers = (
  client: Pick<DrizzleClient, "query">,
  teamId: string,
) =>
  client.query.mpvpBattleUser.findMany({
    where: eq(mpvpBattleUser.clanBattleId, teamId),
  });

/** Build deletion of a multiplayer battle queue by team ID. */
export const deleteQueueById = (
  client: Pick<DrizzleClient, "delete">,
  teamId: string,
) => client.delete(mpvpBattleQueue).where(eq(mpvpBattleQueue.id, teamId));

/** Build the `mpvpBattleQueue` lookup for `startRaidBattle`, using predicates on `id` and `battleType`. */
export const findMpvpBattleQueueForStartRaidBattle = (
  client: Pick<DrizzleClient, "query">,
  input: { teamId: string },
) =>
  client.query.mpvpBattleQueue.findFirst({
    where: and(
      eq(mpvpBattleQueue.id, input.teamId),
      eq(mpvpBattleQueue.battleType, "RAID_BATTLE"),
    ),
    with: {
      queue: { with: { user: true } },
    },
  });

/**
 * Build the `mpvpBattleQueue` update for `startRaidBattle`, setting `battleId`, using
 * predicates on `id`, `battleId`, `createdAt`.
 */
export const updateMpvpBattleQueueForStartRaidBattle = (
  client: Pick<DrizzleClient, "update">,
  input: { teamId: string },
) =>
  client
    .update(mpvpBattleQueue)
    .set({ battleId: null })
    .where(
      and(
        eq(mpvpBattleQueue.id, input.teamId),
        sql`${mpvpBattleQueue.battleId} LIKE 'claiming-%'`,
        lt(mpvpBattleQueue.createdAt, new Date(Date.now() - RAID_CLAIMING_TIMEOUT_MS)),
      ),
    );

/** Build a battle queue claim guarded by it having no existing battle ID. */
export const claimBattleQueue = (
  client: Pick<DrizzleClient, "update">,
  battleId: string,
  teamId: string,
) =>
  client
    .update(mpvpBattleQueue)
    .set({ battleId: battleId })
    .where(and(eq(mpvpBattleQueue.id, teamId), isNull(mpvpBattleQueue.battleId)));

/** Build a battle queue claim release guarded by the expected claim ID. */
export const releaseBattleQueueClaim = (
  client: Pick<DrizzleClient, "update">,
  teamId: string,
  claimId: string,
) =>
  client
    .update(mpvpBattleQueue)
    .set({ battleId: null })
    .where(and(eq(mpvpBattleQueue.id, teamId), eq(mpvpBattleQueue.battleId, claimId)));

/** Build the battle-ID update for a multiplayer battle queue. */
export const setQueueBattleId = (
  client: Pick<DrizzleClient, "update">,
  battleId: string,
  teamId: string,
) =>
  client
    .update(mpvpBattleQueue)
    .set({ battleId: battleId })
    .where(eq(mpvpBattleQueue.id, teamId));

/** Build the `raidDamageThreshold` lookup for `claimDamageReward`, using predicates on `id` and `questId`. */
export const findRaidDamageThresholdForClaimDamageReward = (
  client: Pick<DrizzleClient, "query">,
  input: { thresholdId: string; questId: string },
) =>
  client.query.raidDamageThreshold.findFirst({
    where: and(
      eq(raidDamageThreshold.id, input.thresholdId),
      eq(raidDamageThreshold.questId, input.questId),
    ),
  });

/**
 * Build the `raidParticipation` update for `claimDamageReward`, setting
 * `rewardsClaimed` and `updatedAt`, using predicates on `id` and `rewardsClaimed`.
 */
export const updateRaidParticipationForClaimDamageReward = (
  client: Pick<DrizzleClient, "update">,
  input: { thresholdId: string },
  participation: { id: string },
) =>
  client
    .update(raidParticipation)
    .set({
      rewardsClaimed: sql`JSON_ARRAY_APPEND(${raidParticipation.rewardsClaimed}, '$', ${input.thresholdId})`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(raidParticipation.id, participation.id),
        sql`NOT JSON_CONTAINS(${raidParticipation.rewardsClaimed}, JSON_QUOTE(${input.thresholdId}))`,
      ),
    );

/** Build the `userRaidBuff` insert for `claimDamageReward`. */
export const insertUserRaidBuffForClaimDamageReward = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: { questId: string },
  threshold: { effects: import("@/validators/combat").ZodAllTags[] },
  expiresAt: Date,
) =>
  client.insert(userRaidBuff).values({
    id: nanoid(),
    userId: ctx.userId,
    questId: input.questId,
    effects: threshold.effects,
    expiresAt,
  });

/**
 * Build the `quest` listing for `cleanupExpiredExclusiveRaids`, selecting only `id`
 * and `content`, using predicates on `questType`, `raidEndsAt`,
 * `raidBossCurrentHealth`.
 */
export const listQuestForCleanupExpiredExclusiveRaids = (
  client: Pick<DrizzleClient, "query">,
  now: Date,
) =>
  client.query.quest.findMany({
    where: and(
      eq(quest.questType, "raid"),
      lt(quest.raidEndsAt, now),
      gte(quest.raidBossCurrentHealth, 1), // Boss not defeated
    ),
    columns: { id: true, content: true },
  });

/** Build the `quest` lookup for `checkAndCleanupExpiredRaid`, including predicates on `id`, `questType`, `raidEndsAt`. */
export const findQuestForCheckAndCleanupExpiredRaid = (
  client: Pick<DrizzleClient, "query">,
  raidId: string,
  now: Date,
) =>
  client.query.quest.findFirst({
    where: and(
      eq(quest.id, raidId),
      eq(quest.questType, "raid"),
      or(lt(quest.raidEndsAt, now), lte(quest.raidBossCurrentHealth, 0)),
    ),
    columns: {
      id: true,
      content: true,
      raidEndsAt: true,
      raidBossCurrentHealth: true,
    },
  });

/**
 * Build the `mpvpBattleQueue` listing for `checkAndCleanupExpiredRaid`, using
 * predicates on `battleType`, `attackerEntityId`, `battleId`.
 */
export const listMpvpBattleQueueForCheckAndCleanupExpiredRaid = (
  client: Pick<DrizzleClient, "query">,
  raidId: string,
) =>
  client.query.mpvpBattleQueue.findMany({
    where: and(
      eq(mpvpBattleQueue.battleType, "RAID_BATTLE"),
      eq(mpvpBattleQueue.attackerEntityId, raidId),
      sql`(${mpvpBattleQueue.battleId} IS NULL OR ${mpvpBattleQueue.battleId} LIKE 'claiming-%')`,
    ),
    with: { queue: { columns: { userId: true } } },
  });

/** Build the `mpvpBattleUser` deletion for `checkAndCleanupExpiredRaid`, using predicates on `clanBattleId`. */
export const deleteMpvpBattleUserForCheckAndCleanupExpiredRaid = (
  client: Pick<DrizzleClient, "delete">,
  teamIds: string[],
) => client.delete(mpvpBattleUser).where(inArray(mpvpBattleUser.clanBattleId, teamIds));

/**
 * Build the `mpvpBattleQueue` deletion for `checkAndCleanupExpiredRaid`, using
 * predicates on `battleType`, `attackerEntityId`, `battleId`.
 */
export const deleteMpvpBattleQueueForCheckAndCleanupExpiredRaid = (
  client: Pick<DrizzleClient, "delete">,
  raidId: string,
) =>
  client
    .delete(mpvpBattleQueue)
    .where(
      and(
        eq(mpvpBattleQueue.battleType, "RAID_BATTLE"),
        eq(mpvpBattleQueue.attackerEntityId, raidId),
        sql`(${mpvpBattleQueue.battleId} IS NULL OR ${mpvpBattleQueue.battleId} LIKE 'claiming-%')`,
      ),
    );

/**
 * Build the `userData` update for `checkAndCleanupExpiredRaid`, setting `status` and
 * `battleId`, using predicates on `status` and `userId`.
 */
export const updateUserDataForCheckAndCleanupExpiredRaid = (
  client: Pick<DrizzleClient, "update">,
  userIds: string[],
) =>
  client
    .update(userData)
    .set({ status: "AWAKE", battleId: null })
    .where(
      and(
        eq(userData.status, "QUEUED"),
        inArray(userData.userId, userIds),
        withoutDungeonReservation(),
      ),
    );

/** Build the `mpvpBattleUser` deletion for `rollbackJoinRaidQueue`, using predicates on `userId` and `clanBattleId`. */
export const deleteMpvpBattleUserForRollbackJoinRaidQueue = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
  teamId: string,
) =>
  client
    .delete(mpvpBattleUser)
    .where(
      and(eq(mpvpBattleUser.userId, userId), eq(mpvpBattleUser.clanBattleId, teamId)),
    );

/**
 * Build the `mpvpBattleUser` lookup for `rollbackJoinRaidQueue`, selecting only `id`,
 * using predicates on `clanBattleId`.
 */
export const findMpvpBattleUserForRollbackJoinRaidQueue = (
  client: Pick<DrizzleClient, "query">,
  teamId: string,
) =>
  client.query.mpvpBattleUser.findFirst({
    where: eq(mpvpBattleUser.clanBattleId, teamId),
    columns: { id: true },
  });

/** Build the `mpvpBattleQueue` deletion for `rollbackStartRaidBattle`, using predicates on `id` and `battleId`. */
export const deleteMpvpBattleQueueForRollbackStartRaidBattle = (
  client: Pick<DrizzleClient, "delete">,
  teamId: string,
  claimId: string,
) =>
  client
    .delete(mpvpBattleQueue)
    .where(and(eq(mpvpBattleQueue.id, teamId), eq(mpvpBattleQueue.battleId, claimId)));

/**
 * Build the `userData` update for `rollbackStartRaidBattle`, setting `status`, using
 * predicates on `userId` and `status`.
 */
export const updateUserDataForRollbackStartRaidBattle = (
  client: Pick<DrizzleClient, "update">,
  attackerUserIds: string[],
) =>
  client
    .update(userData)
    .set({ status: "AWAKE" })
    .where(
      and(
        inArray(userData.userId, attackerUserIds),
        eq(userData.status, "QUEUED"),
        withoutDungeonReservation(),
      ),
    );

/** Build the `conversation` insert for `ensureRaidChatConversation`, updating duplicate keys. */
export const insertConversationForEnsureRaidChatConversation = (
  client: Pick<DrizzleClient, "insert">,
  conversationId: string,
  raid: { name: string },
  userId: string,
) =>
  client
    .insert(conversation)
    .values({
      id: conversationId,
      title: `${raid.name} Raid Chat`,
      createdById: userId,
      isPublic: false,
      isLocked: false,
      isEnabled: true,
    })
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });

/**
 * Build the `user2conversation` deletion for `purgeRaidChatMembership`, using
 * predicates on `conversationId` and `userId`.
 */
export const deleteUser2conversationForPurgeRaidChatMembership = (
  client: Pick<DrizzleClient, "delete">,
  conversationId: string,
  ids: string[],
) =>
  client
    .delete(user2conversation)
    .where(
      and(
        eq(user2conversation.conversationId, conversationId),
        inArray(user2conversation.userId, ids),
      ),
    );

/**
 * Drop every raid-chat membership owned by a single user. Used when the
 * specific raid id is not recoverable (orphaned queue rows) and we have to
 * conservatively clear all stale raid-chat access.
 */
export const purgeAllRaidChatMembershipsForUser = (
  client: DrizzleClient,
  userId: string,
) =>
  client
    .delete(user2conversation)
    .where(
      and(
        eq(user2conversation.userId, userId),
        like(user2conversation.conversationId, RAID_CHAT_CONVERSATION_LIKE_PATTERN),
      ),
    );

/**
 * Village membership for raid list filtering, plus owned sectors so exclusive
 * raids can be gated without a second hop. Avoids fetchUpdatedUser's fat row,
 * relations, regen writes, and quest bootstrap.
 */
export const fetchRaidListUser = async (client: DrizzleClient, userId: string) => {
  return client.query.userData.findFirst({
    where: eq(userData.userId, userId),
    columns: { villageId: true },
    with: {
      village: {
        columns: { id: true },
        with: { sectors: { columns: { sector: true } } },
      },
    },
  });
};

/**
 * Fields required by joinRaidQueue guards (ban, AWAKE status, current sector,
 * village, pending training). Does not persist regen or rewrite quests — the later status CAS
 * and rollback pairing remain the source of truth for queue transitions.
 */
export const fetchRaidJoinUser = async (client: DrizzleClient, userId: string) => {
  return client.query.userData.findFirst({
    where: eq(userData.userId, userId),
    columns: {
      villageId: true,
      sector: true,
      status: true,
      isBanned: true,
      energyQueueHead: true,
      energyQueueTail: true,
    },
  });
};
