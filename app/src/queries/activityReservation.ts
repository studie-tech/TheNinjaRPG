import { type SQLWrapper, sql } from "drizzle-orm";
import type { BattleType } from "@/drizzle/constants";
import {
  caravanParticipant,
  dungeonMember,
  dungeonRun,
  userData,
} from "@/drizzle/schema";

/** No live dungeon party holds this player. */
export const withoutDungeonReservation = (userId: SQLWrapper = userData.userId) =>
  sql`NOT EXISTS (SELECT 1 FROM ${dungeonMember} INNER JOIN ${dungeonRun} ON ${dungeonRun.id} = ${dungeonMember.runId} WHERE ${dungeonMember.activeUserId} = ${userId} AND ${dungeonRun.status} NOT IN ('COMPLETED', 'ENDED'))`;

/**
 * No caravan escort holds this player; an escort holds them until its journey is delivered
 * or cancelled.
 */
export const withoutCaravanEscort = (userId: SQLWrapper = userData.userId) =>
  sql`NOT EXISTS (SELECT 1 FROM ${caravanParticipant} WHERE ${caravanParticipant.activeUserId} = ${userId} AND ${caravanParticipant.role} = 'GUARD')`;

/**
 * Protect live party and escort reservations when other activities claim or release status:
 * reserved players stay QUEUED for their own activity and cannot be drawn into another.
 */
export const withoutActivityReservation = (userId: SQLWrapper = userData.userId) =>
  sql`(${withoutDungeonReservation(userId)} AND ${withoutCaravanEscort(userId)})`;

/**
 * The player is not an escort waiting in their caravan's queue; one who left it to heal
 * fights like anyone else.
 */
export const withoutQueuedEscort = () =>
  sql`(${userData.status} <> 'QUEUED' OR ${withoutCaravanEscort()})`;

/**
 * Status of a player leaving combat: escorts return to their caravan's queue from its
 * battles. Any other battle holds only escorts who left the queue to heal, and they rejoin
 * it themselves.
 */
export const leaveCombatStatus = (battleType: BattleType) =>
  battleType === "CARAVAN"
    ? sql`CASE WHEN ${withoutCaravanEscort()} THEN 'AWAKE' ELSE 'QUEUED' END`
    : ("AWAKE" as const);
