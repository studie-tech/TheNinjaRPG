import { type SQLWrapper, sql } from "drizzle-orm";
import { dungeonMember, dungeonRun, userData } from "@/drizzle/schema";

/** Protect live dungeon reservations when other activities claim or release status. */
export const withoutDungeonReservation = (userId: SQLWrapper = userData.userId) =>
  sql`NOT EXISTS (SELECT 1 FROM ${dungeonMember} INNER JOIN ${dungeonRun} ON ${dungeonRun.id} = ${dungeonMember.runId} WHERE ${dungeonMember.activeUserId} = ${userId} AND ${dungeonRun.status} NOT IN ('COMPLETED', 'ENDED'))`;
