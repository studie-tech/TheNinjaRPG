import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { errorResponse, baseServerResponse } from "../trpc";
import { fetchUser } from "@/routers/profile";
import { eq, or, and, gte, sql, desc } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { userData, bankTransfers, dailyBankInterest } from "@/drizzle/schema";
import { RYO_CAP } from "@/drizzle/constants";

export const bankRouter = createTRPCRouter({
  toBank: protectedProcedure
    .input(z.object({ amount: z.number().min(0) }))
    .output(
      baseServerResponse.extend({
        data: z.object({ bank: z.number(), money: z.number() }).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Derived
      const raw = input.amount;
      const overCap = user.bank + raw > RYO_CAP;
      const value = overCap ? RYO_CAP - user.bank : raw;
      // Guard
      if (value <= 0 && overCap) return errorResponse("Ryo cap reached");
      if (user.money < value) return errorResponse("Not enough money in pocket");
      if (user.isBanned) return errorResponse("You are banned");
      if (user.status === "BATTLE")
        return errorResponse("Cannot access bank while in combat");
      // Update
      const result = await ctx.drizzle
        .update(userData)
        .set({
          money: sql`${userData.money} - ${value}`,
          bank: sql`${userData.bank} + ${value}`,
        })
        .where(and(eq(userData.userId, ctx.userId), gte(userData.money, value)));
      if (result.rowsAffected === 0) {
        return { success: false, message: "Not enough money in pocket" };
      }
      // Re-fetch user to get accurate balances after concurrent updates
      const updatedUser = await fetchUser(ctx.drizzle, ctx.userId);
      return {
        success: true,
        message: `Successfully deposited ${value} ryo`,
        data: { bank: updatedUser.bank, money: updatedUser.money },
      };
    }),
  toPocket: protectedProcedure
    .input(z.object({ amount: z.number().min(0) }))
    .output(
      baseServerResponse.extend({
        data: z.object({ bank: z.number(), money: z.number() }).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Derived
      const raw = input.amount;
      const overCap = user.money + raw > RYO_CAP;
      const value = overCap ? RYO_CAP - user.money : raw;
      // Guard
      if (value <= 0 && overCap) return errorResponse("Ryo cap reached");
      if (user.bank < value) return errorResponse("Not enough money in bank");
      if (user.isBanned) return errorResponse("You are banned");
      if (user.status === "BATTLE")
        return errorResponse("Cannot access bank while in combat");
      // Update
      const result = await ctx.drizzle
        .update(userData)
        .set({
          money: sql`${userData.money} + ${value}`,
          bank: sql`${userData.bank} - ${value}`,
        })
        .where(and(eq(userData.userId, ctx.userId), gte(userData.bank, value)));
      if (result.rowsAffected === 0) {
        return { success: false, message: "Not enough money in bank" };
      }
      // Re-fetch user to get accurate balances after concurrent updates
      const updatedUser = await fetchUser(ctx.drizzle, ctx.userId);
      return {
        success: true,
        message: `Successfully withdrew ${value} ryo`,
        data: { bank: updatedUser.bank, money: updatedUser.money },
      };
    }),
  transfer: protectedProcedure
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
      const raw = input.amount;
      const overCap = target.bank + raw > RYO_CAP;
      const value = overCap ? RYO_CAP - target.bank : raw;
      // Guard
      if (value <= 0 && overCap) return errorResponse("Ryo cap reached");
      if (user.bank < value) return errorResponse("Not enough money in bank");
      if (user.isBanned) return errorResponse("You are banned");
      if (user.status === "BATTLE")
        return errorResponse("Cannot access bank while in combat");
      // Update
      const result = await ctx.drizzle
        .update(userData)
        .set({ bank: sql`${userData.bank} - ${value}` })
        .where(and(eq(userData.userId, ctx.userId), gte(userData.bank, value)));
      if (result.rowsAffected === 0) return errorResponse("Not enough money in bank");
      await Promise.all([
        ctx.drizzle
          .update(userData)
          .set({ bank: sql`${userData.bank} + ${value}` })
          .where(eq(userData.userId, input.targetId)),
        ctx.drizzle.insert(bankTransfers).values({
          senderId: ctx.userId,
          receiverId: input.targetId,
          amount: value,
        }),
      ]);
      // Re-fetch user to get accurate bank balance after concurrent updates
      const updatedUser = await fetchUser(ctx.drizzle, ctx.userId);
      return {
        success: true,
        message: `Successfully transferred ${value} ryo to ${target.username}`,
        data: { bank: updatedUser.bank },
      };
    }),
  getGraph: protectedProcedure
    .input(
      z
        .object({
          minAmount: z.number().min(1).default(100),
          dayLimit: z.number().min(1).max(365).default(30),
        })
        .optional()
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const { minAmount = 100, dayLimit = 30 } = input;
      const cutoffDate = new Date(Date.now() - dayLimit * 24 * 60 * 60 * 1000);

      const sender = alias(userData, "sender");
      const receiver = alias(userData, "receiver");
      const transfers = await ctx.drizzle
        .select({
          senderId: bankTransfers.senderId,
          receiverId: bankTransfers.receiverId,
          senderUsername: sender.username,
          receiverUsername: receiver.username,
          senderAvatar: sender.avatar,
          receiverAvatar: receiver.avatar,
          total: sql<number>`SUM(${bankTransfers.amount})`,
        })
        .from(bankTransfers)
        .innerJoin(sender, eq(bankTransfers.senderId, sender.userId))
        .innerJoin(receiver, eq(bankTransfers.receiverId, receiver.userId))
        .where(gte(bankTransfers.createdAt, cutoffDate))
        .groupBy(bankTransfers.senderId, bankTransfers.receiverId)
        .having(sql`SUM(${bankTransfers.amount}) >= ${minAmount}`)
        .limit(50);
      return transfers;
    }),
  getTransfers: protectedProcedure
    .input(
      z.object({
        senderId: z.string().optional().nullish(),
        receiverId: z.string().optional().nullish(),
        cursor: z.number().nullish(),
        limit: z.number().min(1).max(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      const currentCursor = input.cursor ? input.cursor : 0;
      const skip = currentCursor * input.limit;
      const transfers = await ctx.drizzle.query.bankTransfers.findMany({
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
      const nextCursor = transfers.length < input.limit ? null : currentCursor + 1;
      return {
        data: transfers,
        nextCursor: nextCursor,
      };
    }),
  getPendingInterest: protectedProcedure.query(async ({ ctx }) => {
    // Query
    const pendingInterest = await ctx.drizzle.query.dailyBankInterest.findMany({
      where: and(
        eq(dailyBankInterest.userId, ctx.userId),
        eq(dailyBankInterest.claimed, false),
      ),
      columns: {
        id: true,
        date: true,
        amount: true,
      },
    });
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
    .output(
      baseServerResponse.extend({
        data: z.object({ bank: z.number(), claimedAmount: z.number() }).optional(),
      }),
    )
    .mutation(async ({ ctx }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);

      // Guard
      if (user.isBanned) return errorResponse("You are banned");
      if (user.status === "BATTLE")
        return errorResponse("Cannot access bank while in combat");

      // Get all pending interest
      const pendingInterest = await ctx.drizzle.query.dailyBankInterest.findMany({
        where: and(
          eq(dailyBankInterest.userId, ctx.userId),
          eq(dailyBankInterest.claimed, false),
        ),
      });

      if (pendingInterest.length === 0) {
        return errorResponse("No pending interest to claim");
      }

      // Calculate total amount to claim
      const totalAmount = pendingInterest.reduce(
        (sum, record) => sum + record.amount,
        0,
      );

      // Check if claiming would exceed RYO_CAP
      const finalAmount = Math.min(totalAmount, RYO_CAP - user.bank);

      // Guard
      if (finalAmount <= 0) {
        return errorResponse("Bank already at capacity");
      }

      // Update user's bank balance and mark interest as claimed
      await Promise.all([
        ctx.drizzle
          .update(userData)
          .set({ bank: sql`${userData.bank} + ${finalAmount}` })
          .where(eq(userData.userId, ctx.userId)),
        ctx.drizzle
          .update(dailyBankInterest)
          .set({ claimed: true })
          .where(
            and(
              eq(dailyBankInterest.userId, ctx.userId),
              eq(dailyBankInterest.claimed, false),
            ),
          ),
      ]);

      // Re-fetch user to get accurate bank balance after concurrent updates
      const updatedUser = await fetchUser(ctx.drizzle, ctx.userId);

      return {
        success: true,
        message: `Successfully claimed ${finalAmount} ryo in bank interest!`,
        data: {
          bank: updatedUser.bank,
          claimedAmount: finalAmount,
        },
      };
    }),
});
