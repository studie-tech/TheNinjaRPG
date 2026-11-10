import { z } from "zod";
import { VILLAGE_DUTY_MIN_RANK } from "@/drizzle/constants";
import { hasRequiredRank } from "@/libs/rank";
import { isOnVillageDuty } from "@/libs/villageDuty";
import { fetchUser } from "@/queries/profile";
import { findVillageById } from "@/queries/village";
import {
  cancelVillageDuty,
  countVillageDuty,
  enrollVillageDuty,
  listVillageDutyRoster,
} from "@/queries/villageDuty";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  ratelimitMiddleware,
} from "@/server/api/trpc";

/** Manage persistent village enrollment without changing the owner's presence or combat state. */
export const villageDutyRouter = createTRPCRouter({
  /** Read eligibility, the full count and a bounded public roster in one parallel query wave. */
  get: protectedProcedure
    .input(z.object({ villageId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [user, home, counts, patrols] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findVillageById(ctx.drizzle, input.villageId),
        countVillageDuty(ctx.drizzle, input.villageId),
        listVillageDutyRoster(ctx.drizzle, input.villageId),
      ]);
      if (home?.type !== "VILLAGE" || user.villageId !== home.id || user.isOutlaw)
        return null;
      return {
        villageId: home.id,
        onDuty: isOnVillageDuty(user, home.id),
        startedAt: isOnVillageDuty(user, home.id) ? user.villageDutyStartedAt : null,
        canEnroll:
          !user.isBanned &&
          !user.isAi &&
          hasRequiredRank(user.rank, VILLAGE_DUTY_MIN_RANK) &&
          user.status === "AWAKE" &&
          user.sector === home.sector &&
          user.location === "Village",
        count: counts[0]?.count ?? 0,
        protectors: patrols.map((p) => ({
          userId: p.userId,
          username: p.username,
          avatar: p.avatarLight ?? p.avatar,
          rank: p.rank,
        })),
      };
    }),
  /** Enrollment checks live in one guarded UPDATE; cancellation is account-scoped and idempotent. */
  setDuty: protectedProcedure
    .use(ratelimitMiddleware)
    .input(z.object({ villageId: z.string().min(1), enabled: z.boolean() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      if (!input.enabled) {
        await cancelVillageDuty(ctx.drizzle, ctx.userId);
        return { success: true, message: "You have stood down from village duty." };
      }
      const result = await enrollVillageDuty(
        ctx.drizzle,
        ctx.userId,
        input.villageId,
        new Date(),
      );
      if (result.rowsAffected !== 1)
        return errorResponse(
          `You must be an awake ${VILLAGE_DUTY_MIN_RANK} or higher in your home village to sign up for duty.`,
        );
      return {
        success: true,
        message: "You are on village duty until you stand down.",
      };
    }),
});
