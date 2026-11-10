import {
  and,
  asc,
  count,
  eq,
  exists,
  gte,
  inArray,
  isNotNull,
  lt,
  lte,
  sql,
} from "drizzle-orm";
import { VILLAGE_DUTY_MAX_PATROLS, VILLAGE_DUTY_RANKS } from "@/drizzle/constants";
import {
  userData,
  village,
  villageDutyPresence,
  villageDutyShift,
} from "@/drizzle/schema";
import type { VillageDutyPatrol } from "@/libs/villageDuty";
import { spriteUserRelations } from "@/queries/lpc";
import type { DrizzleClient } from "@/server/db";
import { getUtcHourStart } from "@/utils/time";

/** Duty belongs to the membership tenure that enrolled, regardless of online presence. */
export const activeVillageDutyWhere = () =>
  and(
    isNotNull(userData.villageDutyVillageId),
    eq(userData.villageDutyVillageId, userData.villageId),
    gte(userData.villageDutyStartedAt, userData.joinedVillageAt),
    eq(userData.isAi, false),
    eq(userData.isBanned, false),
    eq(userData.isOutlaw, false),
    inArray(userData.rank, VILLAGE_DUTY_RANKS),
  );

/** Eligibility and travel checks need no quest blobs, inventory or other private profile relations. */
export const fetchVillageDutyUser = (client: DrizzleClient, userId: string) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, userId),
    columns: {
      userId: true,
      villageId: true,
      rank: true,
      status: true,
      sector: true,
      longitude: true,
      latitude: true,
      location: true,
      isAi: true,
      isBanned: true,
      isOutlaw: true,
      stealthActive: true,
      stealthActivatedAt: true,
      stealth: true,
      villageDutyVillageId: true,
      villageDutyStartedAt: true,
      joinedVillageAt: true,
    },
  });

/** Read structure, diplomacy and the shared hourly roster in one relation query. */
export const fetchVillageDutyHome = (
  client: DrizzleClient,
  idOrSector: string | number,
) =>
  client.query.village.findFirst({
    where: and(
      typeof idOrSector === "number"
        ? eq(village.sector, idOrSector)
        : eq(village.id, idOrSector),
      eq(village.type, "VILLAGE"),
    ),
    with: {
      structures: true,
      dutyShift: true,
      relationshipA: true,
      relationshipB: true,
    },
  });

/** Select a bounded random roster once per hour, without loading volunteer appearance or loadouts. */
export const listVillageDutyCandidates = (
  client: DrizzleClient,
  villageId: string,
  now: Date,
) =>
  client.query.userData.findMany({
    columns: { userId: true },
    where: and(
      activeVillageDutyWhere(),
      eq(userData.villageDutyVillageId, villageId),
      lte(userData.villageDutyStartedAt, getUtcHourStart(now)),
    ),
    orderBy: [
      sql`SHA2(CONCAT(${villageId}, ':', ${getUtcHourStart(now).toISOString()}, ':', ${userData.userId}), 256)`,
      asc(userData.userId),
    ],
    limit: VILLAGE_DUTY_MAX_PATROLS,
  });

/** Membership changes may withdraw a copy, but cannot introduce a replacement during a shift. */
const assignedVillageDutyWhere = (now: Date, availableOnly: boolean) =>
  // The outer relational read aliases UserData; a fixed inner alias keeps its correlation explicit.
  and(
    lte(userData.villageDutyStartedAt, getUtcHourStart(now)),
    sql`EXISTS (SELECT 1 FROM ${villageDutyShift} AS duty_shift WHERE duty_shift.villageId = ${userData.villageDutyVillageId} AND duty_shift.startedAt = ${getUtcHourStart(now)} AND JSON_CONTAINS(duty_shift.patrols, JSON_OBJECT('userId', ${userData.userId}${availableOnly ? sql`, 'defeated', CAST('false' AS JSON), 'battleId', null` : sql``})))`,
  );

/** Public names for the assigned roster; defeated copies remain visible as spent slots. */
export const listVillageDutyRoster = (
  client: DrizzleClient,
  villageId: string | number,
  now = new Date(),
) =>
  client.query.userData.findMany({
    columns: {
      userId: true,
      username: true,
      avatar: true,
      avatarLight: true,
      rank: true,
    },
    where: and(
      activeVillageDutyWhere(),
      inArray(
        userData.villageDutyVillageId,
        client
          .select({ id: village.id })
          .from(village)
          .where(
            and(
              typeof villageId === "number"
                ? eq(village.sector, villageId)
                : eq(village.id, villageId),
              eq(village.type, "VILLAGE"),
            ),
          ),
      ),
      assignedVillageDutyWhere(now, false),
    ),
    orderBy: asc(userData.userId),
    limit: VILLAGE_DUTY_MAX_PATROLS,
  });

/** Appearance is loaded only for available copies in the authoritative current-hour roster. */
export const listVillageDutyPatrols = (
  client: DrizzleClient,
  sector: number,
  now = new Date(),
) =>
  client.query.userData.findMany({
    columns: {
      userId: true,
      username: true,
      avatar: true,
      avatarLight: true,
      gender: true,
      spriteBodyStyle: true,
      maxHealth: true,
      level: true,
      experience: true,
      rank: true,
      villageId: true,
      villageDutyStartedAt: true,
      anbuId: true,
    },
    with: { ...spriteUserRelations, anbuSquad: { columns: { image: true } } },
    where: and(
      activeVillageDutyWhere(),
      assignedVillageDutyWhere(now, true),
      inArray(
        userData.villageDutyVillageId,
        client
          .select({ id: village.id })
          .from(village)
          .where(and(eq(village.sector, sector), eq(village.type, "VILLAGE"))),
      ),
    ),
    orderBy: asc(userData.userId),
    limit: VILLAGE_DUTY_MAX_PATROLS,
  });

/** Count volunteers separately from the fixed, finite hourly roster. */
export const countVillageDuty = (client: DrizzleClient, villageId: string) =>
  client
    .select({ count: count() })
    .from(userData)
    .where(and(activeVillageDutyWhere(), eq(userData.villageDutyVillageId, villageId)));

/** Only one initializer wins; a losing request reloads the winning roster instead of refilling slots. */
export const saveVillageDutyShift = (
  client: DrizzleClient,
  villageId: string,
  startedAt: Date,
  patrols: VillageDutyPatrol[],
  capacity: number,
  previous: typeof villageDutyShift.$inferSelect | null | undefined,
) =>
  previous
    ? client
        .update(villageDutyShift)
        .set({
          startedAt,
          patrols,
          capacity,
          revision: sql`${villageDutyShift.revision} + 1`,
        })
        .where(
          and(
            eq(villageDutyShift.villageId, villageId),
            eq(villageDutyShift.startedAt, previous.startedAt),
            eq(villageDutyShift.revision, previous.revision),
          ),
        )
    : client
        .insert(villageDutyShift)
        .ignore()
        .values({ villageId, startedAt, patrols, capacity });

/** A raced hourly initialization is uncommon; only its loser needs this reconciliation read. */
export const findVillageDutyShift = (client: DrizzleClient, villageId: string) =>
  client.query.villageDutyShift.findFirst({
    where: eq(villageDutyShift.villageId, villageId),
  });

/** Pursuit updates cannot overwrite concurrent battle claims, defeats or hourly rotations. */
export const updateVillageDutyPursuits = (
  client: DrizzleClient,
  shift: typeof villageDutyShift.$inferSelect,
  patrols: VillageDutyPatrol[],
) =>
  client
    .update(villageDutyShift)
    .set({ patrols, revision: sql`${villageDutyShift.revision} + 1` })
    .where(
      and(
        eq(villageDutyShift.villageId, shift.villageId),
        eq(villageDutyShift.startedAt, shift.startedAt),
        eq(villageDutyShift.revision, shift.revision),
      ),
    );

/** Reserve a single copy before admission; the owner's character row is never claimed. */
export const claimVillageDutyPatrol = (
  client: DrizzleClient,
  shift: typeof villageDutyShift.$inferSelect,
  slot: number,
  battleId: string,
) =>
  client
    .update(villageDutyShift)
    .set({
      patrols: sql`JSON_SET(${villageDutyShift.patrols}, ${`$[${slot}].battleId`}, ${battleId})`,
      revision: sql`${villageDutyShift.revision} + 1`,
    })
    .where(
      and(
        eq(villageDutyShift.villageId, shift.villageId),
        eq(villageDutyShift.startedAt, shift.startedAt),
        eq(villageDutyShift.revision, shift.revision),
        sql`JSON_CONTAINS(${villageDutyShift.patrols}, JSON_OBJECT('userId', ${shift.patrols[slot]?.userId}, 'defeated', CAST('false' AS JSON), 'battleId', null))`,
      ),
    );

/** Admission failures release their own reservation; old battles cannot replenish a newer shift. */
export const releaseVillageDutyPatrol = (
  client: DrizzleClient,
  reference: { villageId: string; startedAt: string; slot: number; battleId: string },
  defeated: boolean,
) =>
  client
    .update(villageDutyShift)
    .set({
      patrols: sql`JSON_SET(${villageDutyShift.patrols}, ${`$[${reference.slot}].battleId`}, NULL, ${`$[${reference.slot}].defeated`}, CAST(${JSON.stringify(defeated)} AS JSON), ${`$[${reference.slot}].pursuit`}, NULL)`,
      revision: sql`${villageDutyShift.revision} + 1`,
    })
    .where(
      and(
        eq(villageDutyShift.villageId, reference.villageId),
        eq(villageDutyShift.startedAt, new Date(reference.startedAt)),
        sql`JSON_UNQUOTE(JSON_EXTRACT(${villageDutyShift.patrols}, ${`$[${reference.slot}].battleId`})) = ${reference.battleId}`,
      ),
    );

/** Travel heartbeats expire without cleanup jobs; canonical coordinates remain on UserData. */
export const touchVillageDutyPresence = (
  client: DrizzleClient,
  userId: string,
  sector: number,
  expiresAt: Date,
) =>
  client
    .insert(villageDutyPresence)
    .values({ userId, sector, expiresAt })
    .onDuplicateKeyUpdate({ set: { sector, expiresAt } });

/** Only recent travel-screen users who are still awake in this village can be pursued. */
export const listVillageDutyVisitors = (
  client: DrizzleClient,
  sector: number,
  now: Date,
) =>
  client.query.villageDutyPresence.findMany({
    where: and(
      eq(villageDutyPresence.sector, sector),
      gte(villageDutyPresence.expiresAt, now),
    ),
    with: {
      user: {
        columns: {
          userId: true,
          villageId: true,
          sector: true,
          longitude: true,
          latitude: true,
          status: true,
          location: true,
          isBanned: true,
          isAi: true,
          stealthActive: true,
          stealthActivatedAt: true,
          stealth: true,
        },
      },
    },
  });

/** Enroll only an awake eligible member physically in their home village; never refresh activity. */
export const enrollVillageDuty = (
  client: DrizzleClient,
  userId: string,
  villageId: string,
  now: Date,
) =>
  client
    .update(userData)
    .set({ villageDutyVillageId: villageId, villageDutyStartedAt: now })
    .where(
      and(
        eq(userData.userId, userId),
        eq(userData.villageId, villageId),
        eq(userData.status, "AWAKE"),
        eq(userData.location, "Village"),
        eq(userData.isBanned, false),
        eq(userData.isAi, false),
        eq(userData.isOutlaw, false),
        inArray(userData.rank, VILLAGE_DUTY_RANKS),
        exists(
          client
            .select({ one: sql`1` })
            .from(village)
            .where(
              and(
                eq(village.id, villageId),
                eq(village.type, "VILLAGE"),
                eq(village.sector, userData.sector),
              ),
            ),
        ),
      ),
    );

/** Cancellation is available during any activity and clears only the account's duty enrollment. */
export const cancelVillageDuty = (client: DrizzleClient, userId: string) =>
  client
    .update(userData)
    .set({ villageDutyVillageId: null, villageDutyStartedAt: null })
    .where(eq(userData.userId, userId));

/** Bound expired travel-presence cleanup so idle accounts cannot grow the sector index indefinitely. */
export const deleteExpiredVillageDutyPresence = (client: DrizzleClient) =>
  client
    .delete(villageDutyPresence)
    .where(
      lt(villageDutyPresence.expiresAt, sql`CURRENT_TIMESTAMP(3) - INTERVAL 1 HOUR`),
    )
    .orderBy(villageDutyPresence.expiresAt)
    .limit(10000);
