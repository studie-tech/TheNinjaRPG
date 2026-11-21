/**
 * Database access for trade routes and their markers; authorization stays in callers.
 */
import { and, eq, gt, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { TRADE_ROUTE_MARKER_MAX_CONTROL } from "@/drizzle/constants";
import {
  clan,
  tradeRoute,
  tradeRouteDiscovery,
  tradeRouteMarker,
  userData,
  village,
  villageAlliance,
  villageStructure,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

const villageColumns = { columns: { id: true, name: true, kageId: true } } as const;

/** Table aliases for the two villages of a route, apart from a marker's controller. */
const routeVillageA = alias(village, "routeVillageA");
const routeVillageB = alias(village, "routeVillageB");

/** Open and proposed routes of a village, with both villages and every marker. */
export const listVillageRoutes = (
  client: Pick<DrizzleClient, "query">,
  villageId: string,
) =>
  client.query.tradeRoute.findMany({
    where: and(
      or(eq(tradeRoute.villageIdA, villageId), eq(tradeRoute.villageIdB, villageId)),
      inArray(tradeRoute.status, ["PROPOSED", "ACTIVE"]),
    ),
    with: { villageA: villageColumns, villageB: villageColumns, markers: true },
  });

/** One route with its villages and markers. */
export const findTradeRoute = (client: Pick<DrizzleClient, "query">, routeId: string) =>
  client.query.tradeRoute.findFirst({
    where: eq(tradeRoute.id, routeId),
    with: { villageA: villageColumns, villageB: villageColumns, markers: true },
  });

/** Villages and settlements with a built Warehouse, the possible trade partners. */
export const listWarehouseVillages = (client: Pick<DrizzleClient, "select">) =>
  client
    .select({ id: village.id, name: village.name })
    .from(village)
    .innerJoin(
      villageStructure,
      and(
        eq(villageStructure.villageId, village.id),
        eq(villageStructure.route, "/warehouse"),
        gt(villageStructure.level, 0),
      ),
    )
    .where(inArray(village.type, ["VILLAGE", "HIDEOUT", "STRONGHOLD"]));

/** Every diplomatic relationship between villages. */
export const listVillageRelationships = (client: Pick<DrizzleClient, "select">) =>
  client.select().from(villageAlliance);

/** Propose a route; the open-pair key rejects a second open route between two villages. */
export const insertTradeRoute = (
  client: Pick<DrizzleClient, "insert">,
  values: typeof tradeRoute.$inferInsert,
) => client.insert(tradeRoute).values(values);

/** Accept a proposal still awaiting an answer. */
export const acceptTradeRoute = (
  client: Pick<DrizzleClient, "update">,
  routeId: string,
  now: Date,
) =>
  client
    .update(tradeRoute)
    .set({ status: "ACTIVE", acceptedAt: now })
    .where(and(eq(tradeRoute.id, routeId), eq(tradeRoute.status, "PROPOSED")));

/**
 * Close or decline one open or proposed route, or every one of a village, freeing their
 * pairs for new agreements.
 */
export const closeTradeRoutes = (
  client: Pick<DrizzleClient, "update">,
  target: { routeId: string } | { villageId: string },
  now: Date,
) =>
  client
    .update(tradeRoute)
    .set({ status: "CLOSED", openPair: null, closedAt: now })
    .where(
      and(
        "routeId" in target
          ? eq(tradeRoute.id, target.routeId)
          : or(
              eq(tradeRoute.villageIdA, target.villageId),
              eq(tradeRoute.villageIdB, target.villageId),
            ),
        inArray(tradeRoute.status, ["PROPOSED", "ACTIVE"]),
      ),
    );

/** Place a route's hidden markers. */
export const insertRouteMarkers = (
  client: Pick<DrizzleClient, "insert">,
  rows: (typeof tradeRouteMarker.$inferInsert)[],
) =>
  rows.length === 0 ? Promise.resolve() : client.insert(tradeRouteMarker).values(rows);

/**
 * Raise a route's level and charge the paying village in one statement: village tokens,
 * or the leading clan's points in faction settlements. The payer must still be the Kage or
 * a serving Elder, and in the paying clan.
 */
export const upgradeTradeRoute = (
  client: Pick<DrizzleClient, "execute">,
  input: {
    routeId: string;
    level: number;
    cost: number;
    villageId: string;
    userId: string;
    clanId: string | null;
  },
) =>
  client.execute(sql`
    UPDATE ${tradeRoute}
    INNER JOIN ${village} ON ${village.id} = ${input.villageId}
    ${input.clanId ? sql`INNER JOIN ${clan} ON ${clan.id} = ${input.clanId}` : sql``}
    SET ${tradeRoute.level} = ${input.level + 1},
        ${input.clanId ? sql`${clan.points} = ${clan.points} - ${input.cost}` : sql`${village.tokens} = ${village.tokens} - ${input.cost}`}
    WHERE ${tradeRoute.id} = ${input.routeId}
      AND ${tradeRoute.status} = 'ACTIVE'
      AND ${tradeRoute.level} = ${input.level}
      AND (${tradeRoute.villageIdA} = ${input.villageId} OR ${tradeRoute.villageIdB} = ${input.villageId})
      AND ${input.clanId ? sql`${clan.points}` : sql`${village.tokens}`} >= ${input.cost}
      AND EXISTS (
        SELECT 1 FROM ${userData}
        WHERE ${userData.userId} = ${input.userId}
          AND ${userData.villageId} = ${input.villageId}
          AND ${userData.isBanned} = FALSE
          AND (${village.kageId} = ${input.userId} OR (${userData.rank} = 'ELDER' AND ${userData.isAi} = FALSE))
          ${input.clanId ? sql`AND ${userData.clanId} = ${input.clanId}` : sql``}
      )
  `);

/** Markers placed in a sector on active routes, with the names of the route's villages. */
export const listSectorMarkers = (
  client: Pick<DrizzleClient, "select">,
  sector: number,
) =>
  client
    .select({
      id: tradeRouteMarker.id,
      sector: tradeRouteMarker.sector,
      controllerVillageId: tradeRouteMarker.controllerVillageId,
      controllerName: village.name,
      control: tradeRouteMarker.control,
      villageIdA: tradeRoute.villageIdA,
      villageIdB: tradeRoute.villageIdB,
      villageNameA: routeVillageA.name,
      villageNameB: routeVillageB.name,
    })
    .from(tradeRouteMarker)
    .innerJoin(tradeRoute, eq(tradeRoute.id, tradeRouteMarker.routeId))
    .leftJoin(village, eq(village.id, tradeRouteMarker.controllerVillageId))
    .leftJoin(routeVillageA, eq(routeVillageA.id, tradeRoute.villageIdA))
    .leftJoin(routeVillageB, eq(routeVillageB.id, tradeRoute.villageIdB))
    .where(and(eq(tradeRouteMarker.sector, sector), eq(tradeRoute.status, "ACTIVE")));

/** One marker with its route's villages. */
export const findMarker = (client: Pick<DrizzleClient, "select">, markerId: string) =>
  client
    .select({
      id: tradeRouteMarker.id,
      sector: tradeRouteMarker.sector,
      controllerVillageId: tradeRouteMarker.controllerVillageId,
      villageIdA: tradeRoute.villageIdA,
      villageIdB: tradeRoute.villageIdB,
      status: tradeRoute.status,
    })
    .from(tradeRouteMarker)
    .innerJoin(tradeRoute, eq(tradeRoute.id, tradeRouteMarker.routeId))
    .where(eq(tradeRouteMarker.id, markerId))
    .then((rows) => rows[0]);

/** Markers a village has found and still knows about. */
export const listMarkerDiscoveries = (
  client: Pick<DrizzleClient, "select">,
  villageId: string,
  now: Date,
) =>
  client
    .select()
    .from(tradeRouteDiscovery)
    .where(
      and(
        eq(tradeRouteDiscovery.villageId, villageId),
        gt(tradeRouteDiscovery.expiresAt, now),
      ),
    );

/** Reveal markers to a village until the given time; an earlier time never shortens one. */
export const upsertMarkerDiscoveries = (
  client: Pick<DrizzleClient, "insert">,
  markerIds: string[],
  villageId: string,
  expiresAt: Date,
) =>
  markerIds.length === 0
    ? Promise.resolve()
    : client
        .insert(tradeRouteDiscovery)
        .values(markerIds.map((markerId) => ({ markerId, villageId, expiresAt })))
        .onDuplicateKeyUpdate({
          set: {
            expiresAt: sql`GREATEST(${tradeRouteDiscovery.expiresAt}, VALUES(${tradeRouteDiscovery.expiresAt}))`,
          },
        });

/**
 * Wear down a marker after a won assault while it still has the holder the assault was
 * allowed against. When its control runs out it changes hands at full control: to the
 * assaulting village, or back to the route's own villages (NULL).
 */
export const damageMarker = (
  client: Pick<DrizzleClient, "update">,
  input: {
    markerId: string;
    damage: number;
    controllerVillageId: string | null;
    captureVillageId: string | null;
  },
) => {
  const { markerId, damage, captureVillageId } = input;
  const captured = sql`${tradeRouteMarker.control} - ${damage} <= 0`;
  return client
    .update(tradeRouteMarker)
    .set({
      // Assigned before control in column order, so `captured` reads the old control.
      controllerVillageId: sql`CASE WHEN ${captured} THEN ${captureVillageId} ELSE ${tradeRouteMarker.controllerVillageId} END`,
      control: sql`CASE WHEN ${captured} THEN ${TRADE_ROUTE_MARKER_MAX_CONTROL} ELSE ${tradeRouteMarker.control} - ${damage} END`,
    })
    .where(
      and(
        eq(tradeRouteMarker.id, markerId),
        sql`${tradeRouteMarker.controllerVillageId} <=> ${input.controllerVillageId}`,
      ),
    );
};
