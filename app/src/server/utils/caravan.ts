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
  type CaravanDiscoveryKind,
  TRADE_ROUTE_MARKER_DISCOVERY_HOURS,
} from "@/drizzle/constants";
import type {
  Caravan,
  CaravanEncounter,
  CaravanOperation,
  UserData,
} from "@/drizzle/schema";
import {
  activeGuards,
  type CaravanNoticeView,
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
  chargeAmbushLoss,
  closeCaravan,
  grantCaravanRewards,
  insertCheckpointAmbush,
  listArrivedCaravans,
  listBlockedCaravans,
  listCaravanParticipants,
  listCaravansByIds,
  listDueEncounters,
  listDueOperations,
  listLiveBattleIds,
  listOpenCaravans,
  listOpenEncounters,
  listOpenVillageCaravans,
  listOperatorProfiles,
  listTravellingCaravans,
  releaseParticipants,
  releaseStaleEncounter,
  resolveOperation,
  resolveSabotage,
  upsertDiscoveries,
} from "@/queries/caravan";
import { findGameSettingByName } from "@/queries/gamesettings";
import {
  closeTradeRoutes,
  listSectorMarkers,
  listVillageRelationships,
  upsertMarkerDiscoveries,
} from "@/queries/tradeRoute";
import {
  cargoLogs,
  ensureWarehouseStock,
  insertWarehouseLogs,
  listOpenWars,
} from "@/queries/warehouse";
import { type DrizzleClient, drizzleDB } from "@/server/db";
import { isServingElder } from "@/server/utils/kageGovernance";
import { isMysqlDuplicateKeyError } from "@/server/utils/mysqlErrors";
import { deferPushToUsers } from "@/server/utils/push/defer";
import { caravanNotice } from "@/server/utils/push/messages";
import { secureRandomInt } from "@/utils/math";
import { HOUR_S, MINUTE_S, secondsFromDate } from "@/utils/time";

/** Cancellations a disbanding settlement retries against concurrent caravan writes. */
const CANCEL_ATTEMPTS = 3;
/** Escorts a caravan released, and may have paid, reload their profile and caravans. */
const ESCORT_RELEASE_VIEWS: CaravanNoticeView[] = ["profile", "caravans", "controls"];

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
  const caravanIds = scope?.caravanIds;
  // A page read finishes only its viewer's operations, or those against its caravans so a
  // sabotage that finished first lands before delivery; the job finishes everyone's.
  const resolvesOperations = !scope || !!scope.userId || !!caravanIds?.length;
  const watchesCaravans = !scope || !!caravanIds?.length;
  const staleBefore = secondsFromDate(-CARAVAN_ENCOUNTER_STALE_MINUTES * MINUTE_S, now);
  const readCaravans = () =>
    caravanIds ? listCaravansByIds(client, caravanIds) : listTravellingCaravans(client);
  // Neither landing sabotage nor rolling ambushes makes an encounter due, so the due
  // encounters are read together with the operations and caravans.
  const [due, caravans, encounters] = await Promise.all([
    resolvesOperations ? listDueOperations(client, now, scope) : Promise.resolve([]),
    watchesCaravans ? readCaravans() : Promise.resolve([]),
    watchesCaravans
      ? listDueEncounters(client, now, staleBefore, caravanIds)
      : Promise.resolve([]),
  ]);
  const landed = await resolveDueOperations(client, due, caravans, now);
  if (!watchesCaravans) return;
  // Landed sabotage moved its caravan's schedule and version.
  const current = landed ? await readCaravans() : caravans;
  await rollCheckpointAmbushes(
    client,
    current.filter((row) => row.status === "TRAVELLING"),
    now,
  );
  await settleDueEncounters(client, encounters, staleBefore, now);
  // Settlement changes caravan versions, so cancellation and delivery read afresh. A
  // blocked caravan that already arrived is delivered instead, so the two never meet.
  const [blocked, arrivals] = await Promise.all([
    listBlockedCaravans(client, caravanIds),
    caravanIds
      ? listCaravansByIds(client, caravanIds)
      : listArrivedCaravans(client, now),
  ]);
  await Promise.all([
    cancelBlockedCaravans(client, blocked, now),
    ...arrivals
      .filter(
        (row) => row.status === "TRAVELLING" && row.arrivesAt && row.arrivesAt <= now,
      )
      .map((row) => deliverCaravan(client, row, now)),
  ]);
};

/**
 * Whether maintaining a page's caravans would change anything at `now`, judged from rows
 * the page already read: an operation against them is due, one has arrived, passed an
 * unrolled checkpoint or travels a blocked route, or a fight over one is due. Mirrors the
 * steps of {@link maintainCaravans}, so a page can skip it when nothing is due; like them,
 * an arrival or a blocked route waits while a fight over the caravan is open.
 */
export const hasDueCaravanWork = (
  input: {
    caravans: Caravan[];
    encounters: CaravanEncounter[];
    dueOperations: CaravanOperation[];
    blockedRouteIds: Set<string>;
  },
  now: Date,
) => {
  const staleBefore = secondsFromDate(-CARAVAN_ENCOUNTER_STALE_MINUTES * MINUTE_S, now);
  const fought = new Set(input.encounters.map((row) => row.caravanId));
  return (
    input.dueOperations.length > 0 ||
    input.caravans.some(
      (row) =>
        (!fought.has(row.id) &&
          (input.blockedRouteIds.has(row.routeId) ||
            (row.status === "TRAVELLING" &&
              !!row.arrivesAt &&
              row.arrivesAt <= now))) ||
        (row.status === "TRAVELLING" &&
          getReachedCheckpoints(row, now) > row.checkpointsProcessed),
    ) ||
    input.encounters.some((row) =>
      row.status === "PENDING"
        ? row.type === "AMBUSH" && !!row.expiresAt && row.expiresAt <= now
        : (row.status === "STARTING" || row.status === "FIGHTING") &&
          row.createdAt < staleBefore,
    )
  );
};

/**
 * Cancel a caravan and return everything it holds: a preparing caravan releases its
 * reservation, a travelling one brings its remaining cargo home. Escorts are freed unpaid.
 * `unfought` refuses the cancellation while a fight over the caravan is open. Resolves to
 * the escorts it released, or false when the caravan changed and stays open.
 */
export const cancelCaravan = async (
  client: DrizzleClient,
  row: Caravan,
  now = new Date(),
  options: { unfought?: boolean } = {},
) => {
  const departed = row.status === "TRAVELLING";
  const returned = departed ? getRemainingCargo(row.cargo, row.lossBp) : row.cargo;
  const participants = await listCaravanParticipants(client, [row.id]);
  if (departed)
    await ensureWarehouseStock(
      client,
      row.originVillageId,
      returned.map((line) => line.itemId),
    );
  const cancelled = await closeCaravan(client, row, {
    status: "CANCELLED",
    resolvedAt: now,
    villageId: row.originVillageId,
    lines: returned,
    stock: departed ? "credit" : "release",
    unfought: options.unfought,
  });
  if (cancelled.rowsAffected === 0) return false;
  // History follows the cancellation: a failure here costs only a log row support can add.
  await insertWarehouseLogs(
    client,
    cargoLogs(row.originVillageId, "RELEASE", returned),
    now,
  );
  const guards = participants.filter((p) => p.role === "GUARD").map((p) => p.userId);
  // A disband cancels on its caller's transaction, so escorts hear of the cancellation only
  // once it committed: the caravan holds the version this call wrote.
  if (guards.length > 0)
    after(async () => {
      const [current] = await listCaravansByIds(drizzleDB, [row.id]);
      if (current?.status !== "CANCELLED" || current.version !== row.version + 1)
        return;
      notifyPlayers(drizzleDB, guards, {
        title: "Caravan cancelled",
        body: "Your escort duty ended; the caravan was cancelled.",
        refresh: ESCORT_RELEASE_VIEWS,
      });
    });
  return activeGuards(participants).map((p) => p.userId);
};

/**
 * End the trade of a disbanded settlement: its routes close and every open caravan to or
 * from it is called off. One bound for it brings its cargo home; one it sent returns to the
 * settlement's own stock and is lost with it. Account deletion disbands on a transaction,
 * so this and the cancellations it runs issue their statements one at a time.
 */
export const closeVillageTrade = async (
  client: DrizzleClient,
  villageId: string,
  now = new Date(),
) => {
  const caravans = await listOpenVillageCaravans(client, villageId);
  await closeTradeRoutes(client, { villageId }, now);
  for (const row of caravans) await callOffCaravan(client, row, now);
};

/** Deliver an arrived caravan once no fight over it is still open, and pay its escorts. */
export const deliverCaravan = async (
  client: DrizzleClient,
  row: Caravan,
  now = new Date(),
) => {
  const remaining = getRemainingCargo(row.cargo, row.lossBp);
  const [encounters, participants] = await Promise.all([
    listOpenEncounters(client, [row.id]),
    listCaravanParticipants(client, [row.id]),
    ensureWarehouseStock(
      client,
      row.destinationVillageId,
      remaining.map((line) => line.itemId),
    ),
  ]);
  if (encounters.length > 0) return false;
  const rewards = activeGuards(participants)
    .filter((p) => !p.rewardedAt)
    .map((guard) => ({
      userId: guard.userId,
      money: getGuardReward(guard.objectives),
    }));
  // A fight opened since the read above keeps the caravan on the road until it settles.
  const delivered = await closeCaravan(client, row, {
    status: "DELIVERED",
    resolvedAt: now,
    villageId: row.destinationVillageId,
    lines: remaining,
    stock: "credit",
    pay: rewards,
    unfought: true,
  });
  if (delivered.rowsAffected === 0) return false;
  // History follows the delivery: a failure here costs only a log row support can add.
  await insertWarehouseLogs(
    client,
    cargoLogs(row.destinationVillageId, "DELIVERY", remaining),
    now,
  );
  for (const reward of rewards)
    notifyPlayers(client, [reward.userId], {
      title: "Caravan delivered",
      body: reward.money
        ? `Your caravan arrived. You earned ${reward.money.toLocaleString()} ryo for the escort.`
        : "Your caravan arrived. Complete a defence or checkpoint to earn escort pay.",
      refresh: ESCORT_RELEASE_VIEWS,
    });
  return true;
};

/**
 * Alert players in game and on their devices, linking the Warehouse unless the notice names
 * another route; `refresh` names the views the notice changed, which their open tabs reload.
 */
export const notifyPlayers = (
  client: DrizzleClient,
  userIds: string[],
  message: {
    title: string;
    body: string;
    route?: string;
    refresh?: CaravanNoticeView[];
  },
) => {
  const recipients = [...new Set(userIds)];
  if (recipients.length === 0) return;
  const route = message.route ?? "/warehouse";
  after(() =>
    getServerPusher().trigger(recipients, "event", {
      type: "userMessage",
      message: message.body,
      route,
      routeText: "Open",
      refresh: message.refresh,
    }),
  );
  deferPushToUsers(client, recipients, caravanNotice(message, route));
};

/** Kage and Elders manage a village's agreements and caravans. */
export const canManageTrade = (
  user: UserData,
  villageData: { id: string; kageId: string },
) =>
  !user.isBanned &&
  user.villageId === villageData.id &&
  (villageData.kageId === user.userId || isServingElder(user, villageData.id));

/**
 * Cancel a caravan of a disbanded settlement despite concurrent writes, such as an expiring
 * ambush, that bump the version the cancel claims: the caravan is reread and called off
 * while it is still open. A caravan still open after every attempt throws, so the disband
 * fails and can be retried; inside an outer transaction the reread repeats its snapshot,
 * so a conflict there always ends in that throw and the caller's retry.
 */
const callOffCaravan = async (client: DrizzleClient, row: Caravan, now: Date) => {
  let current: Caravan | undefined = row;
  for (let attempt = 0; attempt < CANCEL_ATTEMPTS; attempt++) {
    if (current?.status !== "PREPARING" && current?.status !== "TRAVELLING") return;
    if (await cancelCaravan(client, current, now)) return;
    [current] = await listCaravansByIds(client, [current.id]);
  }
  if (current?.status === "PREPARING" || current?.status === "TRAVELLING")
    throw new Error(`Caravan ${row.id} could not be called off`);
};

/**
 * Finish due operations and apply what they found or changed, and report whether sabotage
 * landed. Targets come from `known` caravans where possible.
 */
const resolveDueOperations = async (
  client: DrizzleClient,
  due: CaravanOperation[],
  known: Caravan[],
  now: Date,
) => {
  if (due.length === 0) return false;
  const sabotage = due.filter(
    (operation) =>
      operation.succeeds &&
      operation.caravanId &&
      (operation.type === "DISRUPT" || operation.type === "DELAY"),
  );
  const scouting = due.filter(
    (operation) =>
      operation.succeeds &&
      (operation.type === "INVESTIGATE" || operation.type === "SEARCH"),
  );
  const unsettled = due.filter(
    (operation) => !sabotage.includes(operation) && !scouting.includes(operation),
  );
  const knownIds = new Set(known.map((row) => row.id));
  const targetIds = [
    ...new Set(sabotage.flatMap((operation) => operation.caravanId ?? [])),
  ];
  const [fetched, context] = await Promise.all([
    listCaravansByIds(
      client,
      targetIds.filter((id) => !knownIds.has(id)),
    ),
    scouting.length > 0 ? loadScoutingContext(client, scouting) : undefined,
  ]);
  const targets = new Map([...known, ...fetched].map((row) => [row.id, row]));
  const outcomes = await Promise.all([
    ...unsettled.map(async (operation) => {
      await resolveOperation(client, operation.id, "RESOLVED", now);
      return false;
    }),
    // Sabotage against one caravan lands in turn, in the order it finished, each against the
    // caravan the last left: an earlier delay moves the arrival a later one is judged by.
    ...targetIds.map(async (caravanId) => {
      let landed = false;
      let target = targets.get(caravanId);
      const operations = sabotage
        .filter((row) => row.caravanId === caravanId)
        .sort((a, b) => a.finishesAt.getTime() - b.finishesAt.getTime());
      for (const [index, operation] of operations.entries()) {
        if (index > 0) [target] = await listCaravansByIds(client, [caravanId]);
        if (await landSabotage(client, operation, target, now)) landed = true;
      }
      return landed;
    }),
    // Scouting by players of one village may reveal the same markers, so it runs in turn.
    (async () => {
      if (!context) return false;
      for (const operation of scouting) {
        const claimed = await resolveOperation(client, operation.id, "RESOLVED", now);
        if (claimed.rowsAffected === 1)
          await applyScouting(client, operation, context, now);
      }
      return false;
    })(),
  ]);
  return outcomes.some(Boolean);
};

/** Land a successful sabotage on its caravan and report whether it took effect. */
const landSabotage = async (
  client: DrizzleClient,
  operation: CaravanOperation,
  target: Caravan | undefined,
  now: Date,
) => {
  // A caravan that was due, arrived or was called off before the operation finished
  // cannot be sabotaged.
  if (
    target?.status !== "TRAVELLING" ||
    !target.arrivesAt ||
    target.arrivesAt <= operation.finishesAt
  ) {
    await resolveOperation(client, operation.id, "RESOLVED", now);
    return false;
  }
  // A delay that changed meanwhile leaves the operation for the next run's fresh read.
  const landed = await resolveSabotage(client, {
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
        ? secondsFromDate(CARAVAN_DISRUPTION_MINUTES * MINUTE_S, now)
        : null,
  });
  return landed.rowsAffected > 0;
};

/** What scouting operations need to know, read once for all of them. */
const loadScoutingContext = async (
  client: DrizzleClient,
  operations: CaravanOperation[],
) => {
  const sectors = [
    ...new Set(
      operations
        .filter(
          (operation) => operation.type === "SEARCH" && operation.role === "ENEMY",
        )
        .map((operation) => operation.sector),
    ),
  ];
  const [users, relationships, wars, caravans, markers] = await Promise.all([
    listOperatorProfiles(
      client,
      operations.map((operation) => operation.userId),
    ),
    listVillageRelationships(client),
    listOpenWars(client),
    listOpenCaravans(client),
    Promise.all(sectors.map((sector) => listSectorMarkers(client, sector))),
  ]);
  return {
    users,
    relationships,
    wars,
    caravans,
    markers: new Map(sectors.map((sector, index) => [sector, markers[index] ?? []])),
  };
};

/** Reveal what a successful investigation or sector search found. */
const applyScouting = async (
  client: DrizzleClient,
  operation: CaravanOperation,
  context: Awaited<ReturnType<typeof loadScoutingContext>>,
  now: Date,
) => {
  const user = context.users.find((row) => row.userId === operation.userId);
  if (!user) return;
  const eligible = context.caravans.filter(
    (row) =>
      getAttackerRole(
        user,
        row.originVillageId,
        context.relationships,
        context.wars,
      ) === operation.role,
  );
  const expiresAt = secondsFromDate(CARAVAN_DISCOVERY_MINUTES * MINUTE_S, now);
  const investigated =
    operation.type === "INVESTIGATE" && eligible.length
      ? eligible[secureRandomInt(eligible.length)]
      : undefined;
  const found: {
    caravanId: string;
    kind: CaravanDiscoveryKind;
    sector: number | null;
  }[] =
    operation.type === "INVESTIGATE"
      ? investigated
        ? [{ caravanId: investigated.id, kind: "ROUTE", sector: null }]
        : []
      : eligible
          .filter(
            (row) =>
              row.status === "TRAVELLING" &&
              getCaravanSector(row, now) === operation.sector,
          )
          .map((row) => ({
            caravanId: row.id,
            kind: "LOCATION",
            sector: operation.sector,
          }));
  const markerIds =
    operation.type === "SEARCH" && operation.role === "ENEMY" && user.villageId
      ? (context.markers.get(operation.sector) ?? [])
          .filter(
            (marker) =>
              ![marker.villageIdA, marker.villageIdB].includes(user.villageId ?? ""),
          )
          .map((marker) => marker.id)
      : [];
  await Promise.all([
    upsertDiscoveries(
      client,
      found.map((row) => ({
        ...row,
        userId: operation.userId,
        seenAt: now,
        expiresAt,
      })),
    ),
    user.villageId
      ? upsertMarkerDiscoveries(
          client,
          markerIds,
          user.villageId,
          secondsFromDate(TRADE_ROUTE_MARKER_DISCOVERY_HOURS * HOUR_S, now),
        )
      : undefined,
    operation.role === "BANDIT"
      ? grantCaravanRewards(client, [
          { userId: operation.userId, banditExperience: BANDIT_OPERATION_EXP },
        ])
      : undefined,
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
  const [setting, participants] = await Promise.all([
    findGameSettingByName(client, CARAVAN_ENCOUNTER_RATE_SETTING),
    listCaravanParticipants(
      client,
      due.map((row) => row.id),
    ),
  ]);
  const rate = setting ? setting.value : CARAVAN_DEFAULT_ENCOUNTER_RATE;
  await Promise.all(
    due.map(async (row) => {
      const reached = getReachedCheckpoints(row, now);
      const claimed = await advanceCaravanCheckpoints(client, row, reached);
      // Checkpoints a late run catches up on after arrival pass without an ambush.
      if (claimed.rowsAffected !== 1 || (row.arrivesAt && row.arrivesAt <= now)) return;
      const ambushed = Array.from({ length: reached - row.checkpointsProcessed }, () =>
        rollChance(rate),
      ).some(Boolean);
      if (!ambushed) return;
      try {
        const inserted = await insertCheckpointAmbush(client, {
          id: nanoid(),
          caravanId: row.id,
          expiresAt: secondsFromDate(CARAVAN_AMBUSH_RESPONSE_MINUTES * MINUTE_S, now),
          now,
        });
        // A caravan delivered meanwhile is no longer ambushed.
        if (inserted.rowsAffected !== 1) return;
      } catch (error) {
        // Another fight already holds the caravan; this checkpoint passes quietly.
        if (isMysqlDuplicateKeyError(error)) return;
        throw error;
      }
      notifyPlayers(
        client,
        activeGuards(participants, row.id).map((p) => p.userId),
        {
          title: "Caravan ambushed",
          body: `Bandits ambush your caravan! Defend it within ${CARAVAN_AMBUSH_RESPONSE_MINUTES} minutes.`,
          refresh: ["caravans"],
        },
      );
    }),
  );
};

/** Resolve unanswered ambushes and release fights whose battle vanished or was abandoned. */
const settleDueEncounters = async (
  client: DrizzleClient,
  due: CaravanEncounter[],
  staleBefore: Date,
  now: Date,
) => {
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
  // Each caravan and marker holds one open encounter, so these touch distinct rows.
  await Promise.all(
    due.map(async (encounter) => {
      if (encounter.battleId && running.has(encounter.battleId)) return;
      // An abandoned defence costs what an unanswered ambush would; an unanswered one has
      // no battle and no leader, so only its loss is charged.
      const released =
        encounter.type === "AMBUSH" && encounter.caravanId
          ? await chargeAmbushLoss(client, encounter, CARAVAN_AMBUSH_LOSS_BP, now)
          : await releaseStaleEncounter(client, encounter, now);
      if (released.rowsAffected === 0 || !encounter.caravanId || !encounter.leaderId)
        return;
      await releaseParticipants(client, encounter.caravanId, {
        groupLeaderId: encounter.leaderId,
        roles: ["ENEMY", "BANDIT"],
      });
    }),
  );
};

/** Cancel the open caravans of routes a village outside the agreement cut off. */
const cancelBlockedCaravans = async (
  client: DrizzleClient,
  blocked: Caravan[],
  now: Date,
) => {
  if (blocked.length === 0) return;
  // A caravan still being fought over, even by a fight opened after this read, is called
  // off once its fight settles; one that already arrived is delivered instead.
  const fighting = new Set(
    (
      await listOpenEncounters(
        client,
        blocked.map((row) => row.id),
      )
    ).map((row) => row.caravanId),
  );
  await Promise.all(
    blocked
      .filter(
        (row) => !fighting.has(row.id) && !(row.arrivesAt && row.arrivesAt <= now),
      )
      .map((row) => cancelCaravan(client, row, now, { unfought: true })),
  );
};
