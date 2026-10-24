import { randomInt } from "node:crypto";
import { and, desc, eq, getTableName, gt, isNull, lte, sql } from "drizzle-orm";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";
import { nanoid } from "nanoid";
import map from "@/data/hexasphere.json";
import {
  TERRITORY_WAR_AI_POINTS,
  TERRITORY_WAR_BOOST_HOURS,
  TERRITORY_WAR_DURATION_MINUTES,
  TERRITORY_WAR_INTERVAL_HOURS,
  TERRITORY_WAR_PVP_POINTS,
  TERRITORY_WAR_TARGET_POINTS,
  TERRITORY_WAR_TOKEN_REWARD,
  VILLAGE_SYNDICATE_ID,
} from "@/drizzle/constants";
import {
  clan,
  notification,
  territoryWar,
  territoryWarScore,
  userData,
  village,
} from "@/drizzle/schema";
import { stillInBattle } from "@/libs/combat/actions";
import { areBattleAllies } from "@/libs/combat/participants";
import type { CompleteBattle } from "@/libs/combat/types";
import type { TerritoryCompetitor } from "@/libs/territoryWar";
import type { DrizzleClient } from "@/server/db";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";

export const fetchLatestTerritoryWar = (client: DrizzleClient) =>
  client.query.territoryWar.findFirst({ orderBy: desc(territoryWar.startsAt) });
export const fetchActiveTerritoryWar = (client: DrizzleClient, sectorNumber?: number) =>
  client.query.territoryWar.findFirst({
    where: and(
      isNull(territoryWar.resolvedAt),
      lte(territoryWar.startsAt, new Date()),
      gt(territoryWar.endsAt, new Date()),
      sectorNumber === undefined ? undefined : eq(territoryWar.sector, sectorNumber),
    ),
  });

export const territoryWarAwards = (battle: CompleteBattle) => {
  const snapshot = battle.extraState.territoryWar;
  if (!snapshot || !["COMBAT", "TERRITORY_WAR"].includes(battle.battleType)) return [];
  const awards = new Map<string, { competitor: TerritoryCompetitor; points: number }>();
  for (const user of battle.usersState) {
    const competitor = snapshot.competitors[user.userId];
    if (
      !competitor ||
      user.isAi ||
      user.isSummon ||
      user.fledBattle ||
      !stillInBattle(user, battle.usersEffects)
    )
      continue;
    const opponents = battle.usersState.filter(
      (target) => !target.isSummon && !areBattleAllies(user, target),
    );
    if (
      !opponents.length ||
      opponents.some((target) => stillInBattle(target, battle.usersEffects))
    )
      continue;
    const defeated = opponents.filter(
      (target) =>
        !target.fledBattle &&
        target.curHealth <= 0 &&
        (battle.battleType === "TERRITORY_WAR"
          ? target.isAi
          : !target.isAi && snapshot.competitors[target.userId]?.id !== competitor.id),
    );
    if (!defeated.length) continue;
    const points =
      battle.battleType === "TERRITORY_WAR"
        ? TERRITORY_WAR_AI_POINTS
        : TERRITORY_WAR_PVP_POINTS * defeated.length;
    const current = awards.get(competitor.id);
    awards.set(competitor.id, { competitor, points: (current?.points ?? 0) + points });
  }
  return [...awards.values()];
};

/** Called inside the decided result's battle-version transaction; no reads during combat settlement. */
export const settleTerritoryWarCombat = async (
  client: DrizzleClient,
  battle: CompleteBattle,
  now = new Date(),
) => {
  const snapshot = battle.extraState.territoryWar;
  const awards = territoryWarAwards(battle);
  if (!snapshot || !awards.length) return;
  // Serialize only this global event. The same guard excludes late and post-victory results.
  const claimed = await client
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
  if (!claimed.rowsAffected) return;
  const receipt = await client.execute(
    sql`INSERT IGNORE INTO TerritoryWarReceipt (battleId, warId) VALUES (${battle.id}, ${snapshot.id})`,
  );
  if (!receipt.rowsAffected) return;
  for (const { competitor, points } of awards) {
    await client
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
  }
  await resolveTerritoryWar(client, snapshot.id, now);
};

/** One guarded multi-table write closes the event, pays treasuries and activates every tied winner's boost. */
export const resolveTerritoryWar = async (
  client: DrizzleClient,
  id: string,
  now = new Date(),
) => {
  const result = await client.execute(sql`
    UPDATE ${territoryWar}
    INNER JOIN ${territoryWarScore} ON ${territoryWarScore.warId} = ${territoryWar.id} AND ${territoryWarScore.points} >= ${TERRITORY_WAR_TARGET_POINTS}
    LEFT JOIN ${clan} ON ${clan.id} = ${territoryWarScore.clanId}
    LEFT JOIN ${village} ON ${village.id} = COALESCE(${territoryWarScore.villageId}, IF(${clan.hasHideout}, ${clan.villageId}, NULL))
    SET ${village.tokens} = ${village.tokens} + ${TERRITORY_WAR_TOKEN_REWARD},
        ${clan.points} = ${clan.points} + IF(${clan.hasHideout}, 0, ${TERRITORY_WAR_TOKEN_REWARD}),
        ${village.territoryWarBoostUntil} = DATE_ADD(${now}, INTERVAL ${TERRITORY_WAR_BOOST_HOURS} HOUR),
        ${clan.territoryWarBoostUntil} = DATE_ADD(${now}, INTERVAL ${TERRITORY_WAR_BOOST_HOURS} HOUR),
        ${territoryWarScore.rewarded} = true,
        ${territoryWar.resolvedAt} = ${now}
    WHERE ${territoryWar.id} = ${id} AND ${territoryWar.resolvedAt} IS NULL AND ${territoryWarScore.rewarded} = false
  `);
  if (result.rowsAffected) {
    await client.execute(
      sql`INSERT INTO Notification (userId, content) SELECT guardianId, ${`Territory War victory! Winners receive ${TERRITORY_WAR_TOKEN_REWARD.toLocaleString()} tokens (or clan points) and a one-hour Territory War boost. See [the standings](/territory-war).`} FROM TerritoryWar WHERE id = ${id}`,
    );
    await client
      .update(userData)
      .set({ unreadNotifications: sql`${userData.unreadNotifications} + 1` });
  }
  return result;
};

/** Minute scheduler uses actual previous end, never catches up by opening stale events. */
export const syncTerritoryWars = async (client: DrizzleClient, now = new Date()) => {
  const [latest, owned, homes, guardians] = await Promise.all([
    fetchLatestTerritoryWar(client),
    client.query.sector.findMany({ columns: { sector: true } }),
    client.query.village.findMany({ columns: { sector: true } }),
    client.query.userData.findMany({
      columns: { userId: true },
      where: and(eq(userData.isAi, true), eq(userData.isWarCamp, true)),
    }),
  ]);
  await cleanupTerritoryWarTeams(client, now);
  if (latest && !latest.resolvedAt) {
    await retryOnDeadlock(() =>
      client.transaction(async (tx) => {
        const db = tx as unknown as DrizzleClient;
        await resolveTerritoryWar(db, latest.id, now);
        await db
          .update(territoryWar)
          .set({ resolvedAt: latest.endsAt })
          .where(
            and(
              eq(territoryWar.id, latest.id),
              isNull(territoryWar.resolvedAt),
              lte(territoryWar.endsAt, now),
            ),
          );
      }),
    );
    // A subsequent tick reloads the actual terminal timestamp after a concurrent score.
    if (latest.endsAt > now) return;
  }
  const endedAt = latest?.resolvedAt ?? latest?.endsAt;
  if (
    endedAt &&
    now.getTime() < endedAt.getTime() + TERRITORY_WAR_INTERVAL_HOURS * 3600000
  )
    return;
  const excluded = new Set([...owned, ...homes].map((row) => row.sector));
  const eligible = map.tiles
    .map((_, index) => index)
    .filter((index) => !excluded.has(index));
  if (!eligible.length || !guardians.length) return;
  const sectorNumber = eligible[randomInt(eligible.length)]!;
  const guardianId = guardians[randomInt(guardians.length)]!.userId;
  const id = nanoid();
  // Notification and insertion must commit together; a unique predecessor makes retries harmless.
  await retryOnDeadlock(() =>
    client.transaction(async (tx) => {
      const db = tx as unknown as DrizzleClient;
      const inserted =
        await db.execute(sql`INSERT IGNORE INTO TerritoryWar (id, predecessorId, sector, guardianId, startsAt, endsAt)
      SELECT ${id}, ${latest?.id ?? "initial"}, ${sectorNumber}, ${guardianId}, ${now}, ${new Date(now.getTime() + TERRITORY_WAR_DURATION_MINUTES * 60000)}
      WHERE NOT EXISTS (SELECT 1 FROM Sector WHERE Sector.sector = ${sectorNumber})
        AND NOT EXISTS (SELECT 1 FROM Village WHERE Village.sector = ${sectorNumber})`);
      if (!inserted.rowsAffected) return;
      await db.insert(notification).values({
        userId: guardianId,
        content: `Territory War! A guardian has appeared in sector ${sectorNumber} for ${TERRITORY_WAR_DURATION_MINUTES} minutes. First to ${TERRITORY_WAR_TARGET_POINTS} wins. [Join the battle](/territory-war).`,
      });
      await db
        .update(userData)
        .set({ unreadNotifications: sql`${userData.unreadNotifications} + 1` });
    }),
  );
};

/** Release only expired lobbies; real battles keep their roster until combat settles. */
export const cleanupTerritoryWarTeams = async (
  client: DrizzleClient,
  now = new Date(),
) => {
  const expired = sql`q.battleType = 'TERRITORY_WAR' AND (w.resolvedAt IS NOT NULL OR w.endsAt <= ${now}) AND b.id IS NULL`;
  await client.execute(
    sql`UPDATE UserData u INNER JOIN MpvpBattleUser m ON m.userId = u.userId INNER JOIN MpvpBattleQueue q ON q.id = m.clanBattleId INNER JOIN TerritoryWar w ON w.id = q.territoryWarId LEFT JOIN Battle b ON b.id = q.battleId SET u.status = 'AWAKE' WHERE ${expired} AND u.status = 'QUEUED'`,
  );
  await client.execute(
    sql`DELETE q, m FROM MpvpBattleQueue q INNER JOIN TerritoryWar w ON w.id = q.territoryWarId LEFT JOIN Battle b ON b.id = q.battleId LEFT JOIN MpvpBattleUser m ON m.clanBattleId = q.id WHERE ${expired}`,
  );
};

/** Lightweight activity snapshot including the competitor's temporary bonus. */
export const fetchTerritoryWarUser = async (client: DrizzleClient, userId: string) => {
  const user = await client.query.userData.findFirst({
    where: eq(userData.userId, userId),
    with: { village: true, clan: true },
  });
  if (!user) throw new Error("User not found");
  return user;
};

/** Correlated activity history stays in the existing user query, bounded by its oldest unsettled work. */
export const territoryWarBoostWindowsSql = (
  user: Pick<
    typeof userData,
    | "isOutlaw"
    | "clanId"
    | "villageId"
    | "regenAt"
    | "masteryTrainingStartedAt"
    | "elementalTrainingStartedAt"
    | "covertTrainingStartedAt"
  >,
  since?: Date,
) => {
  // Relational extras strip column qualifiers; identifiers keep score columns from
  // shadowing the outer user's competitor and unsettled activity timestamps.
  const outerColumn = (column: AnyMySqlColumn) =>
    sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`;
  return sql<import("@/libs/territoryWar").TerritoryBoostWindow[]>`
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(
    'startsAt', DATE_FORMAT(tw.resolvedAt, '%Y-%m-%dT%H:%i:%s.%fZ'),
    'endsAt', DATE_FORMAT(DATE_ADD(tw.resolvedAt, INTERVAL ${TERRITORY_WAR_BOOST_HOURS} HOUR), '%Y-%m-%dT%H:%i:%s.%fZ')))
    FROM TerritoryWarScore ts INNER JOIN TerritoryWar tw ON tw.id = ts.warId
    WHERE ts.rewarded = true AND tw.resolvedAt IS NOT NULL
      AND ts.competitorId = CASE WHEN ${outerColumn(user.isOutlaw)} AND ${outerColumn(user.clanId)} IS NOT NULL THEN CONCAT('clan:', ${outerColumn(user.clanId)}) ELSE CONCAT('village:', IF(${outerColumn(user.isOutlaw)}, ${VILLAGE_SYNDICATE_ID}, COALESCE(${outerColumn(user.villageId)}, ${VILLAGE_SYNDICATE_ID}))) END
      AND DATE_ADD(tw.resolvedAt, INTERVAL ${TERRITORY_WAR_BOOST_HOURS} HOUR) > LEAST(${since ?? outerColumn(user.regenAt)}, ${outerColumn(user.regenAt)}, COALESCE(${outerColumn(user.masteryTrainingStartedAt)}, ${outerColumn(user.regenAt)}), COALESCE(${outerColumn(user.elementalTrainingStartedAt)}, ${outerColumn(user.regenAt)}), COALESCE(${outerColumn(user.covertTrainingStartedAt)}, ${outerColumn(user.regenAt)})))
  , JSON_ARRAY())
`.mapWith(
    (value: unknown) =>
      (typeof value === "string"
        ? JSON.parse(value)
        : value) as import("@/libs/territoryWar").TerritoryBoostWindow[],
  );
};
