import { z } from "zod";
import { nanoid } from "nanoid";
import { eq, and, sql, like, gte, lt } from "drizzle-orm";
import { skillTree, userSkill, userData } from "@/drizzle/schema";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "@/api/trpc";
import { serverError, baseServerResponse, errorResponse } from "@/api/trpc";
import { fetchUpdatedUser } from "@/routers/profile";
import { canChangeContent } from "@/utils/permissions";
import { callDiscordContent } from "@/libs/discord";
import { calculateContentDiff } from "@/utils/diff";
import { IMG_AVATAR_DEFAULT, COST_SKILL_RESET } from "@/drizzle/constants";
import { SkillTreeValidator } from "@/libs/combat/types";
import { canUnequipAllUsers } from "@/utils/permissions";
import { actionLog } from "@/drizzle/schema";
import { getUserFederalStatus } from "@/utils/paypal";
import {
  skillTreeFilteringSchema,
  type SkillTreeFilteringSchema,
} from "@/validators/skillTree";
import {
  SKILL_TREE_RESET_FREE_GOLD,
  SKILL_TREE_RESET_FREE_NORMAL,
  SKILL_TREE_RESET_FREE_SILVER,
} from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

export const skillTreeRouter = createTRPCRouter({
  // Get all skill names for selectors
  getAllNames: publicProcedure.query(async ({ ctx }) => {
    return await ctx.drizzle.query.skillTree.findMany({
      columns: { id: true, name: true, skillType: true },
      orderBy: (table, { asc }) => [asc(table.name)],
    });
  }),
  // Get single skill by ID
  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const skill = await ctx.drizzle.query.skillTree.findFirst({
        where: eq(skillTree.id, input.id),
      });
      return skill;
    }),

  // Get all skills for tree view
  getAll: publicProcedure
    .input(
      z
        .object({
          cursor: z.number().nullish(),
          limit: z.number().min(1).max(500),
        })
        .merge(skillTreeFilteringSchema)
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const currentCursor = input?.cursor ? input.cursor : 0;
      const limit = input?.limit ? input.limit : 50;
      const skip = currentCursor * limit;

      // Build where conditions using the generalized filter function
      const baseFilters = skillTreeDatabaseFilter(input || {});

      const results = await ctx.drizzle.query.skillTree.findMany({
        where: and(...baseFilters),
        orderBy: [skillTree.tier, skillTree.name],
        limit: limit,
        offset: skip,
      });

      const nextCursor = results.length < limit ? null : currentCursor + 1;
      return {
        data: results,
        nextCursor,
      };
    }),

  // Get user's purchased skills
  getUserSkills: protectedProcedure.query(async ({ ctx }) => {
    return await fetchUserSkills(ctx.drizzle, ctx.userId);
  }),

  // Purchase a skill or activate an unlocked skill
  purchaseSkill: protectedProcedure
    .input(z.object({ skillId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch all required data in parallel
      const [{ user }, skill, userSkills] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        ctx.drizzle.query.skillTree.findFirst({
          where: and(eq(skillTree.id, input.skillId), eq(skillTree.hidden, false)),
        }),
        fetchUserSkills(ctx.drizzle, ctx.userId),
      ]);

      if (!user) return errorResponse("User not found");
      if (!skill) return errorResponse("Skill not found");

      // Get activated skill IDs (shared logic)
      const activatedSkillIds = userSkills
        .filter((us) => us.activated)
        .map((us) => us.skillId);

      // Check prerequisites (shared logic)
      const hasAllPrereqs = skill.requiredSkillIds.every((reqId) =>
        activatedSkillIds.includes(reqId),
      );
      if (!hasAllPrereqs) {
        return errorResponse("Prerequisites not met");
      }

      // Calculate total used skill points (only activated skills count)
      const totalUsedSkillPoints = userSkills
        .filter((us) => us.activated)
        .reduce((total, userSkill) => total + userSkill.skill.costSkillPoints, 0);

      // Check if user has enough skill points (available = total - used)
      const availableSkillPoints = user.skillPoints - totalUsedSkillPoints;
      if (availableSkillPoints < skill.costSkillPoints) {
        return errorResponse("Not enough skill points");
      }

      // For special skills, the user should already have it
      const existingUserSkill = userSkills.find((us) => us.skillId === input.skillId);
      if (skill.skillType === "SPECIAL" && !existingUserSkill) {
        return errorResponse(
          "You cannot activate this special skill without unlocking it first",
        );
      }

      // Check if skill is already owned
      if (existingUserSkill) {
        if (existingUserSkill.activated) {
          return errorResponse("Skill already activated");
        }
        await ctx.drizzle
          .update(userSkill)
          .set({ activated: true })
          .where(eq(userSkill.id, existingUserSkill.id));
        return { success: true, message: `Successfully activated ${skill.name}!` };
      }

      // Purchase the skill (add to userSkill table, activated by default)
      await ctx.drizzle.insert(userSkill).values({
        id: nanoid(),
        userId: ctx.userId,
        skillId: input.skillId,
        activated: true,
      });

      return { success: true, message: `Successfully purchased ${skill.name}!` };
    }),

  // Admin: Create new skill with placeholder data
  create: protectedProcedure.output(baseServerResponse).mutation(async ({ ctx }) => {
    // Check permissions
    const { user } = await fetchUpdatedUser({
      client: ctx.drizzle,
      userId: ctx.userId,
    });
    if (!user || !canChangeContent(user.role)) {
      throw serverError("UNAUTHORIZED", "You are not authorized to create skills");
    }

    const id = nanoid();
    await ctx.drizzle.insert(skillTree).values({
      id,
      name: `New Skill - ${id}`,
      description: "New skill description",
      image: IMG_AVATAR_DEFAULT,
      effects: [],
      target: "SELF",
      tier: 1,
      requiredSkillIds: [],
      costSkillPoints: 1,
      hidden: true,
      skillType: "DEFAULT",
    });

    await callDiscordContent(user.username, `Created skill: New Skill - ${id}`, [
      "skill created",
    ]);

    return { success: true, message: id };
  }),

  // Admin: Update skill
  update: protectedProcedure
    .input(z.object({ id: z.string(), data: SkillTreeValidator }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Check permissions
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });
      if (!user || !canChangeContent(user.role)) {
        throw serverError(
          "UNAUTHORIZED",
          "You are not authorized to edit this content",
        );
      }

      // Get existing skill
      const skill = await ctx.drizzle.query.skillTree.findFirst({
        where: eq(skillTree.id, input.id),
      });

      if (!skill) return errorResponse("Skill not found");

      // Prepare the data
      const data = {
        name: input.data.name,
        image: input.data.image || IMG_AVATAR_DEFAULT,
        description: input.data.description,
        effects: input.data.effects,
        target: input.data.target,
        tier: input.data.tier,
        requiredSkillIds: input.data.requiredSkillIds,
        costSkillPoints: input.data.costSkillPoints,
        hidden: input.data.hidden,
        skillType: input.data.skillType,
      };

      const diff = calculateContentDiff(skill, {
        id: skill.id,
        createdAt: skill.createdAt,
        updatedAt: skill.updatedAt,
        ...data,
      });

      if (diff.length > 0) {
        await ctx.drizzle.update(skillTree).set(data).where(eq(skillTree.id, input.id));

        await callDiscordContent(user.username, `Updated skill: ${skill.name}`, [
          diff.join(", "),
        ]);
      }

      return { success: true, message: `Data updated: ${diff.join(". ")}` };
    }),

  // Admin: Delete skill
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Check permissions
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });
      if (!user || !canChangeContent(user.role)) {
        throw serverError(
          "UNAUTHORIZED",
          "You are not authorized to delete this content",
        );
      }

      const skill = await ctx.drizzle.query.skillTree.findFirst({
        where: eq(skillTree.id, input.id),
      });

      if (!skill) return errorResponse("Skill not found");

      // Check if any users have this skill
      const usersWithSkill = await ctx.drizzle.query.userSkill.findMany({
        where: eq(userSkill.skillId, input.id),
      });
      if (usersWithSkill.length > 0) {
        return errorResponse("Cannot delete skill that users have purchased");
      }

      await ctx.drizzle.delete(skillTree).where(eq(skillTree.id, input.id));

      await callDiscordContent(user.username, `Deleted skill: ${skill.name}`, [
        "skill deleted",
      ]);

      return { success: true, message: "Skill deleted successfully" };
    }),

  // Reset user's skill points (clear all skills and refund points)
  resetSkillPoints: protectedProcedure
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      // Fetch user data
      const [{ user }, monthlyResets] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchMonthlyResets(ctx.drizzle, ctx.userId),
      ]);
      // Guard
      if (!user) return errorResponse("User not found");

      // Determine if this reset should be free (GOLD supporters get first two per month free)
      const freeResets = getFreeResetAmount(user);
      const freeResetsUsed = monthlyResets.length;
      const isFreeReset = freeResetsUsed < freeResets;

      // Guard: if not free, ensure user can afford
      if (!isFreeReset && user.reputationPoints < COST_SKILL_RESET) {
        return errorResponse(
          `Not enough reputation points. Need ${COST_SKILL_RESET} reputation points.`,
        );
      }

      // Perform the reset (parallel operations)
      const updates: Promise<unknown>[] = [];
      // Delete all user skills (skill points remain, just reset used skills)
      updates.push(
        ctx.drizzle.delete(userSkill).where(eq(userSkill.userId, ctx.userId)),
      );
      if (!isFreeReset) {
        updates.push(
          ctx.drizzle
            .update(userData)
            .set({
              reputationPoints: sql`${userData.reputationPoints} - ${COST_SKILL_RESET}`,
            })
            .where(eq(userData.userId, ctx.userId)),
        );
      }

      // Log the reset for monthly tracking
      updates.push(
        ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "skillReset",
          changes: [
            isFreeReset
              ? "Skill tree reset (free GOLD monthly)"
              : `Skill tree reset (-${COST_SKILL_RESET} reps)`,
          ],
          relatedId: null,
          relatedMsg: isFreeReset
            ? "Free monthly reset for GOLD supporter"
            : `Charged ${COST_SKILL_RESET} reputation points`,
          relatedImage: user.avatarLight,
          relatedValue: isFreeReset ? 0 : COST_SKILL_RESET,
        }),
      );

      // Execute all promises
      await Promise.all(updates);

      return {
        success: true,
        message: `Skills points reset!${isFreeReset ? " (Free for GOLD supporter)" : ""}`,
      };
    }),

  // Info: whether current user has a free reset available this month
  getResetInfo: protectedProcedure.query(async ({ ctx }) => {
    // Query
    const [{ user }, monthlyResets] = await Promise.all([
      fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      }),
      fetchMonthlyResets(ctx.drizzle, ctx.userId),
    ]);
    // Guard
    if (!user) return { isFree: false, freeResetsUsed: 0, freeResetsRemaining: 0 };
    // Derived
    const freeResets = getFreeResetAmount(user);
    const freeResetsUsed = monthlyResets.length;
    const freeResetsRemaining = freeResets - freeResetsUsed;
    const isFree = freeResetsRemaining > 0;
    // Return
    return { isFree, freeResetsUsed, freeResetsRemaining };
  }),

  // Reset all users' skill points (staff only)
  resetAllUsersSkillPoints: protectedProcedure
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      // Fetch user data to check permissions
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });

      if (!user) return errorResponse("User not found");

      // Check if user has permission to unequip all users
      if (!canUnequipAllUsers(user)) {
        return errorResponse(
          "You don't have permission to reset all users' skill trees",
        );
      }

      // Get all users with skill trees
      const allUsers = await ctx.drizzle.select().from(userData);

      if (allUsers.length === 0) {
        return errorResponse("No users found");
      }

      // Delete all user skills (skill points remain, just reset used skills)
      const result = await ctx.drizzle.delete(userSkill);

      if (result.rowsAffected === 0) {
        return errorResponse("Failed to reset skill trees");
      }

      // Log the action
      await ctx.drizzle.insert(actionLog).values({
        id: nanoid(),
        userId: ctx.userId,
        tableName: "userSkill",
        changes: [`Mass reset all users' skill trees`],
        relatedId: null,
        relatedMsg: `Mass skill tree reset by ${user.username}`,
        relatedImage: user.avatarLight,
      });

      return {
        success: true,
        message: `Reset skill trees for all ${allUsers.length} users`,
      };
    }),
});

/**
 * Builds the where conditions for the skill tree database filter
 * @param input - The input object containing the filter criteria
 * @returns The where conditions for the skill tree database filter
 */
export const skillTreeDatabaseFilter = (input: SkillTreeFilteringSchema) => {
  const filters = [];

  if (input.name) {
    filters.push(like(skillTree.name, `%${input.name}%`));
  }

  if (input.effect && input.effect.length > 0) {
    filters.push(
      sql`JSON_SEARCH(${skillTree.effects}, 'one', ${input.effect[0]}, NULL, '$[*].type') IS NOT NULL`,
    );
  }

  if (input.tier) {
    filters.push(eq(skillTree.tier, input.tier));
  }

  if (input.costSkillPoints) {
    filters.push(eq(skillTree.costSkillPoints, input.costSkillPoints));
  }

  // Default to false if hidden is undefined (show non-hidden skills by default)
  if (input.hidden !== undefined) {
    filters.push(eq(skillTree.hidden, input.hidden));
  } else {
    filters.push(eq(skillTree.hidden, false));
  }

  return filters;
};

/**
 * Fetch the number of monthly resets for a user
 * @param client - The database client
 * @param userId - The user ID
 * @returns The number of monthly resets for the user
 */
export const fetchMonthlyResets = async (client: DrizzleClient, userId: string) => {
  const now = new Date();
  const startOfMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0),
  );
  const startOfNextMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0),
  );
  const results = await client.query.actionLog.findMany({
    where: and(
      eq(actionLog.userId, userId),
      eq(actionLog.tableName, "skillReset"),
      gte(actionLog.createdAt, startOfMonth),
      lt(actionLog.createdAt, startOfNextMonth),
    ),
    columns: { id: true },
  });
  return results;
};

/**
 * Get the free reset amount for a user
 * @param user - The user
 * @returns The free reset amount
 */
export const getFreeResetAmount = (user: UserData) => {
  const status = getUserFederalStatus(user);
  switch (status) {
    case "NORMAL":
      return SKILL_TREE_RESET_FREE_NORMAL;
    case "SILVER":
      return SKILL_TREE_RESET_FREE_SILVER;
    case "GOLD":
      return SKILL_TREE_RESET_FREE_GOLD;
    default:
      return 0;
  }
};

/**
 * Fetch the user's skills
 * @param client - The database client
 * @param userId - The user ID
 * @returns The user's skills
 */
export const fetchUserSkills = async (client: DrizzleClient, userId: string) => {
  return await client.query.userSkill.findMany({
    where: eq(userSkill.userId, userId),
    with: { skill: true },
  });
};
