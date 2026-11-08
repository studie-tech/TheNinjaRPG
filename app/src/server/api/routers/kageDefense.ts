import { nanoid } from "nanoid";
import { z } from "zod";
import { getKageDefenseCheckInUserUpdate } from "@/deltas/kage";
import {
  KAGE_CHALLENGER_DAILY_LIMIT,
  KAGE_CHALLENGER_WEEKLY_LIMIT,
  KAGE_DEFENSE_CHECK_IN_MINUTES,
  KAGE_DEFENSE_GRACE_MINUTES,
  KAGE_DEFENSE_INSTANT_REQUEST_MINUTES,
  KAGE_DEFENSE_NOTICE_HOURS,
  KAGE_DEFENSE_SLOT_MINUTES,
} from "@/drizzle/constants";
import { getServerPusher } from "@/libs/pusher";
import { fetchActionUser } from "@/queries/actionReadiness";
import {
  executeResultForDismissInstantDefense,
  executeResultForRequestInstantDefense,
  executeResultForSetDefenseAi,
  executeResultForWithdrawDefense,
  findKageDefendedChallengesForWithdrawDefense,
  findVillageForSetDefenseAi,
  findVillageForWithdrawDefense,
  insertKageDefendedChallengesForJoinDefenseQueue,
  listKageDefendedChallengesForStartDefense,
  requeueKageDefendedChallenges,
  saveKageSchedule,
  updateKageDefendedChallengesForCheckInDefense,
  updateKageDefendedChallengesForRescheduleDefense2,
} from "@/queries/kageDefense";
import { fetchAllGameSettings, findUserById } from "@/queries/profile";
import { initiateBattle } from "@/routers/combat";
import {
  baseServerResponse,
  errorResponse,
  protectedProcedure,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import {
  type ActionReadiness,
  actionReadinessResponse,
  prepareActionReadiness,
} from "@/server/utils/actionReadiness";
import {
  assignKageMatches,
  getKageDefensePublic,
  type KageDefenseHall,
  syncLockedKageDefense,
  withinKageChallengeLimits,
  withKageDefense,
  withKageHall,
} from "@/server/utils/kage";
import { isMysqlDuplicateKeyError, retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { getKageEligibility } from "@/utils/kage";
import { secondsFromDate } from "@/utils/time";
import {
  kageBattleResponseSchema,
  kageScheduleSchema,
  kageVillageSchema,
} from "@/validators/kage";
import { userDeltaResponseSchema } from "@/validators/userCache";

const kageMatchSchema = z.object({ id: z.string().min(1) });

/** Omit the invitation ID for an ordinary scheduled start; include it to accept early. */
const kageStartSchema = kageMatchSchema.extend({
  instantRequestId: z.string().min(1).optional(),
});

/** Bind dismissal to the exact invitation shown, so stale responses cannot revoke a new one. */
const kageInstantResponseSchema = kageMatchSchema.extend({
  instantRequestId: z.string().min(1),
});

const kageAiSchema = kageMatchSchema.extend({ consent: z.boolean() });

const kageJoinSchema = kageVillageSchema.extend({
  aiRequested: z.boolean().default(false),
});

/** Authenticated title-defense scheduling, queue participation and battle admission. */
export const kageDefenseProcedures = {
  /** Return the public hall snapshot and the caller's current challenger eligibility. */
  getDefenses: protectedProcedure
    .input(kageVillageSchema)
    .query(async ({ ctx, input }) => {
      const [hall, user] = await Promise.all([
        getKageDefensePublic(ctx.drizzle, input.villageId),
        findUserById(ctx.drizzle, ctx.userId),
      ]);
      return {
        hall,
        eligibility: user
          ? getKageEligibility(user, input.villageId)
          : "Character not found",
      };
    }),
  /** Publish UTC windows only while the current tenure has no assigned or running match. */
  publishSchedule: protectedProcedure
    .input(kageScheduleSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      return withKageHall(ctx.drizzle, input.villageId, async (tx, hall) => {
        if (hall.village.kageId !== ctx.userId)
          return errorResponse("Only the current Kage can publish defense times");
        // Reconcile first: an existing queue can acquire assignments that lock these windows.
        if (!(await syncLockedKageDefense(tx, hall)))
          return errorResponse("Leadership changed. Refresh the defense schedule.");
        if (
          hall.rows.some(({ match }) =>
            ["SCHEDULED", "STARTING", "BATTLE"].includes(match.status),
          )
        )
          return errorResponse(
            "Assigned matches lock the schedule. Use the match reschedule action instead.",
          );
        hall.state.windows = input.windows;
        hall.state.publishedAt = hall.now.toISOString();
        await saveKageSchedule(tx, hall);
        if (!hall.paused) await assignKageMatches(tx, hall);
        return {
          success: true,
          message: "Defense schedule published in UTC game time",
        };
      });
    }),
  /** Admit one eligible challenger per active queue entry without reserving their character. */
  joinDefenseQueue: protectedProcedure
    .input(kageJoinSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      return withKageHall(ctx.drizzle, input.villageId, async (tx, hall) => {
        const user = await findUserById(tx, ctx.userId);
        if (!user) return errorResponse("Character not found");
        if (hall.rows.some((r) => r.match.userId === ctx.userId))
          return errorResponse("You already have an active queue entry");
        const reason = getKageEligibility(user, input.villageId);
        if (reason) return errorResponse(reason);
        if (hall.village.kageId === ctx.userId)
          return errorResponse("The Kage cannot challenge themselves");
        if (!hall.village.kageId)
          return errorResponse("The village is awaiting a new Kage");
        if (!(await syncLockedKageDefense(tx, hall)))
          return errorResponse("Leadership changed. Refresh the defense schedule.");
        const result = await insertKageDefendedChallengesForJoinDefenseQueue(
          tx,
          input,
          ctx,
          hall,
        ).catch((error: unknown) => {
          if (isMysqlDuplicateKeyError(error)) return null;
          throw error;
        });
        if (!result?.rowsAffected)
          return errorResponse("You already have an active queue entry");
        // Assignment uses the newly inserted row on the next authoritative sync, without blocking play.
        return {
          success: true,
          message: hall.paused
            ? "Joined the queue. Match scheduling is paused for war."
            : "Joined the Kage defense queue",
        };
      });
    }),
  /** Cancel the caller's waiting entry atomically against schedule assignment and battle launch. */
  withdrawDefense: protectedProcedure
    .input(kageMatchSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const match = await findKageDefendedChallengesForWithdrawDefense(
        ctx.drizzle,
        input,
      );
      if (!match) return errorResponse("Match not found");
      // Drizzle has no multi-table UPDATE builder. STRAIGHT_JOIN keeps the village
      // first, matching schedule/launch locks so a loaded assignment cannot revive this entry.
      const result = await retryOnDeadlock(() =>
        executeResultForWithdrawDefense(ctx.drizzle, match, input, ctx),
      );
      // Joined writes count both changed rows rather than one queue receipt.
      if (result.rowsAffected > 0)
        return { success: true, message: "Withdrawn from the queue" };
      const home = await findVillageForWithdrawDefense(ctx.drizzle, match);
      return errorResponse(
        home?.type === "VILLAGE"
          ? "Only your waiting entry can be withdrawn"
          : "Village not found",
      );
    }),
  /** Move one assigned match and its followers together while retaining FIFO priority. */
  rescheduleDefense: protectedProcedure
    .input(kageMatchSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const match = await findKageDefendedChallengesForWithdrawDefense(
        ctx.drizzle,
        input,
      );
      if (!match) return errorResponse("Match not found");
      return withKageHall(ctx.drizzle, match.villageId, async (tx, hall) => {
        if (!(await syncLockedKageDefense(tx, hall)))
          return errorResponse("Leadership changed. Refresh the defense schedule.");
        const m = hall.rows.find((r) => r.match.id === input.id)?.match;
        if (!m || (ctx.userId !== m.userId && ctx.userId !== hall.village.kageId))
          return errorResponse("Only match participants can reschedule");
        if (m.rescheduled || m.status !== "SCHEDULED" || !m.scheduledAt || hall.paused)
          return errorResponse(
            "One reschedule is available for each assigned match outside war",
          );
        if (hall.now >= m.scheduledAt)
          return errorResponse("Reschedule before the appointed match time");
        // Reassign later waiting matches together: the original queue order remains authoritative.
        const index = hall.rows.findIndex((r) => r.match.id === input.id);
        const notBefore = new Date(
          Math.max(
            secondsFromDate(KAGE_DEFENSE_NOTICE_HOURS * 3600, hall.now).getTime(),
            secondsFromDate(KAGE_DEFENSE_SLOT_MINUTES * 60, m.scheduledAt).getTime(),
          ),
        );
        await requeueKageDefendedChallenges(tx, waitingFrom(hall, index), {
          notBefore,
        });
        await updateKageDefendedChallengesForRescheduleDefense2(tx, input);
        return {
          success: true,
          message: "Match rescheduled once; queue priority preserved",
        };
      });
    }),
  /** Save waiting-match AI consent using the current incumbent and invalidate acceptance on requests. */
  setDefenseAi: protectedProcedure
    .input(kageAiSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const match = await findKageDefendedChallengesForWithdrawDefense(
        ctx.drizzle,
        input,
      );
      if (!match) return errorResponse("Match not found");
      // Share the village-first atomic boundary with reconciliation and launch. Consent
      // is checked against the locked incumbent/request, never the initial match snapshot.
      const result = await retryOnDeadlock(() =>
        executeResultForSetDefenseAi(ctx.drizzle, ctx, input, match),
      );
      // The village increment also makes an unchanged preference a successful guarded write.
      if (result.rowsAffected > 0)
        return {
          success: true,
          message: input.consent
            ? "AI preference saved; both players must agree"
            : "Manual PvP selected",
        };
      // Diagnose only rejected writes; successful preference saves need no hall reload.
      const [home, current] = await Promise.all([
        findVillageForSetDefenseAi(ctx.drizzle, match),
        findKageDefendedChallengesForWithdrawDefense(ctx.drizzle, input),
      ]);
      if (home?.type !== "VILLAGE") return errorResponse("Village not found");
      if (!current || !["QUEUED", "SCHEDULED"].includes(current.status))
        return errorResponse("The match can no longer change combat mode");
      const isKage = home.kageId === ctx.userId;
      if (!isKage && current.userId !== ctx.userId)
        return errorResponse("Only participants can select combat mode");
      if (isKage && input.consent && !current.aiRequested)
        return errorResponse("The challenger must request AI combat first");
      return errorResponse("Combat mode changed. Refresh the schedule and try again.");
    }),
  /** Record an awake challenger's attendance within the assigned match's check-in window. */
  checkInDefense: protectedProcedure
    .input(kageMatchSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const [match, actionUser, settings] = await Promise.all([
        findKageDefendedChallengesForWithdrawDefense(ctx.drizzle, input),
        fetchActionUser(ctx.drizzle, ctx.userId),
        fetchAllGameSettings(ctx.drizzle),
      ]);
      if (!match) return errorResponse("Match not found");
      let confirmedReadiness: ActionReadiness | undefined;
      const result = await withKageHall(
        ctx.drizzle,
        match.villageId,
        async (tx, hall) => {
          const readiness = prepareActionReadiness(actionUser, settings, hall.now);
          if (readiness.error) return errorResponse(readiness.error);
          for (const row of hall.rows) {
            if (row.user.userId === ctx.userId) row.user = readiness.user;
          }
          if (hall.village.kage?.userId === ctx.userId)
            hall.village.kage = readiness.user;
          if (!(await syncLockedKageDefense(tx, hall)))
            return errorResponse("Leadership changed. Refresh the defense schedule.");
          const row = hall.rows.find((r) => r.match.id === input.id);
          const m = row?.match;
          if (!m || m.userId !== ctx.userId)
            return errorResponse("Only the challenger can check in");
          if (
            hall.paused ||
            m.hospitalDeferred ||
            m.status !== "SCHEDULED" ||
            !m.scheduledAt
          )
            return errorResponse("Check-in is unavailable while this match is paused");
          if (
            hall.now.getTime() <
              m.scheduledAt.getTime() - KAGE_DEFENSE_CHECK_IN_MINUTES * 60_000 ||
            hall.now.getTime() >
              m.scheduledAt.getTime() + KAGE_DEFENSE_GRACE_MINUTES * 60_000
          )
            return errorResponse(
              `Check in during the ${KAGE_DEFENSE_CHECK_IN_MINUTES} minutes before the match or its start grace period`,
            );
          const saved = await updateKageDefendedChallengesForCheckInDefense(
            tx,
            hall,
            input,
            readiness,
          );
          if (!saved.rowsAffected)
            return errorResponse("Your status changed. Please try again.");
          confirmedReadiness = readiness;
          return {
            success: true,
            message: hall.village.kage?.isAi
              ? "Checked in. Remain awake and start the title fight at the appointed time."
              : "Checked in. Remain awake; the Kage starts the battle.",
            ...getKageDefenseCheckInUserUpdate(),
          };
        },
      );
      return actionReadinessResponse(result, confirmedReadiness, ctx.drizzle);
    }),
  /**
   * Publish one invitation with a guarded village write, without reconciling attendance
   * or moving appointments. The normal schedule query/maintenance owns reconciliation.
   */
  requestInstantDefense: protectedProcedure
    .input(kageMatchSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const match = await findKageDefendedChallengesForWithdrawDefense(
        ctx.drizzle,
        input,
      );
      if (!match) return errorResponse("Match not found");
      if (match.kageId !== ctx.userId)
        return errorResponse("Only the current Kage can send an instant challenge");
      if (match.status !== "SCHEDULED" || !match.scheduledAt || !match.tenure)
        return errorResponse("This match is not available for an instant challenge");
      const { scheduledAt, tenure } = match;
      const now = new Date();
      const invitation = {
        id: nanoid(),
        matchId: match.id,
        scheduledAt: scheduledAt.toISOString(),
        expiresAt: secondsFromDate(
          KAGE_DEFENSE_INSTANT_REQUEST_MINUTES * 60,
          now,
        ).toISOString(),
        ai: match.aiRequested && match.aiAccepted,
      };
      // Drizzle has no joined UPDATE builder. Match the existing village-first writes:
      // JSON_SET preserves other schedule fields, and live guards reject stale snapshots
      // without a transaction or an attendance obligation for either participant.
      const result = await retryOnDeadlock(() =>
        executeResultForRequestInstantDefense(
          ctx.drizzle,
          invitation,
          match,
          ctx,
          tenure,
          input,
          scheduledAt,
          now,
        ),
      );
      if (result.rowsAffected !== 1)
        return errorResponse(
          "Challenge not sent. Be awake, wait for any pending invitation, and refresh the defense schedule.",
        );
      await getServerPusher()
        .trigger(match.userId, "event", {
          type: "userMessage",
          message:
            "Your Kage invites you to fight now. Accept at the town hall; ignoring this request has no penalty.",
          route: "/townhall#Kage",
          routeText: "View challenge",
          duration: 15_000,
        })
        .catch(console.error);
      return {
        success: true,
        message:
          "Instant challenge sent. Your scheduled match remains unchanged until accepted.",
      };
    }),
  /** Remove only the viewed invitation; a late response cannot dismiss its replacement. */
  dismissInstantDefense: protectedProcedure
    .input(kageInstantResponseSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const match = await findKageDefendedChallengesForWithdrawDefense(
        ctx.drizzle,
        input,
      );
      if (!match) return errorResponse("Match not found");
      // The village-first guard serializes with reconciliation and battle launch. Only
      // this JSON field changes, so dismissal needs neither a transaction nor a hall read.
      const result = await retryOnDeadlock(() =>
        executeResultForDismissInstantDefense(ctx.drizzle, match, input, ctx),
      );
      if (result.rowsAffected !== 1)
        return errorResponse(
          "Only match participants can dismiss a pending invitation. Refresh the schedule and try again.",
        );
      return {
        success: true,
        message:
          "Invitation dismissed without penalty. Your scheduled match is unchanged.",
      };
    }),
  /** Validate scheduled attendance or an accepted invitation, then recheck at atomic launch. */
  startDefense: protectedProcedure
    .input(kageStartSchema.extend({ originSocketId: z.string().max(128).optional() }))
    .output(kageBattleResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const [match, actionUser, settings] = await Promise.all([
        findKageDefendedChallengesForWithdrawDefense(ctx.drizzle, input),
        fetchActionUser(ctx.drizzle, ctx.userId),
        fetchAllGameSettings(ctx.drizzle),
      ]);
      if (!match) return errorResponse("Match not found");
      const admission = await withKageHall(
        ctx.drizzle,
        match.villageId,
        async (tx, hall) => {
          const readiness = prepareActionReadiness(actionUser, settings, hall.now);
          if (readiness.error) return errorResponse(readiness.error);
          for (const row of hall.rows) {
            if (row.user.userId === ctx.userId) row.user = readiness.user;
          }
          if (hall.village.kage?.userId === ctx.userId)
            hall.village.kage = readiness.user;
          if (!(await syncLockedKageDefense(tx, hall)))
            return errorResponse("Leadership changed. Refresh the defense schedule.");
          const row = hall.rows.find((r) => r.match.id === input.id);
          const m = row?.match;
          const instant = input.instantRequestId !== undefined;
          const npcIncumbent = hall.village.kage?.isAi && ctx.userId === m?.userId;
          if (instant && (!m || ctx.userId !== m.userId))
            return errorResponse("Only the invited challenger can accept");
          if (!m || (!instant && ctx.userId !== hall.village.kageId && !npcIncumbent))
            return errorResponse("Only the current Kage can start this match");
          if (
            m.status !== "SCHEDULED" ||
            !m.scheduledAt ||
            hall.paused ||
            m.hospitalDeferred
          )
            return errorResponse("This match is not ready to start");
          if (
            m.kageId !== hall.village.kageId ||
            !m.tenure ||
            m.tenure.getTime() !== hall.village.leaderUpdatedAt.getTime()
          )
            return errorResponse("Leadership changed; the match will be reassigned");
          const invitation = hall.state.instantChallenge;
          if (
            instant &&
            (!invitation ||
              invitation.id !== input.instantRequestId ||
              invitation.matchId !== m.id)
          )
            return errorResponse(
              "This invitation expired or changed. Your scheduled match is unchanged.",
            );
          if (
            !instant &&
            (hall.now < m.scheduledAt ||
              hall.now.getTime() >
                m.scheduledAt.getTime() + KAGE_DEFENSE_GRACE_MINUTES * 60_000)
          )
            return errorResponse(
              "Start at the scheduled time, within the published grace period",
            );
          if (!instant && !m.checkedInAt)
            return errorResponse("The challenger must check in first");
          const reason = getKageEligibility(row.user, match.villageId);
          if (reason) return errorResponse(reason);
          if (hall.rows.some((r) => r.match.status === "BATTLE"))
            return errorResponse("Finish the current defense first");
          const history = await listKageDefendedChallengesForStartDefense(tx, m);
          if (!withinKageChallengeLimits(history, hall.now))
            return errorResponse(
              `Challengers may fight ${KAGE_CHALLENGER_DAILY_LIMIT} time per UTC day and ${KAGE_CHALLENGER_WEEKLY_LIMIT} times per UTC week`,
            );
          const actor = ctx.userId === row.user.userId ? row.user : hall.village.kage;
          if (!actor) return errorResponse("Your character is unavailable");
          if (
            (row.user.userId === ctx.userId ? readiness.user : row.user).status !==
              "AWAKE" ||
            (!hall.village.kage?.isAi &&
              (hall.village.kage?.userId === ctx.userId
                ? readiness.user
                : hall.village.kage
              )?.status !== "AWAKE")
          )
            return errorResponse(
              "Both participants must be awake and free of other activities",
            );
          return {
            success: true as const,
            message: "Ready",
            match: { ...m, tenure: m.tenure, scheduledAt: m.scheduledAt },
          };
        },
      );
      if (!admission.success || !("match" in admission)) return admission;
      const m = admission.match;
      // Combat preload runs without holding the schedule transaction; launch rechecks
      // the tenure, slot, attendance and selected AI mode before claiming either player.
      let result: Awaited<ReturnType<typeof initiateBattle>>;
      try {
        result = await initiateBattle(
          {
            client: ctx.drizzle,
            actionUserId: ctx.userId,
            originSocketId: input.originSocketId,
            userIds: [m.userId],
            targetIds: [m.kageId],
            biome: "arena",
            autoCombatUserIds:
              m.aiRequested && m.aiAccepted ? [m.userId, m.kageId] : undefined,
            kageMatch: {
              id: m.id,
              villageId: m.villageId,
              kageId: m.kageId,
              tenure: m.tenure.toISOString(),
              battleId: nanoid(),
              ai: m.aiRequested && m.aiAccepted,
              instantRequest: input.instantRequestId
                ? {
                    id: input.instantRequestId,
                    scheduledAt: m.scheduledAt.toISOString(),
                  }
                : undefined,
            },
          },
          "KAGE_PVP",
        );
      } catch (error) {
        if (!input.instantRequestId)
          await resetFailedLaunch(ctx.drizzle, m.id, m.villageId);
        throw error;
      }
      if (!result.success && !input.instantRequestId)
        await resetFailedLaunch(ctx.drizzle, m.id, m.villageId);
      if (result.success && input.instantRequestId)
        await getServerPusher()
          .trigger(m.kageId, "event", {
            type: "userMessage",
            message:
              "Your instant title challenge was accepted. The battle has started.",
            route: "/combat",
            routeText: "To Combat",
          })
          .catch(console.error);
      return result;
    }),
};

/** Requeue a failed system launch and its waiting followers without spending a voluntary reschedule. */
const resetFailedLaunch = (client: DrizzleClient, id: string, villageId: string) =>
  withKageDefense(client, villageId, async (tx, hall) => {
    const index = hall.rows.findIndex(
      (r) => r.match.id === id && r.match.status === "SCHEDULED",
    );
    if (index < 0) return;
    // A running/finished match is never reset. Waiting followers move together so a
    // service failure preserves queue order and cannot become an attendance penalty.
    await requeueKageDefendedChallenges(tx, waitingFrom(hall, index), {
      notBefore: secondsFromDate(KAGE_DEFENSE_NOTICE_HOURS * 3600, hall.now),
      outcome: "Battle could not start; queue priority retained without penalty",
    });
  });

/** IDs of the match at `index` and the queue behind it that have not started. */
const waitingFrom = (hall: KageDefenseHall, index: number) =>
  hall.rows
    .slice(index)
    .filter((r) => ["QUEUED", "SCHEDULED"].includes(r.match.status))
    .map((r) => r.match.id);
