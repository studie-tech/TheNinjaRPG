import { nanoid } from "nanoid";

import { boostPvpGain } from "@/libs/pvpExperience";
import { collapseRewards } from "@/libs/rewards";
import { getVillageLoyaltyBonuses } from "@/libs/villageLoyalty";
import {
  getVillageMissionProgress,
  isVillageMissionAvailable,
} from "@/libs/villageMission";
import { fetchUser } from "@/queries/profile";
import { findVillageUserCache } from "@/queries/socialUserCache";
import { findVillageById } from "@/queries/village";
import {
  listQuestForSelect,
  updateVillageForCancel,
  updateVillageForClaim,
  updateVillageForSelect,
} from "@/queries/villageMission";
import { createTRPCRouter, errorResponse, protectedProcedure } from "@/server/api/trpc";
import { getRandomElement } from "@/utils/array";
import { isStaffRole } from "@/utils/permissions";
import { idSchema } from "@/validators/misc";
import { userDeltaResponseSchema } from "@/validators/userCache";
import {
  type VillageMission,
  villageMissionActionSchema,
  villageMissionCancelSchema,
  villageMissionObjectiveSchema,
} from "@/validators/villageMission";

export const villageMissionRouter = createTRPCRouter({
  get: protectedProcedure.input(idSchema).query(async ({ ctx, input }) => {
    const [user, villageData] = await Promise.all([
      fetchUser(ctx.drizzle, ctx.userId),
      findVillageById(ctx.drizzle, input.id),
    ]);
    if (
      !villageData ||
      user.villageId !== input.id ||
      user.isOutlaw ||
      villageData.type !== "VILLAGE"
    )
      return null;
    return {
      mission: getVillageMissionProgress(villageData),
      isKage: villageData.kageId === ctx.userId,
      isStaff: isStaffRole(user.role) && !user.isBanned,
    };
  }),
  select: protectedProcedure
    .input(villageMissionActionSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const [user, villageData, candidates] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findVillageById(ctx.drizzle, input.villageId),
        listQuestForSelect(ctx.drizzle),
      ]);
      if (
        !villageData ||
        villageData.type !== "VILLAGE" ||
        user.villageId !== input.villageId ||
        user.isOutlaw
      )
        return errorResponse("You must belong to this village");
      if (villageData.kageId !== ctx.userId && !isStaffRole(user.role))
        return errorResponse("Only the Kage or staff can select a Village Mission");
      if (user.isBanned) return errorResponse("You are banned");
      const current = villageData.activeMission;
      if (input.missionId) {
        if (villageData.kageId !== ctx.userId)
          return errorResponse("Only the Kage can reroll a Village Mission");
        if (!current || current.id !== input.missionId)
          return errorResponse("The Village Mission changed; refresh and try again");
        if (current.rerolled)
          return errorResponse("This Village Mission has already been rerolled");
      } else if (current)
        return errorResponse("Your village already has an active Village Mission");
      const candidate = getRandomElement(
        candidates.filter(
          (entry) =>
            entry.id !== current?.questId &&
            isVillageMissionAvailable(entry, villageData.id),
        ),
      );
      if (!candidate)
        return errorResponse(
          current
            ? "No different Village Mission is available"
            : "No Village Missions are available. Ask staff to add missions in the quest editor.",
        );
      const mission: VillageMission = {
        id: nanoid(),
        questId: candidate.id,
        name: candidate.name,
        description: candidate.description,
        rewardTokens: collapseRewards([
          candidate.content.reward,
          ...(candidate.content.reward.reward_packages ?? []).map(
            (pack) => pack.rewards,
          ),
        ]).reward_tokens,
        objectives: candidate.content.objectives.map((objective) =>
          villageMissionObjectiveSchema.parse(objective),
        ),
        baseline: {},
        rerolled: !!current,
        startedAt: new Date().toISOString(),
      };
      const result = await updateVillageForSelect(
        ctx.drizzle,
        mission,

        ctx,
        input,
        current,
      );
      if (result.rowsAffected === 0)
        return errorResponse(
          "Village leadership or mission changed; refresh and try again",
        );
      return {
        success: true,
        userPatch: {
          village: await findVillageUserCache(ctx.drizzle, input.villageId),
        },
        message: current
          ? "Village Mission rerolled. Progress starts again for the new mission."
          : "Village Mission selected",
      };
    }),
  cancel: protectedProcedure
    .input(villageMissionCancelSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (!isStaffRole(user.role))
        return errorResponse("Only staff can cancel a Village Mission");
      if (user.isBanned) return errorResponse("You are banned");
      if (user.villageId !== input.villageId || user.isOutlaw)
        return errorResponse("You must belong to this village");
      const result = await updateVillageForCancel(ctx.drizzle, ctx, input);
      if (result.rowsAffected === 0)
        return errorResponse(
          "Village membership or mission changed; refresh and try again",
        );
      return {
        success: true,
        userPatch: {
          village: await findVillageUserCache(ctx.drizzle, input.villageId),
        },
        message:
          "Village Mission cancelled without penalty. A new mission can be selected immediately.",
      };
    }),
  claim: protectedProcedure
    .input(villageMissionActionSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const [user, villageData] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findVillageById(ctx.drizzle, input.villageId),
      ]);
      if (
        !villageData ||
        villageData.kageId !== ctx.userId ||
        user.villageId !== input.villageId ||
        user.isOutlaw ||
        villageData.type !== "VILLAGE"
      )
        return errorResponse("Only this village's Kage can claim the reward");
      if (user.isBanned) return errorResponse("You are banned");
      const mission = getVillageMissionProgress(villageData);
      if (!mission || mission.id !== input.missionId)
        return errorResponse("The Village Mission changed; refresh and try again");
      if (!mission.completed)
        return errorResponse("Complete every Village Mission objective first");
      // Round the claiming leader's loyalty-adjusted tokens once before the guarded payout.
      const rewardTokens =
        mission.rewardTokens > 0
          ? Math.round(
              boostPvpGain(
                mission.rewardTokens,
                getVillageLoyaltyBonuses(user).villageRewards,
              ),
            )
          : mission.rewardTokens;
      const result = await updateVillageForClaim(
        ctx.drizzle,
        rewardTokens,

        ctx,
        input,
        mission,
      );
      if (result.rowsAffected === 0)
        return errorResponse(
          "Village leadership or mission changed; refresh and try again",
        );
      return {
        success: true,
        userPatch: {
          village: await findVillageUserCache(ctx.drizzle, input.villageId),
        },
        message: `${rewardTokens.toLocaleString()} tokens awarded to the village`,
      };
    }),
});
