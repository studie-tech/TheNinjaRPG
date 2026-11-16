import { nanoid } from "nanoid";
import { z } from "zod";
import { snapshotSpriteAnimations } from "@/libs/spriteAnimations";
import { decodeTdActions } from "@/libs/towerDefense/actionLog";
import {
  TD_DOJO,
  TD_DOJO_INFO,
  type TdDojoLevels,
  type TdDojoUpgrade,
  tdCheckpoints,
} from "@/libs/towerDefense/content";
import { TD_SIM_VERSION, tdDojoCost } from "@/libs/towerDefense/sim";
import {
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
  upsertUserTowerDefenseUpgrade,
} from "@/queries/towerDefense";
import {
  baseServerResponse,
  cdnCachedProcedure,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  ratelimitMiddleware,
} from "@/server/api/trpc";
import { isMysqlDuplicateKeyError } from "@/server/utils/mysqlErrors";
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
import {
  TD_MAX_LOG_CHARS,
  TD_MAX_TICKS,
  towerDefenseRunTokenSchema,
} from "@/validators/towerDefense";

export const towerDefenseRouter = createTRPCRouter({
  /** The caller's scrolls, best wave and Dojo levels. */
  getProgress: protectedProcedure
    .meta({
      mcp: { description: "Get tower defense scrolls, best wave and Dojo levels" },
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
          .pick({ seed: true, startWave: true, bestWave: true, dojo: true })
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
        dojo: dojoLevels(upgrades),
      };
      const token = signRunToken({
        v: 1,
        userId: ctx.userId,
        nonce: nanoid(),
        ...config,
        issuedAt: Date.now(),
      });
      return { success: true, message: "Run started", token, config };
    }),

  /**
   * Claim a finished run. The server replays the signed run with the submitted action log
   * and pays out what the replay earned. Everything that can refuse a claim without the
   * replay runs first, and replays have their own tighter limit. The receipt keyed on
   * the run nonce is inserted before anything is granted, so each run pays out once.
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
      baseServerResponse.extend({
        permanent: z.boolean().optional(),
        reloadRequired: z.boolean().optional(),
        alreadyClaimed: z.boolean().optional(),
        pointsEarned: z.number().optional(),
        wave: z.number().optional(),
        kills: z.number().optional(),
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
      const [receipt, canReplay] = await Promise.all([
        findTowerDefenseClaimReceipt(ctx.drizzle, claimKey),
        reserveTowerDefenseReplay(ctx.userId, input.endTick),
      ]);
      if (receipt)
        return alreadyClaimed({
          wave: receipt.wave,
          kills: receipt.score,
          points: receipt.pointsEarned,
        });
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
      try {
        await insertTowerDefenseClaimReceipt(ctx.drizzle, ctx, {
          claimKey,
          wave: result.wave,
          kills: result.kills,
          points: result.points,
        });
      } catch (error) {
        if (!isMysqlDuplicateKeyError(error)) throw error;
        // A simultaneous claim of the same run won with its own log; report what it paid.
        // A duplicate with no receipt for this run is some other collision, not a claim.
        const winner = await findTowerDefenseClaimReceipt(ctx.drizzle, claimKey);
        if (!winner) throw error;
        return alreadyClaimed({
          wave: winner.wave,
          kills: winner.score,
          points: winner.pointsEarned,
        });
      }
      const [updated] = await Promise.all([
        updateUserDataForClaimTowerDefenseRun(ctx.drizzle, ctx, result),
        insertTowerDefenseRun(ctx.drizzle, ctx, {
          seed: token.seed,
          startWave: token.startWave,
          wave: result.wave,
          kills: result.kills,
          startedAt: new Date(token.issuedAt),
        }),
      ]);
      // MySQL counts changed rows: a run that earned nothing and set no record changes none.
      if (updated.rowsAffected === 0 && result.points > 0)
        return errorResponse("Failed to award scrolls. User data might be missing.");
      return {
        success: true,
        message:
          result.points > 0
            ? `Reached wave ${result.wave} and earned ${result.points.toLocaleString()} scroll${result.points === 1 ? "" : "s"}!`
            : `Reached wave ${result.wave}.`,
        pointsEarned: result.points,
        wave: result.wave,
        kills: result.kills,
      };
    }),

  /** Buy the next level of a Dojo upgrade with scrolls. */
  purchaseDojoUpgrade: protectedProcedure
    .meta({ mcp: { description: "Buy a tower defense Dojo upgrade" } })
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
      const level = dojoLevels(upgrades)[input.upgradeId] ?? 0;
      if (level >= TD_DOJO_INFO[input.upgradeId].max)
        return errorResponse("Already at max level.");
      if (progress.towerDefenseBestWave < TD_DOJO_INFO[input.upgradeId].unlockWave)
        return errorResponse(
          `Reach wave ${TD_DOJO_INFO[input.upgradeId].unlockWave} to unlock this.`,
        );
      const cost = tdDojoCost(input.upgradeId, level);
      // The level comes from the snapshot above, so two concurrent purchases by the same
      // account can each pay for the same level. The cost stays on that account's own
      // scrolls and support can restore it, so this stays a readable check-then-write.
      const result = await updateUserDataForPurchaseDojoUpgrade(ctx.drizzle, cost, ctx);
      if (result.rowsAffected === 0) return errorResponse("Not enough scrolls.");
      await upsertUserTowerDefenseUpgrade(ctx.drizzle, ctx, input.upgradeId, level + 1);
      return {
        success: true,
        message: `${TD_DOJO_INFO[input.upgradeId].name} is now level ${level + 1}.`,
        level: level + 1,
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

/** Dojo levels keyed by upgrade, ignoring rows for upgrades that no longer exist. */
const dojoLevels = (rows: { upgradeId: string; level: number }[]): TdDojoLevels => {
  const levels: TdDojoLevels = {};
  for (const row of rows)
    if ((TD_DOJO as readonly string[]).includes(row.upgradeId)) {
      const id = row.upgradeId as TdDojoUpgrade;
      levels[id] = Math.max(0, Math.min(TD_DOJO_INFO[id].max, row.level));
    }
  return levels;
};
