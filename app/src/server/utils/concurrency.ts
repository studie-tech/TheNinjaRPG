/**
 * Optimistic concurrency helpers using guarded MySQL / PlanetScale statements.
 *
 * Use **row-level** `updateUserItemQuantityAtomically` / `consumeUserItemAtomically` when the
 * invariant is a single `userItem` stack (consume, craft materials). Use **`claimUserSnapshot`**
 * when multiple fields must commit together or you need to serialize whole-user mutations via
 * `userData.updatedAt` (quest tracker persistence, crafting start, natural bloodline roll).
 *
 * Failed CAS (`success: false` / `false`) means another request mutated the row first — return a
 * safe client error and retry-friendly message.
 */
import { and, eq, exists, sql } from "drizzle-orm";
import type { BattleType } from "@/drizzle/constants";
import { huntingSession, type UserItem, userData, userItem } from "@/drizzle/schema";
import {
  deleteBloodlineRollsForRemoveBloodlineFromPoolAtomically,
  deleteUserItemForRestoreStaleUserItemMergeClaims,
  deleteUserItemWhere,
  insertUserItemForRefundUserItemQuantityAtomically,
  insertUserItemForRefundUserItemQuantityAtomically2,
  selectClaimedRankedQueueEntry,
  selectMpvpBattleUserForBattleClaimRollbackStatus,
  updateBloodlineRollsForRemoveBloodlineFromPoolAtomically,
  updateBloodlineRollsForReservePityCredit,
  updateUserDataForAdjustSeichiSilverAtomically,
  updateUserDataForClaimActiveNpcQuest,
  updateUserDataForClaimUserSnapshot,
  updateUserItemForRestoreStaleUserItemMergeClaims,
  updateUserItemForUpdateUserItemQuantityAtomically,
} from "@/queries/concurrency";
import type { DrizzleClient } from "@/server/db";
import type { ActionReadinessWrite } from "@/server/utils/actionReadiness";
import { getNextUserSnapshotAt } from "@/utils/time";
import type { QueryCondition } from "@/utils/typeutils";

type ClaimUserSnapshotParams = {
  client: Pick<DrizzleClient, "update">;
  userId: string;
  updatedAt: Date;
  where?: QueryCondition[];
  set?: Record<string, unknown>;
  /** Recovery is committed atomically with the endpoint's existing account claim. */
  readiness?: ActionReadinessWrite;
};

/** CAS on `user.updatedAt`; endpoint-supplied recovery shares the same guarded write and final action fields take precedence. */
export const claimUserSnapshot = async ({
  client,
  userId,
  updatedAt,
  where = [],
  set = {},
  readiness,
}: ClaimUserSnapshotParams) => {
  const claimedAt = getNextUserSnapshotAt(updatedAt);
  const result = await updateUserDataForClaimUserSnapshot(
    client,
    claimedAt,
    { ...readiness?.set, ...set },
    userId,
    updatedAt,
    [...where, readiness?.where],
  );

  return {
    success: result.rowsAffected === 1,
    claimedAt,
  };
};

type UpdateUserItemQuantityAtomicallyParams = {
  client: Pick<DrizzleClient, "update" | "delete">;
  userId: string;
  userItemId: string;
  expectedQuantity: number;
  nextQuantity: number;
  where?: QueryCondition[];
};

/** Evaluate at each inventory write so hunting admission also blocks stale requests. */
export const hasNoHuntingBattle = (userId: string) =>
  sql`NOT EXISTS (SELECT 1 FROM ${huntingSession}
    WHERE ${huntingSession.userId} = ${userId}
      AND ${huntingSession.battleId} IS NOT NULL)`;

/**
 * Sets quantity when the row still matches `expectedQuantity`, or deletes the row when
 * `nextQuantity` is 0. Hunting owns its preloaded inventory until settlement; other battle
 * types can still consume entry items. Returns false if the row changed or a hunt owns it.
 */
export const updateUserItemQuantityAtomically = async ({
  client,
  userId,
  userItemId,
  expectedQuantity,
  nextQuantity,
  where: conditions = [],
}: UpdateUserItemQuantityAtomicallyParams) => {
  if (expectedQuantity <= 0 || nextQuantity < 0 || nextQuantity >= expectedQuantity) {
    return false;
  }

  const where = and(
    eq(userItem.id, userItemId),
    eq(userItem.userId, userId),
    eq(userItem.quantity, expectedQuantity),
    hasNoHuntingBattle(userId),
    ...conditions,
  );

  const result =
    nextQuantity > 0
      ? await updateUserItemForUpdateUserItemQuantityAtomically(
          client,
          nextQuantity,
          where,
        )
      : await deleteUserItemWhere(client, where);

  return result.rowsAffected === 1;
};

type ConsumeUserItemAtomicallyParams = Omit<
  UpdateUserItemQuantityAtomicallyParams,
  "nextQuantity"
>;

/** Decrements quantity by 1 or deletes the stack when quantity was 1. */
export const consumeUserItemAtomically = async ({
  client,
  userId,
  userItemId,
  expectedQuantity,
  where,
}: ConsumeUserItemAtomicallyParams) => {
  return updateUserItemQuantityAtomically({
    client,
    userId,
    userItemId,
    expectedQuantity,
    nextQuantity: expectedQuantity - 1,
    where,
  });
};

/**
 * How long a stack-merge claim (negative quantity) may exist before it is considered abandoned
 * and safe to restore. Claims normally live for only a few database round trips.
 */
export const MERGE_STACK_CLAIM_TIMEOUT_MS = 30_000;

type RefundUserItemQuantityAtomicallyParams = {
  client: DrizzleClient;
  itemSnapshot: UserItem;
  quantity: number;
};

/**
 * Compensates a successful item consume. If the consume decremented the stack, the duplicate-key
 * branch adds the quantity back; if it deleted the stack, the insert branch recreates the original
 * row with only the refunded quantity. A negative quantity belongs to an active stack merge whose
 * publish would overwrite any value we set, so the guarded upsert refuses to touch it and the
 * refund lands in a fresh row instead — the next merge folds it back into the stack.
 */
export const refundUserItemQuantityAtomically = async ({
  client,
  itemSnapshot,
  quantity,
}: RefundUserItemQuantityAtomicallyParams) => {
  if (quantity <= 0) return;

  const result = await insertUserItemForRefundUserItemQuantityAtomically(
    client,
    itemSnapshot,
    quantity,
  );
  if (result.rowsAffected > 0) return;

  // The claimed original keeps its equipped slot when the merge publishes it back, so the
  // refund row must start unequipped — two rows can never share one slot.
  await insertUserItemForRefundUserItemQuantityAtomically2(
    client,
    itemSnapshot,
    quantity,
  );
};

type RestoreStaleUserItemMergeClaimsParams = {
  client: DrizzleClient;
  userId: string;
  staleBefore: Date;
};

/**
 * Cleans up abandoned stack-merge state. A merge claims a row by negating its quantity, so the
 * original value remains recoverable after a process crash. Its atomic publish turns obsolete
 * rows into zero-quantity tombstones, which are safe to delete once stale. Fresh non-positive rows
 * are left alone for the active merge; callers exclude them from inventory reads and writes.
 * Return whether recovery changed rows so mutation responses can withhold incomplete cache metadata.
 */
export const restoreStaleUserItemMergeClaims = async ({
  client,
  userId,
  staleBefore,
}: RestoreStaleUserItemMergeClaimsParams) => {
  const results = await Promise.all([
    updateUserItemForRestoreStaleUserItemMergeClaims(client, userId, staleBefore),
    deleteUserItemForRestoreStaleUserItemMergeClaims(client, userId, staleBefore),
  ]);
  return results.some((result) => result.rowsAffected > 0);
};

/**
 * Builds the per-row CASE expression used by the stack-merge protocol so one UPDATE can set a
 * different quantity per row (claim negation, publish targets, and conflict restores).
 */
export const userItemMergeQuantityCase = (
  targets: readonly { id: string; quantity: number }[],
) =>
  sql<number>`CASE ${userItem.id} ${sql.join(
    targets.map((target) => sql`WHEN ${target.id} THEN ${target.quantity}`),
    sql.raw(" "),
  )} ELSE ${userItem.quantity} END`;

type AdjustSeichiSilverParams = {
  client: DrizzleClient;
  userId: string;
  delta: number;
};

/**
 * Atomically adds `delta` to a user's Seichi Silver. For a negative delta a CAS floor
 * (`seichiSilver >= -delta`) prevents the balance going negative and guards against clobbering a
 * concurrent earn/spend. Returns false when the floor blocks the change (no row updated).
 */
export const adjustSeichiSilverAtomically = async ({
  client,
  userId,
  delta,
}: AdjustSeichiSilverParams) => {
  const result = await updateUserDataForAdjustSeichiSilverAtomically(
    client,
    delta,
    userId,
  );
  return result.rowsAffected === 1;
};

type RemoveBloodlineFromPoolParams = {
  client: DrizzleClient;
  userId: string;
  bloodlineId: string;
  now: Date;
};

/**
 * Removes a bloodline from a user's swappable pool. NATURAL rows are nulled (preserving the
 * one-natural-roll unique constraint, so the player gets no free re-roll); every other roll type
 * is deleted, because nulling an ITEM success row would match the failed-roll/pity bucket keyed on
 * `goal && !bloodlineId` and corrupt pity accounting. Both statements carry a `NOT EXISTS` guard so
 * the bloodline cannot be removed while it is the user's equipped bloodline (closes the read->write
 * race). Returns false when nothing changed (e.g. it became equipped concurrently).
 *
 * The DELETE and UPDATE run in parallel but are not atomic together. If a concurrent
 * `swapBloodline` equips this bloodline between them, one statement's guard can pass while the
 * other's blocks, leaving a partial removal (one roll type gone, the other retained) while this
 * helper still returns true. The per-statement guards do not serialize the whole removal with
 * the equip operation.
 */
export const removeBloodlineFromPoolAtomically = async ({
  client,
  userId,
  bloodlineId,
  now,
}: RemoveBloodlineFromPoolParams) => {
  const notEquipped = sql`NOT EXISTS (SELECT 1 FROM ${userData} WHERE ${userData.userId} = ${userId} AND ${userData.bloodlineId} = ${bloodlineId})`;
  const [deleteResult, updateResult] = await Promise.all([
    deleteBloodlineRollsForRemoveBloodlineFromPoolAtomically(
      client,
      userId,
      bloodlineId,
      notEquipped,
    ),
    updateBloodlineRollsForRemoveBloodlineFromPoolAtomically(
      client,
      now,
      userId,
      bloodlineId,
      notEquipped,
    ),
  ]);
  return deleteResult.rowsAffected + updateResult.rowsAffected > 0;
};

type ActiveNpcQuestParams = {
  client: DrizzleClient;
  userId: string;
  questId: string;
};

/** Claims the single "active NPC mission" slot. true iff the slot was free and is now ours. */
export const claimActiveNpcQuest = async ({
  client,
  userId,
  questId,
}: ActiveNpcQuestParams) => {
  const res = await updateUserDataForClaimActiveNpcQuest(client, questId, userId);
  return res.rowsAffected === 1;
};

/**
 * Status to restore on player rows caught by a failed battle-start claim (the
 * `initiateBattle` CAS rollback). Rows claimed out of a queue must return to
 * their queue status rather than AWAKE, so the queue entry they came from stays
 * usable:
 * - RANKED_PVP rows were claimed from QUEUED and only return to QUEUED while
 *   their claimed `rankedPvpQueue` row still exists (the user may have left the queue).
 * - TERRITORY_WAR rows return to QUEUED while their membership still owns the
 *   reserved lobby and its event remains active.
 * - Every other battle type returns to AWAKE; CLAN_BATTLE and RAID also claim
 *   QUEUED rows, but their own flows manage those queue entries.
 */
export const battleClaimRollbackStatus = (
  client: DrizzleClient,
  battleType: BattleType,
  clanBattle?: { queueId: string; battleId: string },
) => {
  if (battleType === "TERRITORY_WAR" && clanBattle) {
    return sql`CASE WHEN ${exists(
      selectMpvpBattleUserForBattleClaimRollbackStatus(client, clanBattle),
    )} THEN "QUEUED" ELSE "AWAKE" END`;
  }
  if (battleType === "RANKED_PVP") {
    return sql`CASE WHEN ${exists(
      selectClaimedRankedQueueEntry(client, userData.userId),
    )} THEN "QUEUED" ELSE "AWAKE" END`;
  }
  return "AWAKE" as const;
};

type ReservePityCreditParams = {
  client: DrizzleClient;
  rollId: string;
  expectedPityRolls: number;
};

/**
 * Reserve one pity credit before granting: increments `pityRolls` only while the row still
 * shows the count the caller read. A request racing on a stale count matches zero rows and
 * loses, so a single earned credit can never fund two grants. Reserve BEFORE the grant so the
 * loser aborts without touching the equipped-mode slot.
 */
export const reservePityCredit = async ({
  client,
  rollId,
  expectedPityRolls,
}: ReservePityCreditParams) => {
  const result = await updateBloodlineRollsForReservePityCredit(
    client,
    rollId,
    expectedPityRolls,
  );
  return result.rowsAffected === 1;
};

/**
 * Await lazy Drizzle query builders in order: PlanetScale sessions serialize statements.
 * Pass unstarted builders, not eager promises; already-running work cannot be sequenced here.
 * Independent autocommit reads should still use Promise.all.
 */
export const queryInTransaction = async <const T extends readonly unknown[]>(
  queries: T,
): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> => {
  const results: unknown[] = [];
  for (const query of queries) results.push(await query);
  return results as { -readonly [K in keyof T]: Awaited<T[K]> };
};

/**
 * Run deferred queries or writes, retaining parallel phases for ordinary callers.
 * Transaction callers must pass unevaluated tasks: each statement starts after the previous
 * statement supplies the driver's next session token. Results preserve the input tuple order.
 */
export const runRewardTasks =
  (inTransaction: boolean) =>
  async <T extends readonly (() => unknown)[]>(
    tasks: readonly [...T],
  ): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> => {
    if (!inTransaction)
      return Promise.all(tasks.map((task) => task())) as Promise<{
        [K in keyof T]: Awaited<ReturnType<T[K]>>;
      }>;
    const results: unknown[] = [];
    for (const task of tasks) results.push(await task());
    return results as { [K in keyof T]: Awaited<ReturnType<T[K]>> };
  };
