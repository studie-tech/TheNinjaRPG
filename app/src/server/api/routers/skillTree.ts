import {
  and,
  asc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  like,
  lt,
  ne,
  not,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  COST_SKILL_RESET,
  IMG_AVATAR_DEFAULT,
  SKILL_TREE_RESET_FREE_GOLD,
  SKILL_TREE_RESET_FREE_NORMAL,
  SKILL_TREE_RESET_FREE_SILVER,
} from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import {
  actionLog,
  bloodline,
  skillTree,
  skillTreeFolder,
  userData,
  userItem,
  userSkill,
} from "@/drizzle/schema";
import type { MasterySources } from "@/libs/mastery";
import { effectiveMasteries } from "@/libs/mastery";
import { calcMaxEnergy } from "@/libs/profile";
import { callDiscordContent } from "@/libs/socials";
import { fetchUpdatedUser } from "@/routers/profile";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
  serverError,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { getNextUserSnapshotAt } from "@/server/utils/concurrency";
import { calculateContentDiff } from "@/utils/diff";
import { getUserFederalStatus } from "@/utils/paypal";
import {
  canAccessHiddenSkillTree,
  canChangeContent,
  canUnequipAllUsers,
  isStaffMember,
} from "@/utils/permissions";
import { getUtcMonthKey } from "@/utils/time";
import { SkillTreeValidator } from "@/validators/combat";
import { idSchema } from "@/validators/misc";
import {
  createSkillSchema,
  type SkillTreeFilteringSchema,
  skillTreeFilteringSchema,
  skillTreeFolderSchema,
} from "@/validators/skillTree";
import { userDeltaResponseSchema } from "@/validators/userCache";

export const skillTreeRouter = createTRPCRouter({
  // Get all skill names for selectors
  getAllNames: publicProcedure
    .meta({ mcp: { description: "Get all skill names for selectors" } })
    .query(async ({ ctx }) => {
      const [user, skills] = await Promise.all([
        fetchSkillTreeViewer(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.skillTree.findMany({
          columns: { id: true, name: true, skillType: true, hidden: true },
          where: eq(skillTree.pathType, "SKILL"),
          with: { folder: true },
          orderBy: (table, { asc }) => [asc(table.name)],
        }),
      ]);
      return skills
        .filter((skill) => isSkillVisible(skill, canAccessHiddenSkillTree(user?.role)))
        .map(({ id, name, skillType }) => ({ id, name, skillType }));
    }),
  // Get single skill by ID
  get: publicProcedure
    .meta({ mcp: { description: "Get a skill by ID" } })
    .input(idSchema)
    .query(async ({ ctx, input }) => {
      const [user, skill] = await Promise.all([
        fetchSkillTreeViewer(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.skillTree.findFirst({
          where: eq(skillTree.id, input.id),
          with: { folder: true },
        }),
      ]);
      // React Query rejects undefined query data, so missing/hidden skills resolve to null.
      return skill && isSkillVisible(skill, canAccessHiddenSkillTree(user?.role))
        ? skill
        : null;
    }),

  // Get all skills for tree view
  getAll: publicProcedure
    .meta({ mcp: { description: "Get all skills with filtering" } })
    .input(
      z
        .object({
          cursor: z.number().nullish(),
          limit: z.number().min(1).max(500),
        })
        .extend(skillTreeFilteringSchema.shape)
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const currentCursor = input?.cursor ? input.cursor : 0;
      const limit = input?.limit ? input.limit : 50;
      const skip = currentCursor * limit;

      // Build where conditions using the generalized filter function
      const baseFilters = skillTreeDatabaseFilter(input || {});

      // Visibility must be applied before pagination, so this query depends on the viewer.
      const user = await fetchSkillTreeViewer(ctx.drizzle, ctx.userId);
      if (!canAccessHiddenSkillTree(user?.role)) {
        baseFilters.push(
          eq(skillTree.hidden, false),
          or(
            isNull(skillTree.folderId),
            notInArray(
              skillTree.folderId,
              ctx.drizzle
                .select({ id: skillTreeFolder.id })
                .from(skillTreeFolder)
                .where(eq(skillTreeFolder.hidden, true)),
            ),
          )!,
        );
      }
      const results = await ctx.drizzle.query.skillTree.findMany({
        where: and(...baseFilters),
        orderBy: [skillTree.tier, skillTree.name],
        with: { folder: true },
        limit,
        offset: skip,
      });

      const nextCursor = results.length < limit ? null : currentCursor + 1;
      return {
        data: results,
        nextCursor,
      };
    }),

  // Get user's purchased skills
  getUserSkills: protectedProcedure
    .meta({ mcp: { description: "Get user's purchased skills" } })
    .query(async ({ ctx }) => {
      const [user, skills] = await Promise.all([
        fetchSkillTreeViewer(ctx.drizzle, ctx.userId),
        fetchUserSkills(ctx.drizzle, ctx.userId),
      ]);
      const activatedSkills = skills.filter((entry) => entry.activated);
      return {
        skills: skills.filter((entry) =>
          isSkillVisible(entry.skill, canAccessHiddenSkillTree(user?.role)),
        ),
        // Prerequisites remain satisfied even when an activated skill becomes hidden.
        activatedSkillIds: activatedSkills.map((entry) => entry.skillId),
        activatedSkillCount: activatedSkills.length,
        // Hidden activated skills still consume points even when their details are inaccessible.
        usedSkillPoints: activatedSkills.reduce(
          (total, entry) => total + entry.skill.costSkillPoints,
          0,
        ),
      };
    }),

  // Purchase a skill or activate an unlocked skill
  purchaseSkill: protectedProcedure
    .meta({ mcp: { description: "Purchase or activate a skill" } })
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
          where: eq(skillTree.id, input.skillId),
          with: { folder: true },
        }),
        fetchUserSkills(ctx.drizzle, ctx.userId),
      ]);

      if (!user) return errorResponse("User not found");
      if (
        !skill ||
        skill.pathType === "BLOODRIGHT" ||
        !isSkillVisible(skill, canAccessHiddenSkillTree(user.role))
      ) {
        return errorResponse("Skill not found");
      }

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
      // Uses onDuplicateKeyUpdate to handle race conditions where concurrent requests
      // both pass the ownership check. The unique index on (userId, skillId) ensures
      // only one record exists, and we simply update activated=true if it already exists.
      await ctx.drizzle
        .insert(userSkill)
        .values({
          id: nanoid(),
          userId: ctx.userId,
          skillId: input.skillId,
          activated: true,
        })
        .onDuplicateKeyUpdate({ set: { activated: true } });

      return { success: true, message: `Successfully purchased ${skill.name}!` };
    }),

  // Admin: Create new skill with placeholder data
  create: protectedProcedure
    .input(createSkillSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Check permissions
      const [{ user }, line] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        input?.bloodlineId
          ? ctx.drizzle.query.bloodline.findFirst({
              where: eq(bloodline.id, input.bloodlineId),
              columns: { id: true },
            })
          : Promise.resolve(null),
      ]);
      if (!user || !canChangeContent(user.role)) {
        throw serverError("UNAUTHORIZED", "You are not authorized to create skills");
      }
      // New skills start hidden, so their creator must be allowed to access them.
      if (!canAccessHiddenSkillTree(user.role)) {
        return errorResponse("You are not authorized to create hidden skills");
      }

      if (input?.bloodlineId && !line) return errorResponse("Bloodline not found");
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
        pathType: input?.bloodlineId ? "BLOODRIGHT" : "SKILL",
        bloodlineId: input?.bloodlineId ?? null,
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
      const requestedFolderId = input.data.folderId || null;
      const [
        { user },
        skill,
        skillWithName,
        targetFolder,
        line,
        prerequisites,
        purchased,
        dependents,
      ] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        ctx.drizzle.query.skillTree.findFirst({
          where: eq(skillTree.id, input.id),
          with: { folder: true },
        }),
        ctx.drizzle.query.skillTree.findFirst({
          columns: { name: true, id: true },
          where: eq(skillTree.name, input.data.name),
        }),
        requestedFolderId
          ? ctx.drizzle.query.skillTreeFolder.findFirst({
              where: eq(skillTreeFolder.id, requestedFolderId),
              columns: { hidden: true },
            })
          : Promise.resolve(null),
        input.data.bloodlineId
          ? ctx.drizzle.query.bloodline.findFirst({
              where: eq(bloodline.id, input.data.bloodlineId),
              columns: { id: true },
            })
          : Promise.resolve(null),
        input.data.requiredSkillIds.length
          ? ctx.drizzle.query.skillTree.findMany({
              where: inArray(skillTree.id, input.data.requiredSkillIds),
            })
          : Promise.resolve([]),
        input.data.pathType === "BLOODRIGHT"
          ? ctx.drizzle.query.userData.findFirst({
              where: sql`JSON_SEARCH(${userData.bloodright}, 'one', ${input.id}, NULL, '$[*].skillId') IS NOT NULL`,
              columns: { userId: true },
            })
          : Promise.resolve(null),
        ctx.drizzle.query.skillTree.findMany({
          where: sql`JSON_CONTAINS(${skillTree.requiredSkillIds}, ${JSON.stringify(input.id)})`,
          columns: { id: true, tier: true, bloodlineId: true, pathType: true },
        }),
      ]);
      if (!user || !canChangeContent(user.role)) {
        throw serverError(
          "UNAUTHORIZED",
          "You are not authorized to edit this content",
        );
      }
      const canViewHidden = canAccessHiddenSkillTree(user.role);
      // A hidden skill, or a skill in a hidden folder, is invisible to this role.
      if (!skill || !isSkillVisible(skill, canViewHidden)) {
        return errorResponse("Skill not found");
      }
      // Hiding the skill or moving it into a hidden folder would make this save unreadable.
      if (!canViewHidden && (input.data.hidden || targetFolder?.hidden)) {
        return errorResponse("You are not authorized to hide skills");
      }
      if (skillWithName && skillWithName.id !== skill.id)
        return errorResponse("Skill name already exists");

      if (input.data.pathType !== skill.pathType)
        return errorResponse("A tier's path type cannot be changed");
      if (
        input.data.pathType === "BLOODRIGHT" &&
        (!input.data.bloodlineId || input.data.skillType !== "DEFAULT")
      ) {
        return errorResponse(
          "Bloodright tiers require a bloodline and the DEFAULT entry type",
        );
      }
      if (input.data.pathType === "BLOODRIGHT" && !line)
        return errorResponse("Bloodline not found");
      const changesHierarchy =
        skill.tier !== input.data.tier ||
        (skill.bloodlineId ?? null) !== (input.data.bloodlineId || null) ||
        JSON.stringify(skill.requiredSkillIds) !==
          JSON.stringify(input.data.requiredSkillIds);
      if (
        changesHierarchy &&
        (prerequisites.length !== input.data.requiredSkillIds.length ||
          prerequisites.some(
            (tier) =>
              tier.id === skill.id ||
              tier.tier >= input.data.tier ||
              tier.pathType !== input.data.pathType ||
              (tier.bloodlineId ?? null) !== (input.data.bloodlineId || null),
          ))
      ) {
        return errorResponse(
          "Prerequisites must belong to the same path and bloodline, and a lower tier",
        );
      }
      if (purchased && changesHierarchy)
        return errorResponse(
          "Refund purchased Bloodright tiers before changing their bloodline, tier or prerequisites",
        );
      if (input.data.pathType === "SKILL" && input.data.bloodlineId)
        return errorResponse("Only Bloodright tiers can have a bloodline");

      if (
        changesHierarchy &&
        dependents.some(
          (tier) =>
            tier.pathType !== input.data.pathType ||
            tier.bloodlineId !== (input.data.bloodlineId || null) ||
            tier.tier <= input.data.tier,
        )
      )
        return errorResponse(
          "This change would invalidate a dependent tier. Update its prerequisites first",
        );

      // The folder relation is only for the visibility check above.
      const { folder: _currentFolder, ...skillRecord } = skill;

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
        pathType: input.data.pathType,
        bloodlineId: input.data.bloodlineId || null,
        seichiSilverCost: input.data.seichiSilverCost,
        hidden: input.data.hidden,
        skillType: input.data.skillType,
        folderId: input.data.folderId || null,
      };

      const diff = calculateContentDiff(skillRecord, {
        id: skill.id,
        createdAt: skill.createdAt,
        updatedAt: skill.updatedAt,
        ...data,
      });

      if (diff.length > 0) {
        const result = await ctx.drizzle
          .update(skillTree)
          .set({ ...data, updatedAt: getNextUserSnapshotAt(skill.updatedAt) })
          .where(
            and(
              eq(skillTree.id, input.id),
              changesHierarchy && skill.pathType === "BLOODRIGHT"
                ? sql`NOT EXISTS (SELECT 1 FROM ${userData} WHERE JSON_SEARCH(${userData.bloodright}, 'one', ${skill.id}, NULL, '$[*].skillId') IS NOT NULL)`
                : undefined,
            ),
          );
        if (result.rowsAffected !== 1)
          return errorResponse("Tier changed or was purchased. Refresh and try again");

        await callDiscordContent(user.username, `Updated skill: ${skill.name}`, [
          diff.join(", "),
        ]);
      }

      return { success: true, message: `Data updated: ${diff.join(". ")}` };
    }),

  // Admin: Delete skill
  delete: protectedProcedure
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [{ user }, skill, usersWithSkill, bloodrightOwner, dependents] =
        await Promise.all([
          fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
          ctx.drizzle.query.skillTree.findFirst({ where: eq(skillTree.id, input.id) }),
          ctx.drizzle.query.userSkill.findMany({
            where: eq(userSkill.skillId, input.id),
          }),
          ctx.drizzle.query.userData.findFirst({
            where: sql`JSON_SEARCH(${userData.bloodright}, 'one', ${input.id}, NULL, '$[*].skillId') IS NOT NULL`,
            columns: { userId: true },
          }),
          ctx.drizzle.query.skillTree.findMany({
            where: sql`JSON_CONTAINS(${skillTree.requiredSkillIds}, ${JSON.stringify(input.id)})`,
            columns: { id: true },
          }),
        ]);
      if (!user || !canChangeContent(user.role)) {
        throw serverError(
          "UNAUTHORIZED",
          "You are not authorized to delete this content",
        );
      }

      if (!skill) return errorResponse("Skill not found");
      if (dependents.length)
        return errorResponse(
          "Cannot delete a tier referenced by dependent tiers. Update their prerequisites first",
        );
      if (usersWithSkill.length > 0 || bloodrightOwner) {
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
    .meta({ mcp: { description: "Reset user's skill tree" } })
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx }) => {
      // Fetch user data
      const [updatedUser, monthlyResets] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchMonthlyResets(ctx.drizzle, ctx.userId),
      ]);
      const { user } = updatedUser;
      // Guard
      if (!user) return errorResponse("User not found");

      // Determine if this reset should be free (GOLD supporters get first two per month free)
      const federalStatus = getUserFederalStatus(user);
      const freeResets = getFreeResetAmount(user);
      const resetState = getMonthlyResetState(user, monthlyResets.length);
      const freeResetsUsed = resetState.count;
      const hasFreeResetAvailable = freeResetsUsed < freeResets;
      const isStaffFreeReset = isStaffMember(user);
      const isFreeReset = hasFreeResetAvailable || isStaffFreeReset;

      // Guard: if not free, ensure user can afford
      if (!isFreeReset && user.reputationPoints < COST_SKILL_RESET) {
        return errorResponse(
          `Not enough reputation points. Need ${COST_SKILL_RESET} reputation points.`,
        );
      }

      // Both trees share one persisted allowance; CAS prevents concurrent free resets.
      const result = await ctx.drizzle
        .update(userData)
        .set({
          updatedAt: getNextUserSnapshotAt(user.updatedAt),
          reputationPoints: sql`${userData.reputationPoints} - ${isFreeReset ? 0 : COST_SKILL_RESET}`,
          monthlySkillResets: {
            ...resetState,
            count: resetState.count + (isStaffFreeReset ? 0 : 1),
          },
        })
        .where(
          and(
            eq(userData.userId, ctx.userId),
            sql`${userData.monthlySkillResets} = CAST(${JSON.stringify(user.monthlySkillResets)} AS JSON)`,
            gte(userData.reputationPoints, isFreeReset ? 0 : COST_SKILL_RESET),
          ),
        );
      if (result.rowsAffected !== 1)
        return errorResponse(
          "Your reset allowance or reputation balance changed. Refresh and try again",
        );

      const resetActionLogDetails = !isFreeReset
        ? {
            changes: [`Skill tree reset (-${COST_SKILL_RESET} reps)`],
            relatedMsg: `Charged ${COST_SKILL_RESET} reputation points`,
            relatedValue: COST_SKILL_RESET,
          }
        : isStaffFreeReset
          ? {
              changes: ["Skill tree reset (free staff)"],
              relatedMsg: SKILL_RESET_STAFF_RELATED_MSG,
              relatedValue: 0,
            }
          : {
              changes: [`Skill tree reset (free ${federalStatus} - monthly)`],
              relatedMsg: `Free monthly reset for ${federalStatus} supporter`,
              relatedValue: 0,
            };

      // Perform the reset
      const writes: Promise<unknown>[] = [
        ctx.drizzle.delete(userSkill).where(eq(userSkill.userId, ctx.userId)),
        ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "skillReset",
          relatedId: null,
          relatedImage: user.avatarLight,
          ...resetActionLogDetails,
        }),
      ];

      await Promise.all(writes);

      const maxEnergy = calcMaxEnergy({ ...user, userSkills: [] });
      return {
        success: true,
        userDelta: updatedUser.requiresUserRefresh
          ? undefined
          : isFreeReset
            ? {}
            : { reputationPoints: -COST_SKILL_RESET },
        userPatch: {
          monthlySkillResets: {
            ...resetState,
            count: resetState.count + (isStaffFreeReset ? 0 : 1),
          },
          maxEnergy,
          effectiveMasteries: effectiveMasteries({ ...user, userSkills: [] }),
        },
        message: `Skills points reset!${isFreeReset ? (isStaffFreeReset ? " (Free for staff member)" : ` (Free for ${federalStatus} supporter)`) : ""}`,
      };
    }),

  // Info: whether current user has a free reset available this month
  getResetInfo: protectedProcedure
    .meta({
      mcp: { description: "Get skill reset info and free resets" },
    })
    .query(async ({ ctx }) => {
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
      const freeResetsUsed = getMonthlyResetState(user, monthlyResets.length).count;
      const freeResetsRemaining = Math.max(0, freeResets - freeResetsUsed);
      const isFree = freeResetsRemaining > 0 || isStaffMember(user);
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

      // Delete in batches to avoid PlanetScale/Vitess timeouts (vttablet EOF on large single deletes)
      const BATCH_SIZE = 500;
      let totalDeleted = 0;
      let hadUndeletedRows = false;

      while (true) {
        const batch = await ctx.drizzle
          .select({ id: userSkill.id })
          .from(userSkill)
          .limit(BATCH_SIZE);

        if (batch.length === 0) break;

        const ids = batch.map((row) => row.id);
        const result = await ctx.drizzle
          .delete(userSkill)
          .where(inArray(userSkill.id, ids));
        if (result.rowsAffected === 0) {
          hadUndeletedRows = true;
          break;
        }
        totalDeleted += result.rowsAffected;
      }

      if (totalDeleted === 0) {
        return errorResponse(
          hadUndeletedRows
            ? "Failed to reset skill trees"
            : "No skill tree entries to reset",
        );
      }

      if (hadUndeletedRows) {
        await ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "userSkill",
          changes: [`Partial mass reset of users' skill trees`],
          relatedId: null,
          relatedMsg: `Partial skill tree reset by ${user.username} (${totalDeleted} entries cleared, some remained)`,
          relatedImage: user.avatarLight,
        });
        return errorResponse(
          `Partial reset: ${totalDeleted} entries cleared, but some entries could not be deleted`,
        );
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
        message: `Reset skill trees (${totalDeleted} entries cleared)`,
      };
    }),

  // ============================================
  // FOLDER ENDPOINTS
  // ============================================

  // Get all folders (with optional hidden filter for admins)
  getAllFolders: publicProcedure
    .meta({ mcp: { description: "Get all skill tree folders" } })
    .input(z.object({ includeHidden: z.boolean().optional() }).nullish())
    .query(async ({ ctx, input }) => {
      const [user, folders] = await Promise.all([
        fetchSkillTreeViewer(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.skillTreeFolder.findMany({
          orderBy: [asc(skillTreeFolder.order), asc(skillTreeFolder.name)],
        }),
      ]);
      const isStaff = canAccessHiddenSkillTree(user?.role);

      // Filter out hidden folders unless staff requested them
      if (!input?.includeHidden || !isStaff) {
        return folders.filter((folder) => !folder.hidden);
      }
      return folders;
    }),

  // Get folder stats (owned/total skill counts per folder for current user)
  getFolderStats: protectedProcedure
    .meta({ mcp: { description: "Get skill folder progress stats" } })
    .query(async ({ ctx }) => {
      // Fetch all data in parallel for efficiency
      const [allFolders, skills, userSkillsData, user] = await Promise.all([
        ctx.drizzle.query.skillTreeFolder.findMany({
          orderBy: [asc(skillTreeFolder.order), asc(skillTreeFolder.name)],
        }),
        ctx.drizzle.query.skillTree.findMany({
          columns: { id: true, folderId: true, hidden: true, skillType: true },
          where: eq(skillTree.pathType, "SKILL"),
          with: { folder: true },
        }),
        fetchUserSkills(ctx.drizzle, ctx.userId),
        fetchSkillTreeViewer(ctx.drizzle, ctx.userId),
      ]);
      const includeHidden = canAccessHiddenSkillTree(user?.role);
      const folders = allFolders.filter((folder) => includeHidden || !folder.hidden);
      const ownedIds = new Set(userSkillsData.map((entry) => entry.skillId));
      const allSkills = skills.filter(
        (skill) =>
          isSkillVisible(skill, includeHidden) &&
          (skill.skillType !== "SPECIAL" || ownedIds.has(skill.id)),
      );

      // Get activated skill IDs (only activated skills count toward progression)
      const ownedSkillIds = new Set(
        userSkillsData.filter((us) => us.activated).map((us) => us.skillId),
      );

      // Calculate stats per folder
      const folderStats = folders.map((folder) => {
        const folderSkills = allSkills.filter((s) => s.folderId === folder.id);
        const totalSkills = folderSkills.length;
        const ownedSkills = folderSkills.filter((s) => ownedSkillIds.has(s.id)).length;
        return {
          folderId: folder.id,
          folderName: folder.name,
          folderImage: folder.image,
          totalSkills,
          ownedSkills,
        };
      });

      // Also add stats for skills without a folder (if any)
      const unassignedSkills = allSkills.filter((s) => !s.folderId);
      if (unassignedSkills.length > 0) {
        folderStats.push({
          folderId: "",
          folderName: "Uncategorized",
          folderImage: "",
          totalSkills: unassignedSkills.length,
          ownedSkills: unassignedSkills.filter((s) => ownedSkillIds.has(s.id)).length,
        });
      }

      return folderStats;
    }),

  // Admin: Create new folder
  createFolder: protectedProcedure
    .input(skillTreeFolderSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Check permissions
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });
      if (!user || !canChangeContent(user.role)) {
        throw serverError("UNAUTHORIZED", "You are not authorized to create folders");
      }
      if (input.hidden && !canAccessHiddenSkillTree(user.role)) {
        return errorResponse("You are not authorized to create hidden folders");
      }

      const id = nanoid();
      await ctx.drizzle.insert(skillTreeFolder).values({
        id,
        name: input.name,
        image: input.image || "",
        description: input.description || null,
        hidden: input.hidden || false,
        order: input.order || 0,
      });

      return { success: true, message: id };
    }),

  // Admin: Update folder
  updateFolder: protectedProcedure
    .input(z.object({ id: z.string(), data: skillTreeFolderSchema }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Check permissions and fetch folder in parallel
      const [{ user }, folder] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        ctx.drizzle.query.skillTreeFolder.findFirst({
          where: eq(skillTreeFolder.id, input.id),
        }),
      ]);
      if (!user || !canChangeContent(user.role)) {
        throw serverError("UNAUTHORIZED", "You are not authorized to edit folders");
      }
      if (input.data.hidden && !canAccessHiddenSkillTree(user.role)) {
        return errorResponse("You are not authorized to hide folders");
      }
      if (!folder) return errorResponse("Folder not found");

      await ctx.drizzle
        .update(skillTreeFolder)
        .set({
          name: input.data.name,
          image: input.data.image || "",
          description: input.data.description || null,
          hidden: input.data.hidden || false,
          order: input.data.order || 0,
          updatedAt: new Date(),
        })
        .where(eq(skillTreeFolder.id, input.id));

      return { success: true, message: "Folder updated successfully" };
    }),

  // Admin: Delete folder (with guard for non-empty folders)
  deleteFolder: protectedProcedure
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Check permissions, fetch folder, and fetch skills in folder in parallel
      const [{ user }, folder, skillsInFolder] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        ctx.drizzle.query.skillTreeFolder.findFirst({
          where: eq(skillTreeFolder.id, input.id),
          columns: { id: true },
        }),
        ctx.drizzle.query.skillTree.findMany({
          where: eq(skillTree.folderId, input.id),
          columns: { id: true },
        }),
      ]);
      if (!user || !canChangeContent(user.role)) {
        throw serverError("UNAUTHORIZED", "You are not authorized to delete folders");
      }
      if (!folder) {
        return errorResponse("Folder not found");
      }
      if (skillsInFolder.length > 0) {
        return errorResponse(
          `Cannot delete folder that contains ${skillsInFolder.length} skill(s). Please move or delete skills first.`,
        );
      }

      await ctx.drizzle.delete(skillTreeFolder).where(eq(skillTreeFolder.id, input.id));

      return { success: true, message: "Folder deleted successfully" };
    }),

  // Admin: Reorder folders (batch update folder ordering)
  reorderFolders: protectedProcedure
    .input(
      z.object({
        folderOrders: z.array(z.object({ id: z.string(), order: z.number() })),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Check permissions
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });
      if (!user || !canChangeContent(user.role)) {
        throw serverError("UNAUTHORIZED", "You are not authorized to reorder folders");
      }

      // Update each folder's order in parallel
      await Promise.all(
        input.folderOrders.map(({ id, order }) =>
          ctx.drizzle
            .update(skillTreeFolder)
            .set({ order, updatedAt: new Date() })
            .where(eq(skillTreeFolder.id, id)),
        ),
      );

      return { success: true, message: "Folders reordered successfully" };
    }),
});

/**
 * Builds the where conditions for the skill tree database filter
 * @param input - The input object containing the filter criteria
 * @returns The where conditions for the skill tree database filter
 */
export const skillTreeDatabaseFilter = (input: SkillTreeFilteringSchema) => {
  const filters = [eq(skillTree.pathType, input.pathType ?? "SKILL")];
  if (input.bloodlineId) filters.push(eq(skillTree.bloodlineId, input.bloodlineId));

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

  // Viewer permissions are enforced separately from the requested hidden filter.
  if (input.hidden !== undefined) {
    filters.push(eq(skillTree.hidden, input.hidden));
  }

  // Filter by folder ID
  if (input.folderId) {
    if (input.folderId === "uncategorized") {
      filters.push(isNull(skillTree.folderId));
    } else {
      filters.push(eq(skillTree.folderId, input.folderId));
    }
  }

  return filters;
};

const SKILL_RESET_STAFF_RELATED_MSG = "Free reset for staff member";

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
      not(eq(actionLog.relatedMsg, SKILL_RESET_STAFF_RELATED_MSG)),
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
      return SKILL_TREE_RESET_FREE_NORMAL;
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
    with: { skill: { with: { folder: true } } },
  });
};

/**
 * The sources of a user's out-of-battle mastery tags, for effectiveMasteries: the equipped
 * bloodline, activated skills and equipped items.
 * @param client - The database client
 * @param userId - The user ID
 */
export const fetchMasterySources = async (
  client: DrizzleClient,
  userId: string,
): Promise<Required<MasterySources>> => {
  const sources = await client.query.userData.findFirst({
    columns: { userId: true },
    where: eq(userData.userId, userId),
    with: {
      bloodline: { columns: { effects: true } },
      userSkills: {
        columns: { id: true },
        where: eq(userSkill.activated, true),
        with: { skill: { columns: { target: true, effects: true } } },
      },
      items: {
        columns: { id: true, equipped: true, durability: true, level: true },
        where: and(ne(userItem.equipped, "NONE"), gt(userItem.quantity, 0)),
        with: {
          item: {
            columns: {
              itemType: true,
              maxDurability: true,
              bloodlineId: true,
              canBeImbued: true,
              effects: true,
              requiredNinjutsuMastery: true,
              requiredGenjutsuMastery: true,
              requiredTaijutsuMastery: true,
              requiredBukijutsuMastery: true,
              requiredBloodlineMastery: true,
              requiredSageMastery: true,
            },
          },
          imbuements: {
            columns: { craftingFinishedAt: true },
            with: { item: { columns: { effects: true } } },
          },
        },
      },
    },
  });
  return {
    bloodline: sources?.bloodline ?? null,
    userSkills: sources?.userSkills ?? [],
    items: sources?.items ?? [],
  };
};

export const fetchSkillTreeViewer = async (
  client: DrizzleClient,
  userId: string | null | undefined,
) =>
  userId
    ? client.query.userData.findFirst({
        where: eq(userData.userId, userId),
        columns: { role: true },
      })
    : undefined;

export const isSkillVisible = (
  skill: { hidden: boolean; folder: { hidden: boolean } | null },
  includeHidden: boolean,
) => includeHidden || (!skill.hidden && !skill.folder?.hidden);

/** Include pre-migration logs while persisting claims before their audit log is written. */
export const getMonthlyResetState = (user: UserData, loggedCount: number) => {
  const month = getUtcMonthKey();
  return {
    month,
    count: Math.max(
      loggedCount,
      user.monthlySkillResets?.month === month ? user.monthlySkillResets.count : 0,
    ),
  };
};
