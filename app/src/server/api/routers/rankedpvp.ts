import { createTRPCRouter, publicProcedure, protectedProcedure } from "@/api/trpc";
import { drizzleDB } from "@/server/db";
import { RankedDivisions } from "@/drizzle/constants";
import { userData } from "@/drizzle/schema";
import { gte, desc, inArray } from "drizzle-orm";
import { z } from "zod";

export const rankedpvpRouter = createTRPCRouter({
  getPvpRank: publicProcedure
    .input(z.object({ userId: z.string(), rankedLp: z.number() }))
    .query(async ({ input }) => {
      const { userId, rankedLp } = input;

      // Fetch top 10 players with rankedLp >= 900
      const topSannins = await drizzleDB
        .select({ userId: userData.userId })
        .from(userData)
        .where(gte(userData.rankedLp, 900))
        .orderBy(desc(userData.rankedLp))
        .limit(10);

      // Check if the user is in the top 10
      const isTopSannin = topSannins.some(player => player.userId === userId);

      if (isTopSannin) return "Sannin";
      if (rankedLp >= 900) return "Legend";

      return (
        RankedDivisions
          .slice()
          .reverse()
          .find(rank => rankedLp >= rank.rankedLp)?.name || "Wood"
      );
    }),

  getPvpRanks: publicProcedure
    .input(z.object({ userIds: z.array(z.string()) }))
    .query(async ({ input }) => {
      // If no userIds provided, return empty object
      if (input.userIds.length === 0) return {};

      // Fetch all users with their rankedLp
      const users = await drizzleDB
        .select({ userId: userData.userId, rankedLp: userData.rankedLp })
        .from(userData)
        .where(inArray(userData.userId, input.userIds));

      // Fetch top 10 players with rankedLp >= 900
      const topSannins = await drizzleDB
        .select({ userId: userData.userId })
        .from(userData)
        .where(gte(userData.rankedLp, 900))
        .orderBy(desc(userData.rankedLp))
        .limit(10);

      // Create a map of userId to rank
      const ranks: Record<string, string> = {};
      for (const user of users) {
        if (!user.rankedLp) {
          ranks[user.userId] = "Wood";
          continue;
        }

        const isTopSannin = topSannins.some(player => player.userId === user.userId);
        if (isTopSannin) {
          ranks[user.userId] = "Sannin";
        } else if (user.rankedLp >= 900) {
          ranks[user.userId] = "Legend";
        } else {
          ranks[user.userId] = RankedDivisions
            .slice()
            .reverse()
            .find(rank => user.rankedLp >= rank.rankedLp)?.name || "Wood";
        }
      }

      return ranks;
    }),
});
