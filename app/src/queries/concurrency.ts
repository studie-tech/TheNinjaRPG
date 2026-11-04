/**
 * Database access for concurrency; authorization and transaction scopes stay in callers.
 */
import {
  and,
  eq,
  getTableColumns,
  gt,
  gte,
  isNull,
  lt,
  lte,
  ne,
  type SQL,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import type { AnyMySqlColumn, MySqlTable } from "drizzle-orm/mysql-core";
import { nanoid } from "nanoid";
import {
  actionLog,
  bloodlineRolls,
  mpvpBattleQueue,
  mpvpBattleUser,
  rankedPvpQueue,
  territoryWar,
  userData,
  userItem,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { clampActionLogText } from "@/utils/actionLog";

/** SQL twin of `getNextUserSnapshotAt`: it has to advance a CAS snapshot the same way. */
export const nextSnapshotSql = (column: AnyMySqlColumn) =>
  sql`GREATEST(NOW(3), TIMESTAMPADD(MICROSECOND, 1000, ${column}))`;

/**
 * INSERT ... SELECT of only the given columns, written when `guard` holds. Drizzle's builder
 * requires every table column for SELECT, including defaults, so this is parameterized SQL.
 */
export const insertValuesWhere = (
  client: Pick<DrizzleClient, "execute">,
  table: MySqlTable,
  values: Record<string, unknown>,
  guard: SQL | undefined,
  { ignoreDuplicate = false } = {},
) => {
  const columns = getTableColumns(table);
  const inserted = Object.entries(values).flatMap(([key, value]) => {
    const column = columns[key];
    return column ? [{ column, value }] : [];
  });
  return client.execute(sql`
    INSERT INTO ${table} (${sql.join(
      inserted.map(({ column }) => sql.identifier(column.name)),
      sql`, `,
    )})
    SELECT ${sql.join(
      inserted.map(({ column, value }) => sql.param(value ?? null, column)),
      sql`, `,
    )}
    WHERE ${guard}
    ${ignoreDuplicate ? sql`ON DUPLICATE KEY UPDATE id = id` : sql``}
  `);
};

/** Build the `userData` lookup for `enforceRateLimit`, selecting `money` and `bank`. */
export const fetchUserDataForEnforceRateLimit = (
  client: Pick<DrizzleClient, "query">,
  context: { userId: string },
) =>
  client.query.userData.findFirst({
    columns: { money: true, bank: true },
    where: eq(userData.userId, context.userId),
  });

/**
 * Build the `userData` update for `enforceRateLimit`, using predicates on `userId`.
 * Always counts the infraction; debits the exact (pre-computed) fines, never below 0.
 */
export const updateUserDataForEnforceRateLimit = (
  client: Pick<DrizzleClient, "update">,
  context: { userId: string; moneyFine: number; bankFine: number },
) =>
  client
    .update(userData)
    .set({
      movedTooFastCount: sql`${userData.movedTooFastCount} + 1`,
      ...(context.moneyFine > 0
        ? { money: sql`GREATEST(${userData.money} - ${context.moneyFine}, 0)` }
        : {}),
      ...(context.bankFine > 0
        ? { bank: sql`GREATEST(${userData.bank} - ${context.bankFine}, 0)` }
        : {}),
    })
    .where(eq(userData.userId, context.userId));

/** Build the `actionLog` insert recording a `enforceRateLimit` fine so staff can see it. */
export const insertActionLogForEnforceRateLimit = (
  client: Pick<DrizzleClient, "insert">,
  context: { userId: string; path: string; moneyFine: number; bankFine: number },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: context.userId,
    tableName: "user",
    changes: [
      `Rate-limit fine on ${context.path}: ${context.moneyFine} ryo from pocket, ${context.bankFine} ryo from bank`,
    ],
    relatedId: context.userId,
    relatedMsg: clampActionLogText(`Rate-limit fine on ${context.path}`),
    relatedValue: context.moneyFine + context.bankFine,
  });

/** Build the account snapshot CAS using updatedAt and caller guards; rowsAffected determines whether the claim succeeded. */
export const updateUserDataForClaimUserSnapshot = (
  client: Pick<DrizzleClient, "update">,
  claimedAt: Date,
  set: Record<string, unknown>,
  userId: string,
  updatedAt: Date,
  where: import("@/utils/typeutils").QueryCondition[],
) =>
  client
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

/**
 * Build the `userItem` update for `updateUserItemQuantityAtomically`, setting
 * `quantity`, using the configured predicates.
 */
export const updateUserItemForUpdateUserItemQuantityAtomically = (
  client: Pick<DrizzleClient, "update">,
  nextQuantity: number,
  where: undefined | SQL<unknown>,
) => client.update(userItem).set({ quantity: nextQuantity }).where(where);

/**
 * Build an item deletion using the caller predicate. Undefined leaves it unfiltered;
 * callers must supply ownership and quantity guards.
 */
export const deleteUserItemWhere = (
  client: Pick<DrizzleClient, "delete">,
  where: undefined | SQL<unknown>,
) => client.delete(userItem).where(where);

/** Build the `userItem` insert for `refundUserItemQuantityAtomically`, updating duplicate keys. */
export const insertUserItemForRefundUserItemQuantityAtomically = (
  client: Pick<DrizzleClient, "insert">,
  itemSnapshot: import("@/drizzle/schema").UserItem,
  quantity: number,
) =>
  client
    .insert(userItem)
    .values({ ...itemSnapshot, quantity })
    .onDuplicateKeyUpdate({
      set: {
        quantity: sql`IF(${userItem.quantity} >= 0, ${userItem.quantity} + ${quantity}, ${userItem.quantity})`,
      },
    });

/** Build the `userItem` insert for `refundUserItemQuantityAtomically`. */
export const insertUserItemForRefundUserItemQuantityAtomically2 = (
  client: Pick<DrizzleClient, "insert">,
  itemSnapshot: import("@/drizzle/schema").UserItem,
  quantity: number,
) =>
  client.insert(userItem).values({
    ...itemSnapshot,
    id: nanoid(),
    createdAt: new Date(),
    updatedAt: new Date(),
    equipped: "NONE",
    quantity,
  });

/**
 * Build the `userItem` update for `restoreStaleUserItemMergeClaims`, setting
 * `quantity` and `updatedAt`, using predicates on `userId`, `quantity`, `updatedAt`.
 */
export const updateUserItemForRestoreStaleUserItemMergeClaims = (
  client: Pick<DrizzleClient, "update">,
  userId: string,
  staleBefore: Date,
) =>
  client
    .update(userItem)
    .set({
      quantity: sql`-${userItem.quantity}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(userItem.userId, userId),
        lt(userItem.quantity, 0),
        lte(userItem.updatedAt, staleBefore),
      ),
    );

/**
 * Build the `userItem` deletion for `restoreStaleUserItemMergeClaims`, using
 * predicates on `userId`, `quantity`, `updatedAt`.
 */
export const deleteUserItemForRestoreStaleUserItemMergeClaims = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
  staleBefore: Date,
) =>
  client
    .delete(userItem)
    .where(
      and(
        eq(userItem.userId, userId),
        eq(userItem.quantity, 0),
        lte(userItem.updatedAt, staleBefore),
      ),
    );

/**
 * Build the `userData` update for `adjustSeichiSilverAtomically`, setting
 * `seichiSilver`, using predicates on `userId` and `seichiSilver`.
 */
export const updateUserDataForAdjustSeichiSilverAtomically = (
  client: Pick<DrizzleClient, "update">,
  delta: number,
  userId: string,
) =>
  client
    .update(userData)
    .set({ seichiSilver: sql`${userData.seichiSilver} + ${delta}` })
    .where(
      and(
        eq(userData.userId, userId),
        delta < 0 ? gte(userData.seichiSilver, -delta) : undefined,
      ),
    );

/**
 * Build the `bloodlineRolls` deletion for `removeBloodlineFromPoolAtomically`, using
 * predicates on `userId`, `bloodlineId`, `type`.
 */
export const deleteBloodlineRollsForRemoveBloodlineFromPoolAtomically = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
  bloodlineId: string,
  notEquipped: SQL<unknown>,
) =>
  client
    .delete(bloodlineRolls)
    .where(
      and(
        eq(bloodlineRolls.userId, userId),
        eq(bloodlineRolls.bloodlineId, bloodlineId),
        ne(bloodlineRolls.type, "NATURAL"),
        notEquipped,
      ),
    );

/**
 * Build the `bloodlineRolls` update for `removeBloodlineFromPoolAtomically`, setting
 * `bloodlineId` and `updatedAt`, using predicates on `userId`, `bloodlineId`, `type`.
 */
export const updateBloodlineRollsForRemoveBloodlineFromPoolAtomically = (
  client: Pick<DrizzleClient, "update">,
  now: Date,
  userId: string,
  bloodlineId: string,
  notEquipped: SQL<unknown>,
) =>
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
    );

/**
 * Build the `userData` update for `claimActiveNpcQuest`, setting `activeNpcQuestId`,
 * using predicates on `userId` and `activeNpcQuestId`.
 */
export const updateUserDataForClaimActiveNpcQuest = (
  client: Pick<DrizzleClient, "update">,
  questId: string,
  userId: string,
) =>
  client
    .update(userData)
    .set({ activeNpcQuestId: questId })
    .where(and(eq(userData.userId, userId), isNull(userData.activeNpcQuestId)));

/**
 * Releases the slot — CONDITIONAL on the specific questId so a concurrent interaction at a
 * different NPC can't clear a slot another NPC legitimately owns.
 */
export const clearActiveNpcQuest = ({
  client,
  userId,
  questId,
}: {
  client: DrizzleClient;
  userId: string;
  questId: string;
}) =>
  client
    .update(userData)
    .set({ activeNpcQuestId: null })
    .where(and(eq(userData.userId, userId), eq(userData.activeNpcQuestId, questId)));

/**
 * Build the `mpvpBattleUser` selection for `battleClaimRollbackStatus`, including
 * predicates on `userId`, `id`, `battleId`.
 */
export const selectMpvpBattleUserForBattleClaimRollbackStatus = (
  client: Pick<DrizzleClient, "select">,
  clanBattle: { queueId: string; battleId: string },
) =>
  client
    .select({ one: sql`1` })
    .from(mpvpBattleUser)
    .innerJoin(mpvpBattleQueue, eq(mpvpBattleQueue.id, mpvpBattleUser.clanBattleId))
    .innerJoin(territoryWar, eq(territoryWar.id, mpvpBattleQueue.territoryWarId))
    .where(
      and(
        eq(mpvpBattleUser.userId, userData.userId),
        eq(mpvpBattleQueue.id, clanBattle.queueId),
        eq(mpvpBattleQueue.battleId, clanBattle.battleId),
        eq(mpvpBattleQueue.battleType, "TERRITORY_WAR"),
        isNull(territoryWar.resolvedAt),
        lte(territoryWar.startsAt, sql`NOW(3)`),
        gt(territoryWar.endsAt, sql`NOW(3)`),
      ),
    );

/** Build the EXISTS subquery for a user holding a claimed ranked-queue entry. */
export const selectClaimedRankedQueueEntry = (
  client: Pick<DrizzleClient, "select">,
  userId: string | SQLWrapper,
) =>
  client
    .select({ one: sql`1` })
    .from(rankedPvpQueue)
    .where(and(eq(rankedPvpQueue.userId, userId), eq(rankedPvpQueue.hasClaimed, true)));

/** Build the EXISTS subquery for a user sitting in a clan lobby without a winner. */
export const selectUnresolvedClanLobbyEntry = (
  client: Pick<DrizzleClient, "select">,
  userId: string | SQLWrapper,
) =>
  client
    .select({ one: sql`1` })
    .from(mpvpBattleUser)
    .innerJoin(mpvpBattleQueue, eq(mpvpBattleUser.clanBattleId, mpvpBattleQueue.id))
    .where(and(eq(mpvpBattleUser.userId, userId), isNull(mpvpBattleQueue.winnerId)));

/**
 * Build the `table` update for `reservePityCredit`, setting `pityRolls` and
 * `updatedAt`, using the configured predicates.
 */
export const updateTableForReservePityCredit = (
  client: Pick<DrizzleClient, "update">,
  table: typeof import("@/drizzle/schema").bloodlineRolls,
  rollId: string,
  expectedPityRolls: number,
) =>
  client
    .update(table)
    .set({ pityRolls: sql`${table.pityRolls} + 1`, updatedAt: new Date() })
    .where(and(eq(table.id, rollId), eq(table.pityRolls, expectedPityRolls)));

/**
 * Return a credit reserved by `reservePityCredit` when the grant that followed it did not apply.
 * Callers MUST invoke this only when the grant's own compare-and-swap rejected (rowsAffected 0,
 * surfaced as a TRPCError from the grant helper) — NOT when a post-CAS side-effect write in that
 * helper throws, since those run only after the grant has committed and refunding then would hand
 * back a credit that already funded a grant. Each successful reservation is refunded at most once,
 * so `pityRolls` returns to the count the caller read without underflowing. The `pityRolls > 0`
 * predicate is a floor rather than the correctness mechanism: a misuse or duplicated refund becomes
 * a no-op instead of driving the (signed) column negative.
 */
export const refundPityCredit = async ({
  client,
  table,
  rollId,
}: {
  client: DrizzleClient;
  table: typeof bloodlineRolls;
  rollId: string;
}) => {
  await client
    .update(table)
    .set({ pityRolls: sql`${table.pityRolls} - 1`, updatedAt: new Date() })
    .where(and(eq(table.id, rollId), gt(table.pityRolls, 0)));
};
