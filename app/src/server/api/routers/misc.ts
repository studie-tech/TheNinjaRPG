import { z } from "zod";
import path from "path";
import TextToSVG from "text-to-svg";
import { randomString } from "@/libs/random";
import { sql, and, desc, eq, inArray, gte, like, gt, lt } from "drizzle-orm";
import {
  notification,
  userData,
  gameSetting,
  gameAsset,
  captcha,
  userRewards,
  emailReminder,
  supportReview,
  visitorLog,
  abEvent,
} from "@/drizzle/schema";
import { canAwardReputation } from "@/utils/permissions";
import { nanoid } from "nanoid";
import { awardSchema, awardsFilteringSchema } from "@/validators/reputation";
import { canSubmitNotification, canModifyEventGains } from "@/utils/permissions";
import { fetchUser } from "@/routers/profile";
import { secondsFromNow, DAY_S } from "@/utils/time";
import { baseServerResponse, errorResponse } from "../trpc";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { ratelimitMiddleware, hasUserMiddleware } from "../trpc";
import { updateGameSetting } from "@/libs/gamesettings";
import { changeSettingSchema } from "@/validators/misc";

import { Sentiment } from "@/drizzle/constants";
import type { DrizzleClient } from "@/server/db";

export const miscRouter = createTRPCRouter({
  trackVisitor: publicProcedure
    .input(
      z.object({
        ref: z.string().max(191).optional(),
        utmSource: z.string().max(191).optional(),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Only track if not logged in
      if (ctx.userId) return { success: true, message: "Already logged in" };
      const ip = ctx.userIp ?? "unknown";
      if (ip === "unknown") return { success: false, message: "No IP detected" };

      // Check if IP already recorded
      const existing = await ctx.drizzle.query.visitorLog.findFirst({
        where: eq(visitorLog.ip, ip),
      });
      if (existing) {
        return { success: true, message: "IP already tracked" };
      }

      // Insert new visitor and log AB welcome loaded event (if applicable) in parallel
      const [visitorResult] = await Promise.all([
        ctx.drizzle.insert(visitorLog).values({
          id: nanoid(),
          ip,
          ref: input.ref,
          utmSource: input.utmSource,
          userAgent: String(ctx.userAgent).slice(0, 180),
        }),
        ctx.abWelcomeVariant
          ? ctx.drizzle
              .insert(abEvent)
              .values({
                id: nanoid(),
                userId: null,
                experiment: "ab_music_welcome_to_seichi",
                variant: ctx.abWelcomeVariant,
                event: "loaded",
                source: input.utmSource,
                ip: ctx.userIp && ctx.userIp !== "unknown" ? ctx.userIp : undefined,
                userAgent:
                  typeof ctx.userAgent === "string"
                    ? ctx.userAgent.slice(0, 180)
                    : undefined,
              })
              .onDuplicateKeyUpdate({ set: { id: sql`id` } })
          : Promise.resolve(null),
      ]);
      if (visitorResult.rowsAffected === 0) {
        return { success: false, message: "Failed to insert visitor" };
      }
      return { success: true, message: "Visitor tracked" };
    }),
  getAllGameAssetNames: publicProcedure.query(async ({ ctx }) => {
    return await fetchGameAssets(ctx.drizzle);
  }),
  getCaptcha: protectedProcedure
    .use(ratelimitMiddleware)
    .use(hasUserMiddleware)
    .query(async ({ ctx }) => {
      return await generateCaptcha(ctx.drizzle, ctx.userId);
    }),
  submitNotification: protectedProcedure
    .input(z.object({ content: z.string().min(2).max(10000), senderId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query data
      const [user, sender] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.senderId),
      ]);
      // Guards
      if (!canSubmitNotification(user.role)) return errorResponse("Not allowed");
      if (!user || !sender) return errorResponse("User not found");
      if (user.userId !== sender.userId && !sender.isAi) {
        return errorResponse("You or an AI must be marked as sender");
      }
      // Update database
      const [result] = await Promise.all([
        ctx.drizzle.insert(notification).values({
          userId: sender.userId,
          content: input.content,
        }),
        ctx.drizzle
          .update(userData)
          .set({ unreadNotifications: sql`unreadNotifications + 1` }),
      ]);
      if (result.rowsAffected === 0) {
        return { success: false, message: "Could insert notificaiton in db" };
      } else {
        return { success: true, message: "Notification sent" };
      }
    }),
  getPreviousNotifications: protectedProcedure
    .input(
      z.object({
        cursor: z.number().nullish(),
        limit: z.number().min(1).max(500),
      }),
    )
    .query(async ({ ctx, input }) => {
      const currentCursor = input.cursor ? input.cursor : 0;
      const skip = currentCursor * input.limit;
      const results = await ctx.drizzle.query.notification.findMany({
        offset: skip,
        limit: input.limit,
        with: { user: true },
        orderBy: [desc(notification.createdAt)],
      });
      const nextCursor = results.length < input.limit ? null : currentCursor + 1;
      return {
        data: results,
        nextCursor: nextCursor,
      };
    }),
  getSetting: publicProcedure
    .input(z.object({ name: z.string() }))
    .query(async ({ ctx, input }) => {
      const setting = await ctx.drizzle.query.gameSetting.findFirst({
        where: eq(gameSetting.name, input.name),
      });
      return setting ?? null;
    }),
  setEventGameSetting: protectedProcedure
    .input(changeSettingSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guards
      if (!canModifyEventGains(user.role)) return errorResponse("Not allowed");
      if (!user) return errorResponse("User not found");
      // Update
      await updateGameSetting(
        ctx.drizzle,
        input.setting,
        parseInt(input.multiplier),
        secondsFromNow(input.days * 24 * 3600),
      );
      return { success: true, message: `Setting set to: ${input.multiplier}X` };
    }),
  awardReputation: protectedProcedure
    .input(awardSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch admin user
      const admin = await fetchUser(ctx.drizzle, ctx.userId);

      // Guard checks section
      if (!canAwardReputation(admin.role)) {
        return errorResponse("Not authorized to award points");
      }

      // Fetch all target users in a single query
      const users = await ctx.drizzle.query.userData.findMany({
        where: inArray(userData.userId, input.userIds),
      });

      // Check if any users are missing
      if (users.length !== input.userIds.length) {
        return errorResponse("One or more users not found");
      }

      // Create rewards records for all users
      const rewardsToInsert = users.map((user) => ({
        id: nanoid(),
        awardedById: admin.userId,
        receiverId: user.userId,
        reputationAmount: input.reputationAmount || 0,
        moneyAmount: input.moneyAmount || 0,
        reason: input.reason,
      }));

      // Execute both operations in parallel
      await Promise.all([
        // Batch insert all rewards
        ctx.drizzle.insert(userRewards).values(rewardsToInsert),

        // Update all users in a single query
        ctx.drizzle
          .update(userData)
          .set({
            reputationPoints: sql`reputationPoints + ${input.reputationAmount || 0}`,
            reputationPointsTotal: sql`reputationPointsTotal + ${input.reputationAmount || 0}`,
            money: sql`money + ${input.moneyAmount || 0}`,
          })
          .where(inArray(userData.userId, input.userIds)),
      ]);

      return {
        success: true,
        message: `Rewards awarded successfully to ${users.length} user(s)`,
      };
    }),

  getAllAwards: publicProcedure
    .input(
      awardsFilteringSchema.extend({
        cursor: z.number().nullish(),
        limit: z.number().min(1).max(500),
      }),
    )
    .query(async ({ ctx, input }) => {
      const currentCursor = input?.cursor ? input.cursor : 0;
      const limit = input?.limit ? input.limit : 100;
      const skip = currentCursor * limit;

      // Resolve username filters to userId arrays (done upfront to keep main query simple)
      const [receiverIds, awardedByIds] = await Promise.all([
        input.awardedTo
          ? ctx.drizzle.query.userData
              .findMany({
                where: like(userData.username, `%${input.awardedTo}%`),
                columns: { userId: true },
              })
              .then((rows) => rows.map((r) => r.userId))
          : Promise.resolve<string[]>([]),
        input.awardedBy
          ? ctx.drizzle.query.userData
              .findMany({
                where: like(userData.username, `%${input.awardedBy}%`),
                columns: { userId: true },
              })
              .then((rows) => rows.map((r) => r.userId))
          : Promise.resolve<string[]>([]),
      ]);

      // Compute date range for a given day if provided (UTC day)
      const dayStart = input.date ? new Date(input.date) : undefined;
      const dayEnd = dayStart ? new Date(dayStart) : undefined;
      if (dayEnd) dayEnd.setDate(dayEnd.getDate() + 1);

      const results = await ctx.drizzle.query.userRewards.findMany({
        offset: skip,
        limit: limit,
        with: {
          awardedBy: {
            columns: {
              userId: true,
              username: true,
              avatar: true,
            },
          },
          receiver: {
            columns: {
              userId: true,
              username: true,
              avatar: true,
            },
          },
        },
        where: and(
          // Reward type conditions
          ...(input.rewardType === "reputation"
            ? [gt(userRewards.reputationAmount, 0), eq(userRewards.moneyAmount, 0)]
            : []),
          ...(input.rewardType === "money"
            ? [gt(userRewards.moneyAmount, 0), eq(userRewards.reputationAmount, 0)]
            : []),
          ...(input.rewardType === "both"
            ? [gt(userRewards.reputationAmount, 0), gt(userRewards.moneyAmount, 0)]
            : []),
          // Date range conditions for a specific day (UTC)
          ...(dayStart && dayEnd
            ? [gte(userRewards.createdAt, dayStart), lt(userRewards.createdAt, dayEnd)]
            : []),
          // Username-derived id filters
          ...(receiverIds.length > 0
            ? [inArray(userRewards.receiverId, receiverIds)]
            : []),
          ...(awardedByIds.length > 0
            ? [inArray(userRewards.awardedById, awardedByIds)]
            : []),
        ),
        orderBy: [desc(userRewards.createdAt)],
      });

      const nextCursor = results.length < limit ? null : currentCursor + 1;
      return { data: results, nextCursor: nextCursor };
    }),

  getPersonalEmailReminder: protectedProcedure.query(async ({ ctx }) => {
    const reminder = await ctx.drizzle.query.emailReminder.findFirst({
      where: eq(emailReminder.userId, ctx.userId),
    });
    return reminder ?? null;
  }),

  getEmailReminder: publicProcedure
    .input(z.object({ email: z.string().email(), secret: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await fetchEmailReminder(ctx.drizzle, input.email, input.secret);
      return result ?? null;
    }),

  toggleEmailReminder: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        secret: z.string(),
        disabled: z.boolean(),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Find the email reminder
      const reminder = await fetchEmailReminder(ctx.drizzle, input.email, input.secret);

      if (!reminder) {
        return errorResponse("Email reminder not found");
      }

      // Update the disabled status
      const result = await ctx.drizzle
        .update(emailReminder)
        .set({ disabled: input.disabled })
        .where(
          and(
            eq(emailReminder.email, input.email),
            eq(emailReminder.secret, input.secret),
          ),
        );

      if (result.rowsAffected === 0) {
        return { success: false, message: "Failed to update email reminder" };
      }

      return {
        success: true,
        message: `Email reminders ${input.disabled ? "disabled" : "enabled"} successfully`,
      };
    }),

  deleteEmailReminder: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        secret: z.string(),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Find the email reminder
      const reminder = await fetchEmailReminder(ctx.drizzle, input.email, input.secret);

      if (!reminder) {
        return errorResponse("Email reminder not found");
      }

      // Delete the email reminder
      const result = await ctx.drizzle
        .delete(emailReminder)
        .where(
          and(
            eq(emailReminder.email, input.email),
            eq(emailReminder.secret, input.secret),
          ),
        );

      if (result.rowsAffected === 0) {
        return errorResponse("Failed to delete email reminder");
      }

      return {
        success: true,
        message: "Email reminder deleted successfully",
      };
    }),

  reviewSupportWithAI: protectedProcedure
    .input(
      z.object({
        apiRoute: z.string(),
        chatHistory: z.array(z.any()),
        sentiment: z.enum(Sentiment),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const reviewsToday = await ctx.drizzle.query.supportReview.findMany({
        where: gte(supportReview.createdAt, secondsFromNow(-DAY_S)),
      });
      // Guard
      if (reviewsToday.length >= 5) {
        return errorResponse(
          "You have reached the maximum number of reviews for today",
        );
      }
      // Insert
      await ctx.drizzle.insert(supportReview).values({
        id: nanoid(),
        userId: ctx.userId,
        apiRoute: input.apiRoute,
        chatHistory: input.chatHistory,
        sentiment: input.sentiment,
      });
      return { success: true, message: "Review submitted" };
    }),
});

/**
 * Generate a captcha & its hash
 * @returns
 */
export const generateCaptcha = async (client: DrizzleClient, userId: string) => {
  // Fetch
  const current = await client.query.captcha.findFirst({
    where: and(eq(captcha.userId, userId), eq(captcha.used, false)),
  });
  // Value to guess
  const value = current?.value ?? randomString(6);
  // Create the SVG
  const fontPath = path.resolve("./fonts/OpenSans.ttf");
  const textToSVG = TextToSVG.loadSync(fontPath);
  const svg = textToSVG.getSVG(value, {
    x: 0,
    y: 0,
    fontSize: 40,
    anchor: "top",
    attributes: { fill: "red", stroke: "black" },
  });
  // Insert into database
  if (!current) {
    // Create a new captcha
    await client.insert(captcha).values({ userId, value });
  }
  // Return svg & hash
  return { svg };
};

/**
 * Validate a given captcha value
 * @param hash
 * @param value
 * @returns
 */
export const validateCaptcha = async (
  client: DrizzleClient,
  userId: string,
  guess: string,
) => {
  // Fetch
  const current = await client.query.captcha.findFirst({
    where: and(eq(captcha.userId, userId), eq(captcha.used, false)),
  });
  // Check
  if (current) {
    const success = current.value === guess;
    await client
      .update(captcha)
      .set({ used: true, success: success })
      .where(eq(captcha.id, current.id));
    return success;
  }
  return false;
};

/**
 * Fetches game assets from the database.
 *
 * @param client - The DrizzleClient instance used to query the database.
 * @returns A promise that resolves to an array of game assets, each containing the id, name, and image.
 */
export const fetchGameAssets = async (client: DrizzleClient) => {
  return await client.query.gameAsset.findMany({
    where: eq(gameAsset.hidden, false),
    orderBy: [desc(gameAsset.name)],
  });
};

/**
 * Fetches an email reminder by email and secret
 * @param client - The DrizzleClient instance
 * @param email - The email address
 * @param secret - The secret token
 * @returns The email reminder or null if not found
 */
export const fetchEmailReminder = async (
  client: DrizzleClient,
  email: string,
  secret: string,
) => {
  return await client.query.emailReminder.findFirst({
    where: and(eq(emailReminder.email, email), eq(emailReminder.secret, secret)),
  });
};
