import { eq, sql } from "drizzle-orm";
import { DUNGEON_LOBBY_SECONDS } from "@/drizzle/constants";
import { type dungeonRun, userData } from "@/drizzle/schema";
import { combatEnergyRecoverySql } from "@/libs/combat/database";
import type { CompleteBattle } from "@/libs/combat/types";
import { dungeonBattleOutcome, dungeonNextState } from "@/libs/dungeon";
import { deleteBattleById, deleteBattleIfVersionMatches } from "@/queries/combat";
import {
  claimDungeonQueue,
  claimDungeonStartRecovery,
  clearDungeonActiveUsers,
  findBattleForExpireDungeonRun,
  releaseDungeonQueue,
  updateDungeonRunForExpireDungeonRun,
  updateDungeonRunForRollbackDungeonStart,
  updateDungeonRunForSettleDungeonBattle,
  updateUserDataForExpireDungeonRun,
  updateUserDataForSettleDungeonBattle,
} from "@/queries/dungeon";
import type { DrizzleClient } from "@/server/db";
import { cleanupCoopBattleStart } from "@/server/utils/coop";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";

/** Compensate every committed sibling write before reopening a failed floor start. */
export const rollbackDungeonStart = (
  client: DrizzleClient,
  run: typeof dungeonRun.$inferSelect,
  battleId: string,
  version: number,
) =>
  retryOnDeadlock(async () => {
    // Publication and this claim serialize on the run row. Advancing the version
    // prevents a slow launcher from publishing while cleanup removes partial writes.
    const recovering = run.status === "STARTING";
    if (!recovering) {
      const claim = await claimDungeonStartRecovery(client, run.id, battleId, version);
      if (claim.rowsAffected !== 1) return;
    }
    const recoveryVersion = recovering ? version : version + 1;
    const {
      battlePublished: _published,
      entryStartedAt: _started,
      entryPreviousDeadline: _deadline,
      ...state
    } = run.state;
    await cleanupCoopBattleStart(client, battleId, run.state.memberIds);
    // Reopen only after all cleanup finished; the CAS rejects stale or competing recovery.
    const reopened = await updateDungeonRunForRollbackDungeonStart(
      client,
      run,
      state,
      battleId,
      recoveryVersion,
    );
    if (reopened.rowsAffected === 1)
      await Promise.all(
        run.state.memberIds.map((id) => claimDungeonQueue(client, id, run.id)),
      );
  });

/**
 * Atomically claim the battle version, advance its run and restore every bound member.
 * Uses only preloaded combat state: settlement adds no reads to the action mutation phase.
 * Return false when another caller won the battle claim; a run mismatch throws and rolls back
 * the deletion, keeping the battle available for recovery instead of losing party progress.
 */
export const settleDungeonBattle = async (
  client: DrizzleClient,
  current: CompleteBattle,
  fetchedVersion: number,
) => {
  const settledAt = new Date();
  const meta = current.extraState.dungeon;
  const outcome = dungeonBattleOutcome(current);
  if (!meta || !outcome) return false;
  const next = dungeonNextState(meta.runState, outcome, meta.roomKind);
  if (outcome === "ended") next.message = meta.failedReason ?? "Dungeon ended.";
  const status =
    outcome === "ended"
      ? "ENDED"
      : next.floor === meta.totalFloors
        ? "COMPLETED"
        : "BETWEEN";
  // These changes span battle, run, character and membership rows. A single guarded update
  // cannot delete the battle too; retain a short transaction so failed revival is retryable.
  return retryOnDeadlock(() =>
    client.transaction(async (tx) => {
      const claim = await deleteBattleIfVersionMatches(tx, current, fetchedVersion);
      if (claim.rowsAffected === 0) return false;
      const run = await updateDungeonRunForSettleDungeonBattle(
        tx,
        next,
        status,
        meta,
        current,
      );
      if (run.rowsAffected !== 1)
        throw new Error("Dungeon run changed during floor settlement");
      await updateUserDataForSettleDungeonBattle(
        tx,
        dungeonEnergyRecoverySql,
        current,
        meta,
        settledAt,
        status === "BETWEEN",
      );
      if (status === "ENDED") await clearDungeonActiveUsers(tx, meta.runId);
      return true;
    }),
  );
};

/**
 * End an expired run, delete its battle, restore bound members and release reservations.
 * A loaded run version claims the whole cleanup; terminal, unexpired and stale snapshots
 * are no-ops. Fetch the battle only when needed for its preloaded energy recovery values.
 * Return whether readers must refresh, including when a competing version won the expiry CAS.
 */
export const expireDungeonRun = async (
  client: DrizzleClient,
  run: typeof dungeonRun.$inferSelect,
) => {
  const deadline =
    run.expiresAt ??
    (run.status === "LOBBY"
      ? new Date(run.createdAt.getTime() + DUNGEON_LOBBY_SECONDS * 1000)
      : null);
  if (
    !deadline ||
    deadline.getTime() > Date.now() ||
    ["COMPLETED", "ENDED"].includes(run.status)
  )
    return false;
  const settledAt = new Date();
  const snapshot = run.battleId
    ? await findBattleForExpireDungeonRun(client, { battleId: run.battleId })
    : undefined;
  // The terminal status disables future expiry, so battle removal, revival and reservation
  // release must commit with it. A single run CAS cannot express those multi-table effects.
  await retryOnDeadlock(() =>
    client.transaction(async (tx) => {
      const claim = await updateDungeonRunForExpireDungeonRun(tx, run);
      if (claim.rowsAffected === 0) return;
      if (run.battleId) {
        await deleteBattleById(tx, run.battleId);
        await updateUserDataForExpireDungeonRun(
          tx,
          dungeonEnergyRecoverySql,
          snapshot,
          { state: { memberIds: run.state.memberIds }, battleId: run.battleId },
          settledAt,
        );
      }
      await releaseDungeonQueue(tx, run.id);
      await clearDungeonActiveUsers(tx, run.id);
    }),
  );
  return true;
};

/** Recover each member's energy using combat's preloaded regeneration and capacity. */
const dungeonEnergyRecoverySql = (
  snapshot: CompleteBattle | undefined,
  memberIds: string[],
  at: Date,
) =>
  sql`CASE ${sql.join(
    memberIds.map(
      (id) =>
        sql`WHEN ${eq(userData.userId, id)} THEN ${combatEnergyRecoverySql(snapshot, id, 0, at)}`,
    ),
    sql` `,
  )} ELSE ${userData.curEnergy} END`;
