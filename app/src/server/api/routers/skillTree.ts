import { z } from "zod";
import { nanoid } from "nanoid";
import { eq, and, sql, like } from "drizzle-orm";
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

export const skillTreeRouter = createTRPCRouter({
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
          name: z.string().optional(),
          hidden: z.boolean().optional(),
          tier: z.number().min(1).max(10).optional(),
          costSkillPoints: z.number().min(1).optional(),
          effect: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const currentCursor = input?.cursor ? input.cursor : 0;
      const limit = input?.limit ? input.limit : 50;
      const skip = currentCursor * limit;

      const results = await ctx.drizzle.query.skillTree.findMany({
        where: and(
          ...(input?.name ? [like(skillTree.name, `%${input.name}%`)] : []),
          ...(input?.hidden !== undefined
            ? [eq(skillTree.hidden, input.hidden)]
            : [eq(skillTree.hidden, false)]),
          ...(input?.tier ? [eq(skillTree.tier, input.tier)] : []),
          ...(input?.costSkillPoints
            ? [eq(skillTree.costSkillPoints, input.costSkillPoints)]
            : []),
          ...(input?.effect
            ? [sql`JSON_SEARCH(${skillTree.effects},'one',${input.effect}) IS NOT NULL`]
            : []),
        ),
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
    return await ctx.drizzle.query.userSkill.findMany({
      where: eq(userSkill.userId, ctx.userId),
      with: { skill: true },
    });
  }),

  // Purchase a skill
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
        ctx.drizzle.query.userSkill.findMany({
          where: eq(userSkill.userId, ctx.userId),
          with: { skill: true },
        }),
      ]);

      if (!user) return errorResponse("User not found");
      if (!skill) return errorResponse("Skill not found");

      // Check if skill is already purchased
      const purchasedSkillIds = userSkills.map((us) => us.skillId);
      if (purchasedSkillIds.includes(input.skillId)) {
        return errorResponse("Skill already purchased");
      }

      // Calculate total used skill points
      const totalUsedSkillPoints = userSkills.reduce(
        (total, userSkill) => total + userSkill.skill.costSkillPoints,
        0,
      );

      // Check if user has enough skill points (available = total - used)
      const availableSkillPoints = user.skillPoints - totalUsedSkillPoints;
      if (availableSkillPoints < skill.costSkillPoints) {
        return errorResponse("Not enough skill points");
      }

      // Check prerequisites
      const hasAllPrereqs = skill.requiredSkillIds.every((reqId) =>
        purchasedSkillIds.includes(reqId),
      );
      if (!hasAllPrereqs) {
        return errorResponse("Prerequisites not met");
      }

      // Purchase the skill (just add to userSkill table)
      await ctx.drizzle.insert(userSkill).values({
        id: nanoid(),
        userId: ctx.userId,
        skillId: input.skillId,
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
      tier: 1,
      requiredSkillIds: [],
      costSkillPoints: 1,
      hidden: true,
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
        tier: input.data.tier,
        requiredSkillIds: input.data.requiredSkillIds,
        costSkillPoints: input.data.costSkillPoints,
        hidden: input.data.hidden,
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
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });

      if (!user) return errorResponse("User not found");

      // Check if user has enough reputation points
      if (user.reputationPoints < COST_SKILL_RESET) {
        return errorResponse(
          `Not enough reputation points. Need ${COST_SKILL_RESET} reputation points.`,
        );
      }

      // Perform the reset (parallel operations)
      await Promise.all([
        // Remove reputation points
        ctx.drizzle
          .update(userData)
          .set({
            reputationPoints: sql`${userData.reputationPoints} - ${COST_SKILL_RESET}`,
          })
          .where(eq(userData.userId, ctx.userId)),
        // Delete all user skills (skill points remain, just reset used skills)
        ctx.drizzle.delete(userSkill).where(eq(userSkill.userId, ctx.userId)),
      ]);

      return {
        success: true,
        message: `Skills points reset!`,
      };
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
        return errorResponse("You don't have permission to reset all users' skill trees");
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
