import { nanoid } from "nanoid";
import { z } from "zod";
import { getDailyDutyUserUpdate } from "@/deltas/towerDefense";
import { snapshotSpriteAnimations } from "@/libs/spriteAnimations";
import { decodeTdActions } from "@/libs/towerDefense/actionLog";
import { tdDailyReward, tdFulfilsDailyDuty } from "@/libs/towerDefense/balance";
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
import {
  baseServerResponse,
  cdnCachedProcedure,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  ratelimitMiddleware,
} from "@/server/api/trpc";
import {
  areTowerDefenseClaimsEnabled,
  checkTowerDefenseClaimTiming,
  reserveTowerDefenseReplay,
  TOWER_DEFENSE_CLAIMS_PAUSED_MESSAGE,
  TOWER_DEFENSE_REPLAY_LIMIT_MESSAGE,
  towerDefenseClaimKey,
  verifyTowerDefenseRun,
} from "@/server/utils/towerDefenseClaims";
import { signRunToken, verifyRunToken } from "@/server/utils/towerDefenseCrypto";
import { periodStart } from "@/utils/time";
import {
  TD_MAX_LOG_CHARS,
  TD_MAX_TICKS,
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

  /** Sign a new run from one of the caller's checkpoints. */
  startRun: protectedProcedure
    .meta({ mcp: { description: "Start a tower defense run" } })
    .use(ratelimitMiddleware)
    .input(z.object({ startWave: z.int().min(1) }))
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
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [progress, upgrades] = await Promise.all([
        findTowerDefenseProgress(ctx.drizzle, ctx),
        listUserTowerDefenseUpgrades(ctx.drizzle, ctx),
      ]);
      if (!progress) return errorResponse("User not found.");
      const bestWave = progress.towerDefenseBestWave;
      if (!tdCheckpoints(bestWave).includes(input.startWave))
        return errorResponse("That checkpoint is not unlocked yet.");
      const config = {
        seed: nanoid(),
        startWave: input.startWave,
        bestWave,
        level: progress.level,
        dojo: dojoLevels(upgrades),
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
      const token = verifyRunToken(input.token);
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
