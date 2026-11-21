import { nanoid } from "nanoid";
import { z } from "zod";
import { getScoutingReportUserUpdate } from "@/deltas/chakraStorm";
import { decodeCsActions } from "@/libs/chakraStorm/actionLog";
import {
  CS_DAILY_SECONDS,
  CS_LEADERBOARD_STAGE,
  CS_STAGE_INFO,
  CS_STAGES,
  CS_TRAINING,
  CS_TRAINING_INFO,
  csTrainingCost,
} from "@/libs/chakraStorm/content";
import {
  type CsProgress,
  csStageUnlocked,
  parseCsProgress,
  settleCsRun,
} from "@/libs/chakraStorm/progress";
import { CS_SIM_VERSION } from "@/libs/chakraStorm/sim";
import { tdDailyReward } from "@/libs/towerDefense/balance";
import {
  findChakraStormClaimant,
  findChakraStormClaimReceipt,
  findChakraStormProgress,
  insertChakraStormClaimReceipt,
  listChakraStormReceiptForGetLeaderboard,
  updateChakraStormProgressForClaimRun,
  updateChakraStormProgressForTrain,
  updateUserDataForChakraStormDuty,
  upsertChakraStormProgressForStartRun,
} from "@/queries/chakraStorm";
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
  areChakraStormClaimsEnabled,
  CHAKRA_STORM_CLAIMS_PAUSED_MESSAGE,
  CHAKRA_STORM_REPLAY_LIMIT_MESSAGE,
  chakraStormClaimKey,
  checkChakraStormClaimTiming,
  reserveChakraStormReplay,
  verifyChakraStormRun,
} from "@/server/utils/chakraStormClaims";
import { signRunToken, verifyRunToken } from "@/server/utils/runTokens";
import { getFirstOfThisMonth, periodStart } from "@/utils/time";
import {
  type ChakraStormRunToken,
  CS_MAX_ACTIONS,
  CS_MAX_LOG_CHARS,
  CS_MAX_TICKS,
  chakraStormRunTokenSchema,
} from "@/validators/chakraStorm";
import { userDeltaResponseSchema } from "@/validators/userCache";

const stageRecordSchema = z.object({
  seconds: z.number(),
  kills: z.number(),
  level: z.number(),
  won: z.boolean(),
});

export const chakraStormRouter = createTRPCRouter({
  /** The caller's intel, Training Hall levels and best run in each region. */
  getProgress: protectedProcedure
    .meta({
      mcp: { description: "Get Chakra Storm intel, training and region records" },
    })
    .use(ratelimitMiddleware)
    .query(async ({ ctx }) =>
      progressFrom(await findChakraStormProgress(ctx.drizzle, ctx)),
    ),

  /** Sign a new scouting run in an open region with the caller's training. */
  startRun: protectedProcedure
    .meta({ mcp: { description: "Start a Chakra Storm scouting run" } })
    .use(ratelimitMiddleware)
    .input(z.object({ stage: z.enum(CS_STAGES) }))
    .output(
      baseServerResponse.extend({
        token: z.string().optional(),
        seed: z.string().optional(),
        training: z.record(z.enum(CS_TRAINING), z.number()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const progress = progressFrom(await findChakraStormProgress(ctx.drizzle, ctx));
      if (!csStageUnlocked(progress, input.stage))
        return errorResponse(`${CS_STAGE_INFO[input.stage].name} is not open yet.`);
      const seed = nanoid();
      const nonce = nanoid();
      // Only the latest run can be claimed, so runs are never played side by side.
      await upsertChakraStormProgressForStartRun(ctx.drizzle, ctx, nonce);
      const payload: ChakraStormRunToken = {
        game: "chakraStorm",
        v: 1,
        userId: ctx.userId,
        nonce,
        seed,
        stage: input.stage,
        training: progress.training,
        issuedAt: Date.now(),
      };
      return {
        success: true,
        message: "Run started",
        token: signRunToken(payload),
        seed,
        training: progress.training,
      };
    }),

  /**
   * Claim a finished run. The server replays the signed run with the submitted action log
   * and pays out what the replay earned: intel, the region's record, and once per UTC day
   * the scouting report reward for a run of at least `CS_DAILY_SECONDS`. Everything that
   * can refuse a claim without the replay runs first, and replays have their own tighter
   * limit. Only the caller's latest run can be claimed, and the payout retires it, so each
   * run pays out once; its receipt then answers a retry whose response was lost.
   * `permanent` marks refusals that claiming the same run again can only repeat.
   */
  claimRun: protectedProcedure
    .meta({ mcp: { description: "Claim a finished Chakra Storm run" } })
    .use(ratelimitMiddleware)
    .input(
      z.object({
        token: z.string().min(1).max(4000),
        // The compact encoding of `libs/chakraStorm/actionLog`.
        actions: z.string().max(CS_MAX_LOG_CHARS),
        endTick: z.int().min(0).max(CS_MAX_TICKS),
        /** `CS_SIM_VERSION` of the page that played the run. */
        simVersion: z.int(),
      }),
    )
    .output(
      userDeltaResponseSchema.extend({
        permanent: z.boolean().optional(),
        reloadRequired: z.boolean().optional(),
        alreadyClaimed: z.boolean().optional(),
        intelEarned: z.number().optional(),
        record: stageRecordSchema.nullable().optional(),
        unlocked: z.enum(CS_STAGES).optional(),
        dailyReward: z
          .object({ ryo: z.number(), prestige: z.number(), villageTokens: z.number() })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!areChakraStormClaimsEnabled())
        return errorResponse(CHAKRA_STORM_CLAIMS_PAUSED_MESSAGE);
      // A page on older rules played a run this replay would not reproduce.
      if (input.simVersion !== CS_SIM_VERSION)
        return {
          ...errorResponse(
            "Chakra Storm was updated during your run, so it cannot be verified. Reload the page for the new version.",
          ),
          permanent: true,
          reloadRequired: true,
        };
      const token = verifyRunToken(input.token, chakraStormRunTokenSchema);
      if (!token) return refusedForGood("This run's token is invalid.");
      if (token.userId !== ctx.userId)
        return refusedForGood("This run belongs to another player.");
      const refused = checkChakraStormClaimTiming({
        token,
        endTick: input.endTick,
        now: Date.now(),
      });
      if (refused)
        return refused.permanent
          ? refusedForGood(refused.message)
          : errorResponse(refused.message);
      const claimKey = chakraStormClaimKey(token.nonce);
      // The replay is reserved alongside the lookups to keep one round trip. A retry of a
      // run already paid spends a reservation it does not use, which only happens when a
      // claim's response is lost.
      const [receipt, canReplay, row, claimant] = await Promise.all([
        findChakraStormClaimReceipt(ctx.drizzle, claimKey),
        reserveChakraStormReplay(ctx.userId, input.endTick),
        findChakraStormProgress(ctx.drizzle, ctx),
        findChakraStormClaimant(ctx.drizzle, ctx),
      ]);
      if (receipt)
        return {
          ...errorResponse("This run has already been claimed."),
          alreadyClaimed: true,
          intelEarned: receipt.intelEarned,
        };
      if (!claimant || !row) return errorResponse("User not found.");
      if (row.activeRun !== token.nonce) return refusedForGood(REPLACED_RUN_MESSAGE);
      if (!canReplay) return errorResponse(CHAKRA_STORM_REPLAY_LIMIT_MESSAGE);
      const actions = decodeCsActions(input.actions, CS_MAX_ACTIONS);
      if (!actions) return refusedForGood("This run's record could not be read.");
      const result = await verifyChakraStormRun({
        token,
        actions,
        endTick: input.endTick,
      });
      // The replay is deterministic, so a refused log stays refused.
      if (!result.ok) return refusedForGood(result.message);
      const run = {
        stage: token.stage,
        seconds: result.seconds,
        kills: result.kills,
        level: result.level,
        won: result.won,
        bosses: result.bosses,
      };
      const settled = settleCsRun(progressFrom(row), run);
      const paid = await updateChakraStormProgressForClaimRun(ctx.drizzle, ctx, {
        nonce: token.nonce,
        intel: settled.intel,
        stages: settled.progress.stages,
      });
      // A simultaneous claim of this run paid it, or a newer run replaced it meanwhile.
      if (paid.rowsAffected === 0) return refusedForGood(REPLACED_RUN_MESSAGE);
      const paidAt = new Date();
      const dutyReward =
        result.seconds >= CS_DAILY_SECONDS ? tdDailyReward(claimant.level) : null;
      const [duty] = await Promise.all([
        dutyReward
          ? updateUserDataForChakraStormDuty(ctx.drizzle, ctx, {
              ryo: dutyReward.ryo,
              prestige: dutyReward.prestige,
              paidAt,
              dayStart: periodStart("daily", paidAt),
            })
          : undefined,
        insertChakraStormClaimReceipt(ctx.drizzle, ctx, {
          claimKey,
          ...run,
          intel: settled.intel,
        }),
      ]);
      // The report pays only when no payout has happened yet this UTC day.
      const reward = duty && duty.rowsAffected > 0 ? dutyReward : null;
      if (reward && claimant.villageId)
        await incrementVillageTokens(
          ctx.drizzle,
          reward.villageTokens,
          claimant.villageId,
        );
      const summary = `${result.won ? "Scouting complete" : "Back from scouting"}: +${settled.intel.toLocaleString()} intel.`;
      const update = getScoutingReportUserUpdate({
        reward,
        villageId: claimant.villageId,
        paidAt,
      });
      return {
        success: true,
        message: reward
          ? `${summary} Daily scouting report delivered: +${reward.ryo.toLocaleString()} ryo, +${reward.prestige} prestige${claimant.villageId ? ` and +${reward.villageTokens} tokens for your village` : ""}.`
          : summary,
        intelEarned: settled.intel,
        record: settled.isBest ? (settled.progress.stages[run.stage] ?? null) : null,
        unlocked: settled.unlocked,
        dailyReward: reward ?? undefined,
        userDelta: update.userDelta,
        userPatch: update.userPatch,
      };
    }),

  /** Buy the next level of a Training Hall upgrade with intel. */
  train: protectedProcedure
    .meta({ mcp: { description: "Buy a Chakra Storm Training Hall upgrade" } })
    .use(ratelimitMiddleware)
    .input(z.object({ id: z.enum(CS_TRAINING) }))
    .output(
      baseServerResponse.extend({
        level: z.number().optional(),
        intelSpent: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await findChakraStormProgress(ctx.drizzle, ctx);
      const progress = progressFrom(row);
      const cost = csTrainingCost(input.id, progress.training);
      if (cost === null) return errorResponse("That training is already mastered.");
      if (!row || progress.intel < cost) return errorResponse("Not enough intel.");
      const level = progress.training[input.id] + 1;
      // The level comes from the snapshot above, so two concurrent purchases by the same
      // account can each pay for the same level. The cost stays on that account's own
      // intel and support can restore it, so this stays a readable check-then-write.
      const result = await updateChakraStormProgressForTrain(ctx.drizzle, ctx, {
        cost,
        training: { ...progress.training, [input.id]: level },
      });
      if (result.rowsAffected === 0) return errorResponse("Not enough intel.");
      return {
        success: true,
        message: `${CS_TRAINING_INFO[input.id].name} is now level ${level}.`,
        level,
        intelSpent: cost,
      };
    }),

  /** This month's longest verified Undercover runs, one per player. */
  getLeaderboard: cdnCachedProcedure
    .meta({ mcp: { description: "Get the Chakra Storm Undercover leaderboard" } })
    .input(z.object({ limit: z.number().min(1).max(100).prefault(50) }))
    .query(async ({ ctx, input }) =>
      listChakraStormReceiptForGetLeaderboard(ctx.drizzle, {
        limit: input.limit,
        stage: CS_LEADERBOARD_STAGE,
        since: getFirstOfThisMonth(),
      }),
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

/** Stored progress read through the same validation as the device's own. */
const progressFrom = (
  row: { intel: number; training: unknown; stages: unknown } | undefined,
): CsProgress =>
  row
    ? parseCsProgress(
        JSON.stringify({
          intel: row.intel,
          training: row.training,
          stages: row.stages,
        }),
      )
    : parseCsProgress(null);
