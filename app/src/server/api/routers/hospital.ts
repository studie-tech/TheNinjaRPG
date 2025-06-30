import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { serverError, baseServerResponse, errorResponse } from "@/server/api/trpc";
import { sql, eq, gte, lte, and, or, inArray, isNull } from "drizzle-orm";
import { userData } from "@/drizzle/schema";
import { hasRequiredRank } from "@/libs/train";
import { calcHealFinish } from "@/libs/hospital/hospital";
import { calcHealCost } from "@/libs/hospital/hospital";
import { fetchUser, fetchUpdatedUser } from "@/routers/profile";
import { fetchStructures } from "@/routers/village";
import { structureBoost } from "@/utils/village";
import { getServerPusher, updateUserOnMap } from "@/libs/pusher";
import { calcHealthToChakra } from "@/libs/hospital/hospital";
import { MEDNIN_MIN_RANK } from "@/drizzle/constants";
import { MEDNIN_HEAL_TO_EXP } from "@/drizzle/constants";
import { MEDNIN_HEALABLE_STATES } from "@/drizzle/constants";
import type { ExecutedQuery } from "@planetscale/database";

const pusher = getServerPusher();

export const hospitalRouter = createTRPCRouter({
  getHospitalizedUsers: protectedProcedure.query(async ({ ctx }) => {
    // Query
    const [user, alliances] = await Promise.all([
      fetchUser(ctx.drizzle, ctx.userId),
      ctx.drizzle.query.villageAlliance.findMany(),
    ]);
    // Derived
    const allies = alliances
      .filter((a) => a.villageIdA === user.villageId || a.villageIdB === user.villageId)
      .filter((a) => a.status === "ALLY")
      .map((a) => [a.villageIdA, a.villageIdB])
      .flat();
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
        lte(userData.curHealth, userData.maxHealth),
        or(...MEDNIN_HEALABLE_STATES.map((s) => eq(userData.status, s))),
        sql`(${userData.maxHealth} - ${userData.curHealth}) > 0`,
      ),
      limit: 10,
      orderBy: sql`RAND()`,
    });
  }),
  // Let users heal other users if they are GENIN or above
  userHeal: protectedProcedure
    .input(
      z.object({
        userId: z.string(),
        healPercentage: z.number().int().min(1).max(100),
      }),
    )
    .output(
      baseServerResponse.extend({
        chakraCost: z.number().optional(),
        expGain: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Query for fetching latest user & target
      const [updatedUser, updatedTarget] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
          userIp: ctx.userIp,
          forceRegen: true,
        }),
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: input.userId,
          forceRegen: true,
        }),
      ]);
      // Extract user & target to shorthand variables
      const { user: u } = updatedUser;
      const { user: t } = updatedTarget;
      if (!u) return errorResponse("Your user was not found");
      if (!t) return errorResponse("Your target was not found");
      // Derived
      const toHeal = t.maxHealth * (input.healPercentage / 100);
      const chakraCost = calcHealthToChakra(u, toHeal);
      const expGain = t.userId !== u.userId ? MEDNIN_HEAL_TO_EXP * toHeal : 0;
      // Guard
      if (u.isBanned) return errorResponse("You are banned");
      if (t.isBanned) return errorResponse("Target is banned");
      if (!["AWAKE", "ASLEEP"].includes(u.status)) {
        return errorResponse("You can't heal while you're not awake");
      }
      if (!MEDNIN_HEALABLE_STATES.find((s) => s === t.status)) {
        return errorResponse("Target user must be awake or hospitalized");
      }
      if (t.maxHealth - t.curHealth <= 0) {
        return errorResponse("User did not need this healing anymore");
      }
      if (!hasRequiredRank(u.rank, MEDNIN_MIN_RANK)) {
        return errorResponse("You need to be at least a GENIN to heal other users");
      }
      if (u.sector !== t.sector) {
        return errorResponse("You can only heal users in the same sector as you");
      }
      if (chakraCost > u.curChakra) {
        return errorResponse("You don't have enough chakra to heal this much");
      }
      // Reduce chakra & give med exp
      const uResult = await ctx.drizzle
        .update(userData)
        .set({
          medicalExperience: sql`${userData.medicalExperience} + ${expGain}`,
          curChakra: sql`${userData.curChakra} - ${chakraCost}`,
        })
        .where(and(eq(userData.userId, u.userId), gte(userData.curChakra, chakraCost)));
      // If successful deduction
      if (uResult.rowsAffected === 1) {
        const tResult = await ctx.drizzle
          .update(userData)
          .set({
            curHealth: sql`LEAST(${t.curHealth + toHeal}, ${t.maxHealth})`,
            regenAt: new Date(),
            status: "AWAKE",
          })
          .where(eq(userData.userId, t.userId));
        if (tResult.rowsAffected === 1) {
          void pusher.trigger(t.userId, "event", {
            type: "userMessage",
            message: `You've been healed for ${toHeal}HP by ${u.username}`,
            route: "/profile",
            routeText: "To profile",
          });
          void updateUserOnMap(pusher, t.sector, t);
          return {
            success: true,
            message: "You have healed the target user",
            chakraCost,
            expGain,
          };
        } else {
          return { success: false, message: "Could not heal target" };
        }
      } else {
        return { success: false, message: "Could not heal - failed to update healer" };
      }
    }),
  // Pay to heal & get out of hospital
  heal: protectedProcedure
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
      const boost = structureBoost("hospitalSpeedupPerLvl", structures);
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
