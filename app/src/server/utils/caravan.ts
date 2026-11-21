import * as Sentry from "@sentry/nextjs";
import { nanoid } from "nanoid";
import { after } from "next/server";
import {
  BANDIT_OPERATION_EXP,
  CARAVAN_AMBUSH_LOSS_BP,
  CARAVAN_AMBUSH_RESPONSE_MINUTES,
  CARAVAN_DEFAULT_ENCOUNTER_RATE,
  CARAVAN_DELAY_MINUTES,
  CARAVAN_DISCOVERY_MINUTES,
  CARAVAN_DISRUPTION_MINUTES,
  CARAVAN_ENCOUNTER_RATE_SETTING,
  CARAVAN_ENCOUNTER_STALE_MINUTES,
  TRADE_ROUTE_MARKER_DISCOVERY_HOURS,
} from "@/drizzle/constants";
import type { Caravan, CaravanOperation, UserData } from "@/drizzle/schema";
import {
  getAllowedDelay,
  getAttackerRole,
  getCaravanSector,
  getGuardReward,
  getReachedCheckpoints,
  getRemainingCargo,
  rollChance,
} from "@/libs/caravan";
import { getServerPusher } from "@/libs/pusher";
import {
  advanceCaravanCheckpoints,
  applyCaravanLoss,
  expireAmbush,
  grantCaravanRewards,
  insertCheckpointAmbush,
  listArrivedCaravans,
  listCaravanParticipants,
  listCaravansByIds,
  listDueEncounters,
  listDueOperations,
  listLiveBattleIds,
  listOpenCaravans,
  listOpenEncounters,
  listOpenVillageCaravans,
  listTravellingCaravans,
  markGuardsRewarded,
  releaseCargo,
  releaseParticipants,
  releaseStaleEncounter,
  resolveOperation,
  resolveSabotage,
  transitionCaravan,
  upsertDiscoveries,
  wakeReleasedGuards,
} from "@/queries/caravan";
import { findGameSettingByName } from "@/queries/gamesettings";
import { fetchUser } from "@/queries/profile";
import {
  closeVillageTradeRoutes,
  listBlockedRouteIds,
  listSectorMarkers,
  listVillageRelationships,
  upsertMarkerDiscoveries,
} from "@/queries/tradeRoute";
import {
  creditWarehouseStock,
  insertWarehouseLogs,
  listOpenWars,
} from "@/queries/warehouse";
import type { DrizzleClient } from "@/server/db";
import { isServingElder } from "@/server/utils/kageGovernance";
import { isMysqlDuplicateKeyError, retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { sendPushToUsers } from "@/server/utils/push";
import { secureRandomInt } from "@/utils/math";

const MINUTE_MS = 60_000;

/**
 * Advance caravans and covert operations to `now`: finish due operations, roll ambushes at
 * passed checkpoints, resolve unanswered ambushes and vanished or abandoned fights, cancel
 * shipments on routes a hostile village cut, and deliver arrivals. Every step is a guarded
 * transition, so the per-minute job and page reads can run it concurrently. A scope limits
 * the work to the caravans and operator a page shows.
 */
export const maintainCaravans = async (
  client: DrizzleClient,
  now = new Date(),
  scope?: { caravanIds?: string[]; userId?: string },
) => {
  // A page read finishes only its viewer's operations, or those against its caravans so a
  // sabotage that finished first lands before delivery; the job finishes everyone's.
  if (!scope || scope.userId || scope.caravanIds?.length)
    await resolveDueOperations(client, now, scope);
  if (scope && !scope.caravanIds?.length) return;
  const caravans = scope?.caravanIds
    ? await listCaravansByIds(client, scope.caravanIds)
    : await listTravellingCaravans(client);
  await rollCheckpointAmbushes(
    client,
    caravans.filter((row) => row.status === "TRAVELLING"),
    now,
  );
  await settleDueEncounters(client, now, scope?.caravanIds);
  await cancelBlockedCaravans(client, now, scope?.caravanIds);
  const arrived = scope?.caravanIds
    ? (await listCaravansByIds(client, scope.caravanIds)).filter(
        (row) => row.status === "TRAVELLING" && row.arrivesAt && row.arrivesAt <= now,
      )
    : await listArrivedCaravans(client, now);
  await Promise.all(arrived.map((row) => deliverCaravan(client, row, now)));
};

/**
 * Cancel a caravan and return everything it holds: a preparing caravan releases its
 * reservation, a travelling one brings its remaining cargo home. Escorts are freed unpaid.
 * `unfought` refuses the cancellation while a fight over the caravan is open.
 */
export const cancelCaravan = async (
  client: DrizzleClient,
  row: Caravan,
  now = new Date(),
  options: { unfought?: boolean } = {},
) => {
  const participants = await listCaravanParticipants(client, [row.id]);
  const remaining =
    row.status === "TRAVELLING" ? getRemainingCargo(row.cargo, row.lossBp) : row.cargo;
  // The lifecycle claim and the stock it returns span the caravan and several stock rows;
  // the transaction prevents a cancelled caravan whose goods never came back.
  const cancelled = await retryOnDeadlock(() =>
    client.transaction(async (tx) => {
      const claimed = await transitionCaravan(
        tx,
        row,
        { status: "CANCELLED", resolvedAt: now },
        options,
      );
      if (claimed.rowsAffected !== 1) return false;
      for (const line of remaining) {
        if (line.quantity <= 0) continue;
        if (row.status === "PREPARING")
          await releaseCargo(tx, row.originVillageId, line);
        else
          await creditWarehouseStock(
            tx,
            row.originVillageId,
            line.itemId,
            line.quantity,
          );
      }
      await releaseParticipants(tx, row.id);
      await insertWarehouseLogs(
        tx,
        remaining
          .filter((line) => line.quantity > 0)
          .map((line) => ({
            villageId: row.originVillageId,
            itemId: line.itemId,
            type: "RELEASE" as const,
            quantity: line.quantity,
          })),
        now,
      );
      return true;
    }),
  );
  if (!cancelled) return false;
  const guardIds = participants.filter((p) => p.role === "GUARD").map((p) => p.userId);
  await wakeReleasedGuards(client, guardIds);
  notifyPlayers(client, guardIds, {
    title: "Caravan cancelled",
    body: "Your escort duty ended; the caravan was cancelled.",
    route: "/warehouse",
  });
  return true;
};

/**
 * End the trade of a disbanded settlement: its routes close and every open caravan to or
 * from it is called off. One bound for it brings its cargo home; one it sent returns to the
 * settlement's own stock and is lost with it.
 */
export const closeVillageTrade = async (
  client: DrizzleClient,
  villageId: string,
  now = new Date(),
) => {
  const [caravans] = await Promise.all([
    listOpenVillageCaravans(client, villageId),
    closeVillageTradeRoutes(client, villageId, now),
  ]);
  // One at a time: inside an outer transaction each cancel is a savepoint of the same name.
  for (const row of caravans) await cancelCaravan(client, row, now);
};

/** Deliver an arrived caravan once no fight over it is still open, and pay its escorts. */
export const deliverCaravan = async (
  client: DrizzleClient,
  row: Caravan,
  now = new Date(),
) => {
  const [encounters, participants] = await Promise.all([
    listOpenEncounters(client, { caravanIds: [row.id] }),
    listCaravanParticipants(client, [row.id]),
  ]);
  if (encounters.length > 0) return false;
  const remaining = getRemainingCargo(row.cargo, row.lossBp).filter(
    (line) => line.quantity > 0,
  );
  const guards = participants.filter(
    (p) => p.role === "GUARD" && p.activeUserId && !p.rewardedAt,
  );
  const rewards = guards.map((guard) => ({
    userId: guard.userId,
    money: getGuardReward(guard.objectives),
  }));
  // Delivering credits stock rows, pays escorts and records the receipt across tables; the
  // transaction ties them to one DELIVERED claim so a retry neither repeats nor loses them.
  const delivered = await retryOnDeadlock(() =>
    client.transaction(async (tx) => {
      // A fight opened since the read above keeps the caravan on the road until it settles.
      const claimed = await transitionCaravan(
        tx,
        row,
        { status: "DELIVERED", resolvedAt: now },
        { unfought: true },
      );
      if (claimed.rowsAffected !== 1) return false;
      for (const line of remaining)
        await creditWarehouseStock(
          tx,
          row.destinationVillageId,
          line.itemId,
          line.quantity,
        );
      await grantCaravanRewards(tx, rewards);
      await markGuardsRewarded(tx, row.id, now);
      await releaseParticipants(tx, row.id);
      await insertWarehouseLogs(
        tx,
        remaining.map((line) => ({
          villageId: row.destinationVillageId,
          itemId: line.itemId,
          type: "DELIVERY" as const,
          quantity: line.quantity,
        })),
        now,
      );
      return true;
    }),
  );
  if (!delivered) return false;
  await wakeReleasedGuards(
    client,
    guards.map((guard) => guard.userId),
  );
  for (const reward of rewards)
    notifyPlayers(client, [reward.userId], {
      title: "Caravan delivered",
      body: reward.money
        ? `Your caravan arrived. You earned ${reward.money.toLocaleString()} ryo for the escort.`
        : "Your caravan arrived. Complete a defence or checkpoint to earn escort pay.",
      route: "/warehouse",
    });
  return true;
};

/** Alert players in game and on their devices. */
export const notifyPlayers = (
  client: DrizzleClient,
  userIds: string[],
  message: { title: string; body: string; route: string },
) => {
  const recipients = [...new Set(userIds)];
  if (recipients.length === 0) return;
  after(async () => {
    try {
      await Promise.all([
        getServerPusher().trigger(recipients, "event", {
          type: "userMessage",
          message: message.body,
          route: message.route,
          routeText: "Open",
        }),
        sendPushToUsers(client, recipients, {
          title: message.title,
          body: message.body,
          category: "combat",
          url: message.route,
        }),
      ]);
    } catch (error) {
      Sentry.captureException(error, { tags: { source: "caravanNotification" } });
    }
  });
};

/** Kage and Elders manage a village's agreements and caravans. */
export const canManageTrade = (
  user: UserData,
  villageData: { id: string; kageId: string },
) =>
  !user.isBanned &&
  user.villageId === villageData.id &&
  (villageData.kageId === user.userId || isServingElder(user, villageData.id));

/** Whether two villages fight each other in an open war. */
export const isAtWar = (
  wars: { attackerVillageId: string; defenderVillageId: string }[],
  villageIdA: string,
  villageIdB: string,
) =>
  wars.some(
    (war) =>
      (war.attackerVillageId === villageIdA && war.defenderVillageId === villageIdB) ||
      (war.attackerVillageId === villageIdB && war.defenderVillageId === villageIdA),
  );

/** Finish due operations and apply what they found or changed. */
const resolveDueOperations = async (
  client: DrizzleClient,
  now: Date,
  filter?: { userId?: string; caravanIds?: string[] },
) => {
  const due = await listDueOperations(client, now, filter);
  for (const operation of due) {
    if (!operation.succeeds) {
      await resolveOperation(client, operation.id, "RESOLVED", now);
      continue;
    }
    if (operation.type === "DISRUPT" || operation.type === "DELAY") {
      if (!operation.caravanId) {
        await resolveOperation(client, operation.id, "RESOLVED", now);
        continue;
      }
      const [target] = await listCaravansByIds(client, [operation.caravanId]);
      // A caravan that was due, arrived or was called off before the operation finished
      // cannot be sabotaged.
      if (
        target?.status !== "TRAVELLING" ||
        !target.arrivesAt ||
        target.arrivesAt <= operation.finishesAt
      ) {
        await resolveOperation(client, operation.id, "RESOLVED", now);
        continue;
      }
      // A delay that changed meanwhile leaves the operation for the next run's fresh read.
      await resolveSabotage(client, {
        operationId: operation.id,
        caravanId: target.id,
        finishesAt: operation.finishesAt,
        now,
        expectedDelayMinutes: target.delayMinutes,
        addedMinutes:
          operation.type === "DELAY"
            ? getAllowedDelay(target.delayMinutes, CARAVAN_DELAY_MINUTES)
            : 0,
        disruptedUntil:
          operation.type === "DISRUPT"
            ? new Date(now.getTime() + CARAVAN_DISRUPTION_MINUTES * MINUTE_MS)
            : null,
      });
      continue;
    }
    const claimed = await resolveOperation(client, operation.id, "RESOLVED", now);
    if (claimed.rowsAffected !== 1) continue;
    await applyScouting(client, operation, now);
  }
};

/** Reveal what a successful investigation or sector search found. */
const applyScouting = async (
  client: DrizzleClient,
  operation: CaravanOperation,
  now: Date,
) => {
  const [user, relationships, wars, caravans] = await Promise.all([
    fetchUser(client, operation.userId),
    listVillageRelationships(client),
    listOpenWars(client),
    listOpenCaravans(client),
  ]);
  const eligible = caravans.filter(
    (row) =>
      getAttackerRole(
        user,
        row.originVillageId,
        relationships,
        isAtWar(wars, user.villageId ?? "", row.originVillageId),
      ) === operation.role,
  );
  const expiresAt = new Date(now.getTime() + CARAVAN_DISCOVERY_MINUTES * MINUTE_MS);
  if (operation.type === "INVESTIGATE") {
    const found = eligible.length
      ? eligible[secureRandomInt(eligible.length)]
      : undefined;
    if (found)
      await upsertDiscoveries(client, [
        {
          caravanId: found.id,
          userId: operation.userId,
          kind: "ROUTE",
          sector: null,
          seenAt: now,
          expiresAt,
        },
      ]);
  } else {
    const sighted = eligible.filter(
      (row) =>
        row.status === "TRAVELLING" && getCaravanSector(row, now) === operation.sector,
    );
    await upsertDiscoveries(
      client,
      sighted.map((row) => ({
        caravanId: row.id,
        userId: operation.userId,
        kind: "LOCATION" as const,
        sector: operation.sector,
        seenAt: now,
        expiresAt,
      })),
    );
    if (operation.role === "ENEMY" && user.villageId) {
      const markers = await listSectorMarkers(client, operation.sector);
      await upsertMarkerDiscoveries(
        client,
        markers
          .filter(
            (marker) =>
              ![marker.villageIdA, marker.villageIdB].includes(user.villageId ?? ""),
          )
          .map((marker) => marker.id),
        user.villageId,
        new Date(now.getTime() + TRADE_ROUTE_MARKER_DISCOVERY_HOURS * 3_600_000),
      );
    }
  }
  if (operation.role === "BANDIT")
    await grantCaravanRewards(client, [
      { userId: operation.userId, banditExperience: BANDIT_OPERATION_EXP },
    ]);
};

/** Roll an NPC bandit ambush for each checkpoint a caravan passed since the last roll. */
const rollCheckpointAmbushes = async (
  client: DrizzleClient,
  caravans: Caravan[],
  now: Date,
) => {
  const due = caravans.filter(
    (row) => getReachedCheckpoints(row, now) > row.checkpointsProcessed,
  );
  if (due.length === 0) return;
  const setting = await findGameSettingByName(client, CARAVAN_ENCOUNTER_RATE_SETTING);
  const rate = setting ? setting.value : CARAVAN_DEFAULT_ENCOUNTER_RATE;
  for (const row of due) {
    const reached = getReachedCheckpoints(row, now);
    const claimed = await advanceCaravanCheckpoints(
      client,
      row.id,
      row.checkpointsProcessed,
      reached,
    );
    // Checkpoints a late run catches up on after arrival pass without an ambush.
    if (claimed.rowsAffected !== 1 || (row.arrivesAt && row.arrivesAt <= now)) continue;
    const ambushed = Array.from({ length: reached - row.checkpointsProcessed }, () =>
      rollChance(rate),
    ).some(Boolean);
    if (!ambushed) continue;
    try {
      const inserted = await insertCheckpointAmbush(client, {
        id: nanoid(),
        caravanId: row.id,
        expiresAt: new Date(
          now.getTime() + CARAVAN_AMBUSH_RESPONSE_MINUTES * MINUTE_MS,
        ),
        now,
      });
      // A caravan delivered meanwhile is no longer ambushed.
      if (inserted.rowsAffected !== 1) continue;
    } catch (error) {
      // Another fight already holds the caravan; this checkpoint passes quietly.
      if (isMysqlDuplicateKeyError(error)) continue;
      throw error;
    }
    const participants = await listCaravanParticipants(client, [row.id]);
    notifyPlayers(
      client,
      participants
        .filter((p) => p.role === "GUARD" && p.activeUserId)
        .map((p) => p.userId),
      {
        title: "Caravan ambushed",
        body: `Bandits ambush your caravan! Defend it within ${CARAVAN_AMBUSH_RESPONSE_MINUTES} minutes.`,
        route: "/warehouse",
      },
    );
  }
};

/** Resolve unanswered ambushes and release fights whose battle vanished or was abandoned. */
const settleDueEncounters = async (
  client: DrizzleClient,
  now: Date,
  caravanIds?: string[],
) => {
  const staleBefore = new Date(
    now.getTime() - CARAVAN_ENCOUNTER_STALE_MINUTES * MINUTE_MS,
  );
  const due = (await listDueEncounters(client, now, staleBefore)).filter(
    (row) => !caravanIds || (row.caravanId && caravanIds.includes(row.caravanId)),
  );
  if (due.length === 0) return;
  // An abandoned battle releases its caravan too; finishing it later settles nothing, since
  // settlement claims only a FIGHTING encounter.
  const running = new Set(
    (
      await listLiveBattleIds(
        client,
        due.flatMap((row) => (row.battleId ? [row.battleId] : [])),
        staleBefore,
      )
    ).map((row) => row.id),
  );
  for (const encounter of due) {
    if (encounter.status === "PENDING") {
      await expireAmbush(client, encounter.id, CARAVAN_AMBUSH_LOSS_BP, now);
      continue;
    }
    if (encounter.battleId && running.has(encounter.battleId)) continue;
    const released = await releaseStaleEncounter(client, encounter, now);
    // An abandoned defence costs what an unanswered ambush would.
    if (
      released.rowsAffected === 1 &&
      encounter.type === "AMBUSH" &&
      encounter.caravanId
    )
      await applyCaravanLoss(client, encounter.caravanId, CARAVAN_AMBUSH_LOSS_BP);
    if (released.rowsAffected === 1 && encounter.caravanId && encounter.leaderId)
      await releaseParticipants(client, encounter.caravanId, {
        groupLeaderId: encounter.leaderId,
        roles: ["ENEMY", "BANDIT"],
      });
  }
};

/** Cancel the open caravans of routes a village outside the agreement cut off. */
const cancelBlockedCaravans = async (
  client: DrizzleClient,
  now: Date,
  caravanIds?: string[],
) => {
  const blocked = await listBlockedRouteIds(client);
  if (blocked.length === 0) return;
  const caravans = await listOpenCaravans(
    client,
    blocked.map((row) => row.routeId),
  );
  const scoped = caravans.filter((row) => !caravanIds || caravanIds.includes(row.id));
  // A caravan still being fought over, even by a fight opened after this read, is called
  // off once its fight settles; one that already arrived is delivered instead.
  const fighting = new Set(
    (await listOpenEncounters(client, { caravanIds: scoped.map((row) => row.id) })).map(
      (row) => row.caravanId,
    ),
  );
  await Promise.all(
    scoped
      .filter(
        (row) => !fighting.has(row.id) && !(row.arrivesAt && row.arrivesAt <= now),
      )
      .map((row) => cancelCaravan(client, row, now, { unfought: true })),
  );
};
