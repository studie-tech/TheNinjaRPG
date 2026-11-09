/**
 * Database access for bank; authorization and transaction scopes stay in callers.
 */
import {
  and,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  lte,
  or,
  type SQL,
  sql,
  sum,
} from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { RYO_CAP } from "@/drizzle/constants";
import { bankTransfers, dailyBankInterest, userData } from "@/drizzle/schema";
import { serverError } from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { missingUserMessage } from "@/server/utils/sentry";
import { getBankInterestDateRange } from "@/utils/time";

/**
 * Post-CAS pocket/bank read. Concurrent grants can change either column after
 * the increment, so callers cannot derive balances from the pre-update snapshot.
 * Only these two columns are returned to the UI.
 */
export const fetchUserBalances = async (client: DrizzleClient, userId: string) => {
  const user = await client.query.userData.findFirst({
    where: eq(userData.userId, userId),
    columns: { money: true, bank: true },
  });
  if (!user) {
    throw serverError("NOT_FOUND", missingUserMessage(userId));
  }
  return user;
};

/** Table alias for receiver joins, keeping its columns distinct from other participants. */
const receiver = alias(userData, "receiver");

/** Table alias for sender joins, keeping its columns distinct from other participants. */
const sender = alias(userData, "sender");

/** Build the `userData` update for `transfer`, setting `bank`, using predicates on `userId` and `bank`. */
export const updateUserDataForTransfer = (
  client: Pick<DrizzleClient, "update">,
  value: number,
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({ bank: sql`${userData.bank} - ${value}` })
    .where(and(eq(userData.userId, ctx.userId), gte(userData.bank, value)));

/** Build an atomic bank balance increment for one user. */
export const incrementUserBank = (
  client: Pick<DrizzleClient, "update">,
  amount: number,
  userId: string,
) =>
  client
    .update(userData)
    .set({ bank: sql`${userData.bank} + ${amount}` })
    .where(eq(userData.userId, userId));

/** Build the `bankTransfers` insert for `transfer`. */
export const insertBankTransfersForTransfer = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: { targetId: string },
  value: number,
) =>
  client.insert(bankTransfers).values({
    senderId: ctx.userId,
    receiverId: input.targetId,
    amount: value,
  });

/** Build the `bankTransfers` selection for `getGraph`, using predicates on `createdAt`. */
export const selectBankTransfersForGetGraph = (
  client: Pick<DrizzleClient, "select">,
  cutoffDate: Date,
  minAmount: number,
) =>
  client
    .select({
      senderId: bankTransfers.senderId,
      receiverId: bankTransfers.receiverId,
      senderUsername: sender.username,
      receiverUsername: receiver.username,
      senderAvatar: sender.avatar,
      receiverAvatar: receiver.avatar,
      total: sum(bankTransfers.amount).mapWith(Number),
    })
    .from(bankTransfers)
    .innerJoin(sender, eq(bankTransfers.senderId, sender.userId))
    .innerJoin(receiver, eq(bankTransfers.receiverId, receiver.userId))
    .where(gte(bankTransfers.createdAt, cutoffDate))
    .groupBy(bankTransfers.senderId, bankTransfers.receiverId)
    .having(({ total }) => gte(total, minAmount))
    .limit(50);

/** Build the `bankTransfers` listing for `getTransfers`, using predicates on `senderId` and `receiverId`. */
export const listBankTransfersForGetTransfers = (
  client: Pick<DrizzleClient, "query">,
  input: {
    senderId?: undefined | null | string;
    receiverId?: undefined | null | string;
    limit: number;
  },
  skip: number,
) =>
  client.query.bankTransfers.findMany({
    where: or(
      input.senderId ? eq(bankTransfers.senderId, input.senderId) : undefined,
      input.receiverId ? eq(bankTransfers.receiverId, input.receiverId) : undefined,
    ),
    with: {
      sender: { columns: { username: true } },
      receiver: { columns: { username: true } },
    },
    offset: skip,
    limit: input.limit,
    orderBy: desc(bankTransfers.createdAt),
  });

/** Build the `dailyBankInterest` listing for `getPendingInterest`, using the configured predicates. */
export const listDailyBankInterestForGetPendingInterest = (
  client: Pick<DrizzleClient, "query">,

  ctx: { userId: string },
) =>
  client.query.dailyBankInterest.findMany({
    where: pendingInterestWhere(ctx.userId),
    columns: {
      id: true,
      date: true,
      amount: true,
    },
  });

/** Build the `userData` update for `transferRyo`, using predicates on `userId`, `money`, `bank`. */
export const updateUserDataForTransferRyo = (
  client: Pick<DrizzleClient, "update">,
  fromPocket: false | true,
  value: number,
  userId: string,
) =>
  client
    .update(userData)
    .set(
      fromPocket
        ? {
            money: sql`${userData.money} - ${value}`,
            bank: sql`${userData.bank} + ${value}`,
          }
        : {
            money: sql`${userData.money} + ${value}`,
            bank: sql`${userData.bank} - ${value}`,
          },
    )
    .where(
      and(
        eq(userData.userId, userId),
        gte(fromPocket ? userData.money : userData.bank, value),
      ),
    );

/** Build the account locking lookup used by the caller transaction when claiming bank interest. */
export const selectUserDataForClaimBankInterest = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
) =>
  client
    .select({
      bank: userData.bank,
      isBanned: userData.isBanned,
      status: userData.status,
    })
    .from(userData)
    .where(eq(userData.userId, userId))
    .for("update");

/** Build the pending-interest locking lookup; keep it on the same caller transaction as the account claim. */
export const selectDailyBankInterestForClaimBankInterest = (
  client: Pick<DrizzleClient, "select">,

  userId: string,
) =>
  client
    .select({ id: dailyBankInterest.id, amount: dailyBankInterest.amount })
    .from(dailyBankInterest)
    .where(pendingInterestWhere(userId))
    .for("update");

/**
 * Build the `dailyBankInterest` update for `claimBankInterest`, setting `claimed`,
 * using predicates on `userId`, `claimed`, `id`.
 */
export const updateDailyBankInterestForClaimBankInterest = (
  client: Pick<DrizzleClient, "update">,
  userId: string,
  pending: Pick<import("@/drizzle/schema").RecruitmentRewards, "id" | "amount">[],
) =>
  client
    .update(dailyBankInterest)
    .set({ claimed: true })
    .where(
      and(
        eq(dailyBankInterest.userId, userId),
        eq(dailyBankInterest.claimed, false),
        inArray(
          dailyBankInterest.id,
          pending.map((record) => record.id),
        ),
      ),
    );

/** Build the `userData` update for `claimBankInterest`, setting `bank`, using predicates on `userId` and `bank`. */
export const updateUserDataForClaimBankInterest = (
  client: Pick<DrizzleClient, "update">,
  amount: number,
  userId: string,
  user: { bank: number },
) =>
  client
    .update(userData)
    .set({ bank: sql`${userData.bank} + ${amount}` })
    .where(and(eq(userData.userId, userId), eq(userData.bank, user.bank)));

/** Build the `userData` selection for `GET`, using predicates on `villageId` and `bank`. */
export const selectUserDataForGET = (
  client: Pick<DrizzleClient, "select">,
  village: { id: string },
  c: { where: undefined | SQL<unknown> },
) =>
  client
    .select({
      userId: userData.userId,
      bank: userData.bank,
    })
    .from(userData)
    .where(
      and(
        eq(userData.villageId, village.id),
        gt(userData.bank, 0),
        lt(userData.bank, RYO_CAP),
        c.where,
      ),
    );

/** Build the `dailyBankInterest` insert for `GET`, updating duplicate keys. */
export const insertDailyBankInterestForGET = (
  client: Pick<DrizzleClient, "insert">,
  batch: Pick<
    import("@/drizzle/schema").DailyBankInterest,
    "date" | "id" | "userId" | "amount" | "interestPercent"
  >[],
) =>
  client
    .insert(dailyBankInterest)
    .values(batch)
    .onDuplicateKeyUpdate({
      set: {
        id: sql`id`,
      },
    });

/** Expiry is enforced on reads and claims independently of background cleanup. */
const pendingInterestWhere = (userId: string) => {
  const { oldestDate, today } = getBankInterestDateRange();
  return and(
    eq(dailyBankInterest.userId, userId),
    eq(dailyBankInterest.claimed, false),
    gte(dailyBankInterest.date, oldestDate),
    lte(dailyBankInterest.date, today),
  );
};
