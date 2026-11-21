import { type SQLWrapper, sql } from "drizzle-orm";
import {
  caravanParticipant,
  dungeonMember,
  dungeonRun,
  userData,
} from "@/drizzle/schema";

/** A live dungeon party holds this player. */
export const withoutDungeonReservation = (userId: SQLWrapper = userData.userId) =>
  sql`NOT EXISTS (SELECT 1 FROM ${dungeonMember} INNER JOIN ${dungeonRun} ON ${dungeonRun.id} = ${dungeonMember.runId} WHERE ${dungeonMember.activeUserId} = ${userId} AND ${dungeonRun.status} NOT IN ('COMPLETED', 'ENDED'))`;

/** A caravan escort holds this player until its journey is delivered or cancelled. */
export const withoutCaravanEscort = (userId: SQLWrapper = userData.userId) =>
  sql`NOT EXISTS (SELECT 1 FROM ${caravanParticipant} WHERE ${caravanParticipant.activeUserId} = ${userId} AND ${caravanParticipant.role} = 'GUARD')`;

/**
 * Protect live party and escort reservations when other activities claim or release status:
 * reserved players stay QUEUED for their own activity and cannot be drawn into another.
 */
export const withoutActivityReservation = (userId: SQLWrapper = userData.userId) =>
  sql`(${withoutDungeonReservation(userId)} AND ${withoutCaravanEscort(userId)})`;

/** Escorts waiting in their caravan's queue; one who left it to heal fights like anyone else. */
export const withoutQueuedEscort = (userId: SQLWrapper = userData.userId) =>
  sql`(${userData.status} <> 'QUEUED' OR ${withoutCaravanEscort(userId)})`;

/** Status of a player leaving combat: escorts return to their caravan's queue. */
export const leaveCombatStatusSql = (userId: SQLWrapper = userData.userId) =>
  sql`CASE WHEN ${withoutCaravanEscort(userId)} THEN 'AWAKE' ELSE 'QUEUED' END`;
