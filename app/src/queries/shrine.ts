/**
 * Database access for shrine; authorization and transaction scopes stay in callers.
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
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  SHRINE_AI_UNLOCK_COST,
  SHRINE_BATTLE_MAX_USERS_PER_SIDE,
  SHRINE_BOOST_COST,
  type SHRINE_BOOST_TYPE,
  SHRINE_UPGRADE_COST,
  SHRINE_WEEKLY_MAINTENANCE_COST,
} from "@/drizzle/constants";
import {
  mpvpBattleQueue,
  mpvpBattleUser,
  sector,
  userData,
  village,
} from "@/drizzle/schema";
import { withoutDungeonReservation } from "@/queries/dungeonReservation";
import type { DrizzleClient } from "@/server/db";
import {
  boostInactivePredicate,
  mergeActiveBoostsExpression,
  setActiveBoostExpression,
  setShrineSettingsKeyExpression,
} from "@/server/utils/shrine";

/** Build the `sector` listing for `runShrineMaintenance`, using predicates on `nextMaintainanceDueDate`. */
export const listSectorForRunShrineMaintenance = (
  client: Pick<DrizzleClient, "query">,
  now: Date,
) =>
  client.query.sector.findMany({
    where: lte(sector.nextMaintainanceDueDate, now),
  });

/** Build the `sector` deletion for `runShrineMaintenance`, using predicates on `id`. */
export const deleteSectorForRunShrineMaintenance = (
  client: Pick<DrizzleClient, "delete">,
  s: { id: number },
) => client.delete(sector).where(eq(sector.id, s.id));

/**
 * Build the `sector` update for `runShrineMaintenance`, setting `shrineLevel` and
 * `nextMaintainanceDueDate`, using predicates on `id`.
 */
export const updateSectorForRunShrineMaintenance = (
  client: Pick<DrizzleClient, "update">,
  newLevel: number,
  nextMaintainanceDueDate: Date,
  s: { id: number },
) =>
  client
    .update(sector)
    .set({ shrineLevel: newLevel, nextMaintainanceDueDate })
    .where(eq(sector.id, s.id));

/** Build the `village` listing for `runShrineBoostTick`. */
export const listVillageForRunShrineBoostTick = (
  client: Pick<DrizzleClient, "query">,
) =>
  client.query.village.findMany({
    columns: { id: true, shrineSettings: true, tokens: true },
  });

/** Build the `sector` selection for `runShrineBoostTick`, using predicates on `shrineLevel` and `boostLockedUntil`. */
export const selectSectorForRunShrineBoostTick = (
  client: Pick<DrizzleClient, "select">,
  now: Date,
) =>
  client
    .select({ villageId: sector.villageId })
    .from(sector)
    .where(
      and(
        eq(sector.shrineLevel, 3),
        or(isNull(sector.boostLockedUntil), lte(sector.boostLockedUntil, now)),
      ),
    );

/**
 * Build the `village` update for `runShrineBoostTick`, setting `shrineSettings` and
 * `tokens`, using predicates on `id` and `tokens`.
 */
export const updateVillageForRunShrineBoostTick = (
  client: Pick<DrizzleClient, "update">,
  upserts: {
    boostType: SHRINE_BOOST_TYPE;
    endAt: string;
  }[],
  totalCost: number,
  villageId: string,
  nowIso: string,
) =>
  client
    .update(village)
    .set({
      shrineSettings: mergeActiveBoostsExpression({ removeKeys: [], upserts }),
      tokens: sql`${village.tokens} - ${totalCost}`,
    })
    .where(
      and(
        eq(village.id, villageId),
        gte(village.tokens, totalCost),
        ...upserts.map((u) => boostInactivePredicate(u.boostType, nowIso)),
      ),
    );

/**
 * Build the `mpvpBattleQueue` selection for `runStaleShrineLobbyCleanup`, using
 * predicates on `battleType`, `battleId`, `createdAt`.
 */
export const selectMpvpBattleQueueForRunStaleShrineLobbyCleanup = (
  client: Pick<DrizzleClient, "select">,
  cutoff: Date,
) =>
  client
    .select({ id: mpvpBattleQueue.id })
    .from(mpvpBattleQueue)
    .where(
      and(
        eq(mpvpBattleQueue.battleType, "SHRINE_BATTLE"),
        isNull(mpvpBattleQueue.battleId),
        lt(mpvpBattleQueue.createdAt, cutoff),
      ),
    );

/**
 * Build the `mpvpBattleQueue` selection for `runStaleShrineLobbyCleanup`, using
 * predicates on `id`, `battleId`, `createdAt`.
 */
export const selectMpvpBattleQueueForRunStaleShrineLobbyCleanup2 = (
  client: Pick<DrizzleClient, "select">,
  deletedQueueIds: string[],
  cutoff: Date,
) =>
  client
    .select({ id: mpvpBattleQueue.id })
    .from(mpvpBattleQueue)
    .where(
      and(
        inArray(mpvpBattleQueue.id, deletedQueueIds),
        isNull(mpvpBattleQueue.battleId),
        lt(mpvpBattleQueue.createdAt, cutoff),
      ),
    );

/** Build the `mpvpBattleUser` selection for `runStaleShrineLobbyCleanup`, using predicates on `clanBattleId`. */
export const selectMpvpBattleUserForRunStaleShrineLobbyCleanup = (
  client: Pick<DrizzleClient, "select">,
  unclaimedSubquery: ReturnType<
    typeof selectMpvpBattleQueueForRunStaleShrineLobbyCleanup2
  >,
) =>
  client
    .select({ userId: mpvpBattleUser.userId })
    .from(mpvpBattleUser)
    .where(inArray(mpvpBattleUser.clanBattleId, unclaimedSubquery));

/**
 * Build the `userData` update for `runStaleShrineLobbyCleanup`, setting `status`,
 * using predicates on `userId` and `status`.
 */
export const updateUserDataForRunStaleShrineLobbyCleanup = (
  client: Pick<DrizzleClient, "update">,
  unclaimedUsersSubquery: ReturnType<
    typeof selectMpvpBattleUserForRunStaleShrineLobbyCleanup
  >,
) =>
  client
    .update(userData)
    .set({ status: "AWAKE" })
    .where(
      and(
        inArray(userData.userId, unclaimedUsersSubquery),
        eq(userData.status, "QUEUED"),
        withoutDungeonReservation(),
      ),
    );

/** Build the `mpvpBattleUser` deletion for `runStaleShrineLobbyCleanup`, using predicates on `clanBattleId`. */
export const deleteMpvpBattleUserForRunStaleShrineLobbyCleanup = (
  client: Pick<DrizzleClient, "delete">,
  unclaimedSubquery: ReturnType<
    typeof selectMpvpBattleQueueForRunStaleShrineLobbyCleanup2
  >,
) =>
  client
    .delete(mpvpBattleUser)
    .where(inArray(mpvpBattleUser.clanBattleId, unclaimedSubquery));

/**
 * Build the `mpvpBattleQueue` deletion for `runStaleShrineLobbyCleanup`, including
 * predicates on `id`, `battleType`, `battleId`.
 */
export const deleteMpvpBattleQueueForRunStaleShrineLobbyCleanup = (
  client: Pick<DrizzleClient, "delete">,
  deletedQueueIds: string[],
  cutoff: Date,
) =>
  client
    .delete(mpvpBattleQueue)
    .where(
      and(
        inArray(mpvpBattleQueue.id, deletedQueueIds),
        eq(mpvpBattleQueue.battleType, "SHRINE_BATTLE"),
        isNull(mpvpBattleQueue.battleId),
        lt(mpvpBattleQueue.createdAt, cutoff),
      ),
    );

/** Build the `userData` listing for `getShrineAis`, using predicates on `isAi` and `inShrines`. */
export const listUserDataForGetShrineAis = (client: Pick<DrizzleClient, "query">) =>
  client.query.userData.findMany({
    where: and(eq(userData.isAi, true), eq(userData.inShrines, true)),
    with: {
      jutsus: {
        columns: {
          level: true,
        },
        with: {
          jutsu: {
            columns: {
              name: true,
            },
          },
        },
      },
    },
    columns: {
      userId: true,
      username: true,
      level: true,
      rank: true,
      avatar: true,
    },
    orderBy: asc(userData.level),
  });

/** Build the `sector` listing for `getCapturedSectors`, using predicates on `villageId` and `shrineLevel`. */
export const listSectorForGetCapturedSectors = (
  client: Pick<DrizzleClient, "query">,
  input: { villageId: string },
) =>
  client.query.sector.findMany({
    where: and(eq(sector.villageId, input.villageId), gt(sector.shrineLevel, 0)),
  });

/** Build a sector lookup by its map number. */
export const findSectorByNumber = (
  client: Pick<DrizzleClient, "query">,
  sectorNumber: number,
) =>
  client.query.sector.findFirst({
    where: eq(sector.sector, sectorNumber),
  });

/** Build the `village` update for `upgradeShrine`, setting `tokens`, using predicates on `id` and `tokens`. */
export const updateVillageForUpgradeShrine = (
  client: Pick<DrizzleClient, "update">,
  user: { villageId: string },
) =>
  client
    .update(village)
    .set({ tokens: sql`${village.tokens} - ${SHRINE_UPGRADE_COST}` })
    .where(
      and(eq(village.id, user.villageId), gte(village.tokens, SHRINE_UPGRADE_COST)),
    );

/**
 * Build the `sector` update for `upgradeShrine`, setting `shrineLevel`, using
 * predicates on `sector`, `villageId`, `shrineLevel`.
 */
export const updateSectorForUpgradeShrine = (
  client: Pick<DrizzleClient, "update">,
  targetSector: { shrineLevel: number },
  input: { sectorNumber: number },
  user: { villageId: string },
) =>
  client
    .update(sector)
    .set({ shrineLevel: targetSector.shrineLevel + 1 })
    .where(
      and(
        eq(sector.sector, input.sectorNumber),
        eq(sector.villageId, user.villageId),
        eq(sector.shrineLevel, targetSector.shrineLevel),
      ),
    );

/** Build the `village` update for `upgradeShrine`, setting `tokens`, using predicates on `id`. */
export const updateVillageForUpgradeShrine2 = (
  client: Pick<DrizzleClient, "update">,
  user: { villageId: string },
) =>
  client
    .update(village)
    .set({ tokens: sql`${village.tokens} + ${SHRINE_UPGRADE_COST}` })
    .where(eq(village.id, user.villageId));

/**
 * Build the `village` update for `activateBoost`, setting `tokens` and
 * `shrineSettings`, using predicates on `id` and `tokens`.
 */
export const updateVillageForActivateBoost = (
  client: Pick<DrizzleClient, "update">,
  input: { boostType: SHRINE_BOOST_TYPE },
  boostExpiry: Date,
  user: { villageId: string },
  now: Date,
) =>
  client
    .update(village)
    .set({
      tokens: sql`${village.tokens} - ${SHRINE_BOOST_COST}`,
      shrineSettings: setActiveBoostExpression(
        input.boostType,
        boostExpiry.toISOString(),
      ),
    })
    .where(
      and(
        eq(village.id, user.villageId),
        gte(village.tokens, SHRINE_BOOST_COST),
        boostInactivePredicate(input.boostType, now.toISOString()),
      ),
    );

/**
 * Build the `village` update for `unlockAiDefender`, setting `tokens` and
 * `shrineSettings`, using predicates on `id` and `tokens`.
 */
export const updateVillageForUnlockAiDefender = (
  client: Pick<DrizzleClient, "update">,
  updatedUnlocks: string[],
  user: { villageId: string },
) =>
  client
    .update(village)
    .set({
      tokens: sql`${village.tokens} - ${SHRINE_AI_UNLOCK_COST}`,
      shrineSettings: setShrineSettingsKeyExpression("unlockedAiIds", updatedUnlocks),
    })
    .where(
      and(eq(village.id, user.villageId), gte(village.tokens, SHRINE_AI_UNLOCK_COST)),
    );

/** Build the `village` update for `toggleVillageAiDefender`, setting `shrineSettings`, using predicates on `id`. */
export const updateVillageForToggleVillageAiDefender = (
  client: Pick<DrizzleClient, "update">,
  newAssigns: string[],
  user: { villageId: string },
) =>
  client
    .update(village)
    .set({
      shrineSettings: setShrineSettingsKeyExpression("activeAiIds", newAssigns),
    })
    .where(eq(village.id, user.villageId));

/** Build the `sector` lookup for `payWeeklyMaintenance`, using predicates on `id`. */
export const findSectorForPayWeeklyMaintenance = (
  client: Pick<DrizzleClient, "query">,
  input: { sectorId: number },
) =>
  client.query.sector.findFirst({
    where: eq(sector.id, input.sectorId),
    with: { village: true },
  });

/** Build the `village` update for `payWeeklyMaintenance`, setting `tokens`, using predicates on `id` and `tokens`. */
export const updateVillageForPayWeeklyMaintenance = (
  client: Pick<DrizzleClient, "update">,
  user: { villageId: string },
) =>
  client
    .update(village)
    .set({ tokens: sql`${village.tokens} - ${SHRINE_WEEKLY_MAINTENANCE_COST}` })
    .where(
      and(
        eq(village.id, user.villageId),
        gte(village.tokens, SHRINE_WEEKLY_MAINTENANCE_COST),
      ),
    );

/**
 * Build the `sector` update for `payWeeklyMaintenance`, setting
 * `nextMaintainanceDueDate`, including predicates on `id`, `villageId`, `shrineLevel`.
 */
export const updateSectorForPayWeeklyMaintenance = (
  client: Pick<DrizzleClient, "update">,
  nextNextMaintainanceDueDate: Date,
  input: { sectorId: number },
  user: { villageId: string },
  targetSector: { nextMaintainanceDueDate: null | Date },
) =>
  client
    .update(sector)
    .set({ nextMaintainanceDueDate: nextNextMaintainanceDueDate })
    .where(
      and(
        eq(sector.id, input.sectorId),
        eq(sector.villageId, user.villageId),
        gt(sector.shrineLevel, 0),
        targetSector.nextMaintainanceDueDate === null
          ? isNull(sector.nextMaintainanceDueDate)
          : eq(sector.nextMaintainanceDueDate, targetSector.nextMaintainanceDueDate),
      ),
    );

/** Build the `village` update for `payWeeklyMaintenance`, setting `tokens`, using predicates on `id`. */
export const updateVillageForPayWeeklyMaintenance2 = (
  client: Pick<DrizzleClient, "update">,
  user: { villageId: string },
) =>
  client
    .update(village)
    .set({ tokens: sql`${village.tokens} + ${SHRINE_WEEKLY_MAINTENANCE_COST}` })
    .where(eq(village.id, user.villageId));

/** Build the `village` lookup for `getBoostTemplate`, selecting only `id` and `shrineSettings`, using predicates on `id`. */
export const findVillageForGetBoostTemplate = (
  client: Pick<DrizzleClient, "query">,
  input: { villageId: string },
) =>
  client.query.village.findFirst({
    where: eq(village.id, input.villageId),
    columns: { id: true, shrineSettings: true },
  });

/** Build the `village` update for `setBoostTemplate`, setting `shrineSettings`, using predicates on `id`. */
export const updateVillageForSetBoostTemplate = (
  client: Pick<DrizzleClient, "update">,
  input: {
    template: import("@/validators/shrine").BoostTemplateEntry[];
    villageId: string;
  },
  user: { username: string },
  templateUpdatedAt: string,
) =>
  client
    .update(village)
    .set({
      shrineSettings: sql`JSON_SET(
            COALESCE(${village.shrineSettings}, JSON_OBJECT()),
            '$.boostTemplate', CAST(${JSON.stringify(input.template)} AS JSON),
            '$.boostTemplateUpdatedBy', ${user.username},
            '$.boostTemplateUpdatedAt', ${templateUpdatedAt}
          )`,
    })
    .where(eq(village.id, input.villageId));

/**
 * Build the `mpvpBattleQueue` listing for `getShrineBattles`, including predicates on
 * `battleType`, `sector`, `battleId`.
 */
export const listMpvpBattleQueueForGetShrineBattles = (
  client: Pick<DrizzleClient, "query">,
  input: { sectorNumber: number },
  shrineLobbyStaleBefore: Date,
) =>
  client.query.mpvpBattleQueue.findMany({
    where: and(
      eq(mpvpBattleQueue.battleType, "SHRINE_BATTLE"),
      eq(mpvpBattleQueue.sector, input.sectorNumber),
      isNull(mpvpBattleQueue.battleId),
      gt(mpvpBattleQueue.createdAt, shrineLobbyStaleBefore),
    ),
    with: {
      queue: {
        columns: {
          userId: true,
          side: true,
          slot: true,
          createdAt: true,
        },
        with: {
          user: {
            columns: {
              username: true,
              level: true,
              rank: true,
              avatar: true,
              villageId: true,
            },
          },
        },
      },
    },
    orderBy: asc(mpvpBattleQueue.createdAt), // FIFO ordering - oldest first
  });

/** Build the `mpvpBattleQueue` deletion for `getShrineBattles`, using predicates on `id` and `battleId`. */
export const deleteMpvpBattleQueueForGetShrineBattles = (
  client: Pick<DrizzleClient, "delete">,
  emptyBattleIds: string[],
) =>
  client
    .delete(mpvpBattleQueue)
    .where(
      and(
        inArray(mpvpBattleQueue.id, emptyBattleIds),
        isNull(mpvpBattleQueue.battleId),
      ),
    );

/**
 * Build the `mpvpBattleUser` selection for `getUserQueuedShrineBattle`, including
 * predicates on `userId`, `battleType`, `battleId`.
 */
export const selectMpvpBattleUserForGetUserQueuedShrineBattle = (
  client: Pick<DrizzleClient, "select">,
  ctx: { userId: string },
  shrineLobbyStaleBefore: Date,
) =>
  client
    .select({ battleId: mpvpBattleQueue.id, sector: mpvpBattleQueue.sector })
    .from(mpvpBattleUser)
    .innerJoin(mpvpBattleQueue, eq(mpvpBattleUser.clanBattleId, mpvpBattleQueue.id))
    .where(
      and(
        eq(mpvpBattleUser.userId, ctx.userId),
        eq(mpvpBattleQueue.battleType, "SHRINE_BATTLE"),
        isNull(mpvpBattleQueue.battleId),
        gt(mpvpBattleQueue.createdAt, shrineLobbyStaleBefore),
      ),
    )
    .orderBy(desc(mpvpBattleUser.createdAt))
    .limit(1);

/** Build a sector lookup including its village. */
export const findSectorWithVillage = (
  client: Pick<DrizzleClient, "query">,
  sectorNumber: number,
) =>
  client.query.sector.findFirst({
    where: eq(sector.sector, sectorNumber),
    with: {
      village: true,
    },
  });

/** Build the `mpvpBattleQueue` insert for `challengeShrine`. */
export const insertMpvpBattleQueueForChallengeShrine = (
  client: Pick<DrizzleClient, "insert">,
  shrineBattleId: string,
  attackerSide: string,
  targetSector: { villageId: string },
  input: { sectorNumber: number },
  createdAt = new Date(),
) =>
  client.insert(mpvpBattleQueue).values({
    id: shrineBattleId,
    createdAt,
    battleType: "SHRINE_BATTLE",
    attackerEntityId: attackerSide,
    defenderEntityId: targetSector.villageId,
    sector: input.sectorNumber,
  });

/** Build the `mpvpBattleQueue` lookup for `joinShrineBattle`, using predicates on `id`, `battleType`, `createdAt`. */
export const findMpvpBattleQueueForJoinShrineBattle = (
  client: Pick<DrizzleClient, "query">,
  input: { shrineBattleId: string },
  shrineLobbyStaleBefore: Date,
) =>
  client.query.mpvpBattleQueue.findFirst({
    where: and(
      eq(mpvpBattleQueue.id, input.shrineBattleId),
      eq(mpvpBattleQueue.battleType, "SHRINE_BATTLE"),
      gt(mpvpBattleQueue.createdAt, shrineLobbyStaleBefore),
    ),
    with: {
      queue: {
        with: {
          user: {
            columns: {
              username: true,
              villageId: true,
            },
          },
        },
      },
    },
  });

/** Build shrine-battle participant inserts for challenge and join operations. */
export const insertMpvpBattleUserForJoinShrineBattle = (
  client: Pick<DrizzleClient, "insert">,
  user: { userId: string },
  input: { shrineBattleId: string; side: "ATTACKER" | "DEFENDER" },
  availableSlot: number,
) =>
  client.insert(mpvpBattleUser).values({
    id: nanoid(),
    userId: user.userId,
    clanBattleId: input.shrineBattleId,
    side: input.side,
    slot: availableSlot,
  });

/** Build the `userData` lookup for `joinShrineBattle`, selecting only `status`, using predicates on `userId`. */
export const findUserDataForJoinShrineBattle = (
  client: Pick<DrizzleClient, "query">,
  user: { userId: string },
) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, user.userId),
    columns: { status: true },
  });

/** Build the `mpvpBattleUser` lookup for `joinShrineBattle`, using predicates on `userId` and `clanBattleId`. */
export const findMpvpBattleUserForJoinShrineBattle = (
  client: Pick<DrizzleClient, "query">,
  user: { userId: string },
  input: { shrineBattleId: string },
) =>
  client.query.mpvpBattleUser.findFirst({
    where: and(
      eq(mpvpBattleUser.userId, user.userId),
      eq(mpvpBattleUser.clanBattleId, input.shrineBattleId),
    ),
  });

/** Build the `mpvpBattleQueue` selection for `leaveShrineBattle`, using predicates on `id`, `battleId`, `createdAt`. */
export const selectMpvpBattleQueueForLeaveShrineBattle = (
  client: Pick<DrizzleClient, "select">,
  input: { shrineBattleId: string },
  shrineLobbyStaleBefore: Date,
) =>
  client
    .select({ id: mpvpBattleQueue.id })
    .from(mpvpBattleQueue)
    .where(
      and(
        eq(mpvpBattleQueue.id, input.shrineBattleId),
        isNull(mpvpBattleQueue.battleId),
        gt(mpvpBattleQueue.createdAt, shrineLobbyStaleBefore),
      ),
    );

/** Build the `mpvpBattleUser` deletion for `leaveShrineBattle`, using predicates on `userId` and `clanBattleId`. */
export const deleteMpvpBattleUserForLeaveShrineBattle = (
  client: Pick<DrizzleClient, "delete">,
  user: { userId: string },
  activeQueueSubquery: ReturnType<typeof selectMpvpBattleQueueForLeaveShrineBattle>,
) =>
  client
    .delete(mpvpBattleUser)
    .where(
      and(
        eq(mpvpBattleUser.userId, user.userId),
        inArray(mpvpBattleUser.clanBattleId, activeQueueSubquery),
      ),
    );

/**
 * Build the `mpvpBattleQueue` lookup for `leaveShrineBattle`, selecting only
 * `battleId` and `createdAt`, using predicates on `id`.
 */
export const findMpvpBattleQueueForLeaveShrineBattle = (
  client: Pick<DrizzleClient, "query">,
  input: { shrineBattleId: string },
) =>
  client.query.mpvpBattleQueue.findFirst({
    where: eq(mpvpBattleQueue.id, input.shrineBattleId),
    columns: { battleId: true, createdAt: true },
  });

/** Build the `mpvpBattleUser` selection for `leaveShrineBattle`, using predicates on `clanBattleId`. */
export const selectMpvpBattleUserForLeaveShrineBattle = (
  client: Pick<DrizzleClient, "select">,
  input: { shrineBattleId: string },
) =>
  client
    .select({ remaining: count() })
    .from(mpvpBattleUser)
    .where(eq(mpvpBattleUser.clanBattleId, input.shrineBattleId));

/**
 * Build the `userData` listing for `initiateShrineBattle`, selecting only `userId`,
 * using predicates on `isAi` and `inShrines`.
 */
export const listUserDataForInitiateShrineBattle = (
  client: Pick<DrizzleClient, "query">,
) =>
  client.query.userData.findMany({
    where: and(eq(userData.isAi, true), eq(userData.inShrines, true)),
    columns: { userId: true },
    limit: SHRINE_BATTLE_MAX_USERS_PER_SIDE,
  });

/**
 * Build the `sector` selection for `hasLevel3Shrine`, using predicates on `villageId`,
 * `shrineLevel`, `boostLockedUntil`.
 */
export const selectSectorForHasLevel3Shrine = (
  client: Pick<DrizzleClient, "select">,
  villageId: string,
) =>
  client
    .select({ id: sector.id })
    .from(sector)
    .where(
      and(
        eq(sector.villageId, villageId),
        eq(sector.shrineLevel, 3),
        or(isNull(sector.boostLockedUntil), lte(sector.boostLockedUntil, new Date())),
      ),
    )
    .limit(1);
