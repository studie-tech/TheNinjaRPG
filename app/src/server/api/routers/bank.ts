import { z } from "zod";
import { RYO_CAP } from "@/drizzle/constants";

import { bankAccessBlockMessage, clampToRyoCap } from "@/libs/bank";
import {
  fetchUserBalances,
  incrementUserBank,
  insertBankTransfersForTransfer,
  listBankTransfersForGetTransfers,
  listDailyBankInterestForGetPendingInterest,
  selectBankTransfersForGetGraph,
  selectDailyBankInterestForClaimBankInterest,
  selectUserDataForClaimBankInterest,
  updateDailyBankInterestForClaimBankInterest,
  updateUserDataForClaimBankInterest,
  updateUserDataForTransfer,
  updateUserDataForTransferRyo,
} from "@/queries/bank";
import { fetchUser } from "@/queries/profile";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { offsetPage } from "@/server/utils/pagination";

export const bankRouter = createTRPCRouter({
  toBank: protectedProcedure
    .meta({ mcp: { description: "Deposit ryo from pocket to bank" } })
    .input(z.object({ amount: z.number().min(0) }))
    .output(
      baseServerResponse.extend({
        data: z.object({ bank: z.number(), money: z.number() }).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return transferRyo(ctx.drizzle, ctx.userId, input.amount, "toBank");
    }),
  toPocket: protectedProcedure
    .meta({ mcp: { description: "Withdraw ryo from bank to pocket" } })
    .input(z.object({ amount: z.number().min(0) }))
    .output(
      baseServerResponse.extend({
        data: z.object({ bank: z.number(), money: z.number() }).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return transferRyo(ctx.drizzle, ctx.userId, input.amount, "toPocket");
    }),
  transfer: protectedProcedure
    .meta({
      mcp: {
        description: "Transfer ryo from your bank to another user",
      },
    })
    .input(z.object({ amount: z.number().min(0), targetId: z.string() }))
    .output(
      baseServerResponse.extend({
        data: z.object({ bank: z.number() }).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Query
      const [target, user] = await Promise.all([
        fetchUser(ctx.drizzle, input.targetId),
        fetchUser(ctx.drizzle, ctx.userId),
      ]);
      // Derived
      const value = clampToRyoCap(target.bank, input.amount);
      // Guard
      if (value === null) return errorResponse("Ryo cap reached");
      if (user.bank < value) return errorResponse("Not enough money in bank");
      const block = bankAccessBlockMessage(user);
      if (block) return errorResponse(block);
      // Update
      const result = await updateUserDataForTransfer(ctx.drizzle, value, ctx);
      if (result.rowsAffected === 0) return errorResponse("Not enough money in bank");
      await Promise.all([
        incrementUserBank(ctx.drizzle, value, input.targetId),
        insertBankTransfersForTransfer(ctx.drizzle, ctx, input, value),
      ]);
      const updatedUser = await fetchUserBalances(ctx.drizzle, ctx.userId);
      return {
        success: true,
        message: `Successfully transferred ${value} ryo to ${target.username}`,
        data: { bank: updatedUser.bank },
      };
    }),
  getGraph: protectedProcedure
    .meta({ mcp: { description: "Get bank transfer graph data" } })
    .input(
      z
        .object({
          minAmount: z.number().min(1).prefault(100),
          dayLimit: z.number().min(1).max(365).prefault(30),
        })
        .prefault({}),
    )
    .query(async ({ ctx, input }) => {
      const { minAmount, dayLimit } = input;
      const cutoffDate = new Date(Date.now() - dayLimit * 24 * 60 * 60 * 1000);

      const transfers = await selectBankTransfersForGetGraph(
        ctx.drizzle,
        cutoffDate,
        minAmount,
      );
      return transfers;
    }),
  getTransfers: protectedProcedure
    .meta({
      mcp: { description: "Get paginated bank transfer history" },
    })
    .input(
      z.object({
        senderId: z.string().nullish(),
        receiverId: z.string().nullish(),
        cursor: z.number().nullish(),
        limit: z.number().min(1).max(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { skip, cursorAfter } = offsetPage(input);
      const transfers = await listBankTransfersForGetTransfers(
        ctx.drizzle,
        input,
        skip,
      );
      const nextCursor = cursorAfter(transfers);
      return {
        data: transfers,
        nextCursor: nextCursor,
      };
    }),
  getPendingInterest: protectedProcedure
    .meta({ mcp: { description: "Get pending daily bank interest" } })
    .query(async ({ ctx }) => {
      // Query
      const pendingInterest = await listDailyBankInterestForGetPendingInterest(
        ctx.drizzle,

        ctx,
      );
      // Derived
      const totalPending = pendingInterest.reduce(
        (sum, record) => sum + record.amount,
        0,
      );
      // Return
      return {
        totalPending,
        records: pendingInterest,
      };
    }),
  claimInterest: protectedProcedure
    .meta({
      mcp: { description: "Claim accumulated daily bank interest" },
    })
    .output(
      baseServerResponse.extend({
        data: z.object({ bank: z.number(), claimedAmount: z.number() }).optional(),
      }),
    )
    .mutation(async ({ ctx }) => {
      return claimBankInterest(ctx.drizzle, ctx.userId);
    }),
});

const transferRyo = async (
  client: DrizzleClient,
  userId: string,
  amount: number,
  direction: "toBank" | "toPocket",
) => {
  const user = await fetchUser(client, userId);
  const fromPocket = direction === "toBank";
  const capColumn = fromPocket ? user.bank : user.money;
  const sourceColumn = fromPocket ? user.money : user.bank;
  const value = clampToRyoCap(capColumn, amount);
  if (value === null) return errorResponse("Ryo cap reached");
  if (sourceColumn < value) {
    return errorResponse(
      fromPocket ? "Not enough money in pocket" : "Not enough money in bank",
    );
  }
  const block = bankAccessBlockMessage(user);
  if (block) return errorResponse(block);
  const result = await updateUserDataForTransferRyo(client, fromPocket, value, userId);
  if (result.rowsAffected === 0) {
    return errorResponse(
      fromPocket ? "Not enough money in pocket" : "Not enough money in bank",
    );
  }
  const updatedUser = await fetchUserBalances(client, userId);
  return {
    success: true,
    message: fromPocket
      ? `Successfully deposited ${value} ryo`
      : `Successfully withdrew ${value} ryo`,
    data: { bank: updatedUser.bank, money: updatedUser.money },
  };
};

export const claimBankInterest = (client: DrizzleClient, userId: string) =>
  retryOnDeadlock(() =>
    client.transaction(async (tx) => {
      // Serialize claims and balance changes; both the payout and receipts must commit together.
      const [user] = await selectUserDataForClaimBankInterest(tx, userId);
      if (!user) return errorResponse("User not found");
      const block = bankAccessBlockMessage(user);
      if (block) return errorResponse(block);

      const pending = await selectDailyBankInterestForClaimBankInterest(
        tx,

        userId,
      );
      if (pending.length === 0) return errorResponse("No pending interest to claim");
      const total = pending.reduce((sum, record) => sum + record.amount, 0);
      const amount = Math.min(total, RYO_CAP - user.bank);
      if (amount <= 0) return errorResponse("Bank already at capacity");

      const claimed = await updateDailyBankInterestForClaimBankInterest(
        tx,
        userId,
        pending,
      );
      if (claimed.rowsAffected !== pending.length) {
        throw new Error("Bank interest claim changed during transaction");
      }
      const credited = await updateUserDataForClaimBankInterest(
        tx,
        amount,
        userId,
        user,
      );
      if (credited.rowsAffected !== 1) {
        throw new Error("Bank balance changed during interest claim");
      }
      return {
        success: true,
        message: `Successfully claimed ${amount} ryo in bank interest!`,
        data: { bank: user.bank + amount, claimedAmount: amount },
      };
    }),
  );
