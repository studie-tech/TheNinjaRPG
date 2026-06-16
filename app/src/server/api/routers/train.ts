import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { TrainingSpeeds, UserStatNames } from "@/drizzle/constants";
import { trainingLog, userData } from "@/drizzle/schema";
import { showTrainingCapcha } from "@/libs/captcha";
import {
  cancelStatQueueEntry,
  completeStatTraining,
  enqueueStatTraining,
  getStatQueueStatus,
  promoteStatQueue,
} from "@/libs/queue";
import { validateCaptcha } from "@/routers/misc";
import { fetchUpdatedUser } from "@/routers/profile";
import { QuestTracker } from "@/validators/objectives";
import { activityQueueStatusSchema } from "@/validators/queue";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  serverError,
} from "../trpc";

export const trainRouter = createTRPCRouter({
  getStatQueue: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get stat training queue status" } })
    .output(activityQueueStatusSchema)
    .query(async ({ ctx }) => {
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
        forceRegen: true,
      });
      if (!user) throw serverError("NOT_FOUND", "User not found");
      return getStatQueueStatus(ctx.drizzle, user);
    }),

  enqueueStatTraining: protectedProcedure
    .meta({
      mcp: {
        enabled: true,
        description: "Start or queue stat training for a specific stat",
      },
    })
    .input(z.object({ stat: z.enum(UserStatNames) }))
    .output(
      baseServerResponse.extend({
        data: z
          .object({
            currentlyTraining: z.enum(UserStatNames),
            trainingStartedAt: z.date(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await enqueueStatTraining(ctx.drizzle, ctx.userId, input.stat);
      if (!result.success) return errorResponse(result.message);
      return {
        success: true,
        message: result.message,
        data: result.data,
      };
    }),

  cancelStatQueueEntry: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Cancel a queued stat training entry" },
    })
    .input(z.object({ queueId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const result = await cancelStatQueueEntry(ctx.drizzle, ctx.userId, input.queueId);
      if (!result.success) return errorResponse(result.message);
      return { success: true, message: result.message };
    }),

  // Start training of a specific attribute
  startTraining: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Start training a specific stat" } })
    .input(z.object({ stat: z.enum(UserStatNames) }))
    .output(
      baseServerResponse.extend({
        data: z
          .object({
            currentlyTraining: z.enum(UserStatNames),
            trainingStartedAt: z.date(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await enqueueStatTraining(ctx.drizzle, ctx.userId, input.stat);
      if (!result.success) return errorResponse(result.message);
      return {
        success: true,
        message: result.message,
        data: result.data,
      };
    }),

  // Stop training
  stopTraining: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Stop training and collect stat gains" },
    })
    .input(z.object({ guess: z.string().optional(), villageId: z.string().nullable() }))
    .output(
      baseServerResponse.extend({
        data: z
          .object({
            experience: z.number(),
            currentlyTraining: z.enum(UserStatNames),
            questData: z.array(QuestTracker),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [{ user, settings }] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
          forceRegen: true,
        }),
      ]);
      if (!user) throw serverError("NOT_FOUND", "User not found");
      if (showTrainingCapcha(user)) {
        if (!input.guess) return errorResponse("Captcha required");
        if (!(await validateCaptcha(ctx.drizzle, ctx.userId, input.guess))) {
          return errorResponse("Invalid captcha");
        }
      }

      const result = await completeStatTraining(ctx.drizzle, user, settings, {
        bypassCaptcha: true,
      });
      if (!result.success) return errorResponse(result.message);

      await promoteStatQueue(ctx.drizzle, ctx.userId);

      return {
        success: true,
        message: `You gained ${result.trainingAmount.toFixed(2)} ${result.stat}`,
        data: {
          experience: result.trainingAmount,
          currentlyTraining: result.stat,
          questData: result.questData,
        },
      };
    }),

  // Update user training speed
  updateTrainingSpeed: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Update training speed interval" } })
    .input(z.object({ speed: z.enum(TrainingSpeeds) }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });
      if (!user) {
        throw serverError("NOT_FOUND", "User not found");
      }
      if (user.currentlyTraining) {
        return {
          success: false,
          message: "Cannot change training speed while training",
        };
      }
      const result = await ctx.drizzle
        .update(userData)
        .set({ trainingSpeed: input.speed })
        .where(eq(userData.userId, ctx.userId));
      if (result.rowsAffected === 0) {
        return { success: false, message: "Could not update user" };
      } else {
        return { success: true, message: "Training speed updated" };
      }
    }),

  getTrainingLog: protectedProcedure
    .meta({
      mcp: {
        enabled: true,
        description: "Get user training history from last 24 hours",
      },
    })
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.drizzle.query.trainingLog.findMany({
        where: and(
          eq(trainingLog.userId, input.userId),
          gt(trainingLog.trainingFinishedAt, sql`NOW() - INTERVAL 1 DAY`),
        ),
      });
    }),
});
