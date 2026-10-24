import type { ExecutedQuery } from "@planetscale/database";
import { and, asc, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { after } from "next/server";
import {
  MEDNIN_EXP_CAP,
  MEDNIN_HEALABLE_STATES,
  MEDNIN_MIN_RANK,
  REGEN_SECONDS,
  SENSEI_GENIN_MED_EXP_SHARE_PERC,
  SENSEI_MAX_STUDENT_LEVEL,
} from "@/drizzle/constants";
import { userData } from "@/drizzle/schema";
import {
  calcHealCost,
  calcHealFinish,
  calcHealthToChakra,
  calcHospitalHealExperience,
  calcHospitalHealPools,
  calcHowMuchToHeal,
} from "@/libs/hospital";
import { getServerPusher, updateUserOnMap } from "@/libs/pusher";
import { filterQuestTrackersForDbPersist, getNewTrackers } from "@/libs/quest";
import { getTerritoryWarBoost } from "@/libs/territoryWar";
import { hasRequiredRank } from "@/libs/train";
import { fetchUpdatedUser, fetchUser } from "@/routers/profile";
import { fetchAlliances, fetchStructures } from "@/routers/village";
import {
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  serverError,
} from "@/server/api/trpc";
import { claimUserSnapshot, getNextUserSnapshotAt } from "@/server/utils/concurrency";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { pushActivityUpdate } from "@/server/utils/push/liveActivity";
import {
  getUserRegenerationGain,
  userRegenerationGainSql,
} from "@/server/utils/regeneration";
import { findRelationship } from "@/utils/alliance";
import { secondsFromDate, secondsFromNow } from "@/utils/time";
import { getStrucBoost } from "@/utils/village";
import {
  npcHealInputSchema,
  npcHealOutputSchema,
  userHealInputSchema,
  userHealOutputSchema,
} from "@/validators/hospital";

const pusher = getServerPusher();

export const hospitalRouter = createTRPCRouter({
  getHospitalizedUsers: protectedProcedure
    .meta({
      mcp: { description: "Get hospitalized users in current sector" },
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
  /** Deliver allowed healing pools with their chakra payment and medical progress. */
  userHeal: protectedProcedure
    .meta({ mcp: { description: "Heal another user using chakra" } })
    .input(userHealInputSchema)
    .output(userHealOutputSchema)
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
        isSelfHeal ? [] : fetchAlliances(ctx.drizzle),
      ]);
      const updatedTarget = updatedTargetOrNull ?? updatedUser;
      // Extract user & target to shorthand variables
      const { user: u } = updatedUser;
      const { user: t } = updatedTarget;
      if (!u) return errorResponse("Your user was not found");
      if (!t) return errorResponse("Your target was not found");
      // Derived
      const pools = calcHospitalHealPools(u, isSelfHeal);
      const { toHeal } = calcHowMuchToHeal(u, t, input.healPercentage, pools);
      const chakraCost = calcHealthToChakra(u, toHeal);
      // Calculate experience gain, capped at 4 million. Self-heals award half.
      const baseExpGain = calcHospitalHealExperience({
        healerId: u.userId,
        targetId: t.userId,
        toHeal,
        medicalExperience: u.medicalExperience,
      });
      const expGain = Math.min(
        Math.max(0, MEDNIN_EXP_CAP - u.medicalExperience),
        Math.floor(baseExpGain * (1 + getTerritoryWarBoost(u))),
      );
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
      // cannot reuse one snapshot. Self-heals also restore pools in this same statement. The
      // claim guarantees the row still matches the snapshot, so the healer's resulting values
      // are known without reading them back.
      const healedAt = new Date();
      const healer = {
        curHealth:
          isSelfHeal && pools.includes("Health")
            ? Math.min(u.curHealth + toHeal, u.maxHealth)
            : u.curHealth,
        curChakra: u.curChakra - chakraCost,
        curStamina:
          isSelfHeal && pools.includes("Stamina")
            ? Math.min(u.curStamina + toHeal, u.maxStamina)
            : u.curStamina,
        medicalExperience: Math.min(u.medicalExperience + expGain, MEDNIN_EXP_CAP),
        curEnergy: isSelfHeal
          ? Math.min(u.maxEnergy, u.curEnergy + getUserRegenerationGain(u, healedAt))
          : u.curEnergy,
        maxEnergy: u.maxEnergy,
        regenAt: isSelfHeal
          ? secondsFromDate(
              Math.floor(
                Math.max(0, healedAt.getTime() - u.regenAt.getTime()) /
                  (REGEN_SECONDS * 1000),
              ) * REGEN_SECONDS,
              u.regenAt,
            )
          : u.regenAt,
      };
      let healSucceeded: boolean;
      if (isSelfHeal) {
        const claim = await claimUserSnapshot({
          client: ctx.drizzle,
          userId: u.userId,
          updatedAt: u.updatedAt,
          where: [eq(userData.status, "AWAKE"), gte(userData.curChakra, chakraCost)],
          set: {
            medicalExperience: sql`LEAST(${userData.medicalExperience} + ${expGain}, ${MEDNIN_EXP_CAP})`,
            curChakra: sql`${userData.curChakra} - ${chakraCost}`,
            ...(pools.includes("Health")
              ? {
                  curHealth: sql`LEAST(${userData.curHealth} + ${toHeal}, ${t.maxHealth})`,
                }
              : {}),
            ...(pools.includes("Stamina")
              ? {
                  curStamina: sql`LEAST(${userData.curStamina} + ${toHeal}, ${t.maxStamina})`,
                }
              : {}),
            curEnergy: sql`LEAST(${u.maxEnergy}, ${userData.curEnergy} + ${userRegenerationGainSql(u, userData.regenAt, healedAt)})`,
            maxEnergy: u.maxEnergy,
            regenAt: healer.regenAt,
            questData: questDataForDb,
          },
        });
        healSucceeded = claim.success;
      } else {
        const recipient = alias(userData, "recipient");
        // Drizzle has no multi-table UPDATE builder. A joined write delivers healing and
        // claims the healer's payment, experience and trackers together. Recipient status
        // guards a player who enters battle after the initial read; rejection changes
        // neither account and cannot award student shares. Energy is settled before
        // resetting the hospital admission/regen clock; checkout remains manual.
        const result = await retryOnDeadlock(() =>
          ctx.drizzle.execute(sql`
            UPDATE ${userData}
            INNER JOIN ${userData} AS recipient ON ${recipient.userId} = ${t.userId}
            SET ${userData.updatedAt} = ${getNextUserSnapshotAt(u.updatedAt, healedAt)},
                ${userData.medicalExperience} = LEAST(${userData.medicalExperience} + ${expGain}, ${MEDNIN_EXP_CAP}),
                ${userData.curChakra} = ${userData.curChakra} - ${chakraCost},
                ${userData.questData} = CAST(${JSON.stringify(questDataForDb)} AS JSON),
                ${pools.includes("Health") ? sql`${recipient.curHealth} = LEAST(${recipient.curHealth} + ${toHeal}, ${recipient.maxHealth}),` : sql``}
                ${pools.includes("Chakra") ? sql`${recipient.curChakra} = LEAST(${recipient.curChakra} + ${toHeal}, ${recipient.maxChakra}),` : sql``}
                ${pools.includes("Stamina") ? sql`${recipient.curStamina} = LEAST(${recipient.curStamina} + ${toHeal}, ${recipient.maxStamina}),` : sql``}
                ${recipient.curEnergy} = LEAST(${t.maxEnergy}, ${recipient.curEnergy} + ${userRegenerationGainSql(t, recipient.regenAt, sql`NOW(3)`)}),
                ${recipient.maxEnergy} = ${t.maxEnergy},
                ${recipient.regenAt} = ${
                  t.status === "HOSPITALIZED"
                    ? sql`NOW(3)`
                    : sql`TIMESTAMPADD(SECOND, FLOOR(GREATEST(0, TIMESTAMPDIFF(SECOND, ${recipient.regenAt}, NOW(3))) / ${REGEN_SECONDS}) * ${REGEN_SECONDS}, ${recipient.regenAt})`
                },
                ${recipient.updatedAt} = GREATEST(NOW(3), TIMESTAMPADD(MICROSECOND, 1000, ${recipient.updatedAt}))
            WHERE ${and(
              eq(userData.userId, u.userId),
              eq(userData.updatedAt, u.updatedAt),
              eq(userData.status, "AWAKE"),
              gte(userData.curChakra, chakraCost),
              eq(recipient.updatedAt, t.updatedAt),
              inArray(recipient.status, MEDNIN_HEALABLE_STATES),
            )}
          `),
        );
        // MySQL may count both changed accounts for this single delivery.
        healSucceeded = result.rowsAffected > 0;
      }
      if (!healSucceeded) {
        return errorResponse(
          "Could not heal — your state or target changed, please try again",
        );
      }
      // Student shares follow successful delivery, so a rejected heal grants no experience.
      const shareExp = Math.floor((expGain * SENSEI_GENIN_MED_EXP_SHARE_PERC) / 100);
      if (shareExp > 0) {
        await ctx.drizzle
          .update(userData)
          .set({
            medicalExperience: sql`LEAST(${userData.medicalExperience} + ${shareExp}, ${MEDNIN_EXP_CAP})`,
          })
          .where(
            and(
              eq(userData.senseiId, u.userId),
              lte(userData.level, SENSEI_MAX_STUDENT_LEVEL),
            ),
          );
      }
      if (!isSelfHeal) {
        void pusher.trigger(t.userId, "event", {
          type: "userMessage",
          message: `You've been healed for ${toHeal} ${pools.join(", ")} by ${u.username}`,
          route: "/profile",
          routeText: "To profile",
        });
      }
      void updateUserOnMap(pusher, t.sector, t);
      return {
        success: true,
        message: `You have healed ${isSelfHeal ? "yourself" : "the target user"}${expGain > 0 ? ` and gained ${expGain} medical experience` : ""}`,
        chakraCost,
        expGain,
        healer,
      };
    }),
  // Pay to heal & get out of hospital
  npcHeal: protectedProcedure
    .meta({ mcp: { description: "Pay NPC to heal and leave hospital" } })
    .input(npcHealInputSchema)
    .output(npcHealOutputSchema)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [{ user }, structures] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId, forceRegen: true }),
        fetchStructures(ctx.drizzle, input.villageId),
      ]);
      // Guard
      if (!user) return errorResponse("User not found");
      if (user.villageId !== input.villageId) {
        return errorResponse("You are not in this village");
      }
      // Calc finish
      const boost = getStrucBoost("hospitalSpeedupPerLvl", structures);
      const finishAt = calcHealFinish({ user, boost });
      const healedAt = new Date();
      const energyRecovery = userRegenerationGainSql(user, userData.regenAt, healedAt);
      // Mutate w. validation
      let result: ExecutedQuery;
      let cost: number;
      if (finishAt <= healedAt) {
        cost = 0;
        result = await ctx.drizzle
          .update(userData)
          .set({
            curHealth: user.maxHealth,
            curEnergy: sql`LEAST(${user.maxEnergy}, ${userData.curEnergy} + ${energyRecovery})`,
            maxEnergy: user.maxEnergy,
            regenAt: healedAt,
            updatedAt: sql`GREATEST(NOW(3), TIMESTAMPADD(MICROSECOND, 1000, ${userData.updatedAt}))`,
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
            curEnergy: sql`LEAST(${user.maxEnergy}, ${userData.curEnergy} + ${energyRecovery})`,
            maxEnergy: user.maxEnergy,
            regenAt: healedAt,
            updatedAt: sql`GREATEST(NOW(3), TIMESTAMPADD(MICROSECOND, 1000, ${userData.updatedAt}))`,
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
            curEnergy: Math.min(
              user.maxEnergy,
              user.curEnergy + getUserRegenerationGain(user, healedAt),
            ),
            maxEnergy: user.maxEnergy,
            money: user.money - cost,
            regenAt: healedAt,
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
