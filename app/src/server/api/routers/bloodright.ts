import {
  getPurchaseUserUpdate,
  getRefundUserUpdate,
  getResetUserUpdate,
} from "@/deltas/bloodright";
import { COST_SKILL_RESET, MAX_BLOODRIGHT_TIERS } from "@/drizzle/constants";
import { getBloodrightRefundIds } from "@/libs/bloodright";
import {
  insertActionLogForReset,
  listSkillTreeForGet,
  listSkillTreeForRefund,
  updateUserDataForPurchase,
  updateUserDataForRefund,
  updateUserDataForReset,
} from "@/queries/bloodright";
import { findSkillWithFolderById } from "@/queries/skillTree";
import { fetchUpdatedUser } from "@/routers/profile";
import { getResetAllowance, isSkillVisible } from "@/routers/skillTree";
import { createTRPCRouter, errorResponse, protectedProcedure } from "@/server/api/trpc";
import { canAccessHiddenSkillTree } from "@/utils/permissions";
import { bloodrightTierSchema } from "@/validators/skillTree";
import { userDeltaResponseSchema } from "@/validators/userCache";

export const bloodrightRouter = createTRPCRouter({
  get: protectedProcedure.query(async ({ ctx }) => {
    const [{ user }, tiers] = await Promise.all([
      fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
      listSkillTreeForGet(ctx.drizzle),
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
        findSkillWithFolderById(ctx.drizzle, input.skillId),
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
      const result = await updateUserDataForPurchase(
        ctx.drizzle,
        user,
        {
          seichiSilverCost: tier.seichiSilverCost,
          bloodlineId: tier.bloodlineId,
          id: tier.id,
          updatedAt: tier.updatedAt,
        },
        bloodright,
        ctx,
        purchased,
      );
      if (result.rowsAffected !== 1)
        return errorResponse(
          "Your Bloodright or balance changed. Refresh and try again",
        );
      return {
        success: true,
        message: `Activated ${tier.name}`,
        ...getPurchaseUserUpdate({
          updatedUserRequiresUserRefresh: updatedUser.requiresUserRefresh,
          tierSeichiSilverCost: tier.seichiSilverCost,
          bloodright,
        }),
      };
    }),
  refund: protectedProcedure
    .input(bloodrightTierSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const [updatedUser, tiers] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        listSkillTreeForRefund(ctx.drizzle),
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
      const result = await updateUserDataForRefund(
        ctx.drizzle,
        user,
        refund,
        bloodright,
        ctx,
      );
      if (result.rowsAffected !== 1)
        return errorResponse("Your Bloodright changed. Refresh and try again");
      return {
        success: true,
        ...getRefundUserUpdate({
          updatedUserRequiresUserRefresh: updatedUser.requiresUserRefresh,
          refund,
          bloodright,
        }),

        message: `Refunded ${refund} Seichi Silver and removed ${removed.length} tier(s)`,
      };
    }),
  reset: protectedProcedure
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx }) => {
      const updatedUser = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });
      const { user } = updatedUser;
      if (!user) return errorResponse("User not found");
      if (user.status === "BATTLE")
        return errorResponse("Finish your battle before changing Bloodright");
      if (!user.bloodright.length) return errorResponse("No Bloodright tiers to reset");
      const { isFree, isStaff, next: monthlySkillResets } = getResetAllowance(user);
      const cost = isFree ? 0 : COST_SKILL_RESET;
      const result = await updateUserDataForReset(
        ctx.drizzle,
        user,
        cost,
        monthlySkillResets,
        ctx,
      );
      if (result.rowsAffected !== 1)
        return errorResponse(
          "Your Bloodright, reset allowance or reputation balance changed. Refresh and try again",
        );
      await insertActionLogForReset(ctx.drizzle, ctx, isStaff, cost, user);
      return {
        success: true,
        ...getResetUserUpdate({
          updatedUserRequiresUserRefresh: updatedUser.requiresUserRefresh,
          userBloodrightSpent: user.bloodrightSpent,
          cost,
          monthlySkillResets,
        }),

        message: `Bloodright reset; refunded ${user.bloodrightSpent} Seichi Silver${cost ? ` (-${cost} Reps)` : " (free)"}`,
      };
    }),
});
