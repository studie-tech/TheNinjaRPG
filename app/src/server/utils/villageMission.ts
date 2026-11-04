import { and, eq, exists, isNotNull, sql } from "drizzle-orm";
import {
  type VillageMissionTask,
  WAR_SHRINE_CAPTURE_WARHEALTH_DMG,
} from "@/drizzle/constants";
import { village, war } from "@/drizzle/schema";
import {
  executeResultForApplyVillageMissionShrineDamage,
  missionCounterIncrement,
  missionEligibleVillage,
  selectWarForApplyVillageMissionShrineDamage,
  updateVillageForRecordVillageMissionProgress,
} from "@/queries/villageMission";
import type { DrizzleClient } from "@/server/db";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";

/** Atomic counters need no read, including in combat's final mutation phase. */
export const recordVillageMissionProgress = async (
  client: Pick<DrizzleClient, "update" | "select">,
  villageId: string | null,
  userId: string,
  events: Partial<Record<VillageMissionTask, number>>,
) => {
  const increments = Object.entries(events).filter(
    ([, increment]) => Number.isFinite(increment) && increment > 0,
  );
  if (!villageId || increments.length === 0) return;
  const argumentsSql = increments.flatMap(([task, increment]) =>
    missionCounterIncrement(task as VillageMissionTask, increment),
  );
  await retryOnDeadlock(() =>
    updateVillageForRecordVillageMissionProgress(
      client,
      argumentsSql,
      villageId,
      userId,
    ),
  );
};

/**
 * Remove shrine HP and credit eligible village progress in one atomic statement.
 * LIMIT prevents merging the derived table, preserving pre-damage HP independently
 * of multi-table assignment order. Its locking read serializes concurrent damage
 * inside the UPDATE, without an application fetch or transaction round-trips.
 */
export const applyVillageMissionShrineDamage = async (
  client: Pick<DrizzleClient, "execute" | "select">,
  villageId: string | null,
  userId: string,
  warId: string,
  shrine: "attackerShrineHp" | "defenderShrineHp",
  damage: number,
  canCapture = false,
) => {
  if (damage <= 0) return false;
  const hp = war[shrine];
  const status =
    shrine === "attackerShrineHp" ? war.attackerShrineStatus : war.defenderShrineStatus;
  const health =
    shrine === "attackerShrineHp" ? war.attackerWarHealth : war.defenderWarHealth;
  const snapshot = selectWarForApplyVillageMissionShrineDamage(
    client,
    hp,
    status,
    canCapture,
    damage,
    warId,
  );
  // Drizzle emits computed selection aliases without table qualification in SQL
  // fragments, so qualify this derived field explicitly.
  const captureFlag = sql`${sql.identifier("shrine_snapshot")}.${sql.identifier("shouldCapture")}`;
  const eligibleVillage = missionEligibleVillage(client, villageId ?? "", userId);
  const assignments = [
    sql`${hp} = GREATEST(${snapshot.hp} - ${damage}, 0)`,
    ...(villageId
      ? [
          sql`${village.missionCounters} = JSON_SET(${village.missionCounters}, ${sql.join(
            missionCounterIncrement(
              "siege_operation",
              sql`LEAST(${snapshot.hp}, ${damage})`,
            ),
            sql`, `,
          )})`,
        ]
      : []),
    ...(canCapture
      ? [
          // MySQL has no UPDATE RETURNING: LAST_INSERT_ID(expr) returns the capture
          // flag in this statement's OK packet while IF stores the required status.
          sql`${status} = IF(LAST_INSERT_ID(${captureFlag}), 'CAPTURED', ${snapshot.status})`,
          sql`${health} = IF(${captureFlag}, GREATEST(${health} - ${WAR_SHRINE_CAPTURE_WARHEALTH_DMG}, 0), ${health})`,
        ]
      : []),
  ];
  // Drizzle's MySQL builder cannot update multiple tables; only the joined write
  // needs SQL, while its snapshot and guards use the typed query builders.
  const result = await executeResultForApplyVillageMissionShrineDamage(
    client,
    snapshot,
    villageId,
    eligibleVillage,
    assignments,
    warId,
  );
  return canCapture && result.rowsAffected > 0 && result.insertId === "1";
};
