import { randomInt } from "node:crypto";
import { getTableName, sql } from "drizzle-orm";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";
import { nanoid } from "nanoid";
import map from "@/data/hexasphere.json";
import {
  TERRITORY_WAR_AI_POINTS,
  TERRITORY_WAR_BOOST_HOURS,
  TERRITORY_WAR_INTERVAL_HOURS,
  TERRITORY_WAR_PVP_POINTS,
  VILLAGE_SYNDICATE_ID,
} from "@/drizzle/constants";
import type { userData } from "@/drizzle/schema";
import { stillInBattle } from "@/libs/combat/actions";
import { areBattleAllies } from "@/libs/combat/participants";
import type { CompleteBattle } from "@/libs/combat/types";
import type { TerritoryBoostWindow, TerritoryCompetitor } from "@/libs/territoryWar";
import {
  executeInsertedForSyncTerritoryWars,
  executeReceiptForSettleTerritoryWarCombat,
  executeResultForResolveTerritoryWar,
  executeRowsForCleanupTerritoryWarTeams,
  executeRowsForCleanupTerritoryWarTeams2,
  executeRowsForResolveTerritoryWar,
  expiredTerritoryWarLobby,
  fetchLatestTerritoryWar,
  findTerritoryWarForSyncTerritoryWars,
  findUserDataForFetchTerritoryWarUser,
  insertNotificationForSyncTerritoryWars,
  insertTerritoryWarScoreForSettleTerritoryWarCombat,
  listSectorForSyncTerritoryWars,
  listVillageForSyncTerritoryWars,
  updateTerritoryWarForSettleTerritoryWarCombat,
  updateTerritoryWarForSyncTerritoryWars,
  updateUserDataForResolveTerritoryWar,
} from "@/queries/territoryWar";
import { listWarCampAiUserIds } from "@/queries/war";
import type { DrizzleClient } from "@/server/db";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";

/**
 * Aggregate frozen competitors' credit from surviving, non-fled humans only.
 * Guardian points are per winning member; PvP points are per defeated opposing human.
 * Summons/allies never count. A winner who already collected still counts: the receipt,
 * rather than leftBattle, deduplicates a later opponent's result collection.
 */
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
      !stillInBattle(user)
    )
      continue;
    const opponents = battle.usersState.filter(
      (target) => !target.isSummon && !areBattleAllies(user, target),
    );
    if (!opponents.length || opponents.some((target) => stillInBattle(target)))
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

/**
 * Write-only delivery inside the successful battle-version claim's transaction.
 * The event guard serializes finishers with expiry, and the receipt makes repeated
 * result collections harmless. Always resolve before committing a score increment:
 * the scheduler relies on no qualifying score remaining unresolved after commit.
 */
export const settleTerritoryWarCombat = async (
  client: DrizzleClient,
  battle: CompleteBattle,
  now = new Date(),
) => {
  const snapshot = battle.extraState.territoryWar;
  const awards = territoryWarAwards(battle);
  if (!snapshot || !awards.length) return;
  // Serialize only this global event. The same guard excludes late and post-victory results.
  const claimed = await updateTerritoryWarForSettleTerritoryWarCombat(
    client,
    snapshot,
    now,
  );
  if (!claimed.rowsAffected) return;
  const receipt = await executeReceiptForSettleTerritoryWarCombat(
    client,
    battle,
    snapshot,
  );
  if (!receipt.rowsAffected) return;
  for (const { competitor, points } of awards) {
    await insertTerritoryWarScoreForSettleTerritoryWarCombat(
      client,
      snapshot,
      competitor,
      points,
    );
  }
  await resolveTerritoryWar(client, snapshot.id, now);
};

/**
 * Atomically pay target finishers, or the highest positive scorers at the deadline.
 * Tied winners share rewards. Villages and
 * clan hideouts receive tokens; clans without hideouts receive clan points instead.
 * The caller owns the transaction so the guarded reward, announcement INSERT and
 * recipient counters commit together; this helper never starts its own transaction.
 */
export const resolveTerritoryWar = async (
  client: DrizzleClient,
  id: string,
  now = new Date(),
) => {
  const result = await executeResultForResolveTerritoryWar(client, now, id);
  if (result.rowsAffected) {
    await executeRowsForResolveTerritoryWar(client, id);
    await updateUserDataForResolveTerritoryWar(client);
  }
  return result;
};

/**
 * Settle expired leaders or create the event, spacing openings from the actual end.
 * Scoring resolves in its own battle transaction, so active events need no repair.
 * Delayed ticks open one fresh window rather than catching up with stale events.
 */
export const syncTerritoryWars = async (client: DrizzleClient, now = new Date()) => {
  const [latest, owned, homes, guardians] = await Promise.all([
    fetchLatestTerritoryWar(client),
    listSectorForSyncTerritoryWars(client),
    listVillageForSyncTerritoryWars(client),
    listWarCampAiUserIds(client),
  ]);
  await cleanupTerritoryWarTeams(client, now);
  if (latest && !latest.resolvedAt) {
    if (latest.endsAt > now) return;
    // Claim an empty expiry atomically: a scorer holding the event lock may still
    // commit its first points, so a preceding non-locking score read is insufficient.
    const expired = await retryOnDeadlock(() =>
      updateTerritoryWarForSyncTerritoryWars(client, latest, now),
    );
    if (!expired.rowsAffected) {
      const pending = await findTerritoryWarForSyncTerritoryWars(client, latest, now);
      if (pending) {
        // Only scored, unresolved expiries need mixed-DML delivery: MySQL cannot
        // combine the guarded payout UPDATE with the announcement INSERT/counters.
        // Use the deadline so delayed ticks retain the event's actual end/boost window.
        await retryOnDeadlock(() =>
          client.transaction((tx) => resolveTerritoryWar(tx, latest.id, latest.endsAt)),
        );
      }
    }
    // A concurrent scorer may have closed earlier; the next tick reloads that end.
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
  // MySQL cannot INSERT the event and notification and UPDATE unread counters in one
  // statement. A committed event without its announcement cannot be replayed because
  // its predecessor is unique, so creation needs this short mixed-DML transaction.
  // Deadlocks roll back all three writes; the same id/predecessor makes retries safe.
  await retryOnDeadlock(() =>
    client.transaction(async (db) => {
      const inserted = await executeInsertedForSyncTerritoryWars(
        db,
        id,
        latest,
        sectorNumber,
        guardianId,
        now,
      );
      if (!inserted.rowsAffected) return;
      await insertNotificationForSyncTerritoryWars(db, guardianId, sectorNumber);
      await updateUserDataForResolveTerritoryWar(db);
    }),
  );
};

/** Release only expired lobbies; real battles keep their roster until combat settles. */
export const cleanupTerritoryWarTeams = async (
  client: DrizzleClient,
  now = new Date(),
) => {
  const expired = expiredTerritoryWarLobby(now);
  await executeRowsForCleanupTerritoryWarTeams(client, expired);
  await executeRowsForCleanupTerritoryWarTeams2(client, expired);
};

/** Shared farming/lobby user snapshot with the village/clan needed for competitor and bonus rules. */
export const fetchTerritoryWarUser = async (client: DrizzleClient, userId: string) => {
  const user = await findUserDataForFetchTerritoryWarUser(client, userId);
  if (!user) throw new Error("User not found");
  return user;
};

/**
 * Correlated ISO bonus windows in the existing user query, bounded by its oldest
 * unsettled work. `since` additionally includes a queued job's logical start even
 * when collection occurs after its bonus expired. The competitorId CASE mirrors
 * getTerritoryCompetitor in @/libs/territoryWar; keep both in sync.
 */
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
  return sql<TerritoryBoostWindow[]>`
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
      (typeof value === "string" ? JSON.parse(value) : value) as TerritoryBoostWindow[],
  );
};
