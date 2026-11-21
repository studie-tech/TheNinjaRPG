/**
 * Database access for caravans, their participants, encounters and covert operations.
 * Authorization and transaction scopes stay in callers.
 */
import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
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
  caravan,
  caravanDiscovery,
  caravanEncounter,
  caravanOperation,
  caravanParticipant,
  userData,
  warehouseStock,
} from "@/drizzle/schema";
import type { CargoLine } from "@/libs/caravan";
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

/** One caravan. */
export const findCaravan = (client: Pick<DrizzleClient, "query">, caravanId: string) =>
  client.query.caravan.findFirst({ where: eq(caravan.id, caravanId) });

/** Caravans by id. */
export const listCaravansByIds = (
  client: Pick<DrizzleClient, "select">,
  caravanIds: string[],
) =>
  caravanIds.length === 0
    ? Promise.resolve([])
    : client.select().from(caravan).where(inArray(caravan.id, caravanIds));

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

/** The latest finished caravans a village sent or received. */
export const listFinishedVillageCaravans = (
  client: Pick<DrizzleClient, "select">,
  villageId: string,
  limit: number,
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
        inArray(caravan.status, ["DELIVERED", "CANCELLED"]),
      ),
    )
    .orderBy(desc(caravan.resolvedAt))
    .limit(limit);

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

/** Open caravans a village sends, which count against its capacity. */
export const countOutgoingCaravans = (
  client: Pick<DrizzleClient, "select">,
  villageId: string,
) =>
  client
    .select({ count: sql<number>`COUNT(*)`.mapWith(Number) })
    .from(caravan)
    .where(
      and(
        eq(caravan.originVillageId, villageId),
        inArray(caravan.status, OPEN_STATUSES),
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
          guardSlot: caravanParticipant.guardSlot,
          groupLeaderId: caravanParticipant.groupLeaderId,
          objectives: caravanParticipant.objectives,
          lastCheckpoint: caravanParticipant.lastCheckpoint,
          loot: caravanParticipant.loot,
          lootClaimedAt: caravanParticipant.lootClaimedAt,
          rewardedAt: caravanParticipant.rewardedAt,
          username: userData.username,
          avatar: userData.avatar,
          level: userData.level,
          status: userData.status,
          sector: userData.sector,
          villageId: userData.villageId,
          isBanned: userData.isBanned,
        })
        .from(caravanParticipant)
        .innerJoin(userData, eq(userData.userId, caravanParticipant.userId))
        .where(inArray(caravanParticipant.caravanId, caravanIds));

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

/** Reserve units of one cargo line from unreserved stock. */
export const reserveCargo = (
  client: Pick<DrizzleClient, "update">,
  villageId: string,
  line: CargoLine,
) =>
  client
    .update(warehouseStock)
    .set({ reserved: sql`${warehouseStock.reserved} + ${line.quantity}` })
    .where(
      and(
        eq(warehouseStock.villageId, villageId),
        eq(warehouseStock.itemId, line.itemId),
        sql`${warehouseStock.quantity} >= ${warehouseStock.reserved} + ${line.quantity}`,
      ),
    );

/** Release a cargo line's reservation. */
export const releaseCargo = (
  client: Pick<DrizzleClient, "update">,
  villageId: string,
  line: CargoLine,
) =>
  client
    .update(warehouseStock)
    .set({ reserved: sql`${warehouseStock.reserved} - ${line.quantity}` })
    .where(
      and(
        eq(warehouseStock.villageId, villageId),
        eq(warehouseStock.itemId, line.itemId),
        sql`${warehouseStock.reserved} >= ${line.quantity}`,
      ),
    );

/** Load a reserved cargo line onto a departing caravan. */
export const dispatchCargo = (
  client: Pick<DrizzleClient, "update">,
  villageId: string,
  line: CargoLine,
) =>
  client
    .update(warehouseStock)
    .set({
      quantity: sql`${warehouseStock.quantity} - ${line.quantity}`,
      reserved: sql`${warehouseStock.reserved} - ${line.quantity}`,
    })
    .where(
      and(
        eq(warehouseStock.villageId, villageId),
        eq(warehouseStock.itemId, line.itemId),
        sql`${warehouseStock.reserved} >= ${line.quantity}`,
        sql`${warehouseStock.quantity} >= ${line.quantity}`,
      ),
    );

/** Create a prepared caravan. */
export const insertCaravan = (
  client: Pick<DrizzleClient, "insert">,
  values: typeof caravan.$inferInsert,
) => client.insert(caravan).values(values);

/** Move a caravan between lifecycle states if it is still the version that was read. */
export const transitionCaravan = (
  client: Pick<DrizzleClient, "update">,
  current: { id: string; version: number; status: CaravanStatus },
  set: Partial<typeof caravan.$inferInsert>,
) =>
  client
    .update(caravan)
    .set({ ...set, version: current.version + 1 })
    .where(
      and(
        eq(caravan.id, current.id),
        eq(caravan.version, current.version),
        eq(caravan.status, current.status),
      ),
    );

/** Record that a travelling caravan's checkpoints were processed. */
export const advanceCaravanCheckpoints = (
  client: Pick<DrizzleClient, "update">,
  caravanId: string,
  from: number,
  to: number,
) =>
  client
    .update(caravan)
    .set({ checkpointsProcessed: to })
    .where(
      and(
        eq(caravan.id, caravanId),
        eq(caravan.status, "TRAVELLING"),
        eq(caravan.checkpointsProcessed, from),
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

/** Join or rejoin a journey's attacking side; a player keeps the side they first took. */
export const upsertAttacker = (
  client: Pick<DrizzleClient, "insert">,
  values: {
    caravanId: string;
    userId: string;
    role: CaravanRole;
    groupLeaderId: string;
    now: Date;
  },
) =>
  client
    .insert(caravanParticipant)
    .values({
      caravanId: values.caravanId,
      userId: values.userId,
      role: values.role,
      activeUserId: values.userId,
      groupLeaderId: values.groupLeaderId,
      joinedAt: values.now,
    })
    .onDuplicateKeyUpdate({
      set: {
        activeUserId: sql`CASE WHEN ${caravanParticipant.role} = ${values.role} AND ${caravanParticipant.activeUserId} IS NULL THEN ${values.userId} ELSE ${caravanParticipant.activeUserId} END`,
        // Assignments run in column order and see earlier results, so this tests a column the
        // activeUserId assignment leaves alone: a released row has no leader, an active one has.
        groupLeaderId: sql`CASE WHEN ${caravanParticipant.role} = ${values.role} AND ${caravanParticipant.groupLeaderId} IS NULL THEN ${values.groupLeaderId} ELSE ${caravanParticipant.groupLeaderId} END`,
      },
    });

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

/** Give each robber their share of stolen goods and end the group's reservation. */
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
          // Unclaimed loot from an earlier robbery of the same caravan is kept.
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
 * Claim a robber's loot once, only while it still holds what the caller read and delivers
 * in the same transaction; loot a later robbery appended stays claimable.
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
            sql`NOT EXISTS (SELECT 1 FROM ${caravanParticipant} WHERE ${caravanParticipant.activeUserId} = ${userData.userId})`,
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
  filter: { caravanIds?: string[]; markerIds?: string[] },
) => {
  const scopes: SQL[] = [];
  if (filter.caravanIds?.length)
    scopes.push(inArray(caravanEncounter.caravanId, filter.caravanIds));
  if (filter.markerIds?.length)
    scopes.push(inArray(caravanEncounter.markerId, filter.markerIds));
  return scopes.length === 0
    ? Promise.resolve([])
    : client
        .select()
        .from(caravanEncounter)
        .where(
          and(inArray(caravanEncounter.status, OPEN_ENCOUNTER_STATUSES), or(...scopes)),
        );
};

/** Unanswered ambushes past their deadline and fights whose battle never settled. */
export const listDueEncounters = (
  client: Pick<DrizzleClient, "select">,
  now: Date,
  staleBefore: Date,
) =>
  client
    .select()
    .from(caravanEncounter)
    .where(
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
    );

/** Open an encounter; the active keys allow one per caravan and per marker. */
export const insertEncounter = (
  client: Pick<DrizzleClient, "insert">,
  values: {
    id: string;
    type: CaravanEncounterType;
    status: "PENDING" | "STARTING";
    caravanId?: string | null;
    markerId?: string | null;
    operationId?: string | null;
    battleId?: string | null;
    attackerVillageId?: string | null;
    leaderId?: string | null;
    expiresAt?: Date | null;
    now: Date;
  },
) =>
  client.insert(caravanEncounter).values({
    id: values.id,
    type: values.type,
    status: values.status,
    caravanId: values.caravanId ?? null,
    markerId: values.markerId ?? null,
    activeCaravanId: values.caravanId ?? null,
    activeMarkerId: values.markerId ?? null,
    operationId: values.operationId ?? null,
    battleId: values.battleId ?? null,
    attackerVillageId: values.attackerVillageId ?? null,
    leaderId: values.leaderId ?? null,
    expiresAt: values.expiresAt ?? null,
    createdAt: values.now,
  });

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

/** Close a fought encounter; only the first claim of its battle settles it. */
export const resolveFoughtEncounter = (
  client: Pick<DrizzleClient, "update">,
  encounterId: string,
  battleId: string,
  attackersWon: boolean,
  now: Date,
) =>
  client
    .update(caravanEncounter)
    .set({
      status: "RESOLVED",
      attackersWon,
      resolvedAt: now,
      activeCaravanId: null,
      activeMarkerId: null,
    })
    .where(
      and(
        eq(caravanEncounter.id, encounterId),
        eq(caravanEncounter.battleId, battleId),
        eq(caravanEncounter.status, "FIGHTING"),
      ),
    );

/**
 * Resolve an unanswered ambush against its caravan in one statement: the bandits take a
 * capped share of the manifest.
 */
export const expireAmbush = (
  client: Pick<DrizzleClient, "execute">,
  encounterId: string,
  lossBp: number,
  now: Date,
) =>
  client.execute(sql`
    UPDATE ${caravanEncounter}
    INNER JOIN ${caravan} ON ${caravan.id} = ${caravanEncounter.caravanId}
    SET ${caravanEncounter.status} = 'RESOLVED', ${caravanEncounter.attackersWon} = TRUE,
        ${caravanEncounter.resolvedAt} = ${now}, ${caravanEncounter.activeCaravanId} = NULL,
        ${caravan.lossBp} = LEAST(${CARAVAN_MAX_LOSS_BP}, ${caravan.lossBp} + ${lossBp}),
        ${caravan.version} = ${caravan.version} + 1
    WHERE ${caravanEncounter.id} = ${encounterId}
      AND ${caravanEncounter.status} = 'PENDING'
      AND ${caravanEncounter.expiresAt} <= ${now}
  `);

/** Release an encounter whose battle vanished without settling; nothing changes hands. */
export const releaseStaleEncounter = (
  client: Pick<DrizzleClient, "update">,
  encounter: { id: string; status: "STARTING" | "FIGHTING" | "PENDING" | "RESOLVED" },
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

/** Record or refresh what a player learned about caravans. */
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
            sector: sql`VALUES(${caravanDiscovery.sector})`,
            seenAt: sql`VALUES(${caravanDiscovery.seenAt})`,
            expiresAt: sql`VALUES(${caravanDiscovery.expiresAt})`,
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

/** Running sabotage against caravans, which escorts may interrupt. */
export const listActiveSabotage = (
  client: Pick<DrizzleClient, "select">,
  caravanIds: string[],
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
        })
        .from(caravanOperation)
        .innerJoin(userData, eq(userData.userId, caravanOperation.userId))
        .where(
          and(
            inArray(caravanOperation.caravanId, caravanIds),
            eq(caravanOperation.status, "ACTIVE"),
            inArray(caravanOperation.type, ["DISRUPT", "DELAY"]),
          ),
        );

/** Operations whose time is up. */
export const listDueOperations = (
  client: Pick<DrizzleClient, "select">,
  now: Date,
  userId?: string,
) =>
  client
    .select()
    .from(caravanOperation)
    .where(
      and(
        eq(caravanOperation.status, "ACTIVE"),
        lte(caravanOperation.finishesAt, now),
        userId ? eq(caravanOperation.userId, userId) : undefined,
      ),
    );

/** Finish an operation once and free the player for another. */
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
      and(eq(caravanOperation.id, operationId), eq(caravanOperation.status, "ACTIVE")),
    );

/**
 * Finish a successful sabotage together with its effect on the caravan, so neither applies
 * twice. The added delay was capped against the delay read with the caravan, which the
 * statement still requires; disruption weakens its next fights for a while.
 */
export const resolveSabotage = (
  client: Pick<DrizzleClient, "execute">,
  input: {
    operationId: string;
    caravanId: string;
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
      AND ${caravan.delayMinutes} = ${input.expectedDelayMinutes}
  `);

/** Travelling caravans currently passing a sector, by their frozen path and schedule. */
export const listTravellingCaravans = (client: Pick<DrizzleClient, "select">) =>
  client.select().from(caravan).where(eq(caravan.status, "TRAVELLING"));

/** Caravans whose arrival time has passed. */
export const listArrivedCaravans = (client: Pick<DrizzleClient, "select">, now: Date) =>
  client
    .select()
    .from(caravan)
    .where(and(eq(caravan.status, "TRAVELLING"), lte(caravan.arrivesAt, now)));

/** Battles that still exist, to tell running fights from ones that vanished. */
export const listExistingBattleIds = (
  client: Pick<DrizzleClient, "select">,
  battleIds: string[],
) =>
  battleIds.length === 0
    ? Promise.resolve([])
    : client
        .select({ id: battle.id })
        .from(battle)
        .where(inArray(battle.id, battleIds));

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
    travelMinutes: number;
    createdById: string;
    now: Date;
  },
  capacity: number,
) =>
  client.execute(sql`
    INSERT INTO ${caravan} (id, routeId, originVillageId, destinationVillageId, status, cargo, path, travelMinutes, createdById, createdAt)
    SELECT ${values.id}, ${values.routeId}, ${values.originVillageId}, ${values.destinationVillageId}, 'PREPARING',
           CAST(${JSON.stringify(values.cargo)} AS JSON), CAST(${JSON.stringify(values.path)} AS JSON),
           ${values.travelMinutes}, ${values.createdById}, ${values.now}
    FROM DUAL
    WHERE (SELECT COUNT(*) FROM ${caravan} AS sent WHERE sent.originVillageId = ${values.originVillageId} AND sent.status IN ('PREPARING', 'TRAVELLING')) < ${capacity}
  `);

/** Move a renamed character's caravan sides, reservations and operations to the new id. */
export const renameCaravanUser = (
  client: Pick<DrizzleClient, "update">,
  input: { newUserId: string; userId: string },
) => {
  const moveActive = (column: typeof caravanParticipant.activeUserId) =>
    sql`CASE WHEN ${column} IS NULL THEN NULL ELSE ${input.newUserId} END`;
  return Promise.all([
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
        activeUserId: sql`CASE WHEN ${caravanOperation.activeUserId} IS NULL THEN NULL ELSE ${input.newUserId} END`,
      })
      .where(eq(caravanOperation.userId, input.userId)),
  ]);
};
