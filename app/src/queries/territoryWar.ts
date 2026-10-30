/**
 * Database access for territory war; authorization and transaction scopes stay in callers.
 */
import {
  and,
  asc,
  desc,
  eq,
  gt,
  isNull,
  lte,
  notExists,
  type SQL,
  sql,
} from "drizzle-orm";
import {
  TERRITORY_WAR_BOOST_HOURS,
  TERRITORY_WAR_DURATION_MINUTES,
  TERRITORY_WAR_TARGET_POINTS,
  TERRITORY_WAR_TOKEN_REWARD,
} from "@/drizzle/constants";
import {
  clan,
  mpvpBattleQueue,
  mpvpBattleUser,
  notification,
  territoryWar,
  territoryWarScore,
  userData,
  village,
} from "@/drizzle/schema";
import { withoutDungeonReservation } from "@/queries/dungeonReservation";
import type { DrizzleClient } from "@/server/db";

/** Latest scheduled event, including closed/expired results; does not advance its lifecycle. */
export const fetchLatestTerritoryWar = (client: DrizzleClient) =>
  client.query.territoryWar.findFirst({ orderBy: desc(territoryWar.startsAt) });

/** Read-only, start-inclusive/end-exclusive admission window, optionally limited to a sector. */
export const fetchActiveTerritoryWar = (client: DrizzleClient, sectorNumber?: number) =>
  client.query.territoryWar.findFirst({
    where: and(
      isNull(territoryWar.resolvedAt),
      lte(territoryWar.startsAt, new Date()),
      gt(territoryWar.endsAt, new Date()),
      sectorNumber === undefined ? undefined : eq(territoryWar.sector, sectorNumber),
    ),
  });

/**
 * Build the `territoryWar` update for `settleTerritoryWarCombat`, setting `version`,
 * including predicates on `id`, `resolvedAt`, `startsAt`.
 */
export const updateTerritoryWarForSettleTerritoryWarCombat = (
  client: Pick<DrizzleClient, "update">,
  snapshot: { id: string },
  now: Date,
) =>
  client
    .update(territoryWar)
    .set({ version: sql`${territoryWar.version} + 1` })
    .where(
      and(
        eq(territoryWar.id, snapshot.id),
        isNull(territoryWar.resolvedAt),
        lte(territoryWar.startsAt, now),
        gt(territoryWar.endsAt, now),
      ),
    );

/** Execute the database statement for `settleTerritoryWarCombat`. */
export const executeReceiptForSettleTerritoryWarCombat = (
  client: Pick<DrizzleClient, "execute">,
  battle: { id: string },
  snapshot: { id: string },
) =>
  client.execute(
    sql`INSERT IGNORE INTO TerritoryWarReceipt (battleId, warId) VALUES (${battle.id}, ${snapshot.id})`,
  );

/** Build the `territoryWarScore` insert for `settleTerritoryWarCombat`, updating duplicate keys. */
export const insertTerritoryWarScoreForSettleTerritoryWarCombat = (
  client: Pick<DrizzleClient, "insert">,
  snapshot: { id: string },
  competitor: {
    id: string;
    name: string;
    clanId: null | string;
    villageId: null | string;
  },
  points: number,
) =>
  client
    .insert(territoryWarScore)
    .values({
      warId: snapshot.id,
      competitorId: competitor.id,
      name: competitor.name,
      clanId: competitor.clanId,
      villageId: competitor.villageId,
      points,
    })
    .onDuplicateKeyUpdate({
      set: { points: sql`${territoryWarScore.points} + ${points}` },
    });

/** Execute the database statement for `resolveTerritoryWar`. */
export const executeResultForResolveTerritoryWar = (
  client: Pick<DrizzleClient, "execute">,
  now: Date,
  id: string,
) =>
  client.execute(sql`
    UPDATE ${territoryWar}
    INNER JOIN ${territoryWarScore} ON ${territoryWarScore.warId} = ${territoryWar.id}
    LEFT JOIN ${territoryWarScore} higher ON higher.warId = ${territoryWar.id} AND higher.points > ${territoryWarScore.points}
    LEFT JOIN ${clan} ON ${clan.id} = ${territoryWarScore.clanId}
    LEFT JOIN ${village} ON ${village.id} = COALESCE(${territoryWarScore.villageId}, IF(${clan.hasHideout}, ${clan.villageId}, NULL))
    SET ${village.tokens} = ${village.tokens} + ${TERRITORY_WAR_TOKEN_REWARD},
        ${clan.points} = ${clan.points} + IF(${clan.hasHideout}, 0, ${TERRITORY_WAR_TOKEN_REWARD}),
        ${village.territoryWarBoostUntil} = DATE_ADD(${now}, INTERVAL ${TERRITORY_WAR_BOOST_HOURS} HOUR),
        ${clan.territoryWarBoostUntil} = DATE_ADD(${now}, INTERVAL ${TERRITORY_WAR_BOOST_HOURS} HOUR),
        ${territoryWarScore.rewarded} = true,
        ${territoryWar.resolvedAt} = ${now}
    WHERE ${territoryWar.id} = ${id} AND ${territoryWar.resolvedAt} IS NULL AND ${territoryWarScore.rewarded} = false
      AND ((${territoryWar.endsAt} > ${now} AND ${territoryWarScore.points} >= ${TERRITORY_WAR_TARGET_POINTS})
        OR (${territoryWar.endsAt} <= ${now} AND ${territoryWarScore.points} > 0 AND higher.competitorId IS NULL))
  `);

/** Execute the database statement for `resolveTerritoryWar`. */
export const executeRowsForResolveTerritoryWar = (
  client: Pick<DrizzleClient, "execute">,
  id: string,
) =>
  client.execute(
    sql`INSERT INTO ${notification} (userId, content) SELECT guardianId, ${`Territory War victory! Winners receive ${TERRITORY_WAR_TOKEN_REWARD.toLocaleString()} tokens (or clan points) and a ${TERRITORY_WAR_BOOST_HOURS}-hour Territory War boost. See [the standings](/territory-war).`} FROM ${territoryWar} WHERE ${territoryWar.id} = ${id}`,
  );

/** Build the `userData` update for `resolveTerritoryWar`, setting `unreadNotifications`, using predicates on `isAi`. */
export const updateUserDataForResolveTerritoryWar = (
  client: Pick<DrizzleClient, "update">,
) =>
  client
    .update(userData)
    .set({ unreadNotifications: sql`${userData.unreadNotifications} + 1` })
    .where(eq(userData.isAi, false));

/** Build the `sector` listing for `syncTerritoryWars`, selecting only `sector`. */
export const listSectorForSyncTerritoryWars = (client: Pick<DrizzleClient, "query">) =>
  client.query.sector.findMany({ columns: { sector: true } });

/** Build the `village` listing for `syncTerritoryWars`, selecting only `sector`. */
export const listVillageForSyncTerritoryWars = (client: Pick<DrizzleClient, "query">) =>
  client.query.village.findMany({ columns: { sector: true } });

/**
 * Build the `territoryWar` update for `syncTerritoryWars`, setting `resolvedAt`,
 * including predicates on `id`, `resolvedAt`, `endsAt`.
 */
export const updateTerritoryWarForSyncTerritoryWars = (
  client: Pick<DrizzleClient, "update" | "select">,
  latest: { endsAt: Date; id: string },
  now: Date,
) =>
  client
    .update(territoryWar)
    .set({ resolvedAt: latest.endsAt })
    .where(
      and(
        eq(territoryWar.id, latest.id),
        isNull(territoryWar.resolvedAt),
        lte(territoryWar.endsAt, now),
        notExists(
          client
            .select({ id: territoryWarScore.competitorId })
            .from(territoryWarScore)
            .where(
              and(
                eq(territoryWarScore.warId, latest.id),
                gt(territoryWarScore.points, 0),
              ),
            ),
        ),
      ),
    );

/**
 * Build the `territoryWar` lookup for `syncTerritoryWars`, selecting only `id`, using
 * predicates on `id`, `resolvedAt`, `endsAt`.
 */
export const findTerritoryWarForSyncTerritoryWars = (
  client: Pick<DrizzleClient, "query">,
  latest: { id: string },
  now: Date,
) =>
  client.query.territoryWar.findFirst({
    columns: { id: true },
    where: and(
      eq(territoryWar.id, latest.id),
      isNull(territoryWar.resolvedAt),
      lte(territoryWar.endsAt, now),
    ),
  });

/** Execute the database statement for `syncTerritoryWars`. */
export const executeInsertedForSyncTerritoryWars = (
  client: Pick<DrizzleClient, "execute">,
  id: string,
  latest: { id: undefined | string } | undefined,
  sectorNumber: number,
  guardianId: string,
  now: Date,
) =>
  client.execute(sql`INSERT IGNORE INTO TerritoryWar (id, predecessorId, sector, guardianId, startsAt, endsAt)
      SELECT ${id}, ${latest?.id ?? "initial"}, ${sectorNumber}, ${guardianId}, ${now}, ${new Date(now.getTime() + TERRITORY_WAR_DURATION_MINUTES * 60000)}
      WHERE NOT EXISTS (SELECT 1 FROM Sector WHERE Sector.sector = ${sectorNumber})
        AND NOT EXISTS (SELECT 1 FROM Village WHERE Village.sector = ${sectorNumber})`);

/** Build the `notification` insert for `syncTerritoryWars`. */
export const insertNotificationForSyncTerritoryWars = (
  client: Pick<DrizzleClient, "insert">,
  guardianId: string,
  sectorNumber: number,
) =>
  client.insert(notification).values({
    userId: guardianId,
    content: `Territory War! A guardian has appeared in sector ${sectorNumber} for ${TERRITORY_WAR_DURATION_MINUTES} minutes. First to ${TERRITORY_WAR_TARGET_POINTS} wins early; otherwise the highest positive score wins at the deadline. [Join the battle](/territory-war).`,
  });

/** Execute the database statement for `cleanupTerritoryWarTeams`. */
export const executeRowsForCleanupTerritoryWarTeams = (
  client: Pick<DrizzleClient, "execute">,
  expired: SQL<unknown>,
) =>
  client.execute(
    sql`UPDATE UserData u INNER JOIN MpvpBattleUser m ON m.userId = u.userId INNER JOIN MpvpBattleQueue q ON q.id = m.clanBattleId INNER JOIN TerritoryWar w ON w.id = q.territoryWarId LEFT JOIN Battle b ON b.id = q.battleId SET u.status = 'AWAKE' WHERE ${expired} AND u.status = 'QUEUED'
      AND ${withoutDungeonReservation(sql`u.userId`)}`,
  );

/** Execute the database statement for `cleanupTerritoryWarTeams`. */
export const executeRowsForCleanupTerritoryWarTeams2 = (
  client: Pick<DrizzleClient, "execute">,
  expired: SQL<unknown>,
) =>
  client.execute(
    sql`DELETE q, m FROM MpvpBattleQueue q INNER JOIN TerritoryWar w ON w.id = q.territoryWarId LEFT JOIN Battle b ON b.id = q.battleId LEFT JOIN MpvpBattleUser m ON m.clanBattleId = q.id WHERE ${expired}`,
  );

/** Build the `userData` lookup for `fetchTerritoryWarUser`, using predicates on `userId`. */
export const findUserDataForFetchTerritoryWarUser = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, userId),
    with: { village: true, clan: true },
  });

/** Build the `territoryWarScore` listing for `getCurrent`, using predicates on `warId`. */
export const listTerritoryWarScoreForGetCurrent = (
  client: Pick<DrizzleClient, "query">,
  event: { id: string },
) =>
  client.query.territoryWarScore.findMany({
    where: eq(territoryWarScore.warId, event.id),
    orderBy: (row, { desc }) => [desc(row.points), asc(row.name)],
  });

/** Build the `mpvpBattleQueue` listing for `getCurrent`, using predicates on `territoryWarId` and `battleId`. */
export const listMpvpBattleQueueForGetCurrent = (
  client: Pick<DrizzleClient, "query">,
  event: { id: string },
) =>
  client.query.mpvpBattleQueue.findMany({
    where: and(
      eq(mpvpBattleQueue.territoryWarId, event.id),
      isNull(mpvpBattleQueue.battleId),
    ),
    with: {
      queue: {
        orderBy: asc(mpvpBattleUser.slot),
        with: { user: { columns: { userId: true, username: true } } },
      },
    },
  });

/** Build a territory war lookup by ID. */
export const findTerritoryWarById = (
  client: Pick<DrizzleClient, "query">,
  eventId: string,
) =>
  client.query.territoryWar.findFirst({
    where: eq(territoryWar.id, eventId),
  });

/** Build the `mpvpBattleQueue` insert for `createTeam`. */
export const insertMpvpBattleQueueForCreateTeam = (
  client: Pick<DrizzleClient, "insert">,
  id: string,
  event: { id: string; guardianId: string; sector: number },
  competitor: { id: string },
) =>
  client.insert(mpvpBattleQueue).values({
    id,
    battleType: "TERRITORY_WAR",
    territoryWarId: event.id,
    attackerEntityId: competitor.id,
    defenderEntityId: event.guardianId,
    sector: event.sector,
  });

/** Build the `mpvpBattleQueue` deletion for `createTeam`, using predicates on `id`, `battleId`, `clanBattleId`. */
export const deleteMpvpBattleQueueForCreateTeam = (
  client: Pick<DrizzleClient, "delete" | "select">,
  id: string,
) =>
  client
    .delete(mpvpBattleQueue)
    .where(
      and(
        eq(mpvpBattleQueue.id, id),
        isNull(mpvpBattleQueue.battleId),
        notExists(
          client
            .select({ id: mpvpBattleUser.id })
            .from(mpvpBattleUser)
            .where(eq(mpvpBattleUser.clanBattleId, id)),
        ),
      ),
    );

/** Execute the database statement for `leaveTeam`. */
export const executeRemovedForLeaveTeam = (
  client: Pick<DrizzleClient, "execute">,
  ctx: { userId: string },
  input: { teamId: string },
) =>
  client.execute(sql`
      DELETE ${mpvpBattleUser} FROM ${mpvpBattleUser} INNER JOIN ${mpvpBattleQueue} ON ${mpvpBattleQueue.id} = ${mpvpBattleUser.clanBattleId}
      WHERE ${mpvpBattleUser.userId} = ${ctx.userId} AND ${mpvpBattleQueue.id} = ${input.teamId} AND ${mpvpBattleQueue.battleType} = 'TERRITORY_WAR' AND ${mpvpBattleQueue.battleId} IS NULL
    `);

/** Build the `mpvpBattleQueue` lookup for `startBattle`, using predicates on `id` and `battleType`. */
export const findMpvpBattleQueueForStartBattle = (
  client: Pick<DrizzleClient, "query">,
  input: { teamId: string },
) =>
  client.query.mpvpBattleQueue.findFirst({
    where: and(
      eq(mpvpBattleQueue.id, input.teamId),
      eq(mpvpBattleQueue.battleType, "TERRITORY_WAR"),
    ),
    with: { queue: true },
  });

/** Execute the database statement for `startBattle`. */
export const executeRowsForStartBattle = (
  client: Pick<DrizzleClient, "execute">,
  team: { id: string },
  battleId: string,
) =>
  client.execute(
    sql`UPDATE ${mpvpBattleQueue} SET ${mpvpBattleQueue.battleId} = NULL WHERE ${mpvpBattleQueue.id} = ${team.id} AND ${mpvpBattleQueue.battleId} = ${battleId} AND NOT EXISTS (SELECT 1 FROM Battle WHERE Battle.id = ${battleId})`,
  );

/** Execute the database statement for `joinTeam`. */
export const executeInsertedForJoinTeam = (
  client: Pick<DrizzleClient, "execute">,
  memberId: string,
  user: { userId: string; sector: number },
  teamId: string,
  competitorId: string,
) =>
  client.execute(sql`
      INSERT IGNORE INTO MpvpBattleUser (id, clanBattleId, userId, side, slot)
      SELECT ${memberId}, q.id, ${user.userId}, 'ATTACKER', slots.slot
      FROM MpvpBattleQueue q INNER JOIN TerritoryWar w ON w.id = q.territoryWarId
      CROSS JOIN (SELECT 0 AS slot UNION ALL SELECT 1 UNION ALL SELECT 2) slots
      WHERE q.id = ${teamId} AND q.battleType = 'TERRITORY_WAR' AND q.battleId IS NULL
        AND q.attackerEntityId = ${competitorId} AND q.sector = ${user.sector}
        AND w.resolvedAt IS NULL AND w.startsAt <= NOW(3) AND w.endsAt > NOW(3)
        AND NOT EXISTS (SELECT 1 FROM MpvpBattleUser m WHERE m.clanBattleId = q.id AND m.slot = slots.slot AND m.side = 'ATTACKER')
      ORDER BY slots.slot LIMIT 1
    `);

/** Execute the database statement for `joinTeam`. */
export const executeClaimedForJoinTeam = (
  client: Pick<DrizzleClient, "execute">,
  user: {
    userId: string;
    sector: number;
    isOutlaw: false | true;
    clanId: null | string;
    villageId: null | string;
  },
  memberId: string,
) =>
  client.execute(sql`
      UPDATE UserData u INNER JOIN MpvpBattleUser m ON m.userId = u.userId
      INNER JOIN MpvpBattleQueue q ON q.id = m.clanBattleId
      INNER JOIN TerritoryWar w ON w.id = q.territoryWarId
      SET u.status = 'QUEUED', q.createdAt = q.createdAt
      WHERE u.userId = ${user.userId} AND m.id = ${memberId} AND q.battleId IS NULL
        AND u.status = 'AWAKE' AND u.isBanned = false AND u.sector = ${user.sector}
        AND u.isOutlaw = ${user.isOutlaw} AND u.clanId <=> ${user.clanId} AND u.villageId <=> ${user.villageId}
        AND w.resolvedAt IS NULL AND w.endsAt > NOW(3)
    `);
