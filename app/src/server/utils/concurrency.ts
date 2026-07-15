/**
 * Optimistic concurrency helpers for MySQL / PlanetScale without traditional transactions.
 *
 * Use **row-level** `updateUserItemQuantityAtomically` / `consumeUserItemAtomically` when the
 * invariant is a single `userItem` stack (consume, craft materials). Use **`claimUserSnapshot`**
 * when multiple fields must commit together or you need to serialize whole-user mutations via
 * `userData.updatedAt` (quest tracker persistence, crafting start, natural bloodline roll).
 *
 * Failed CAS (`success: false` / `false`) means another request mutated the row first — return a
 * safe client error and retry-friendly message.
 */
import { and, eq, gte, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { bloodlineRolls, sageModeRolls, userData, userItem } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import type { QueryCondition } from "@/utils/typeutils";

type ClaimUserSnapshotParams = {
  client: DrizzleClient;
  userId: string;
  updatedAt: Date;
  where?: QueryCondition[];
  set?: Record<string, unknown>;
};

/** CAS on `user.updatedAt`: bumps `updatedAt` and merges optional `set` columns when still fresh. */
export const claimUserSnapshot = async ({
  client,
  userId,
  updatedAt,
  where = [],
  set = {},
}: ClaimUserSnapshotParams) => {
  const claimedAt = new Date();
  const result = await client
    .update(userData)
    .set({
      updatedAt: claimedAt,
      ...set,
    })
    .where(
      and(
        eq(userData.userId, userId),
        eq(userData.updatedAt, updatedAt),
        ...where.filter(Boolean),
      ),
    );

  return {
    success: result.rowsAffected === 1,
    claimedAt,
  };
};

type UpdateUserItemQuantityAtomicallyParams = {
  client: DrizzleClient;
  userId: string;
  userItemId: string;
  expectedQuantity: number;
  nextQuantity: number;
};

/**
 * Sets quantity when the row still matches `expectedQuantity`, or deletes the row when
 * `nextQuantity` is 0. Returns false if the row changed concurrently.
 */
export const updateUserItemQuantityAtomically = async ({
  client,
  userId,
  userItemId,
  expectedQuantity,
  nextQuantity,
}: UpdateUserItemQuantityAtomicallyParams) => {
  if (expectedQuantity <= 0 || nextQuantity < 0 || nextQuantity >= expectedQuantity) {
    return false;
  }

  const where = and(
    eq(userItem.id, userItemId),
    eq(userItem.userId, userId),
    eq(userItem.quantity, expectedQuantity),
  );

  const result =
    nextQuantity > 0
      ? await client.update(userItem).set({ quantity: nextQuantity }).where(where)
      : await client.delete(userItem).where(where);

  return result.rowsAffected === 1;
};

type ConsumeUserItemAtomicallyParams = {
  client: DrizzleClient;
  userId: string;
  userItemId: string;
  expectedQuantity: number;
};

/** Decrements quantity by 1 or deletes the stack when quantity was 1. */
export const consumeUserItemAtomically = async ({
  client,
  userId,
  userItemId,
  expectedQuantity,
}: ConsumeUserItemAtomicallyParams) => {
  return updateUserItemQuantityAtomically({
    client,
    userId,
    userItemId,
    expectedQuantity,
    nextQuantity: expectedQuantity - 1,
  });
};

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
  const result = await client
    .update(userData)
    .set({ seichiSilver: sql`${userData.seichiSilver} + ${delta}` })
    .where(
      and(
        eq(userData.userId, userId),
        delta < 0 ? gte(userData.seichiSilver, -delta) : undefined,
      ),
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
 * Known residual (the swap-vs-removal race the PR documents, viewed from this side): the DELETE and
 * UPDATE are two separate statements, not atomic relative to each other. If a concurrent `swapBloodline`
 * equips this bloodline in the gap between them, one statement's guard can pass while the other's blocks,
 * leaving a partial removal (one roll type gone, the other retained) while this helper still returns
 * true. We run them in PARALLEL on purpose: that gap is a sub-millisecond skew, whereas sequencing them
 * would widen it to a full round-trip. PlanetScale/Vitess has no cheap serialization primitive across
 * the two writes (interactive transactions are disallowed; advisory locks aren't viable on pooled
 * serverless), so fully closing this would require guarding the equip side in `swapBloodline` — out of
 * scope for this QoL change.
 */
export const removeBloodlineFromPoolAtomically = async ({
  client,
  userId,
  bloodlineId,
  now,
}: RemoveBloodlineFromPoolParams) => {
  const notEquipped = sql`NOT EXISTS (SELECT 1 FROM ${userData} WHERE ${userData.userId} = ${userId} AND ${userData.bloodlineId} = ${bloodlineId})`;
  const [deleteResult, updateResult] = await Promise.all([
    client
      .delete(bloodlineRolls)
      .where(
        and(
          eq(bloodlineRolls.userId, userId),
          eq(bloodlineRolls.bloodlineId, bloodlineId),
          ne(bloodlineRolls.type, "NATURAL"),
          notEquipped,
        ),
      ),
    client
      .update(bloodlineRolls)
      .set({ bloodlineId: null, updatedAt: now })
      .where(
        and(
          eq(bloodlineRolls.userId, userId),
          eq(bloodlineRolls.bloodlineId, bloodlineId),
          eq(bloodlineRolls.type, "NATURAL"),
          notEquipped,
        ),
      ),
  ]);
  return deleteResult.rowsAffected + updateResult.rowsAffected > 0;
};

type ReservePityCreditParams = {
  client: DrizzleClient;
  table: typeof bloodlineRolls | typeof sageModeRolls;
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
  table,
  rollId,
  expectedPityRolls,
}: ReservePityCreditParams) => {
  const result = await client
    .update(table)
    .set({ pityRolls: sql`${table.pityRolls} + 1`, updatedAt: new Date() })
    .where(and(eq(table.id, rollId), eq(table.pityRolls, expectedPityRolls)));
  return result.rowsAffected === 1;
};

type RefundPityCreditParams = {
  client: DrizzleClient;
  table: typeof bloodlineRolls | typeof sageModeRolls;
  rollId: string;
};

/**
 * Return a credit reserved by `reservePityCredit` when the grant that followed it did not apply.
 * Callers MUST invoke this only when the grant's own compare-and-swap rejected (rowsAffected 0,
 * surfaced as a TRPCError from the grant helper) — NOT when a post-CAS side-effect write in that
 * helper throws, since those run only after the grant has committed and refunding then would hand
 * back a credit that already funded a grant. Each successful reservation is refunded at most once,
 * so `pityRolls` returns to the count the caller read without underflowing.
 */
export const refundPityCredit = async ({
  client,
  table,
  rollId,
}: RefundPityCreditParams) => {
  await client
    .update(table)
    .set({ pityRolls: sql`${table.pityRolls} - 1`, updatedAt: new Date() })
    .where(eq(table.id, rollId));
};

type InsertNaturalSageRollParams = {
  client: DrizzleClient;
  userId: string;
};

/**
 * Record a failed natural sage-mode roll — a `type='NATURAL'` marker row that consumes the user's
 * one-time chance — ONLY while the user still owns no sage mode. The `INSERT ... SELECT ... WHERE
 * sageModeId IS NULL` is a single atomic statement, so a purchase/swap that grants a mode in the
 * window before this runs blocks the insert (0 rows) and the free roll is preserved rather than
 * burned. Raw SQL because Drizzle's `.insert().select()` builder rejects a partial column set;
 * mirrors the `raids.ts` precedent. Returns false when the slot was taken concurrently.
 */
export const insertNaturalSageRollIfSlotFree = async ({
  client,
  userId,
}: InsertNaturalSageRollParams) => {
  const result = await client.execute(sql`
    INSERT INTO ${sageModeRolls} (id, userId, used)
    SELECT ${nanoid()}, ${userData.userId}, 0
    FROM ${userData}
    WHERE ${userData.userId} = ${userId} AND ${userData.sageModeId} IS NULL
  `);
  return result.rowsAffected === 1;
};
