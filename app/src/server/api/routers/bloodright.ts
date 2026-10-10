import { and, eq, gte, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { COST_SKILL_RESET, MAX_BLOODRIGHT_TIERS } from "@/drizzle/constants";
import { actionLog, skillTree, skillTreeFolder, userData } from "@/drizzle/schema";
import { getBloodrightRefundIds } from "@/libs/bloodright";
import { fetchUpdatedUser } from "@/routers/profile";
import {
  fetchMonthlyResets,
  getFreeResetAmount,
  getMonthlyResetState,
  isSkillVisible,
} from "@/routers/skillTree";
import { createTRPCRouter, errorResponse, protectedProcedure } from "@/server/api/trpc";
import { getNextUserSnapshotAt } from "@/server/utils/concurrency";
import { canAccessHiddenSkillTree, isStaffMember } from "@/utils/permissions";
import { bloodrightTierSchema } from "@/validators/skillTree";
import { userDeltaResponseSchema } from "@/validators/userCache";

export const bloodrightRouter = createTRPCRouter({
  get: protectedProcedure.query(async ({ ctx }) => {
    const [{ user }, tiers] = await Promise.all([
      fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
      ctx.drizzle.query.skillTree.findMany({
        where: eq(skillTree.pathType, "BLOODRIGHT"),
        with: { folder: true },
        orderBy: [skillTree.tier, skillTree.name],
      }),
    ]);
    return {
      tiers: tiers.filter(
        (tier) =>
          tier.bloodlineId === user?.bloodlineId &&
          isSkillVisible(tier, canAccessHiddenSkillTree(user?.role)),
      ),
      purchased: user?.bloodright ?? [],
      spent: user?.bloodrightSpent ?? 0,
    };
  }),
  purchase: protectedProcedure
    .input(bloodrightTierSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const [updatedUser, tier] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        ctx.drizzle.query.skillTree.findFirst({
          where: eq(skillTree.id, input.skillId),
          with: { folder: true },
        }),
      ]);
      const { user } = updatedUser;
      if (!user) return errorResponse("User not found");
      if (user.status === "BATTLE")
        return errorResponse("Finish your battle before changing Bloodright");
      if (
        !tier ||
        tier.pathType !== "BLOODRIGHT" ||
        !user.bloodlineId ||
        tier.bloodlineId !== user.bloodlineId ||
        !isSkillVisible(tier, canAccessHiddenSkillTree(user.role))
      )
        return errorResponse("Bloodright tier not found for your bloodline");
      const purchased = user.bloodright;
      if (purchased.some((entry) => entry.skillId === tier.id))
        return errorResponse("Tier already active");
      if (purchased.length >= MAX_BLOODRIGHT_TIERS)
        return errorResponse(
          `Only ${MAX_BLOODRIGHT_TIERS} Bloodright tiers can be active`,
        );
      if (
        !tier.requiredSkillIds.every((id) =>
          purchased.some((entry) => entry.skillId === id),
        )
      )
        return errorResponse("Prerequisites not met");
      const bloodright = [
        ...purchased,
        { skillId: tier.id, cost: tier.seichiSilverCost },
      ];
      const result = await ctx.drizzle
        .update(userData)
        .set({
          updatedAt: getNextUserSnapshotAt(user.updatedAt),
          seichiSilver: sql`${userData.seichiSilver} - ${tier.seichiSilverCost}`,
          bloodrightSpent: sql`${userData.bloodrightSpent} + ${tier.seichiSilverCost}`,
          bloodright,
        })
        .where(
          and(
            eq(userData.userId, ctx.userId),
            eq(userData.bloodlineId, tier.bloodlineId),
            // Content may change between loading the card and claiming its purchase.
            sql`EXISTS (SELECT 1 FROM ${skillTree} LEFT JOIN ${skillTreeFolder} ON ${skillTree.folderId} = ${skillTreeFolder.id} WHERE ${skillTree.id} = ${tier.id} AND ${skillTree.updatedAt} = ${tier.updatedAt} AND (${canAccessHiddenSkillTree(user.role)} OR (${skillTree.hidden} = false AND COALESCE(${skillTreeFolder.hidden}, false) = false)))`,
            sql`${userData.status} <> 'BATTLE'`,
            sql`${userData.bloodright} = CAST(${JSON.stringify(purchased)} AS JSON)`,
            gte(userData.seichiSilver, tier.seichiSilverCost),
          ),
        );
      if (result.rowsAffected !== 1)
        return errorResponse(
          "Your Bloodright or balance changed. Refresh and try again",
        );
      return {
        success: true,
        message: `Activated ${tier.name}`,
        userDelta: updatedUser.requiresUserRefresh
          ? undefined
          : {
              seichiSilver: -tier.seichiSilverCost,
              bloodrightSpent: tier.seichiSilverCost,
            },
        userPatch: { bloodright },
      };
    }),
  refund: protectedProcedure
    .input(bloodrightTierSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const [updatedUser, tiers] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        ctx.drizzle.query.skillTree.findMany({
          where: eq(skillTree.pathType, "BLOODRIGHT"),
        }),
      ]);
      const { user } = updatedUser;
      if (!user) return errorResponse("User not found");
      if (user.status === "BATTLE")
        return errorResponse("Finish your battle before changing Bloodright");
      if (!user.bloodright.some((entry) => entry.skillId === input.skillId))
        return errorResponse("Tier is not active");
      const removed = getBloodrightRefundIds(
        input.skillId,
        user.bloodright.map((entry) => entry.skillId),
        tiers,
      );
      const refund = user.bloodright
        .filter((entry) => removed.includes(entry.skillId))
        .reduce((sum, entry) => sum + entry.cost, 0);
      const bloodright = user.bloodright.filter(
        (entry) => !removed.includes(entry.skillId),
      );
      const result = await ctx.drizzle
        .update(userData)
        .set({
          updatedAt: getNextUserSnapshotAt(user.updatedAt),
          seichiSilver: sql`${userData.seichiSilver} + ${refund}`,
          bloodrightSpent: sql`${userData.bloodrightSpent} - ${refund}`,
          bloodright,
        })
        .where(
          and(
            eq(userData.userId, ctx.userId),
            sql`${userData.status} <> 'BATTLE'`,
            sql`${userData.bloodright} = CAST(${JSON.stringify(user.bloodright)} AS JSON)`,
          ),
        );
      if (result.rowsAffected !== 1)
        return errorResponse("Your Bloodright changed. Refresh and try again");
      return {
        success: true,
        userDelta: updatedUser.requiresUserRefresh
          ? undefined
          : { seichiSilver: refund, bloodrightSpent: -refund },
        userPatch: { bloodright },
        message: `Refunded ${refund} Seichi Silver and removed ${removed.length} tier(s)`,
      };
    }),
  reset: protectedProcedure
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx }) => {
      const [updatedUser, monthlyResets] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        fetchMonthlyResets(ctx.drizzle, ctx.userId),
      ]);
      const { user } = updatedUser;
      if (!user) return errorResponse("User not found");
      if (user.status === "BATTLE")
        return errorResponse("Finish your battle before changing Bloodright");
      if (!user.bloodright.length) return errorResponse("No Bloodright tiers to reset");
      const allowance = getMonthlyResetState(user, monthlyResets.length);
      const isStaff = isStaffMember(user);
      const isFree = isStaff || allowance.count < getFreeResetAmount(user);
      const cost = isFree ? 0 : COST_SKILL_RESET;
      const monthlySkillResets = {
        ...allowance,
        count: allowance.count + (isStaff ? 0 : 1),
      };
      const result = await ctx.drizzle
        .update(userData)
        .set({
          updatedAt: getNextUserSnapshotAt(user.updatedAt),
          seichiSilver: sql`${userData.seichiSilver} + ${userData.bloodrightSpent}`,
          bloodrightSpent: 0,
          bloodright: [],
          reputationPoints: sql`${userData.reputationPoints} - ${cost}`,
          monthlySkillResets,
        })
        .where(
          and(
            eq(userData.userId, ctx.userId),
            sql`${userData.status} <> 'BATTLE'`,
            sql`${userData.bloodright} = CAST(${JSON.stringify(user.bloodright)} AS JSON)`,
            sql`${userData.monthlySkillResets} = CAST(${JSON.stringify(user.monthlySkillResets)} AS JSON)`,
            // The confirmed refund delta must equal the SQL expression's committed amount.
            eq(userData.bloodrightSpent, user.bloodrightSpent),
            gte(userData.reputationPoints, cost),
          ),
        );
      if (result.rowsAffected !== 1)
        return errorResponse(
          "Your Bloodright, reset allowance or reputation balance changed. Refresh and try again",
        );
      await ctx.drizzle.insert(actionLog).values({
        id: nanoid(),
        userId: ctx.userId,
        tableName: "skillReset",
        changes: ["Bloodright reset"],
        relatedMsg: isStaff ? "Free reset for staff member" : "Bloodright reset",
        relatedValue: cost,
        relatedImage: user.avatarLight,
      });
      return {
        success: true,
        userDelta: updatedUser.requiresUserRefresh
          ? undefined
          : {
              seichiSilver: user.bloodrightSpent,
              ...(cost > 0 ? { reputationPoints: -cost } : {}),
            },
        userPatch: { bloodright: [], bloodrightSpent: 0, monthlySkillResets },
        message: `Bloodright reset; refunded ${user.bloodrightSpent} Seichi Silver${cost ? ` (-${cost} Reps)` : " (free)"}`,
      };
    }),
});
