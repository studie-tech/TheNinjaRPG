import { nanoid } from "nanoid";
import { z } from "zod";
import { getToggleAiProfileUserUpdate } from "@/deltas/ai";
import {
  AI_PROFILE_MAX_RULES,
  NPC_AI_PROFILE_MAX_RULES,
  TRANSFORMATION_ACTION,
} from "@/drizzle/constants";
import type { AiTransformation } from "@/drizzle/schema";
import { bossChainIssue, bossFormsFrom } from "@/libs/combat/bossFight";
import { editedReason, outdateProposalsFor } from "@/libs/contentReview/outdate";
import {
  deleteAiTransformation,
  executeRowsForToggleAiProfile,
  fetchAiLoadoutStateForToggleAiProfile,
  fetchAiProfileById,
  fetchAiProfileForUpdate,
  fetchUnlinkedAiProfileByUserId,
  insertAiProfileForToggleAiProfile,
  listAiForBossFight,
  listAiTransformations,
  listItemForUpdateAiProfile,
  listJutsuForUpdateAiProfile,
  listQuestForGetAiRelations,
  saveAiTransformation,
  setUserAiProfile,
  updateAiProfileForUpdateAiProfile,
  updateUserDataForToggleAiProfile,
  upsertAiProfileForToggleAiProfile,
} from "@/queries/ai";
import { fetchUser } from "@/queries/profile";
import {
  fetchAnimationAiName,
  insertSpriteAnimationLog,
  touchAnimationAi,
} from "@/queries/spriteAnimation";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
  serverError,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { canChangeContent, canChangeDefaultAiProfile } from "@/utils/permissions";
import {
  countCustomRules,
  updateAiProfileSchema,
  updateAiTransformationSchema,
} from "@/validators/ai";
import { idSchema } from "@/validators/misc";
import { userDeltaResponseSchema } from "@/validators/userCache";

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
        throw serverError("NOT_FOUND", "Profile not found");
      }
      // Players read the rules of each of their own jutsu loadouts, not only the active one.
      if (
        !canChangeContent(user.role) &&
        profile.id !== "Default" &&
        profile.userId !== user.userId
      ) {
        throw serverError("UNAUTHORIZED", "Unauthorized");
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
        fetchAiProfileForUpdate(ctx.drizzle, input.id),
      ]);
      // Guard
      if (!profile) return errorResponse("Profile not found");
      if (!canChangeContent(user.role) && user.userId !== profile.userId) {
        return errorResponse("Unauthorized");
      }
      if (profile.id === "Default" && !canChangeDefaultAiProfile(user.role)) {
        return errorResponse("Default profile only modifiable by content admin");
      }
      // A jutsu loadout's rules end with the backup rules, which do not count toward the limit.
      if (profile.jutsuLoadoutId) {
        if (countCustomRules(input.rules) > AI_PROFILE_MAX_RULES) {
          return errorResponse(
            `Maximum of ${AI_PROFILE_MAX_RULES} custom rules allowed`,
          );
        }
      } else {
        const maxRules =
          profile.id !== "Default" && profile.user?.isAi
            ? NPC_AI_PROFILE_MAX_RULES
            : AI_PROFILE_MAX_RULES;
        if (input.rules.length > maxRules) {
          return errorResponse(`Maximum of ${maxRules} rules allowed`);
        }
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
  /**
   * Switch between custom and Default AI rules. A player's rules belong to their active jutsu
   * loadout; a staff AI has a single profile.
   */
  toggleAiProfile: protectedProcedure
    // Without `custom`, the current choice flips.
    .input(z.object({ aiId: z.string(), custom: z.boolean().optional() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, target] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.aiId),
      ]);
      // Guard
      if (!canChangeContent(user.role) && user.userId !== target.userId) {
        return errorResponse("Unauthorized");
      }
      const custom = input.custom ?? !target.aiProfileId;
      if (target.isAi) {
        const profile = await fetchUnlinkedAiProfileByUserId(
          ctx.drizzle,
          target.userId,
        );
        if (!custom) {
          await updateUserDataForToggleAiProfile(ctx.drizzle, target);
        } else if (profile) {
          await setUserAiProfile(ctx.drizzle, profile.id, target.userId);
        } else {
          const id = nanoid();
          await Promise.all([
            insertAiProfileForToggleAiProfile(ctx.drizzle, id, target),
            setUserAiProfile(ctx.drizzle, id, target.userId),
          ]);
        }
        return { success: true, message: "AiProfile updated" };
      }
      const loadoutId = target.jutsuLoadout;
      if (!loadoutId) return errorResponse("Choose a jutsu loadout above first");
      // Update
      if (custom) {
        await upsertAiProfileForToggleAiProfile(
          ctx.drizzle,
          nanoid(),
          target.userId,
          loadoutId,
        );
      }
      await executeRowsForToggleAiProfile(
        ctx.drizzle,
        target.userId,
        loadoutId,
        custom,
      );
      // The write is guarded on the active loadout; read back what the player now fights with.
      const state = await fetchAiLoadoutStateForToggleAiProfile(
        ctx.drizzle,
        target.userId,
      );
      if (
        state?.jutsuLoadout !== loadoutId ||
        state.loadout?.userId !== target.userId ||
        state.loadout.customAi !== custom
      ) {
        return errorResponse("Your jutsu loadout changed. Please try again.");
      }
      return {
        success: true,
        message: custom ? "Custom AI rules enabled" : "Default AI rules enabled",
        ...(target.userId === ctx.userId
          ? getToggleAiProfileUserUpdate(loadoutId, state.aiProfileId)
          : {}),
      };
    }),
  /** One boss fight as staff see it: this AI's link and every form with its readiness. */
  getBossFight: protectedProcedure
    .meta({
      mcp: { description: "Get an AI's boss transformation and its chain of forms" },
    })
    .input(z.object({ aiId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [user, links] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        listAiTransformations(ctx.drizzle),
      ]);
      if (!canChangeContent(user.role)) {
        throw serverError("UNAUTHORIZED", "Unauthorized");
      }
      const first = bossChainStart(input.aiId, links);
      const chain = bossFormsFrom(first, links);
      const ais = await listAiForBossFight(
        ctx.drizzle,
        chain.map((form) => form.aiId),
      );
      return {
        transformation: links.find((link) => link.userId === input.aiId) ?? null,
        forms: chain.flatMap(({ aiId, arrival }) => {
          const ai = ais.find((row) => row.userId === aiId);
          if (!ai) return [];
          const actions = ai.spriteAnimationBindings.map((row) => row.actionKey);
          return [
            {
              userId: ai.userId,
              username: ai.username,
              avatar: ai.avatar,
              announce: arrival?.announce,
              hasIdle: actions.includes("idle"),
              hasArrivalClip: actions.includes(TRANSFORMATION_ACTION),
              jutsuCount: ai.jutsus.length,
            },
          ];
        }),
      };
    }),
  /** Save or clear what an AI becomes when it falls, keeping every chain finite. */
  updateTransformation: protectedProcedure
    .meta({
      mcp: { description: "Set or clear the form an AI transforms into when defeated" },
    })
    .input(updateAiTransformationSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const { aiId, transformation } = input;
      const [user, ai, next, links] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchAnimationAiName(ctx.drizzle, aiId),
        transformation
          ? fetchAnimationAiName(ctx.drizzle, transformation.nextAiId)
          : undefined,
        listAiTransformations(ctx.drizzle),
      ]);
      if (user.isBanned || !canChangeContent(user.role))
        return errorResponse("Content editor access required");
      if (!ai) return errorResponse("AI not found");
      if (transformation && !next) return errorResponse("The next form must be an AI");
      const issue =
        transformation &&
        bossChainIssue({ userId: aiId, nextAiId: transformation.nextAiId }, links);
      if (issue) return errorResponse(issue);
      await Promise.all([
        transformation
          ? saveAiTransformation(ctx.drizzle, aiId, transformation)
          : deleteAiTransformation(ctx.drizzle, aiId),
        touchAnimationAi(ctx.drizzle, aiId),
        insertSpriteAnimationLog(ctx.drizzle, {
          id: nanoid(),
          userId: ctx.userId,
          tableName: "ai",
          relatedId: aiId,
          relatedMsg: `Boss transformation: ${ai.username}`,
          changes: [next ? `Transforms into ${next.username}` : "No longer transforms"],
        }),
      ]);
      await outdateProposalsFor(
        ctx.drizzle,
        "AI",
        [aiId],
        editedReason("AI", ai.username, user.username),
      );
      return { success: true, message: "Boss transformation saved" };
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

/** The earliest form leading into `aiId`, so any form's page shows the whole boss. */
const bossChainStart = (aiId: string, links: AiTransformation[]) => {
  const seen = new Set([aiId]);
  let first = aiId;
  let previous = links.find((link) => link.nextAiId === first);
  while (previous && !seen.has(previous.userId)) {
    first = previous.userId;
    seen.add(first);
    previous = links.find((link) => link.nextAiId === first);
  }
  return first;
};
