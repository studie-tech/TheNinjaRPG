import { TRPCError } from "@trpc/server";
import { eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { AI_PROFILE_MAX_RULES } from "@/drizzle/constants";
import { aiProfile, item, jutsu, quest, userData } from "@/drizzle/schema";
import { fetchUser } from "@/routers/profile";
import type { DrizzleClient } from "@/server/db";
import { canChangeContent, canChangeDefaultAiProfile } from "@/utils/permissions";
import { AiRule } from "@/validators/ai";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
} from "../trpc";

export const aiRouter = createTRPCRouter({
  getAiProfile: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get AI profile by ID" } })
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      // Query
      const [user, profile] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchAiProfileById(ctx.drizzle, input.id),
      ]);
      // Guard
      if (!profile) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Profile not found" });
      }
      if (
        !canChangeContent(user.role) &&
        input.id !== (user.aiProfileId ?? "Default")
      ) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Unauthorized" });
      }
      // Return
      return profile;
    }),
  createAiProfile: protectedProcedure
    .input(z.object({ userId: z.string(), rules: z.array(AiRule) }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, profile] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchAiProfileByUserId(ctx.drizzle, input.userId),
      ]);
      // Guard
      if (profile) return errorResponse("Only one AI profile per user is allowed");
      if (!canChangeContent(user.role)) return errorResponse("Unauthorized");
      // Mutate
      await ctx.drizzle
        .insert(aiProfile)
        .values({ id: nanoid(), userId: input.userId, rules: input.rules });
      // Return
      return { success: true, message: "AiProfile created" };
    }),
  updateAiProfile: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        rules: z.array(AiRule),
        includeDefaultRules: z.boolean(),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, profile] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchAiProfileById(ctx.drizzle, input.id),
      ]);
      // Guard
      if (!profile) return errorResponse("Profile not found");
      if (!canChangeContent(user.role) && user.userId !== profile.userId) {
        return errorResponse("Unauthorized");
      }
      if (profile.id === "Default" && !canChangeDefaultAiProfile(user.role)) {
        return errorResponse("Default profile only modifiable by content admin");
      }
      if (input.rules.length > AI_PROFILE_MAX_RULES) {
        return errorResponse(`Maximum of ${AI_PROFILE_MAX_RULES} rules allowed`);
      }
      if (profile.userId === user.userId) {
        const [jutsus, items] = await Promise.all([
          ctx.drizzle.query.jutsu.findMany({
            where: inArray(
              jutsu.id,
              input.rules
                .filter((r) => "jutsuId" in r.action)
                .map((r) => (r.action as { jutsuId: string }).jutsuId),
            ),
          }),
          ctx.drizzle.query.item.findMany({
            where: inArray(
              item.id,
              input.rules
                .filter((r) => "itemId" in r.action)
                .map((r) => (r.action as { itemId: string }).itemId),
            ),
          }),
        ]);
        const effects = [...jutsus, ...items].flatMap((e) => e.effects);
        const hasMove = effects.some((e) => "type" in e && e.type === "move");
        const hasSummon = effects.some((e) => "type" in e && e.type === "summon");
        if (hasMove) {
          return errorResponse("Items/jutsu with move effects are not allowed");
        }
        if (hasSummon) {
          return errorResponse("Items/jutsu with summon effects are not allowed");
        }
      }
      // Update
      await ctx.drizzle
        .update(aiProfile)
        .set({ rules: input.rules, includeDefaultRules: input.includeDefaultRules })
        .where(eq(aiProfile.id, input.id));
      return { success: true, message: "AiProfile updated" };
    }),
  toggleAiProfile: protectedProcedure
    .input(z.object({ aiId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, target, profile] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.aiId),
        fetchAiProfileByUserId(ctx.drizzle, input.aiId),
      ]);
      // Guard
      if (!canChangeContent(user.role) && user.userId !== target.userId) {
        return errorResponse("Unauthorized");
      }
      // Update
      if (target.aiProfileId) {
        await ctx.drizzle
          .update(userData)
          .set({ aiProfileId: null })
          .where(eq(userData.userId, target.userId));
      } else {
        if (profile) {
          await ctx.drizzle
            .update(userData)
            .set({ aiProfileId: profile.id })
            .where(eq(userData.userId, target.userId));
        } else {
          const id = nanoid();
          await Promise.all([
            ctx.drizzle
              .insert(aiProfile)
              .values({ id, userId: target.userId, rules: [] }),
            ctx.drizzle
              .update(userData)
              .set({ aiProfileId: id })
              .where(eq(userData.userId, target.userId)),
          ]);
        }
      }
      return { success: true, message: "AiProfile updated" };
    }),
  getAiRelations: publicProcedure
    .meta({ mcp: { enabled: true, description: "Get quests referencing an AI" } })
    .input(z.object({ aiId: z.string() }))
    .query(async ({ ctx, input }) => {
      const results = await getAiRelations(ctx.drizzle, input.aiId);
      return results;
    }),
});

/**
 * Fetches an AI profile from the database using the provided client and profile ID.
 *
 * @param client - The DrizzleClient instance used to query the database.
 * @param id - The unique identifier of the AI profile to fetch.
 * @returns The AI profile object, including its associated rules.
 * @throws Will throw an error if the profile with the given ID is not found.
 */
export const fetchAiProfileById = async (client: DrizzleClient, id: string) => {
  const profile = await client.query.aiProfile.findFirst({
    where: eq(aiProfile.id, id),
  });
  if (!profile) {
    throw new Error(`fetchAiProfile: Profile not found: ${id}`);
  }
  return profile;
};

/**
 * Fetches an AI profile from the database using the provided client and user ID.
 *
 * @param client
 * @param userId
 * @returns
 */
export const fetchAiProfileByUserId = async (client: DrizzleClient, userId: string) => {
  const profile = await client.query.aiProfile.findFirst({
    where: eq(aiProfile.userId, userId),
  });
  return profile;
};

/**
 * Find quests referencing an AI in objectives (opponentAIs/attackers)
 */
export const getAiRelations = async (client: DrizzleClient, aiId: string) => {
  const questsUsingAi = await client.query.quest.findMany({
    columns: { id: true, name: true },
    where: sql`(
      JSON_SEARCH(${quest.content}, 'one', ${aiId}, NULL, '$.objectives[*].opponentAIs[*].ids[*]') IS NOT NULL
      OR JSON_SEARCH(${quest.content}, 'one', ${aiId}, NULL, '$.objectives[*].attackers[*].ids[*]') IS NOT NULL
    )`,
  });

  return { questsUsingAi };
};
export type AiRelations = Awaited<ReturnType<typeof getAiRelations>>;
