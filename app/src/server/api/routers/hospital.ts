import type { ExecutedQuery } from "@planetscale/database";
import { and, asc, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";
import {
  MEDNIN_EXP_CAP,
  MEDNIN_HEALABLE_STATES,
  MEDNIN_MIN_RANK,
  SENSEI_GENIN_MED_EXP_SHARE_PERC,
  SENSEI_MAX_STUDENT_LEVEL,
} from "@/drizzle/constants";
import { userData } from "@/drizzle/schema";
import {
  calcHealCost,
  calcHealFinish,
  calcHealthToChakra,
  calcHospitalHealExperience,
  calcHowMuchToHeal,
} from "@/libs/hospital";
import { getServerPusher, updateUserOnMap } from "@/libs/pusher";
import { filterQuestTrackersForDbPersist, getNewTrackers } from "@/libs/quest";
import { hasRequiredRank } from "@/libs/train";
import { fetchUpdatedUser, fetchUser } from "@/routers/profile";
import { fetchAlliances, fetchStructures } from "@/routers/village";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  serverError,
} from "@/server/api/trpc";
import { claimUserSnapshot } from "@/server/utils/concurrency";
import { pushActivityUpdate } from "@/server/utils/push/liveActivity";
import { findRelationship } from "@/utils/alliance";
import { secondsFromNow } from "@/utils/time";
import { getStrucBoost } from "@/utils/village";

const pusher = getServerPusher();

export const hospitalRouter = createTRPCRouter({
  getHospitalizedUsers: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Get hospitalized users in current sector" },
    })
    .query(async ({ ctx }) => {
      // Query
      const [user, alliances] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.villageAlliance.findMany(),
      ]);
      // Derived
      const allies = alliances
        .filter(
          (a) => a.villageIdA === user.villageId || a.villageIdB === user.villageId,
        )
        .filter((a) => a.status === "ALLY")
        .flatMap((a) => [a.villageIdA, a.villageIdB]);
      const uniqueVillageIds = user.villageId
        ? [...new Set([user.villageId, ...allies])]
        : [];
      // Return filtered data
      return await ctx.drizzle.query.userData.findMany({
        columns: {
          userId: true,
          avatar: true,
          username: true,
          curHealth: true,
          maxHealth: true,
          regeneration: true,
          regenAt: true,
          level: true,
          status: true,
          sector: true,
          longitude: true,
          latitude: true,
          rank: true,
          isOutlaw: true,
        },
        where: and(
          eq(userData.sector, user.sector),
          user.villageId
            ? inArray(userData.villageId, uniqueVillageIds)
            : isNull(userData.villageId),
          or(...MEDNIN_HEALABLE_STATES.map((s) => eq(userData.status, s))),
          lt(userData.curHealth, userData.maxHealth),
          gte(userData.updatedAt, secondsFromNow(-36000)),
        ),
        limit: 10,
        orderBy: [asc(userData.updatedAt), asc(userData.userId)],
      });
    }),
  // Let users heal other users if they are GENIN or above
  userHeal: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Heal another user using chakra" } })
    .input(
      z.object({
        userId: z.string(),
        healPercentage: z.int().min(1).max(100),
      }),
    )
    .output(
      baseServerResponse.extend({
        chakraCost: z.number().optional(),
        expGain: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const isSelfHeal = input.userId === ctx.userId;
      // Reuse the regenerated healer snapshot for self-heals so one request cannot race two
      // passive-regen writes or duplicate the heavier user fetch and quest bootstrap work.
      const [updatedUser, updatedTargetOrNull, relationships] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
          userIp: ctx.userIp,
          forceRegen: true,
        }),
        isSelfHeal
          ? null
          : fetchUpdatedUser({
              client: ctx.drizzle,
              userId: input.userId,
              forceRegen: true,
            }),
        fetchAlliances(ctx.drizzle),
      ]);
      const updatedTarget = updatedTargetOrNull ?? updatedUser;
      // Extract user & target to shorthand variables
      const { user: u } = updatedUser;
      const { user: t } = updatedTarget;
      if (!u) return errorResponse("Your user was not found");
      if (!t) return errorResponse("Your target was not found");
      // Derived
      const { toHeal, pools } = calcHowMuchToHeal(u, t, input.healPercentage);
      const chakraCost = calcHealthToChakra(u, toHeal);
      // Calculate experience gain, capped at 4 million. Self-heals award half.
      const expGain = calcHospitalHealExperience({
        healerId: u.userId,
        targetId: t.userId,
        toHeal,
        medicalExperience: u.medicalExperience,
      });
      // Guard
      if (u.isBanned) return errorResponse("You are banned");
      if (t.isBanned) return errorResponse("Target is banned");
      if (u.status !== "AWAKE") {
        return errorResponse("You can't heal while you're not awake");
      }
      if (!MEDNIN_HEALABLE_STATES.find((s) => s === t.status)) {
        return errorResponse("Target user must be awake or hospitalized");
      }
      if (toHeal <= 0) {
        return errorResponse("User did not need this healing anymore");
      }
      if (!hasRequiredRank(u.rank, MEDNIN_MIN_RANK)) {
        return errorResponse("You need to be at least a GENIN to heal other users");
      }
      if (u.sector !== t.sector) {
        return errorResponse("You can only heal users in the same sector as you");
      }
      if (u.villageId !== t.villageId) {
        const relationship = findRelationship(relationships, u.villageId, t.villageId);
        if (relationship?.status !== "ALLY") {
          return errorResponse(
            "You can only heal users from the same or allied village as you",
          );
        }
      }
      if (chakraCost > u.curChakra) {
        return errorResponse("You don't have enough chakra to heal this much");
      }
      // Update trackers with medical experience gained
      const { trackers } = getNewTrackers(u, [
        { task: "medical_experience_gained", increment: expGain },
      ]);
      const questDataForDb = filterQuestTrackersForDbPersist(trackers, u);
      // Claim the fetched user version while charging and awarding experience so concurrent heals
      // cannot reuse one snapshot. Self-heals also restore pools in this same statement.
      const healerClaim = await claimUserSnapshot({
        client: ctx.drizzle,
        userId: u.userId,
        updatedAt: u.updatedAt,
        where: [eq(userData.status, "AWAKE"), gte(userData.curChakra, chakraCost)],
        set: {
          medicalExperience: sql`LEAST(${userData.medicalExperience} + ${expGain}, ${MEDNIN_EXP_CAP})`,
          curChakra:
            isSelfHeal && pools.includes("Chakra")
              ? sql`LEAST(${userData.curChakra} - ${chakraCost} + ${toHeal}, ${t.maxChakra})`
              : sql`${userData.curChakra} - ${chakraCost}`,
          ...(isSelfHeal && pools.includes("Health")
            ? {
                curHealth: sql`LEAST(${userData.curHealth} + ${toHeal}, ${t.maxHealth})`,
              }
            : {}),
          ...(isSelfHeal && pools.includes("Stamina")
            ? {
                curStamina: sql`LEAST(${userData.curStamina} + ${toHeal}, ${t.maxStamina})`,
              }
            : {}),
          ...(isSelfHeal ? { regenAt: new Date() } : {}),
          questData: questDataForDb,
        },
      });
      if (!healerClaim.success) {
        return errorResponse("Could not heal — your state changed, please try again");
      }
      // Potential student exp share
      const shareExp = Math.floor((expGain * SENSEI_GENIN_MED_EXP_SHARE_PERC) / 100);
      const targetUpdate = isSelfHeal
        ? Promise.resolve({ rowsAffected: 1 })
        : ctx.drizzle
            .update(userData)
            .set({
              ...(pools.includes("Health")
                ? { curHealth: sql`LEAST(${t.curHealth + toHeal}, ${t.maxHealth})` }
                : {}),
              ...(pools.includes("Chakra")
                ? { curChakra: sql`LEAST(${t.curChakra + toHeal}, ${t.maxChakra})` }
                : {}),
              ...(pools.includes("Stamina")
                ? {
                    curStamina: sql`LEAST(${t.curStamina + toHeal}, ${t.maxStamina})`,
                  }
                : {}),
              regenAt: new Date(),
              // Don't change status - users must check out manually at the hospital
              // unless they pay to be healed at the hospital while hospitalized
            })
            .where(eq(userData.userId, t.userId));
      const [tResult] = await Promise.all([
        targetUpdate,
        shareExp > 0
          ? ctx.drizzle
              .update(userData)
              .set({
                medicalExperience: sql`LEAST(${userData.medicalExperience} + ${shareExp}, ${MEDNIN_EXP_CAP})`,
              })
              .where(
                and(
                  eq(userData.senseiId, u.userId),
                  lte(userData.level, SENSEI_MAX_STUDENT_LEVEL),
                ),
              )
          : null,
      ]);
      if (tResult.rowsAffected !== 1) {
        return { success: false, message: "Could not heal target" };
      }
      void pusher.trigger(t.userId, "event", {
        type: "userMessage",
        message: `You've been healed for ${toHeal} ${pools.join(", ")} by ${u.username}`,
        route: "/profile",
        routeText: "To profile",
      });
      void updateUserOnMap(pusher, t.sector, t);
      return {
        success: true,
        message: `You have healed the target user${expGain > 0 ? ` and gained ${Math.round(expGain)} medical experience` : ""}`,
        chakraCost,
        expGain,
      };
    }),
  // Pay to heal & get out of hospital
  npcHeal: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Pay NPC to heal and leave hospital" } })
    .input(z.object({ villageId: z.string().nullish() }))
    .output(
      baseServerResponse.extend({
        data: z
          .object({
            curHealth: z.number(),
            money: z.number(),
            regenAt: z.date(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, structures] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchStructures(ctx.drizzle, input.villageId),
      ]);
      // Guard
      if (user.villageId !== input.villageId) {
        return errorResponse("You are not in this village");
      }
      // Calc finish
      const boost = getStrucBoost("hospitalSpeedupPerLvl", structures);
      const finishAt = calcHealFinish({ user, boost });
      // Mutate w. validation
      let result: ExecutedQuery;
      let cost: number;
      if (finishAt <= new Date()) {
        cost = 0;
        result = await ctx.drizzle
          .update(userData)
          .set({
            curHealth: user.maxHealth,
            regenAt: new Date(),
            status: "AWAKE",
          })
          .where(
            and(eq(userData.userId, ctx.userId), eq(userData.status, "HOSPITALIZED")),
          );
      } else {
        cost = calcHealCost(user);
        if (user.money < cost) {
          return errorResponse("You don't have enough money");
        }
        result = await ctx.drizzle
          .update(userData)
          .set({
            curHealth: user.maxHealth,
            money: sql`${userData.money} - ${cost}`,
            regenAt: new Date(),
            status: "AWAKE",
          })
          .where(
            and(
              eq(userData.userId, ctx.userId),
              gte(userData.money, cost),
              eq(userData.status, "HOSPITALIZED"),
            ),
          );
        void updateUserOnMap(pusher, user.sector, user);
      }
      if (result.rowsAffected === 1) {
        // The Lock Screen countdown is driven from here once it has started, so leaving
        // hospital early has to close it; otherwise it keeps counting down to a recovery
        // that already happened.
        //
        // Deferred, not awaited: closing it costs a row lookup, a round-trip to Apple and
        // a delete, and none of that is anything the player should wait behind on one of
        // the most-clicked mutations in the game. Deferred rather than voided for the
        // reason travel.ts gives -- nothing else keeps the invocation alive long enough to
        // finish a bare floating promise.
        after(() =>
          pushActivityUpdate(
            ctx.drizzle,
            [ctx.userId],
            "hospital",
            { title: "Recovered", endsAt: new Date() },
            "end",
          ),
        );
        return {
          success: true,
          message: "You have been healed",
          data: {
            curHealth: user.maxHealth,
            money: user.money - cost,
            regenAt: new Date(),
          },
        };
      } else {
        const latestUser = await fetchUser(ctx.drizzle, ctx.userId);
        if (latestUser.status !== "HOSPITALIZED") {
          return errorResponse("You are not hospitalized");
        }
        if (latestUser.money < cost) {
          return errorResponse("You don't have enough money");
        }
        throw serverError("PRECONDITION_FAILED", "Something went wrong during healing");
      }
    }),
});
