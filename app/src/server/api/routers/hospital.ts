import * as Sentry from "@sentry/nextjs";
import { gte, sql } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";
import { getHealerUserPatch } from "@/deltas/hospital";
import {
  MEDNIN_EXP_CAP,
  MEDNIN_HEALABLE_STATES,
  MEDNIN_MIN_RANK,
  REGEN_SECONDS,
  SENSEI_GENIN_MED_EXP_SHARE_PERC,
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
import { hasRequiredRank } from "@/libs/rank";
import { getTerritoryWarBoost } from "@/libs/territoryWar";
import {
  executeResultForUserHeal,
  listUserDataForGetHospitalizedUsers,
  updateUserDataForNpcHeal,
  updateUserDataForUserHeal,
} from "@/queries/hospital";
import { fetchUser } from "@/queries/profile";
import { fetchAlliances, fetchStructures } from "@/queries/village";
import { fetchUpdatedUser } from "@/routers/profile";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  serverError,
} from "@/server/api/trpc";
import {
  actionReadinessResponse,
  prepareActionReadiness,
} from "@/server/utils/actionReadiness";
import { claimUserSnapshot } from "@/server/utils/concurrency";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { pushActivityUpdate } from "@/server/utils/push/liveActivity";
import {
  getUserRegenerationGain,
  userRegenerationGainSql,
} from "@/server/utils/regeneration";
import { flushSafe } from "@/server/utils/sentry";
import { findRelationship, getAlliedVillageIds } from "@/utils/alliance";
import { secondsFromDate } from "@/utils/time";
import { getStrucBoost } from "@/utils/village";
import { healerAfterHealSchema } from "@/validators/hospital";

const userHealInputSchema = z.object({
  userId: z.string(),
  healPercentage: z.int().min(1).max(100),
});

const userHealOutputSchema = baseServerResponse.extend({
  chakraCost: z.number().optional(),
  expGain: z.number().optional(),
  healer: healerAfterHealSchema.optional(),
});

const npcHealInputSchema = z.object({ villageId: z.string().nullish() });

const npcHealOutputSchema = baseServerResponse.extend({
  data: z
    .object({
      curHealth: z.number(),
      curEnergy: z.number(),
      maxEnergy: z.number(),
      money: z.number(),
      regenAt: z.date(),
    })
    .optional(),
});

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
        fetchAlliances(ctx.drizzle),
      ]);
      // Return filtered data
      return await listUserDataForGetHospitalizedUsers(
        ctx.drizzle,
        user,
        getAlliedVillageIds(alliances, user.villageId),
      );
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
      let { user: u } = updatedUser;
      let { user: t } = updatedTarget;
      if (!u) return errorResponse("Your user was not found");
      if (!t) return errorResponse("Your target was not found");
      const readiness = prepareActionReadiness(u, updatedUser.settings);
      if (readiness.error) return errorResponse(readiness.error);
      u = readiness.user;
      if (isSelfHeal) t = u;
      // Derived
      const pools = calcHospitalHealPools(u, isSelfHeal);
      const toHeal = calcHowMuchToHeal(t, input.healPercentage, pools);
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
          readiness,
          where: [gte(userData.curChakra, chakraCost)],
          set: {
            medicalExperience: sql`LEAST(${userData.medicalExperience} + ${expGain}, ${MEDNIN_EXP_CAP})`,
            curChakra: sql`${readiness.set.curChakra ?? userData.curChakra} - ${chakraCost}`,
            ...(pools.includes("Health")
              ? {
                  curHealth: sql`LEAST(${readiness.set.curHealth ?? userData.curHealth} + ${toHeal}, ${t.maxHealth})`,
                }
              : {}),
            ...(pools.includes("Stamina")
              ? {
                  curStamina: sql`LEAST(${readiness.set.curStamina ?? userData.curStamina} + ${toHeal}, ${t.maxStamina})`,
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
        // Drizzle has no multi-table UPDATE builder. A joined write delivers healing and
        // claims the healer's payment, experience and trackers together. Recipient status
        // guards a player who enters battle after the initial read; rejection changes
        // neither account and cannot award student shares. Energy is settled before
        // resetting the hospital admission/regen clock; checkout remains manual.
        const result = await retryOnDeadlock(() =>
          executeResultForUserHeal(
            ctx.drizzle,
            t,
            u,
            healedAt,
            expGain,
            chakraCost,
            questDataForDb,
            pools,
            toHeal,
            readiness,
          ),
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
        // The heal has committed; student progress need not delay the healer's response.
        after(async () => {
          try {
            await updateUserDataForUserHeal(ctx.drizzle, shareExp, u);
          } catch (error) {
            Sentry.captureException(error, {
              tags: { source: "hospital.userHeal.studentShare" },
            });
            await flushSafe();
          }
        });
      }
      if (!isSelfHeal) {
        void pusher.trigger(t.userId, "event", {
          type: "userMessage",
          message: `You've been healed for ${toHeal} ${pools.join(", ")} by ${u.username}`,
          route: "/profile",
          routeText: "To profile",
        });
      }
      const healedHealth = isSelfHeal
        ? healer.curHealth
        : pools.includes("Health")
          ? Math.min(t.curHealth + toHeal, t.maxHealth)
          : t.curHealth;
      after(() => updateUserOnMap(pusher, t.sector, { ...t, curHealth: healedHealth }));
      return actionReadinessResponse(
        {
          success: true,
          message: `You have healed ${isSelfHeal ? "yourself" : "the target user"}${expGain > 0 ? ` and gained ${expGain} medical experience` : ""}`,
          chakraCost,
          expGain,
          healer: getHealerUserPatch(u, healer, questDataForDb),
        },
        readiness,
        ctx.drizzle,
      );
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
      const isFree = finishAt <= healedAt;
      const cost = isFree ? 0 : calcHealCost(user);
      if (!isFree && user.money < cost) {
        return errorResponse("You don't have enough money");
      }
      const result = await updateUserDataForNpcHeal(
        ctx.drizzle,
        user,
        isFree ? undefined : cost,
        energyRecovery,
        healedAt,
        ctx,
      );
      if (result.rowsAffected === 1) {
        after(() =>
          updateUserOnMap(pusher, user.sector, {
            ...user,
            status: "AWAKE",
            curHealth: user.maxHealth,
          }),
        );
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
