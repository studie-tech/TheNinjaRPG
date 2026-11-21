/**
 * Database access for caravans, their participants, encounters and covert operations.
 * Authorization and transaction scopes stay in callers.
 */
import {
  and,
  desc,
  eq,
  getTableColumns,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";
import { alias } from "drizzle-orm/mysql-core";
import {
  CARAVAN_GUARD_SLOTS,
  CARAVAN_MAX_LOSS_BP,
  type CaravanDiscoveryKind,
  type CaravanEncounterType,
  type CaravanOperationType,
  type CaravanRole,
  type CaravanStatus,
} from "@/drizzle/constants";
import {
  battle,
  type Caravan,
  type CaravanEncounter,
  caravan,
  caravanDiscovery,
  caravanEncounter,
  caravanOperation,
  caravanParticipant,
  tradeRoute,
  tradeRouteMarker,
  userData,
  village,
  warehouseStock,
} from "@/drizzle/schema";
import type { CargoLine, CargoSign } from "@/libs/caravan";
import { withoutCaravanEscort } from "@/queries/activityReservation";
import { nextSnapshotSql } from "@/queries/concurrency";
import type { DrizzleClient } from "@/server/db";
import type { ActionReadinessWrite } from "@/server/utils/actionReadiness";

/** Commit an operator's readiness plan, waking a recoverable player before they act. */
export const claimOperatorReadiness = (
  client: Pick<DrizzleClient, "update">,
  userId: string,
  readiness: ActionReadinessWrite,
) =>
  client
    .update(userData)
    .set({ ...readiness.set, updatedAt: nextSnapshotSql(userData.updatedAt) })
    .where(and(eq(userData.userId, userId), readiness.where));

const OPEN_STATUSES = ["PREPARING", "TRAVELLING"] as const;
const OPEN_ENCOUNTER_STATUSES = ["PENDING", "STARTING", "FIGHTING"] as const;

/** Table aliases for the two village joins of a caravan. */
const originVillage = alias(village, "originVillage");
const destinationVillage = alias(village, "destinationVillage");

/** Caravans by id. */
export const listCaravansByIds = (
  client: Pick<DrizzleClient, "select">,
  caravanIds: string[],
) =>
  caravanIds.length === 0
    ? Promise.resolve([])
    : client.select().from(caravan).where(inArray(caravan.id, caravanIds));

/** Caravans by id with the names of the villages they travel between. */
export const listCaravansWithVillageNames = (
  client: Pick<DrizzleClient, "select">,
  caravanIds: string[],
) =>
  caravanIds.length === 0
    ? Promise.resolve([])
    : client
        .select({
          ...getTableColumns(caravan),
          originName: originVillage.name,
          destinationName: destinationVillage.name,
        })
        .from(caravan)
        .leftJoin(originVillage, eq(originVillage.id, caravan.originVillageId))
        .leftJoin(
          destinationVillage,
          eq(destinationVillage.id, caravan.destinationVillageId),
        )
        .where(inArray(caravan.id, caravanIds));

/** Caravans a village is sending or expecting. */
export const listOpenVillageCaravans = (
  client: Pick<DrizzleClient, "select">,
  villageId: string,
) =>
  client
    .select()
    .from(caravan)
    .where(
      and(
        or(
          eq(caravan.originVillageId, villageId),
          eq(caravan.destinationVillageId, villageId),
        ),
        inArray(caravan.status, OPEN_STATUSES),
      ),
    )
    .orderBy(desc(caravan.createdAt));

/**
 * The latest finished caravans a village sent or received. Each side walks its
 * (village, resolvedAt) index newest first and stops at the limit.
 */
export const listFinishedVillageCaravans = (
  client: Pick<DrizzleClient, "select">,
  villageId: string,
  limit: number,
) => {
  const side = (sent: boolean) =>
    client
      .select()
      .from(caravan)
      .where(
        and(
          eq(sent ? caravan.originVillageId : caravan.destinationVillageId, villageId),
          inArray(caravan.status, ["DELIVERED", "CANCELLED"]),
        ),
      )
      .orderBy(desc(caravan.resolvedAt))
      .limit(limit);
  return side(true)
    .unionAll(side(false))
    .orderBy(desc(caravan.resolvedAt))
    .limit(limit);
};

/** Caravans that are preparing or travelling, optionally on given routes. */
export const listOpenCaravans = (
  client: Pick<DrizzleClient, "select">,
  routeIds?: string[],
) =>
  routeIds && routeIds.length === 0
    ? Promise.resolve([])
    : client
        .select()
        .from(caravan)
        .where(
          and(
            inArray(caravan.status, OPEN_STATUSES),
            routeIds ? inArray(caravan.routeId, routeIds) : undefined,
          ),
        );

/**
 * Open caravans, optionally only some, on active routes where a village outside the route
 * holds a marker.
 */
export const listBlockedCaravans = (
  client: Pick<DrizzleClient, "select">,
  caravanIds?: string[],
) =>
  caravanIds && caravanIds.length === 0
    ? Promise.resolve([])
    : client
        .select()
        .from(caravan)
        .where(
          and(
            inArray(caravan.status, OPEN_STATUSES),
            caravanIds ? inArray(caravan.id, caravanIds) : undefined,
            inArray(
              caravan.routeId,
              client
                .select({ routeId: tradeRouteMarker.routeId })
                .from(tradeRouteMarker)
                .innerJoin(tradeRoute, eq(tradeRoute.id, tradeRouteMarker.routeId))
                .where(
                  and(
                    eq(tradeRoute.status, "ACTIVE"),
                    isNotNull(tradeRouteMarker.controllerVillageId),
                  ),
                ),
            ),
          ),
        );

/** Participants of caravans with the player details the escort and group lists show. */
export const listCaravanParticipants = (
  client: Pick<DrizzleClient, "select">,
  caravanIds: string[],
) =>
  caravanIds.length === 0
    ? Promise.resolve([])
    : client
        .select({
          caravanId: caravanParticipant.caravanId,
          userId: caravanParticipant.userId,
          role: caravanParticipant.role,
          activeUserId: caravanParticipant.activeUserId,
          groupLeaderId: caravanParticipant.groupLeaderId,
          objectives: caravanParticipant.objectives,
          lastCheckpoint: caravanParticipant.lastCheckpoint,
          rewardedAt: caravanParticipant.rewardedAt,
          username: userData.username,
          level: userData.level,
          status: userData.status,
          sector: userData.sector,
          villageId: userData.villageId,
          isBanned: userData.isBanned,
        })
        .from(caravanParticipant)
        .innerJoin(userData, eq(userData.userId, caravanParticipant.userId))
        .where(inArray(caravanParticipant.caravanId, caravanIds));

/** What decides the side operators take against caravans. */
export const listOperatorProfiles = (
  client: Pick<DrizzleClient, "select">,
  userIds: string[],
) =>
  userIds.length === 0
    ? Promise.resolve([])
    : client
        .select({
          userId: userData.userId,
          villageId: userData.villageId,
          isOutlaw: userData.isOutlaw,
          isBandit: userData.isBandit,
        })
        .from(userData)
        .where(inArray(userData.userId, userIds));

/** A player's current caravan reservation and any robbery loot left to claim. */
export const listUserParticipations = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
) =>
  client
    .select()
    .from(caravanParticipant)
    .where(
      and(
        eq(caravanParticipant.userId, userId),
        or(
          eq(caravanParticipant.activeUserId, userId),
          and(
            isNotNull(caravanParticipant.loot),
            isNull(caravanParticipant.lootClaimedAt),
          ),
        ),
      ),
    );

/**
 * Apply one of the `CARGO_MOVES` to cargo lines naming distinct items in one statement. A
 * row changes only while the reservation stays covered by its stock, so a line short of
 * stock changes nothing and callers compare changed rows with lines.
 */
export const moveCargo = (
  client: Pick<DrizzleClient, "update">,
  villageId: string,
  lines: CargoLine[],
  sign: CargoSign,
) => {
  if (lines.length === 0) return Promise.resolve({ rowsAffected: 0 });
  const units = cargoLineQuantity(lines);
  // Stock columns are unsigned, so the guard only adds: a reservation that shrinks must
  // cover the units, and quantity + sign.quantity × units >= reserved + sign.reserved × units
  // carries its net term on the side where it is positive.
  const net = sign.quantity - sign.reserved;
  const plusUnits = (column: AnyMySqlColumn, adds: boolean) =>
    adds ? sql`${column} + ${units}` : sql`${column}`;
  return client
    .update(warehouseStock)
    .set({
      quantity: sql`${warehouseStock.quantity} + ${sign.quantity} * ${units}`,
      reserved: sql`${warehouseStock.reserved} + ${sign.reserved} * ${units}`,
    })
    .where(
      and(
        eq(warehouseStock.villageId, villageId),
        inArray(
          warehouseStock.itemId,
          lines.map((line) => line.itemId),
        ),
        sign.reserved < 0 ? sql`${warehouseStock.reserved} >= ${units}` : undefined,
        sql`${plusUnits(warehouseStock.quantity, net > 0)} >= ${plusUnits(warehouseStock.reserved, net < 0)}`,
      ),
    );
};

/**
 * Move a caravan between lifecycle states if it is still the version that was read. With
 * `unfought`, the move also requires that no fight over the caravan is open.
 */
export const transitionCaravan = (
  client: Pick<DrizzleClient, "update">,
  current: { id: string; version: number; status: CaravanStatus },
  set: Partial<typeof caravan.$inferInsert>,
  options: { unfought?: boolean } = {},
) =>
  client
    .update(caravan)
    .set({ ...set, version: current.version + 1 })
    .where(
      and(
        eq(caravan.id, current.id),
        eq(caravan.version, current.version),
        eq(caravan.status, current.status),
        options.unfought
          ? sql`NOT EXISTS (SELECT 1 FROM ${caravanEncounter} WHERE ${caravanEncounter.activeCaravanId} = ${current.id})`
          : undefined,
      ),
    );

/**
 * Send a prepared caravan on its way with its cargo in one statement, as the `DISPATCH`
 * cargo move, for cargo lines naming distinct items. Each line joins its own stock row only
 * while that row covers the line's reservation, so a short line or a caravan changed since
 * it was read changes nothing; a departure changes the caravan and one row per line.
 */
export const dispatchCaravan = (
  client: Pick<DrizzleClient, "execute">,
  current: Pick<Caravan, "id" | "version" | "originVillageId" | "cargo">,
  schedule: { departedAt: Date; arrivesAt: Date },
) => {
  const lines = current.cargo.map((line, index) => ({
    ...line,
    stock: alias(warehouseStock, `line${index}`),
  }));
  return client.execute(sql`
    UPDATE ${caravan}
    ${sql.join(
      lines.map(
        ({ stock, itemId, quantity }) => sql`INNER JOIN ${warehouseStock} AS ${stock}
      ON ${stock.villageId} = ${current.originVillageId} AND ${stock.itemId} = ${itemId}
      AND ${stock.reserved} >= ${quantity} AND ${stock.quantity} >= ${stock.reserved}`,
      ),
      sql` `,
    )}
    SET ${caravan.status} = 'TRAVELLING', ${caravan.version} = ${current.version + 1},
        ${caravan.departedAt} = ${sql.param(schedule.departedAt, caravan.departedAt)},
        ${caravan.arrivesAt} = ${sql.param(schedule.arrivesAt, caravan.arrivesAt)}
        ${sql.join(
          lines.map(
            ({ stock, quantity }) =>
              sql`, ${stock.quantity} = ${stock.quantity} - ${quantity}, ${stock.reserved} = ${stock.reserved} - ${quantity}`,
          ),
          sql``,
        )}
    WHERE ${caravan.id} = ${current.id}
      AND ${caravan.version} = ${current.version}
      AND ${caravan.status} = 'PREPARING'
  `);
};

/**
 * Record that a travelling caravan's checkpoints were processed, only while it keeps the
 * schedule they were counted on: a delay landed meanwhile moves them, and a later run
 * counts them again.
 */
export const advanceCaravanCheckpoints = (
  client: Pick<DrizzleClient, "update">,
  current: Pick<Caravan, "id" | "checkpointsProcessed" | "arrivesAt">,
  to: number,
) =>
  client
    .update(caravan)
    .set({ checkpointsProcessed: to })
    .where(
      and(
        eq(caravan.id, current.id),
        eq(caravan.status, "TRAVELLING"),
        eq(caravan.checkpointsProcessed, current.checkpointsProcessed),
        current.arrivesAt
          ? eq(caravan.arrivesAt, current.arrivesAt)
          : isNull(caravan.arrivesAt),
      ),
    );

/**
 * Take the lowest free escort slot of a preparing caravan. The slot and active-user keys
 * reject a concurrent claim of the same seat or a second reservation of the same player.
 */
export const insertGuard = (
  client: Pick<DrizzleClient, "execute">,
  caravanId: string,
  userId: string,
  now: Date,
) =>
  client.execute(sql`
    INSERT INTO ${caravanParticipant} (caravanId, userId, role, activeUserId, guardSlot, joinedAt)
    SELECT ${caravanId}, ${userId}, 'GUARD', ${userId}, slots.slot, ${now}
    FROM (${sql.raw(
      Array.from(
        { length: CARAVAN_GUARD_SLOTS },
        (_, slot) => `SELECT ${slot} AS slot`,
      ).join(" UNION ALL "),
    )}) AS slots
    WHERE EXISTS (SELECT 1 FROM ${caravan} WHERE ${caravan.id} = ${caravanId} AND ${caravan.status} = 'PREPARING')
      AND NOT EXISTS (SELECT 1 FROM ${caravanParticipant} AS taken WHERE taken.caravanId = ${caravanId} AND taken.guardSlot = slots.slot)
    ORDER BY slots.slot
    LIMIT 1
  `);

/** Remove an escort who leaves before departure; they earned nothing yet. */
export const deleteGuard = (
  client: Pick<DrizzleClient, "delete">,
  caravanId: string,
  userId: string,
) =>
  client
    .delete(caravanParticipant)
    .where(
      and(
        eq(caravanParticipant.caravanId, caravanId),
        eq(caravanParticipant.userId, userId),
        eq(caravanParticipant.role, "GUARD"),
      ),
    );

/**
 * Join or rejoin the attacking side of a caravan still on the road; a player keeps the side
 * they first took. The insert reads the caravan row, so it waits for a delivery or
 * cancellation in progress and then finds the caravan off the road. Assignments run in order
 * and see earlier results, so the leader assignment tests a column the activeUserId
 * assignment leaves alone: a released row has no leader, an active one has.
 */
export const upsertAttacker = (
  client: Pick<DrizzleClient, "execute">,
  values: {
    caravanId: string;
    userId: string;
    role: CaravanRole;
    groupLeaderId: string;
    now: Date;
  },
) =>
  client.execute(sql`
    INSERT INTO ${caravanParticipant} (caravanId, userId, role, activeUserId, groupLeaderId, joinedAt)
    SELECT ${values.caravanId}, ${values.userId}, ${values.role}, ${values.userId}, ${values.groupLeaderId}, ${values.now}
    FROM ${caravan}
    WHERE ${caravan.id} = ${values.caravanId} AND ${caravan.status} = 'TRAVELLING'
    ON DUPLICATE KEY UPDATE
      ${caravanParticipant.activeUserId} = CASE WHEN ${caravanParticipant.role} = ${values.role} AND ${caravanParticipant.activeUserId} IS NULL THEN ${values.userId} ELSE ${caravanParticipant.activeUserId} END,
      ${caravanParticipant.groupLeaderId} = CASE WHEN ${caravanParticipant.role} = ${values.role} AND ${caravanParticipant.groupLeaderId} IS NULL THEN ${values.groupLeaderId} ELSE ${caravanParticipant.groupLeaderId} END
  `);

/** Release participants' reservations, optionally only some players or one group. */
export const releaseParticipants = (
  client: Pick<DrizzleClient, "update">,
  caravanId: string,
  filter: { userIds?: string[]; groupLeaderId?: string; roles?: CaravanRole[] } = {},
) =>
  client
    .update(caravanParticipant)
    .set({ activeUserId: null, groupLeaderId: null })
    .where(
      and(
        eq(caravanParticipant.caravanId, caravanId),
        isNotNull(caravanParticipant.activeUserId),
        filter.userIds ? inArray(caravanParticipant.userId, filter.userIds) : undefined,
        filter.groupLeaderId
          ? eq(caravanParticipant.groupLeaderId, filter.groupLeaderId)
          : undefined,
        filter.roles ? inArray(caravanParticipant.role, filter.roles) : undefined,
      ),
    );

/** Record an escort's check-in at the latest checkpoint the caravan passed. */
export const checkInGuard = (
  client: Pick<DrizzleClient, "update">,
  caravanId: string,
  userId: string,
  checkpoint: number,
) =>
  client
    .update(caravanParticipant)
    .set({
      lastCheckpoint: checkpoint,
      objectives: sql`${caravanParticipant.objectives} + 1`,
    })
    .where(
      and(
        eq(caravanParticipant.caravanId, caravanId),
        eq(caravanParticipant.userId, userId),
        eq(caravanParticipant.activeUserId, userId),
        eq(caravanParticipant.role, "GUARD"),
        lt(caravanParticipant.lastCheckpoint, checkpoint),
      ),
    );

/** Credit a completed defence to the escorts who fought it. */
export const creditGuardObjectives = (
  client: Pick<DrizzleClient, "update">,
  caravanId: string,
  userIds: string[],
) =>
  userIds.length === 0
    ? Promise.resolve()
    : client
        .update(caravanParticipant)
        .set({ objectives: sql`${caravanParticipant.objectives} + 1` })
        .where(
          and(
            eq(caravanParticipant.caravanId, caravanId),
            inArray(caravanParticipant.userId, userIds),
            eq(caravanParticipant.role, "GUARD"),
            isNotNull(caravanParticipant.activeUserId),
          ),
        );

/**
 * Give each robber their share of stolen goods, keeping loot from an earlier robbery that
 * is still unclaimed.
 */
export const awardLoot = (
  client: Pick<DrizzleClient, "update">,
  caravanId: string,
  loot: Map<string, CargoLine[]>,
) =>
  loot.size === 0
    ? Promise.resolve()
    : client
        .update(caravanParticipant)
        .set({
          loot: sql`CASE ${sql.join(
            [...loot].map(
              ([userId, lines]) =>
                sql`WHEN ${caravanParticipant.userId} = ${userId} THEN JSON_MERGE_PRESERVE(CASE WHEN ${caravanParticipant.lootClaimedAt} IS NULL THEN COALESCE(${caravanParticipant.loot}, JSON_ARRAY()) ELSE JSON_ARRAY() END, CAST(${JSON.stringify(lines)} AS JSON))`,
            ),
            sql` `,
          )} ELSE ${caravanParticipant.loot} END`,
          lootClaimedAt: null,
        })
        .where(
          and(
            eq(caravanParticipant.caravanId, caravanId),
            inArray(caravanParticipant.userId, [...loot.keys()]),
          ),
        );

/**
 * Claim a robber's loot once, only while it still holds what the caller read and is about
 * to deliver; loot a later robbery appended stays claimable.
 */
export const claimLoot = (
  client: Pick<DrizzleClient, "update">,
  caravanId: string,
  userId: string,
  loot: CargoLine[],
  now: Date,
) =>
  client
    .update(caravanParticipant)
    .set({ lootClaimedAt: now })
    .where(
      and(
        eq(caravanParticipant.caravanId, caravanId),
        eq(caravanParticipant.userId, userId),
        sql`${caravanParticipant.loot} = CAST(${JSON.stringify(loot)} AS JSON)`,
        isNull(caravanParticipant.lootClaimedAt),
      ),
    );

/** Mark escorts as paid for a delivery so a retried delivery never pays twice. */
export const markGuardsRewarded = (
  client: Pick<DrizzleClient, "update">,
  caravanId: string,
  now: Date,
) =>
  client
    .update(caravanParticipant)
    .set({ rewardedAt: now, activeUserId: null })
    .where(
      and(
        eq(caravanParticipant.caravanId, caravanId),
        eq(caravanParticipant.role, "GUARD"),
        isNull(caravanParticipant.rewardedAt),
      ),
    );

/** Add ryo, bandit experience or both to players. */
export const grantCaravanRewards = (
  client: Pick<DrizzleClient, "update">,
  rewards: { userId: string; money?: number; banditExperience?: number }[],
) => {
  const paid = rewards.filter(
    (row) => (row.money ?? 0) > 0 || (row.banditExperience ?? 0) > 0,
  );
  if (paid.length === 0) return Promise.resolve();
  const caseOf = (pick: (row: (typeof paid)[number]) => number) =>
    sql.join(
      paid.map((row) => sql`WHEN ${userData.userId} = ${row.userId} THEN ${pick(row)}`),
      sql` `,
    );
  return client
    .update(userData)
    .set({
      money: sql`${userData.money} + CASE ${caseOf((row) => row.money ?? 0)} ELSE 0 END`,
      banditExperience: sql`${userData.banditExperience} + CASE ${caseOf((row) => row.banditExperience ?? 0)} ELSE 0 END`,
    })
    .where(
      inArray(
        userData.userId,
        paid.map((row) => row.userId),
      ),
    );
};

/** Wake released escorts still waiting in their caravan's queue. */
export const wakeReleasedGuards = (
  client: Pick<DrizzleClient, "update">,
  userIds: string[],
) =>
  userIds.length === 0
    ? Promise.resolve()
    : client
        .update(userData)
        .set({ status: "AWAKE" })
        .where(
          and(
            inArray(userData.userId, userIds),
            eq(userData.status, "QUEUED"),
            withoutCaravanEscort(),
          ),
        );

/**
 * Put an awake escort into their caravan's queue. A readiness plan first wakes a
 * recoverable player in the same write.
 */
export const queueGuard = (
  client: Pick<DrizzleClient, "update">,
  caravanId: string,
  userId: string,
  readiness?: ActionReadinessWrite,
) =>
  client
    .update(userData)
    .set({ ...readiness?.set, status: "QUEUED" })
    .where(
      and(
        eq(userData.userId, userId),
        readiness?.where ?? eq(userData.status, "AWAKE"),
        isNull(userData.battleId),
        sql`EXISTS (SELECT 1 FROM ${caravanParticipant} WHERE ${caravanParticipant.caravanId} = ${caravanId} AND ${caravanParticipant.activeUserId} = ${userId} AND ${caravanParticipant.role} = 'GUARD')`,
      ),
    );

/** Open encounters of caravans. */
export const listOpenEncounters = (
  client: Pick<DrizzleClient, "select">,
  caravanIds: string[],
) =>
  caravanIds.length === 0
    ? Promise.resolve([])
    : client
        .select()
        .from(caravanEncounter)
        .where(
          and(
            inArray(caravanEncounter.status, OPEN_ENCOUNTER_STATUSES),
            inArray(caravanEncounter.caravanId, caravanIds),
          ),
        );

/**
 * Unanswered ambushes past their deadline and fights whose battle never settled, optionally
 * only those over some caravans.
 */
export const listDueEncounters = (
  client: Pick<DrizzleClient, "select">,
  now: Date,
  staleBefore: Date,
  caravanIds?: string[],
) =>
  caravanIds && caravanIds.length === 0
    ? Promise.resolve([])
    : client
        .select()
        .from(caravanEncounter)
        .where(
          and(
            caravanIds ? inArray(caravanEncounter.caravanId, caravanIds) : undefined,
            or(
              and(
                eq(caravanEncounter.status, "PENDING"),
                eq(caravanEncounter.type, "AMBUSH"),
                lte(caravanEncounter.expiresAt, now),
              ),
              and(
                inArray(caravanEncounter.status, ["STARTING", "FIGHTING"]),
                lt(caravanEncounter.createdAt, staleBefore),
              ),
            ),
          ),
        );

/** Reserve a new fight's encounter; the active keys allow one per caravan and per marker. */
export const insertEncounter = (
  client: Pick<DrizzleClient, "insert">,
  values: {
    id: string;
    type: CaravanEncounterType;
    caravanId: string | null;
    markerId: string | null;
    battleId: string;
    leaderId?: string;
    now: Date;
  },
) =>
  client.insert(caravanEncounter).values({
    id: values.id,
    type: values.type,
    status: "STARTING",
    caravanId: values.caravanId,
    activeCaravanId: values.caravanId,
    activeMarkerId: values.markerId,
    battleId: values.battleId,
    leaderId: values.leaderId ?? null,
    createdAt: values.now,
  });

/**
 * Open an NPC ambush on a caravan that is still on the road. The insert reads the caravan
 * row, so it waits for a delivery in progress and then finds the caravan delivered.
 */
export const insertCheckpointAmbush = (
  client: Pick<DrizzleClient, "execute">,
  values: { id: string; caravanId: string; expiresAt: Date; now: Date },
) =>
  client.execute(sql`
    INSERT INTO ${caravanEncounter} (id, type, status, caravanId, activeCaravanId, expiresAt, createdAt)
    SELECT ${values.id}, 'AMBUSH', 'PENDING', ${values.caravanId}, ${values.caravanId}, ${values.expiresAt}, ${values.now}
    FROM ${caravan}
    WHERE ${caravan.id} = ${values.caravanId}
      AND ${caravan.status} = 'TRAVELLING'
      AND ${caravan.arrivesAt} > ${values.now}
  `);

/** Reserve a pending ambush for the battle about to start. */
export const claimPendingEncounter = (
  client: Pick<DrizzleClient, "update">,
  encounterId: string,
  battleId: string,
  now: Date,
) =>
  client
    .update(caravanEncounter)
    .set({ status: "STARTING", battleId, createdAt: now })
    .where(
      and(
        eq(caravanEncounter.id, encounterId),
        eq(caravanEncounter.status, "PENDING"),
        gt(caravanEncounter.expiresAt, now),
      ),
    );

/** The battle started; settlement now owns the encounter. */
export const markEncounterFighting = (
  client: Pick<DrizzleClient, "update">,
  encounterId: string,
  battleId: string,
) =>
  client
    .update(caravanEncounter)
    .set({ status: "FIGHTING" })
    .where(
      and(
        eq(caravanEncounter.id, encounterId),
        eq(caravanEncounter.battleId, battleId),
        eq(caravanEncounter.status, "STARTING"),
      ),
    );

/** Return an ambush whose battle could not start to its pending state. */
export const reopenEncounter = (
  client: Pick<DrizzleClient, "update">,
  encounterId: string,
  battleId: string,
) =>
  client
    .update(caravanEncounter)
    .set({ status: "PENDING", battleId: null })
    .where(
      and(
        eq(caravanEncounter.id, encounterId),
        eq(caravanEncounter.battleId, battleId),
        eq(caravanEncounter.status, "STARTING"),
      ),
    );

/** Drop an encounter whose battle could not start. */
export const deleteStartingEncounter = (
  client: Pick<DrizzleClient, "delete">,
  encounterId: string,
  battleId: string,
) =>
  client
    .delete(caravanEncounter)
    .where(
      and(
        eq(caravanEncounter.id, encounterId),
        eq(caravanEncounter.battleId, battleId),
        eq(caravanEncounter.status, "STARTING"),
      ),
    );

/**
 * Close a fought encounter; only the first claim of its battle settles it. A battle whose
 * launch could not promote its encounter to FIGHTING still settles it from STARTING.
 */
export const resolveFoughtEncounter = (
  client: Pick<DrizzleClient, "update">,
  encounterId: string,
  battleId: string,
  now: Date,
) =>
  client
    .update(caravanEncounter)
    .set({
      status: "RESOLVED",
      resolvedAt: now,
      activeCaravanId: null,
      activeMarkerId: null,
    })
    .where(
      and(
        eq(caravanEncounter.id, encounterId),
        eq(caravanEncounter.battleId, battleId),
        inArray(caravanEncounter.status, ["STARTING", "FIGHTING"]),
      ),
    );

/**
 * Resolve an ambush left unanswered or abandoned in one statement with the capped share of
 * the manifest the bandits take, so no delivery lands between the two. A caravan that
 * already left the road keeps its loss.
 */
export const chargeAmbushLoss = (
  client: Pick<DrizzleClient, "execute">,
  encounter: EncounterSnapshot,
  lossBp: number,
  now: Date,
) =>
  client.execute(sql`
    UPDATE ${caravanEncounter}
    INNER JOIN ${caravan} ON ${caravan.id} = ${caravanEncounter.caravanId}
    SET ${caravanEncounter.status} = 'RESOLVED', ${caravanEncounter.resolvedAt} = ${now},
        ${caravanEncounter.activeCaravanId} = NULL,
        ${caravan.lossBp} = IF(${caravan.status} = 'TRAVELLING', LEAST(${CARAVAN_MAX_LOSS_BP}, ${caravan.lossBp} + ${lossBp}), ${caravan.lossBp}),
        ${caravan.version} = ${caravan.version} + 1
    WHERE ${caravanEncounter.id} = ${encounter.id}
      AND ${caravanEncounter.status} = ${encounter.status}
      AND ${caravanEncounter.battleId} <=> ${encounter.battleId}
  `);

/** Release an encounter whose battle vanished without settling; nothing changes hands. */
export const releaseStaleEncounter = (
  client: Pick<DrizzleClient, "update">,
  encounter: EncounterSnapshot,
  now: Date,
) =>
  client
    .update(caravanEncounter)
    .set({
      status: "RESOLVED",
      resolvedAt: now,
      activeCaravanId: null,
      activeMarkerId: null,
    })
    .where(
      and(
        eq(caravanEncounter.id, encounter.id),
        eq(caravanEncounter.status, encounter.status),
        sql`${caravanEncounter.battleId} <=> ${encounter.battleId}`,
      ),
    );

/** Add a capped share of losses to a caravan whose loss was read for this fight. */
export const applyCaravanLoss = (
  client: Pick<DrizzleClient, "update">,
  caravanId: string,
  lossBp: number,
) =>
  client
    .update(caravan)
    .set({
      lossBp: sql`LEAST(${CARAVAN_MAX_LOSS_BP}, ${caravan.lossBp} + ${lossBp})`,
      version: sql`${caravan.version} + 1`,
    })
    .where(and(eq(caravan.id, caravanId), eq(caravan.status, "TRAVELLING")));

/** Discoveries a player still holds. */
export const listUserDiscoveries = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
  now: Date,
) =>
  client
    .select()
    .from(caravanDiscovery)
    .where(
      and(eq(caravanDiscovery.userId, userId), gt(caravanDiscovery.expiresAt, now)),
    );

/** Record or refresh what a player learned about caravans; an older sighting keeps a newer one. */
export const upsertDiscoveries = (
  client: Pick<DrizzleClient, "insert">,
  rows: {
    caravanId: string;
    userId: string;
    kind: CaravanDiscoveryKind;
    sector: number | null;
    seenAt: Date;
    expiresAt: Date;
  }[],
) =>
  rows.length === 0
    ? Promise.resolve()
    : client
        .insert(caravanDiscovery)
        .values(rows)
        .onDuplicateKeyUpdate({
          set: {
            // Assignments run in column order and see earlier results: sector compares the
            // stored seenAt, and expiresAt follows only when seenAt became the incoming value.
            sector: sql`IF(VALUES(${caravanDiscovery.seenAt}) > ${caravanDiscovery.seenAt}, VALUES(${caravanDiscovery.sector}), ${caravanDiscovery.sector})`,
            seenAt: sql`GREATEST(${caravanDiscovery.seenAt}, VALUES(${caravanDiscovery.seenAt}))`,
            expiresAt: sql`IF(${caravanDiscovery.seenAt} = VALUES(${caravanDiscovery.seenAt}), VALUES(${caravanDiscovery.expiresAt}), ${caravanDiscovery.expiresAt})`,
          },
        });

/** Refresh a sighting if its last refresh is older than the tracking cooldown. */
export const trackDiscovery = (
  client: Pick<DrizzleClient, "update">,
  input: {
    caravanId: string;
    userId: string;
    sector: number;
    now: Date;
    seenBefore: Date;
    expiresAt: Date;
  },
) =>
  client
    .update(caravanDiscovery)
    .set({ sector: input.sector, seenAt: input.now, expiresAt: input.expiresAt })
    .where(
      and(
        eq(caravanDiscovery.caravanId, input.caravanId),
        eq(caravanDiscovery.userId, input.userId),
        eq(caravanDiscovery.kind, "LOCATION"),
        lte(caravanDiscovery.seenAt, input.seenBefore),
        gt(caravanDiscovery.expiresAt, input.now),
      ),
    );

/** Start a covert operation; the active key allows one per player. */
export const insertOperation = (
  client: Pick<DrizzleClient, "insert">,
  values: {
    id: string;
    userId: string;
    role: CaravanRole;
    type: CaravanOperationType;
    caravanId: string | null;
    sector: number;
    succeeds: boolean;
    startedAt: Date;
    finishesAt: Date;
  },
) =>
  client
    .insert(caravanOperation)
    .values({ ...values, activeUserId: values.userId, status: "ACTIVE" });

/** A player's latest operations, newest first. */
export const listUserOperations = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
  limit: number,
) =>
  client
    .select()
    .from(caravanOperation)
    .where(eq(caravanOperation.userId, userId))
    .orderBy(desc(caravanOperation.startedAt))
    .limit(limit);

/** Sabotage against caravans still under way, which escorts may interrupt. */
export const listActiveSabotage = (
  client: Pick<DrizzleClient, "select">,
  caravanIds: string[],
  now: Date,
) =>
  caravanIds.length === 0
    ? Promise.resolve([])
    : client
        .select({
          id: caravanOperation.id,
          caravanId: caravanOperation.caravanId,
          type: caravanOperation.type,
          userId: caravanOperation.userId,
          finishesAt: caravanOperation.finishesAt,
          username: userData.username,
          userStatus: userData.status,
        })
        .from(caravanOperation)
        .innerJoin(userData, eq(userData.userId, caravanOperation.userId))
        .where(
          and(
            inArray(caravanOperation.caravanId, caravanIds),
            eq(caravanOperation.status, "ACTIVE"),
            inArray(caravanOperation.type, ["DISRUPT", "DELAY"]),
            gt(caravanOperation.finishesAt, now),
          ),
        );

/** Operations whose time is up, optionally only a player's or those against some caravans. */
export const listDueOperations = (
  client: Pick<DrizzleClient, "select">,
  now: Date,
  filter: { userId?: string; caravanIds?: string[] } = {},
) =>
  client
    .select()
    .from(caravanOperation)
    .where(
      and(
        eq(caravanOperation.status, "ACTIVE"),
        lte(caravanOperation.finishesAt, now),
        filter.userId ? eq(caravanOperation.userId, filter.userId) : undefined,
        filter.caravanIds
          ? inArray(caravanOperation.caravanId, filter.caravanIds)
          : undefined,
      ),
    );

/** Finish an operation once and free the player; an interruption needs it still under way. */
export const resolveOperation = (
  client: Pick<DrizzleClient, "update">,
  operationId: string,
  status: "RESOLVED" | "INTERRUPTED",
  now: Date,
) =>
  client
    .update(caravanOperation)
    .set({ status, resolvedAt: now, activeUserId: null })
    .where(
      and(
        eq(caravanOperation.id, operationId),
        eq(caravanOperation.status, "ACTIVE"),
        status === "INTERRUPTED" ? gt(caravanOperation.finishesAt, now) : undefined,
      ),
    );

/**
 * Finish a successful sabotage together with its effect on the caravan, so neither applies
 * twice. The added delay was capped against the delay read with the caravan, which the
 * statement still requires; disruption weakens its next fights for a while. Sabotage that
 * finished only once the caravan was due takes no effect.
 */
export const resolveSabotage = (
  client: Pick<DrizzleClient, "execute">,
  input: {
    operationId: string;
    caravanId: string;
    finishesAt: Date;
    now: Date;
    expectedDelayMinutes: number;
    addedMinutes: number;
    disruptedUntil: Date | null;
  },
) =>
  client.execute(sql`
    UPDATE ${caravanOperation}
    INNER JOIN ${caravan} ON ${caravan.id} = ${input.caravanId}
    SET ${caravanOperation.status} = 'RESOLVED', ${caravanOperation.resolvedAt} = ${input.now},
        ${caravanOperation.activeUserId} = NULL,
        ${caravan.arrivesAt} = DATE_ADD(${caravan.arrivesAt}, INTERVAL ${input.addedMinutes} MINUTE),
        ${caravan.delayMinutes} = ${input.expectedDelayMinutes + input.addedMinutes},
        ${caravan.version} = ${caravan.version} + 1
        ${input.disruptedUntil ? sql`, ${caravan.disruptedUntil} = ${input.disruptedUntil}` : sql``}
    WHERE ${caravanOperation.id} = ${input.operationId}
      AND ${caravanOperation.status} = 'ACTIVE'
      AND ${caravan.status} = 'TRAVELLING'
      AND ${caravan.arrivesAt} > ${input.finishesAt}
      AND ${caravan.delayMinutes} = ${input.expectedDelayMinutes}
  `);

/** Every travelling caravan. */
export const listTravellingCaravans = (client: Pick<DrizzleClient, "select">) =>
  client.select().from(caravan).where(eq(caravan.status, "TRAVELLING"));

/** Caravans whose arrival time has passed. */
export const listArrivedCaravans = (client: Pick<DrizzleClient, "select">, now: Date) =>
  client
    .select()
    .from(caravan)
    .where(and(eq(caravan.status, "TRAVELLING"), lte(caravan.arrivesAt, now)));

/**
 * Battles still being played, to tell running fights from ones that vanished or that
 * nobody has touched since `activeSince`.
 */
export const listLiveBattleIds = (
  client: Pick<DrizzleClient, "select">,
  battleIds: string[],
  activeSince: Date,
) =>
  battleIds.length === 0
    ? Promise.resolve([])
    : client
        .select({ id: battle.id })
        .from(battle)
        .where(and(inArray(battle.id, battleIds), gte(battle.updatedAt, activeSince)));

/** AI templates marked as Caravan AI, with their levels for matching opponents. */
export const listCaravanAi = (client: Pick<DrizzleClient, "select">) =>
  client
    .select({ userId: userData.userId, level: userData.level })
    .from(userData)
    .where(
      and(
        eq(userData.isAi, true),
        eq(userData.isCaravanAi, true),
        eq(userData.isSummon, false),
      ),
    );

/**
 * Prepare a caravan only while its village sends fewer caravans than its routes allow, so
 * concurrent preparations cannot exceed the capacity.
 */
export const insertCaravanWithinCapacity = (
  client: Pick<DrizzleClient, "execute">,
  values: {
    id: string;
    routeId: string;
    originVillageId: string;
    destinationVillageId: string;
    cargo: CargoLine[];
    path: number[];
    now: Date;
  },
  capacity: number,
) =>
  client.execute(sql`
    INSERT INTO ${caravan} (id, routeId, originVillageId, destinationVillageId, status, cargo, path, createdAt)
    SELECT ${values.id}, ${values.routeId}, ${values.originVillageId}, ${values.destinationVillageId}, 'PREPARING',
           CAST(${JSON.stringify(values.cargo)} AS JSON), CAST(${JSON.stringify(values.path)} AS JSON), ${values.now}
    FROM DUAL
    WHERE (SELECT COUNT(*) FROM ${caravan} AS sent WHERE sent.originVillageId = ${values.originVillageId} AND sent.status IN ('PREPARING', 'TRAVELLING')) < ${capacity}
  `);

/**
 * Moves of a renamed character's caravan sides, reservations, operations and the
 * interceptions they lead to the new id.
 */
export const renameCaravanUser = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) => {
  const moveActive = (column: AnyMySqlColumn) =>
    sql`CASE WHEN ${column} IS NULL THEN NULL ELSE ${input.newUserId} END`;
  return [
    client
      .update(caravanParticipant)
      .set({
        userId: input.newUserId,
        activeUserId: moveActive(caravanParticipant.activeUserId),
      })
      .where(eq(caravanParticipant.userId, input.userId)),
    client
      .update(caravanParticipant)
      .set({ groupLeaderId: input.newUserId })
      .where(eq(caravanParticipant.groupLeaderId, input.userId)),
    client
      .update(caravanOperation)
      .set({
        userId: input.newUserId,
        activeUserId: moveActive(caravanOperation.activeUserId),
      })
      .where(eq(caravanOperation.userId, input.userId)),
    client
      .update(caravanEncounter)
      .set({ leaderId: input.newUserId })
      .where(eq(caravanEncounter.leaderId, input.userId)),
  ];
};

/** A CASE yielding each cargo line's quantity for its item's stock row. */
const cargoLineQuantity = (lines: CargoLine[]) =>
  sql`CASE ${sql.join(
    lines.map(
      (line) =>
        sql`WHEN ${warehouseStock.itemId} = ${line.itemId} THEN ${line.quantity}`,
    ),
    sql` `,
  )} ELSE 0 END`;

/** An encounter as read, which a release must still find: the same status and battle. */
type EncounterSnapshot = Pick<CaravanEncounter, "id" | "status" | "battleId">;
