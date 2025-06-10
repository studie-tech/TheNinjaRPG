import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { rankedSeason, userData } from "@/drizzle/schema";
import { nanoid } from "nanoid";
import { canChangeContent } from "@/utils/permissions";

const rewardSchema = z.object({
  type: z.enum(["item", "jutsu", "reputation", "ryo"]),
  id: z.string().optional(),
  amount: z.number().int().positive(),
});

const divisionRewardSchema = z.object({
  division: z.string(),
  rewards: z.array(rewardSchema),
});

const rankedSeasonSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().min(1, "Description is required"),
  startDate: z.date(),
  endDate: z.date(),
  rewards: z.array(divisionRewardSchema),
});

export const rankedRouter = createTRPCRouter({
  // Get all ranked seasons
  getSeasons: protectedProcedure.query(async ({ ctx }) => {
    const seasons = await ctx.drizzle.query.rankedSeason.findMany({
      orderBy: (season, { desc }) => [desc(season.startDate)],
    });
    return seasons;
  }),

  // Get a specific season
  getSeason: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const season = await ctx.drizzle.query.rankedSeason.findFirst({
        where: eq(rankedSeason.id, input.id),
      });
      if (!season) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Season not found",
        });
      }
      return season;
    }),

  // Create a new season
  createSeason: protectedProcedure
    .input(rankedSeasonSchema)
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.drizzle.query.userData.findFirst({
        where: eq(userData.userId, ctx.userId),
      });

      if (!user || !canChangeContent(user.role)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have permission to create ranked seasons",
        });
      }

      const id = nanoid();
      await ctx.drizzle.insert(rankedSeason).values({
        id,
        ...input,
      });

      return { id };
    }),

  // Update an existing season
  updateSeason: protectedProcedure
    .input(z.object({ id: z.string() }).merge(rankedSeasonSchema))
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.drizzle.query.userData.findFirst({
        where: eq(userData.userId, ctx.userId),
      });

      if (!user || !canChangeContent(user.role)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have permission to update ranked seasons",
        });
      }

      const { id, ...data } = input;
      await ctx.drizzle
        .update(rankedSeason)
        .set({
          ...data,
          updatedAt: new Date(),
        })
        .where(eq(rankedSeason.id, id));

      return { id };
    }),

  // Delete a season
  deleteSeason: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.drizzle.query.userData.findFirst({
        where: eq(userData.userId, ctx.userId),
      });

      if (!user || !canChangeContent(user.role)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have permission to delete ranked seasons",
        });
      }

      await ctx.drizzle.delete(rankedSeason).where(eq(rankedSeason.id, input.id));
      return { id: input.id };
    }),
}); 