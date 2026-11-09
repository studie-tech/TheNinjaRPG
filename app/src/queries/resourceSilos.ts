import { and, eq, gte, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  MAP_WAR_TORN_BATTLEGROUND_SECTOR,
  RESOURCE_SILO_POINTS_REQUIRED,
  RESOURCE_SILO_RESPAWN_COST,
} from "@/drizzle/constants";
import {
  actionLog,
  item,
  resourceSilo,
  type UserData,
  userData,
} from "@/drizzle/schema";
import type { CombatResult, CompleteBattle } from "@/libs/combat/types";
import { resourceSiloBattlePoints } from "@/libs/resourceSilos";
import { nextSnapshotSql } from "@/queries/concurrency";
import type { DrizzleClient } from "@/server/db";
import type { ActionReadinessWrite } from "@/server/utils/actionReadiness";
import { userRegenerationGainSql } from "@/server/utils/regeneration";
import { calculateContentDiff } from "@/utils/diff";
import type { ResourceSiloEntryType } from "@/validators/resourceSilos";

/** Read the shrine's singleton reward pool. */
export const findResourceSilo = (client: DrizzleClient) =>
  client.query.resourceSilo.findFirst({ where: eq(resourceSilo.id, "war-torn") });
/** Load consumable candidates once; the caller filters their cache effects in memory. */
export const listResourceSiloCaches = (client: DrizzleClient) =>
  client.query.item.findMany({
    columns: { id: true, name: true, effects: true },
    where: and(eq(item.hidden, false), eq(item.itemType, "CONSUMABLE")),
  });
/** Persist validated catalog snapshots. */
export const saveResourceSilo = (
  client: DrizzleClient,
  entries: ResourceSiloEntryType[],
) =>
  client
    .insert(resourceSilo)
    .values({ id: "war-torn", entries, updatedAt: new Date() })
    .onDuplicateKeyUpdate({ set: { entries, updatedAt: new Date() } });
/** Record the exact pool change with the staff author's identity. */
export const auditResourceSilo = (
  client: DrizzleClient,
  userId: string,
  before: ResourceSiloEntryType[],
  entries: ResourceSiloEntryType[],
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId,
    tableName: "resourceSilo",
    relatedId: "war-torn",
    relatedMsg: "Update: Resource Silos",
    changes: calculateContentDiff({ entries: before }, { entries }),
  });
/** Fold points into combat's battle-ID CAS so duplicate settlement cannot award twice. */
export const resourceSiloProgressUpdate = (
  battle: CompleteBattle,
  userId: string,
  result: CombatResult,
  now: Date,
) => {
  const points = resourceSiloBattlePoints(battle, userId, result, now);
  const windowId = battle.extraState.resourceSiloWindowId;
  if (!points || !windowId) return {};
  return {
    resourceSiloProgress: sql`IF(JSON_UNQUOTE(JSON_EXTRACT(${userData.resourceSiloProgress}, '$.windowId')) = ${windowId}, JSON_SET(${userData.resourceSiloProgress}, '$.points', COALESCE(JSON_EXTRACT(${userData.resourceSiloProgress}, '$.points'), 0) + ${points}), CAST(${JSON.stringify({ windowId, points, claimed: false })} AS JSON))`,
  };
};
/** Atomically consume this window's offer while fencing battle admission and account changes. */
export const claimResourceSilo = (
  client: DrizzleClient,
  user: UserData,
  window: { id: string; start: Date; end: Date },
  readiness?: ActionReadinessWrite,
) =>
  client
    .update(userData)
    .set({
      ...readiness?.set,
      resourceSiloProgress: sql`JSON_SET(${userData.resourceSiloProgress}, '$.claimed', CAST('true' AS JSON))`,
      updatedAt: nextSnapshotSql(userData.updatedAt),
    })
    .where(
      and(
        eq(userData.userId, user.userId),
        eq(userData.updatedAt, user.updatedAt),
        eq(userData.isBanned, false),
        readiness?.where ?? eq(userData.status, "AWAKE"),
        eq(userData.sector, MAP_WAR_TORN_BATTLEGROUND_SECTOR),
        sql`JSON_UNQUOTE(JSON_EXTRACT(${userData.resourceSiloProgress}, '$.windowId')) = ${window.id}`,
        sql`JSON_EXTRACT(${userData.resourceSiloProgress}, '$.points') >= ${RESOURCE_SILO_POINTS_REQUIRED}`,
        sql`JSON_EXTRACT(${userData.resourceSiloProgress}, '$.claimed') = CAST('false' AS JSON)`,
        sql`UTC_TIMESTAMP(3) >= ${window.start} AND UTC_TIMESTAMP(3) < ${window.end}`,
      ),
    );
/** A paid revival spends money and consumes the death choice in the same guarded statement. */
export const resolveWarTornRespawn = (
  client: DrizzleClient,
  user: UserData,
  shrine: { x: number; y: number } | undefined,
  revivedAt = new Date(),
) =>
  client
    .update(userData)
    .set({
      warTornRespawn: false,
      updatedAt: nextSnapshotSql(userData.updatedAt),
      ...(shrine
        ? {
            money: sql`${userData.money} - ${RESOURCE_SILO_RESPAWN_COST}`,
            status: "AWAKE" as const,
            sector: MAP_WAR_TORN_BATTLEGROUND_SECTOR,
            longitude: shrine.x,
            latitude: shrine.y,
            curHealth: user.maxHealth,
            curChakra: user.maxChakra,
            curStamina: user.maxStamina,
            curEnergy: sql`LEAST(${user.maxEnergy}, ${userData.curEnergy} + ${userRegenerationGainSql(user, userData.regenAt, revivedAt)})`,
            maxEnergy: user.maxEnergy,
            regenAt: revivedAt,
            immunityUntil: new Date(0),
          }
        : {}),
    })
    .where(
      and(
        eq(userData.userId, user.userId),
        eq(userData.updatedAt, user.updatedAt),
        eq(userData.status, "HOSPITALIZED"),
        eq(userData.warTornRespawn, true),
        eq(userData.isBanned, false),
        shrine ? gte(userData.money, RESOURCE_SILO_RESPAWN_COST) : undefined,
      ),
    );
