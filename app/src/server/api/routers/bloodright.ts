import { nanoid } from "nanoid";
import { z } from "zod";
import {
  getPurchaseUserUpdate,
  getRefundUserUpdate,
  getResetUserUpdate,
} from "@/deltas/bloodright";
import { COST_SKILL_RESET, MAX_BLOODRIGHT_OPTIONS } from "@/drizzle/constants";
import {
  applyBloodrightChanges,
  isBloodrightCurrent,
  validateBloodrightSelection,
} from "@/libs/bloodrightEffects";
import { getResetAllowance } from "@/libs/skillReset";
import { callDiscordContent } from "@/libs/socials";
import {
  deleteBloodrightOption,
  findBloodrightOption,
  insertActionLogForReset,
  listBloodrightJutsuIdentities,
  listBloodrightJutsus,
  listBloodrightOptions,
  listBloodrightPurchaseJutsus,
  logBloodrightContent,
  saveBloodrightOption,
  updateUserDataForPurchase,
  updateUserDataForRefund,
  updateUserDataForReset,
} from "@/queries/bloodright";
import { fetchContentViewerRole, findUserById } from "@/queries/profile";
import { fetchUpdatedUser } from "@/routers/profile";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
} from "@/server/api/trpc";
import { calculateContentDiff } from "@/utils/diff";
import {
  canAccessHiddenSkillTree,
  canChangeContent,
  getContentRole,
} from "@/utils/permissions";
import { bloodrightOptionSchema } from "@/validators/bloodright";
import { userDeltaResponseSchema } from "@/validators/userCache";

const optionIdSchema = z.object({ optionId: z.string().min(1) });

export const bloodrightRouter = createTRPCRouter({
  catalog: publicProcedure
    .input(z.object({ bloodlineId: z.string().optional() }).nullish())
    .query(async ({ ctx, input }) => {
      const [role, options, jutsus] = await Promise.all([
        fetchContentViewerRole(ctx.drizzle, ctx.userId),
        listBloodrightOptions(ctx.drizzle),
        input?.bloodlineId
          ? listBloodrightJutsus(ctx.drizzle, input.bloodlineId)
          : Promise.resolve([]),
      ]);
      const hidden = canAccessHiddenSkillTree(role);
      return {
        options: options.filter(
          (option) =>
            (!input?.bloodlineId || option.bloodlineId === input.bloodlineId) &&
            (hidden || (!option.hidden && option.jutsu && !option.jutsu.hidden)),
        ),
        jutsus: jutsus.filter((entry) => hidden || !entry.hidden),
      };
    }),
  save: protectedProcedure
    .input(
      z.object({
        id: z.string().optional(),
        updatedAt: z.date().optional(),
        data: bloodrightOptionSchema,
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, previous, jutsus] = await Promise.all([
        findUserById(ctx.drizzle, ctx.userId),
        input.id ? findBloodrightOption(ctx.drizzle, input.id) : Promise.resolve(null),
        listBloodrightJutsus(ctx.drizzle, input.data.bloodlineId),
      ]);
      if (!user || !canChangeContent(user.role))
        return errorResponse("You are not authorized to edit Bloodright");
      const canSeeHidden = canAccessHiddenSkillTree(user.role);
      if (
        (!canSeeHidden &&
          (input.data.hidden || previous?.hidden || previous?.jutsu?.hidden)) ||
        (input.id && !previous)
      )
        return errorResponse("Bloodright option not found");
      if (
        previous &&
        (!input.updatedAt || input.updatedAt.getTime() !== previous.updatedAt.getTime())
      )
        return errorResponse("This option changed. Refresh before saving your edits");
      const source = jutsus.find(
        (entry) => entry.id === input.data.jutsuId && (canSeeHidden || !entry.hidden),
      );
      if (!source) return errorResponse("Select a jutsu belonging to this bloodline");
      if (
        !isBloodrightCurrent(input.data.changes, source.effects) ||
        !applyBloodrightChanges(source.effects, input.data.changes)
      )
        return errorResponse(
          "Reselect the affected tags and keep their values within the jutsu tag limits",
        );
      const id = input.id ?? nanoid();
      const result = await saveBloodrightOption(
        ctx.drizzle,
        id,
        input.data,
        source,
        input.id ? input.updatedAt : undefined,
      );
      if (result.rowsAffected !== 1)
        return errorResponse(
          "Content changed or the option is owned. Refresh and try again",
        );
      const diff = previous
        ? calculateContentDiff(previous, { ...previous, ...input.data })
        : ["Created Bloodright option"];
      await Promise.all([
        logBloodrightContent(ctx.drizzle, ctx.userId, id, input.data.name, diff),
        callDiscordContent(user.username, input.data.name, diff),
      ]);
      return { success: true, message: "Bloodright option saved" };
    }),
  delete: protectedProcedure
    .input(optionIdSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, option] = await Promise.all([
        findUserById(ctx.drizzle, ctx.userId),
        findBloodrightOption(ctx.drizzle, input.optionId),
      ]);
      if (!user || !canChangeContent(user.role))
        return errorResponse("You are not authorized to delete Bloodright");
      if (
        !option ||
        (!canAccessHiddenSkillTree(user.role) &&
          (option.hidden || option.jutsu?.hidden))
      )
        return errorResponse("Bloodright option not found");
      const result = await deleteBloodrightOption(ctx.drizzle, input.optionId);
      if (result.rowsAffected !== 1)
        return errorResponse("Refund all purchases before deleting this option");
      await Promise.all([
        logBloodrightContent(ctx.drizzle, ctx.userId, option.id, option.name, [
          "Deleted Bloodright option",
        ]),
        callDiscordContent(user.username, option.name, ["Deleted Bloodright option"]),
      ]);
      return { success: true, message: "Bloodright option deleted" };
    }),
  get: protectedProcedure.query(async ({ ctx }) => {
    const [{ user }, options] = await Promise.all([
      fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
      listBloodrightOptions(ctx.drizzle),
    ]);
    return {
      options: options.filter(
        (option) =>
          option.bloodlineId === user?.bloodlineId &&
          option.jutsu?.bloodlineId === user?.bloodlineId &&
          (canAccessHiddenSkillTree(user ? getContentRole(user) : undefined) ||
            (!option.hidden && !option.jutsu?.hidden)),
      ),
      purchased: user?.bloodright ?? [],
      spent: user?.bloodrightSpent ?? 0,
    };
  }),
  purchase: protectedProcedure
    .input(optionIdSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const [updatedUser, option, allOptions, purchaseJutsus, identities] =
        await Promise.all([
          fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
          findBloodrightOption(ctx.drizzle, input.optionId),
          listBloodrightOptions(ctx.drizzle),
          listBloodrightPurchaseJutsus(ctx.drizzle, input.optionId),
          listBloodrightJutsuIdentities(ctx.drizzle),
        ]);
      const { user } = updatedUser;
      if (!user) return errorResponse("User not found");
      if (user.status === "BATTLE")
        return errorResponse("Finish your battle before changing Bloodright");
      if (
        !option?.jutsu ||
        !user.bloodlineId ||
        option.bloodlineId !== user.bloodlineId ||
        option.jutsu.bloodlineId !== user.bloodlineId ||
        (!canAccessHiddenSkillTree(getContentRole(user)) &&
          (option.hidden || option.jutsu.hidden))
      )
        return errorResponse("Bloodright option not found for your bloodline");
      if (!isBloodrightCurrent(option.changes, option.jutsu.effects))
        return errorResponse(
          "This option needs a content update before it can be activated",
        );
      const purchased = user.bloodright;
      if (purchased.some((entry) => entry.optionId === option.id))
        return errorResponse("Option already active");
      if (purchased.length >= MAX_BLOODRIGHT_OPTIONS)
        return errorResponse(
          `Only ${MAX_BLOODRIGHT_OPTIONS} Bloodright options can be active`,
        );
      const selected = [
        ...allOptions.filter((entry) =>
          purchased.some((owned) => owned.optionId === entry.id),
        ),
        option,
      ];
      if (!validateBloodrightSelection(purchaseJutsus, selected, identities))
        return errorResponse(
          "These options exceed the jutsu tag limits. Refund another option first",
        );
      const bloodright = [
        ...purchased,
        { optionId: option.id, cost: option.seichiSilverCost },
      ];
      const result = await updateUserDataForPurchase(
        ctx.drizzle,
        user,
        {
          seichiSilverCost: option.seichiSilverCost,
          bloodlineId: option.bloodlineId,
          id: option.id,
          updatedAt: option.updatedAt,
          jutsu: option.jutsu,
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
        message: `Activated ${option.name}`,
        ...getPurchaseUserUpdate({
          updatedUserRequiresUserRefresh: updatedUser.requiresUserRefresh,
          optionSeichiSilverCost: option.seichiSilverCost,
          bloodright,
        }),
      };
    }),
  refund: protectedProcedure
    .input(optionIdSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const updatedUser = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });
      const { user } = updatedUser;
      if (!user) return errorResponse("User not found");
      if (user.status === "BATTLE")
        return errorResponse("Finish your battle before changing Bloodright");
      if (!user.bloodright.some((entry) => entry.optionId === input.optionId))
        return errorResponse("Option is not active");
      const removed = [input.optionId];
      const refund = user.bloodright
        .filter((entry) => removed.includes(entry.optionId))
        .reduce((sum, entry) => sum + entry.cost, 0);
      const bloodright = user.bloodright.filter(
        (entry) => !removed.includes(entry.optionId),
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

        message: `Refunded ${refund} Seichi Silver and removed ${removed.length} option(s)`,
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
      if (!user.bloodright.length)
        return errorResponse("No Bloodright options to reset");
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
