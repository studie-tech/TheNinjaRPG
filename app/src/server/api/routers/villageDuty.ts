import { z } from "zod";
import { buildVillageDutyPatrolUpdate } from "@/deltas/villageDuty";
import {
  VILLAGE_DUTY_MIN_RANK,
  VILLAGE_DUTY_ROTATION_SECONDS,
} from "@/drizzle/constants";
import { hasRequiredRank } from "@/libs/rank";
import { isOnVillageDuty, villageDutyCapacity } from "@/libs/villageDuty";
import {
  cancelVillageDuty,
  countVillageDuty,
  enrollVillageDuty,
  fetchVillageDutyHome,
  fetchVillageDutyUser,
  listVillageDutyRoster,
} from "@/queries/villageDuty";
import { initiateVillageDutyBattle } from "@/routers/combat";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  ratelimitMiddleware,
} from "@/server/api/trpc";
import {
  ensureVillageDutyShift,
  prepareVillageDutyEncounter,
  villageDutyActorId,
} from "@/server/utils/villageDuty";
import { getUtcHourStart, secondsFromDate } from "@/utils/time";
import { userDeltaResponseSchema } from "@/validators/userCache";

/** Manage persistent village enrollment without changing the owner's presence or combat state. */
export const villageDutyRouter = createTRPCRouter({
  /** Read the compact roster and lazily publish its fixed hourly shift; protected reads are never edge-cached. */
  get: protectedProcedure
    .input(z.object({ villageId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const [user, home, counts, loadedRoster] = await Promise.all([
        fetchVillageDutyUser(ctx.drizzle, ctx.userId),
        fetchVillageDutyHome(ctx.drizzle, input.villageId),
        countVillageDuty(ctx.drizzle, input.villageId),
        listVillageDutyRoster(ctx.drizzle, input.villageId, now),
      ]);
      if (home?.type !== "VILLAGE" || user?.villageId !== home.id || user.isOutlaw)
        return null;
      const shift = await ensureVillageDutyShift(ctx.drizzle, home, now);
      const roster =
        shift?.startedAt.getTime() === home.dutyShift?.startedAt.getTime()
          ? loadedRoster
          : await listVillageDutyRoster(ctx.drizzle, home.id, now);
      const ownPatrol = roster.some((entry) => entry.userId === user.userId)
        ? shift?.patrols.find((entry) => entry.userId === user.userId)
        : undefined;
      const protectors = roster.map((p) => ({
        userId: p.userId,
        username: p.username,
        avatar: p.avatarLight ?? p.avatar,
        rank: p.rank,
        defeated: !!shift?.patrols.find((entry) => entry.userId === p.userId)?.defeated,
        fighting: !!shift?.patrols.find((entry) => entry.userId === p.userId)?.battleId,
      }));
      return {
        villageId: home.id,
        enrolled: isOnVillageDuty(user, home.id),
        patrolStatus: !ownPatrol
          ? ("RESERVE" as const)
          : ownPatrol.defeated
            ? ("DEFEATED" as const)
            : ownPatrol.battleId
              ? ("FIGHTING" as const)
              : ("PATROLLING" as const),
        capacity: shift?.capacity ?? villageDutyCapacity(home.structures),
        nextCapacity: villageDutyCapacity(home.structures),
        available: protectors.filter((entry) => !entry.defeated && !entry.fighting)
          .length,
        defeated: protectors.filter((entry) => entry.defeated).length,
        nextRotationAt: secondsFromDate(
          VILLAGE_DUTY_ROTATION_SECONDS,
          shift?.startedAt ?? getUtcHourStart(now),
        ),
        canEnroll:
          !user.isBanned &&
          !user.isAi &&
          hasRequiredRank(user.rank, VILLAGE_DUTY_MIN_RANK) &&
          user.status === "AWAKE" &&
          user.sector === home.sector &&
          user.location === "Village",
        count: counts[0]?.count ?? 0,
        protectors,
      };
    }),
  /** Travel-only heartbeats advance pursuits and admit the closest contacting copy without an encounter roll. */
  patrol: protectedProcedure
    .use(ratelimitMiddleware)
    .input(
      z.object({
        sector: z.number().int().nonnegative(),
        originSocketId: z.string().max(128).optional(),
        startedAt: z.date().optional(),
        revision: z.number().int().nonnegative().optional(),
      }),
    )
    .output(
      userDeltaResponseSchema.extend({
        battleId: z.string().optional(),
        patrolUpdate: z
          .object({
            sector: z.number(),
            startedAt: z.date(),
            revision: z.number().int().nonnegative(),
            patrols: z.array(
              z.object({
                userId: z.string(),
                available: z.boolean(),
                pursuit: z
                  .object({
                    targetUserId: z.string(),
                    startedAt: z.number(),
                    expiresAt: z.number().optional(),
                    path: z.array(z.object({ x: z.number(), y: z.number() })),
                  })
                  .nullable(),
              }),
            ),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const encounter = await prepareVillageDutyEncounter({
        client: ctx.drizzle,
        userId: ctx.userId,
        sector: input.sector,
      });
      if (!encounter || encounter.blocked) return { success: true, message: "" };
      const { shift, slot, user } = encounter;
      const patrolShift = {
        ...shift,
        patrols: shift.patrols.map((patrol) => ({
          ...patrol,
          actorId: villageDutyActorId(patrol.userId),
        })),
      };
      if (slot < 0)
        return {
          success: true,
          message: "",
          patrolUpdate:
            shift.revision !== input.revision ||
            shift.startedAt.getTime() !== input.startedAt?.getTime()
              ? buildVillageDutyPatrolUpdate(
                  patrolShift,
                  input.sector,
                  encounter.eligibleUserIds,
                )
              : undefined,
        };
      const result = await initiateVillageDutyBattle(
        {
          client: ctx.drizzle,
          userIds: [ctx.userId],
          actionUserId: ctx.userId,
          originSocketId: input.originSocketId,
          sector: user.sector,
          longitude: user.longitude,
          latitude: user.latitude,
          forceDefenderVillageId: shift.villageId,
          shift,
          slot,
          autoCombatFromDefaults: true,
        },
        "VILLAGE_PROTECTOR",
      );
      return {
        ...result,
        patrolUpdate: result.success
          ? buildVillageDutyPatrolUpdate(
              patrolShift,
              input.sector,
              encounter.eligibleUserIds,
              result.success && result.battleId ? slot : undefined,
            )
          : undefined,
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
        return { success: true, message: "You have stood down from patrol duty." };
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
        message:
          "You are signed up. Your copy can join the next hourly patrol rotation.",
      };
    }),
});
