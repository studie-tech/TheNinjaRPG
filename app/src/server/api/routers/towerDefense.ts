import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  getChallengeQuestUserUpdate,
  getDailyDutyUserUpdate,
} from "@/deltas/towerDefense";
import { userData } from "@/drizzle/schema";
import { filterQuestTrackersForDbPersist, getNewTrackers } from "@/libs/quest";
import { snapshotSpriteAnimations } from "@/libs/spriteAnimations";
import { decodeTdActions } from "@/libs/towerDefense/actionLog";
import { tdDailyReward, tdFulfilsDailyDuty } from "@/libs/towerDefense/balance";
import { findTowerDefenseChallenge } from "@/libs/towerDefense/challenge";
import {
  TD_DOJO,
  TD_DOJO_INFO,
  type TdDojoLevels,
  type TdDojoUpgrade,
  tdCheckpoints,
} from "@/libs/towerDefense/content";
import { TD_SIM_VERSION, tdDojoPurchase } from "@/libs/towerDefense/sim";
import {
  findTowerDefenseClaimant,
  findTowerDefenseClaimReceipt,
  findTowerDefenseProgress,
  insertTowerDefenseClaimReceipt,
  insertTowerDefenseRun,
  listTowerDefenseRoster,
  listTowerDefenseRunForGetLeaderboard,
  listTowerDefenseRunForGetRunHistory,
  listUserTowerDefenseUpgrades,
  updateUserDataForClaimTowerDefenseRun,
  updateUserDataForPurchaseDojoUpgrade,
  updateUserDataForStartTowerDefenseRun,
  updateUserDataForTowerDefenseDuty,
  upsertUserTowerDefenseUpgrade,
} from "@/queries/towerDefense";
import { incrementVillageTokens } from "@/queries/village";
import { fetchUpdatedUser, type UserWithRelations } from "@/routers/profile";
import {
  baseServerResponse,
  cdnCachedProcedure,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  ratelimitMiddleware,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { handleQuestConsequences } from "@/server/utils/questConsequences";
import { signRunToken, verifyRunToken } from "@/server/utils/runTokens";
import {
  areTowerDefenseClaimsEnabled,
  checkTowerDefenseClaimTiming,
  reserveTowerDefenseReplay,
  TOWER_DEFENSE_CLAIMS_PAUSED_MESSAGE,
  TOWER_DEFENSE_REPLAY_LIMIT_MESSAGE,
  towerDefenseClaimKey,
  verifyTowerDefenseRun,
} from "@/server/utils/towerDefenseClaims";
import { periodStart } from "@/utils/time";
import {
  TD_MAX_LOG_CHARS,
  TD_MAX_TICKS,
  type TdChallengeRequest,
  tdChallengeRequestSchema,
  towerDefenseRunTokenSchema,
} from "@/validators/towerDefense";
import { userDeltaResponseSchema } from "@/validators/userCache";

export const towerDefenseRouter = createTRPCRouter({
  /** The caller's scrolls, best wave and Guard Hall levels. */
  getProgress: protectedProcedure
    .meta({
      mcp: {
        description: "Get tower defense scrolls, best wave and Guard Hall levels",
      },
    })
    .use(ratelimitMiddleware)
    .query(async ({ ctx }) => {
      const [progress, upgrades] = await Promise.all([
        findTowerDefenseProgress(ctx.drizzle, ctx),
        listUserTowerDefenseUpgrades(ctx.drizzle, ctx),
      ]);
      return {
        points: progress?.towerDefensePoints ?? 0,
        bestWave: progress?.towerDefenseBestWave ?? 0,
        dojo: dojoLevels(upgrades),
      };
    }),

  /** AI characters with sprite sheets, drawn as the run's enemies. */
  getRoster: cdnCachedProcedure
    .meta({ mcp: { description: "Get tower defense enemy artwork" } })
    .query(async ({ ctx }) => {
      const roster = await listTowerDefenseRoster(ctx.drizzle);
      return roster.map(({ spriteAnimationBindings, ...ai }) => ({
        ...ai,
        animations: snapshotSpriteAnimations(spriteAnimationBindings),
      }));
    }),

  /**
   * Sign a new run from one of the caller's checkpoints, or a quest challenge run for an
   * active `win_tower_defense` objective whose location the caller stands on. A challenge
   * takes its start wave and rules from the objective, never from the request.
   */
  startRun: protectedProcedure
    .meta({ mcp: { description: "Start a tower defense run" } })
    .use(ratelimitMiddleware)
    .input(
      z.object({
        startWave: z.int().min(1),
        challenge: tdChallengeRequestSchema.optional(),
      }),
    )
    .output(
      baseServerResponse.extend({
        token: z.string().optional(),
        config: towerDefenseRunTokenSchema
          .pick({
            seed: true,
            startWave: true,
            bestWave: true,
            level: true,
            dojo: true,
            challenge: true,
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [progress, upgrades, questUser] = await Promise.all([
        findTowerDefenseProgress(ctx.drizzle, ctx),
        listUserTowerDefenseUpgrades(ctx.drizzle, ctx),
        input.challenge
          ? fetchUpdatedUser({
              client: ctx.drizzle,
              userId: ctx.userId,
              rejectIsolatedPyramid: true,
            })
          : undefined,
      ]);
      if (!progress) return errorResponse("User not found.");
      const bestWave = progress.towerDefenseBestWave;
      const quest = input.challenge
        ? findQuestChallenge(questUser?.user, input.challenge)
        : null;
      if (quest?.message) return errorResponse(quest.message);
      if (!quest && !tdCheckpoints(bestWave).includes(input.startWave))
        return errorResponse("That checkpoint is not unlocked yet.");
      const config = {
        seed: nanoid(),
        startWave: quest?.startWave ?? input.startWave,
        bestWave,
        level: progress.level,
        dojo: dojoLevels(upgrades),
        challenge: quest?.challenge,
      };
      const nonce = nanoid();
      // Only the latest run can be claimed, so runs are never played side by side.
      await updateUserDataForStartTowerDefenseRun(ctx.drizzle, ctx, nonce);
      const token = signRunToken({
        v: 1,
        userId: ctx.userId,
        nonce,
        ...config,
        issuedAt: Date.now(),
      });
      return { success: true, message: "Run started", token, config };
    }),

  /**
   * Claim a finished run. The server replays the signed run with the submitted action log
   * and pays out what the replay earned. Everything that can refuse a claim without the
   * replay runs first, and replays have their own tighter limit. Only the caller's latest
   * run can be claimed, and the payout retires it, so each run pays out once; its receipt
   * then answers a retry whose response was lost. A run that clears the daily duty's
   * waves also pays the daily Guard Hall reward, once per day.
   * `permanent` marks refusals that claiming the same run again can only repeat.
   */
  claimRun: protectedProcedure
    .meta({ mcp: { description: "Claim a finished tower defense run" } })
    .use(ratelimitMiddleware)
    .input(
      z.object({
        token: z.string().min(1).max(8000),
        // The compact encoding of `libs/towerDefense/actionLog`. A long log has hundreds of
        // thousands of actions, so it is decoded only once the claim is otherwise allowed.
        actions: z.string().max(TD_MAX_LOG_CHARS),
        endTick: z.int().min(0).max(TD_MAX_TICKS),
        /** `TD_SIM_VERSION` of the page that played the run. */
        simVersion: z.int(),
      }),
    )
    .output(
      userDeltaResponseSchema.extend({
        permanent: z.boolean().optional(),
        reloadRequired: z.boolean().optional(),
        alreadyClaimed: z.boolean().optional(),
        pointsEarned: z.number().optional(),
        wave: z.number().optional(),
        kills: z.number().optional(),
        dailyReward: z
          .object({ ryo: z.number(), prestige: z.number(), villageTokens: z.number() })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!areTowerDefenseClaimsEnabled())
        return errorResponse(TOWER_DEFENSE_CLAIMS_PAUSED_MESSAGE);
      // A page on older rules played a run this replay would not reproduce. Reloading
      // resumes its save under these rules, which the claim then replays exactly.
      if (input.simVersion !== TD_SIM_VERSION)
        return {
          ...errorResponse(
            "Tower defense was updated during your run. Reload the page to resume it and claim it.",
          ),
          reloadRequired: true,
        };
      const token = verifyRunToken(input.token, towerDefenseRunTokenSchema);
      if (!token) return refusedForGood("This run's token is invalid.");
      if (token.userId !== ctx.userId)
        return refusedForGood("This run belongs to another player.");
      const now = Date.now();
      const refused = checkTowerDefenseClaimTiming({
        token,
        endTick: input.endTick,
        now,
      });
      if (refused)
        return refused.permanent
          ? refusedForGood(refused.message)
          : errorResponse(refused.message);
      const claimKey = towerDefenseClaimKey(token.nonce);
      // The replay is reserved alongside the receipt lookup to keep one round trip. A
      // retry of a run already paid spends a reservation it does not use, which only
      // happens when a claim's response is lost.
      const [receipt, canReplay, claimant] = await Promise.all([
        findTowerDefenseClaimReceipt(ctx.drizzle, claimKey),
        reserveTowerDefenseReplay(ctx.userId, input.endTick),
        findTowerDefenseClaimant(ctx.drizzle, ctx),
      ]);
      if (receipt)
        return alreadyClaimed({
          wave: receipt.wave,
          kills: receipt.score,
          points: receipt.pointsEarned,
        });
      if (!claimant) return errorResponse("User not found.");
      if (claimant.towerDefenseActiveRun !== token.nonce)
        return refusedForGood(REPLACED_RUN_MESSAGE);
      if (!canReplay) return errorResponse(TOWER_DEFENSE_REPLAY_LIMIT_MESSAGE);
      const actions = decodeTdActions(input.actions);
      if (!actions) return refusedForGood("This run's record could not be read.");
      const result = await verifyTowerDefenseRun({
        token,
        actions,
        endTick: input.endTick,
      });
      // The replay is deterministic, so a refused log stays refused.
      if (!result.ok) return refusedForGood(result.message);
      if (token.challenge)
        return await settleChallengeRun(ctx, {
          nonce: token.nonce,
          challenge: token.challenge,
          claimKey,
          result,
        });
      const paid = await updateUserDataForClaimTowerDefenseRun(ctx.drizzle, ctx, {
        nonce: token.nonce,
        points: result.points,
        wave: result.wave,
      });
      // A simultaneous claim of this run paid it, or a newer run replaced it meanwhile.
      if (paid.rowsAffected === 0) return refusedForGood(REPLACED_RUN_MESSAGE);
      const paidAt = new Date();
      const dutyReward = tdFulfilsDailyDuty(token.startWave, result.wave)
        ? tdDailyReward(claimant.level)
        : null;
      const [duty] = await Promise.all([
        dutyReward
          ? updateUserDataForTowerDefenseDuty(ctx.drizzle, ctx, {
              ryo: dutyReward.ryo,
              prestige: dutyReward.prestige,
              paidAt,
              dayStart: periodStart("daily", paidAt),
            })
          : undefined,
        insertTowerDefenseClaimReceipt(ctx.drizzle, ctx, {
          claimKey,
          wave: result.wave,
          kills: result.kills,
          points: result.points,
        }),
        insertTowerDefenseRun(ctx.drizzle, ctx, {
          seed: token.seed,
          startWave: token.startWave,
          wave: result.wave,
          kills: result.kills,
          startedAt: new Date(token.issuedAt),
        }),
      ]);
      // The duty pays only when no payout has happened yet this UTC day.
      const reward = duty && duty.rowsAffected > 0 ? dutyReward : null;
      if (reward && claimant.villageId)
        await incrementVillageTokens(
          ctx.drizzle,
          reward.villageTokens,
          claimant.villageId,
        );
      const summary =
        result.points > 0
          ? `Reached wave ${result.wave} and earned ${result.points.toLocaleString()} scroll${result.points === 1 ? "" : "s"}!`
          : `Reached wave ${result.wave}.`;
      const dutyUpdate = getDailyDutyUserUpdate({
        reward,
        villageId: claimant.villageId,
        paidAt,
      });
      return {
        success: true,
        message: reward
          ? `${summary} Daily Guard Hall duty done: +${reward.ryo.toLocaleString()} ryo, +${reward.prestige} prestige${claimant.villageId ? ` and +${reward.villageTokens} tokens for your village` : ""}.`
          : summary,
        pointsEarned: result.points,
        wave: result.wave,
        kills: result.kills,
        dailyReward: reward ?? undefined,
        userDelta: dutyUpdate.userDelta,
        userPatch: dutyUpdate.userPatch,
      };
    }),

  /** Buy the next level of a Guard Hall upgrade with scrolls. */
  purchaseDojoUpgrade: protectedProcedure
    .meta({ mcp: { description: "Buy a tower defense Guard Hall upgrade" } })
    .use(ratelimitMiddleware)
    .input(z.object({ upgradeId: z.enum(TD_DOJO) }))
    .output(
      baseServerResponse.extend({
        level: z.number().optional(),
        pointsSpent: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [progress, upgrades] = await Promise.all([
        findTowerDefenseProgress(ctx.drizzle, ctx),
        listUserTowerDefenseUpgrades(ctx.drizzle, ctx),
      ]);
      if (!progress) return errorResponse("User not found.");
      const purchase = tdDojoPurchase({
        upgradeId: input.upgradeId,
        level: dojoLevels(upgrades)[input.upgradeId] ?? 0,
        bestWave: progress.towerDefenseBestWave,
      });
      if ("message" in purchase) return errorResponse(purchase.message);
      const { level, cost } = purchase;
      // The level comes from the snapshot above, so two concurrent purchases by the same
      // account can each pay for the same level. The cost stays on that account's own
      // scrolls and support can restore it, so this stays a readable check-then-write.
      const result = await updateUserDataForPurchaseDojoUpgrade(ctx.drizzle, cost, ctx);
      if (result.rowsAffected === 0) return errorResponse("Not enough scrolls.");
      await upsertUserTowerDefenseUpgrade(ctx.drizzle, ctx, input.upgradeId, level);
      return {
        success: true,
        message: `${TD_DOJO_INFO[input.upgradeId].name} is now level ${level}.`,
        level,
        pointsSpent: cost,
      };
    }),

  /** The caller's past runs in stable chronological pages. */
  getRunHistory: protectedProcedure
    .meta({ mcp: { description: "Get user's tower defense run history" } })
    .use(ratelimitMiddleware)
    .input(
      z.object({
        cursor: z.string().optional(),
        limit: z.number().min(1).max(50).prefault(10),
      }),
    )
    .query(async ({ ctx, input }) => {
      const runs = await listTowerDefenseRunForGetRunHistory(ctx.drizzle, ctx, input);
      const hasMore = runs.length > input.limit;
      const items = hasMore ? runs.slice(0, -1) : runs;
      const nextCursor = hasMore ? items[items.length - 1]?.id : undefined;
      return { items, nextCursor };
    }),

  /** This month's highest waves. */
  getLeaderboard: cdnCachedProcedure
    .meta({ mcp: { description: "Get tower defense leaderboard" } })
    .input(z.object({ limit: z.number().min(1).max(100).prefault(20) }))
    .query(async ({ ctx, input }) =>
      listTowerDefenseRunForGetLeaderboard(ctx.drizzle, input),
    ),
});

/** Why a run that is no longer the caller's active one cannot be claimed. */
const REPLACED_RUN_MESSAGE =
  "This run was already claimed or replaced by a newer run, so it can no longer be claimed.";

/** A refusal the same claim can never overcome; the client discards the run. */
const refusedForGood = (message: string) => ({
  ...errorResponse(message),
  permanent: true,
});

/** The answer to a run that has already paid out, with what it earned then. */
const alreadyClaimed = (earned: { wave: number; kills: number; points: number }) => ({
  ...errorResponse("This run has already been claimed."),
  alreadyClaimed: true,
  wave: earned.wave,
  kills: earned.kills,
  pointsEarned: earned.points,
});

/**
 * The challenge of an active `win_tower_defense` objective the player stands on, or why
 * it cannot start. The objective's location is the one rolled for this player.
 */
const findQuestChallenge = (
  user: UserWithRelations | undefined,
  request: TdChallengeRequest,
) => {
  if (!user) return { message: "User not found." };
  const found = findTowerDefenseChallenge(user, request);
  if (!found || found.done || !found.available)
    return {
      message: "This defense is not an open objective of your active quests.",
    };
  const { objective } = found;
  if (!found.atLocation)
    return {
      message: objective.hideLocation
        ? "You are not at this position."
        : `Travel to sector ${objective.sector} at [${objective.longitude}, ${objective.latitude}] to hold your ground there.`,
    };
  return {
    startWave: objective.startWave,
    challenge: {
      ...request,
      waves: objective.waves,
      enemyHealth: objective.enemyHealth,
      enemyDamage: objective.enemyDamage,
    },
  };
};

/**
 * Settle a replayed quest challenge run. A win completes its objective in the player's
 * quest trackers; win or lose, the run then retires without paying scrolls, raising the
 * best wave, entering the leaderboard or counting for the daily duty, and its receipt
 * answers a retry. The objective is recorded before the run retires, so a claim that
 * fails in between is retried in full, and completing an objective twice changes nothing.
 * The record is guarded on the run still being active, so a simultaneous claim that
 * loads the player after this run settled cannot complete the objective again, such as
 * on a repeatable quest accepted anew in between.
 */
const settleChallengeRun = async (
  ctx: { drizzle: DrizzleClient; userId: string },
  input: {
    nonce: string;
    challenge: TdChallengeRequest;
    claimKey: string;
    result: { wave: number; kills: number; won: boolean };
  },
) => {
  const { nonce, challenge, claimKey, result } = input;
  let completedFor: UserWithRelations | undefined;
  let battle: Awaited<ReturnType<typeof handleQuestConsequences>>["battleUserUpdate"];
  if (result.won) {
    const { user } = await fetchUpdatedUser({
      client: ctx.drizzle,
      userId: ctx.userId,
    });
    if (!user) return errorResponse("User not found.");
    const isDone = (questData: typeof user.questData) =>
      !!questData
        ?.find((tracker) => tracker.id === challenge.questId)
        ?.goals.some((goal) => goal.id === challenge.objectiveId && goal.done);
    // A retry after the objective was recorded only retires the run.
    if (isDone(user.questData)) completedFor = user;
    else {
      const { trackers, consequences, notifications } = getNewTrackers(user, [
        {
          task: "win_tower_defense",
          contentId: challenge.objectiveId,
          text: challenge.questId,
        },
      ]);
      if (isDone(trackers)) {
        user.questData = filterQuestTrackersForDbPersist(trackers, user);
        const recorded = await handleQuestConsequences(
          ctx.drizzle,
          user,
          consequences,
          notifications,
          {
            alwaysClaimUserState: true,
            claimConditions: [eq(userData.towerDefenseActiveRun, nonce)],
          },
        );
        if (!recorded.claimed)
          return errorResponse(
            "Your character changed while the defense was recorded. Claim it again.",
          );
        user.questData = trackers;
        completedFor = user;
        battle = recorded.battleUserUpdate;
      }
    }
  }
  const settled = await updateUserDataForClaimTowerDefenseRun(ctx.drizzle, ctx, {
    nonce,
    points: 0,
    wave: 0,
  });
  // A simultaneous claim of this run settled it; the objective it completed stays done.
  if (settled.rowsAffected === 0 && !completedFor)
    return refusedForGood(REPLACED_RUN_MESSAGE);
  if (settled.rowsAffected > 0)
    await insertTowerDefenseClaimReceipt(ctx.drizzle, ctx, {
      claimKey,
      wave: result.wave,
      kills: result.kills,
      points: 0,
    });
  return {
    success: true,
    message: !result.won
      ? `The line broke at wave ${result.wave}. Take your position again when you are ready.`
      : completedFor
        ? "You held your ground! Continue the quest in your logbook."
        : "You held your ground, but this quest objective is no longer open.",
    pointsEarned: 0,
    wave: result.wave,
    kills: result.kills,
    ...getChallengeQuestUserUpdate(completedFor, battle),
  };
};

/** Guard Hall levels keyed by upgrade, ignoring rows for upgrades that no longer exist. */
const dojoLevels = (rows: { upgradeId: string; level: number }[]): TdDojoLevels => {
  const levels: TdDojoLevels = {};
  for (const row of rows)
    if ((TD_DOJO as readonly string[]).includes(row.upgradeId)) {
      const id = row.upgradeId as TdDojoUpgrade;
      levels[id] = Math.max(0, Math.min(TD_DOJO_INFO[id].max, row.level));
    }
  return levels;
};
