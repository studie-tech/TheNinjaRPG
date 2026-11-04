import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { AI_PROFILE_MAX_RULES } from "@/drizzle/constants";
import {
  fetchAiProfileById,
  fetchAiProfileByUserId,
  insertAiProfileForToggleAiProfile,
  listItemForUpdateAiProfile,
  listJutsuForUpdateAiProfile,
  listQuestForGetAiRelations,
  setUserAiProfile,
  updateAiProfileForUpdateAiProfile,
  updateUserDataForToggleAiProfile,
} from "@/queries/ai";
import { fetchUser } from "@/queries/profile";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { canChangeContent, canChangeDefaultAiProfile } from "@/utils/permissions";
import { updateAiProfileSchema } from "@/validators/ai";
import { idSchema } from "@/validators/misc";

export const aiRouter = createTRPCRouter({
  getAiProfile: protectedProcedure
    .meta({ mcp: { description: "Get AI profile by ID" } })
    .input(idSchema)
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
  updateAiProfile: protectedProcedure
    .input(updateAiProfileSchema)
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
          listJutsuForUpdateAiProfile(ctx.drizzle, input),
          listItemForUpdateAiProfile(ctx.drizzle, input),
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
      await updateAiProfileForUpdateAiProfile(ctx.drizzle, input);
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
        await updateUserDataForToggleAiProfile(ctx.drizzle, target);
      } else {
        if (profile) {
          await setUserAiProfile(ctx.drizzle, profile.id, target.userId);
        } else {
          const id = nanoid();
          await Promise.all([
            insertAiProfileForToggleAiProfile(ctx.drizzle, id, target),
            setUserAiProfile(ctx.drizzle, id, target.userId),
          ]);
        }
      }
      return { success: true, message: "AiProfile updated" };
    }),
  getAiRelations: publicProcedure
    .meta({ mcp: { description: "Get quests referencing an AI" } })
    .input(z.object({ aiId: z.string() }))
    .query(async ({ ctx, input }) => {
      const results = await getAiRelations(ctx.drizzle, input.aiId);
      return results;
    }),
});

/**
 * Find quests referencing an AI in objectives (opponentAIs/allyAIs/attackers)
 */
export const getAiRelations = async (client: DrizzleClient, aiId: string) => {
  const questsUsingAi = await listQuestForGetAiRelations(client, aiId);

  return { questsUsingAi };
};
export type AiRelations = Awaited<ReturnType<typeof getAiRelations>>;
