import { randomInt } from "node:crypto";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  EVENT_TOURNAMENT_LAUNCH_RECOVERY_SECONDS,
  EVENT_TOURNAMENT_READY_SECONDS,
  EVENT_TOURNAMENT_RETENTION_DAYS,
  MAP_WAKE_ISLAND_SECTOR,
  RANKED_PVP_STATS,
} from "@/drizzle/constants";
import { getExpBracket } from "@/libs/profile";
import { getServerPusher } from "@/libs/pusher";
import { postProcessRewards } from "@/libs/quest";
import {
  advanceEvent,
  beginEventRound,
  completeEventGame,
  createEventState,
  eligibilityFailures,
  eventRewardFor,
  generateEventBracket,
} from "@/libs/tournament/events";
import { findUserById, findUserRoleById } from "@/queries/profile";
import { deleteTournamentMatches } from "@/queries/tournament";
import {
  deleteTournamentForMaintainEventTournaments,
  deleteTournamentRewardClaimForMaintainEventTournaments,
  fetchEvent,
  fetchEventNoticeState,
  fetchEventUser,
  findBattleForSyncEventTournament,
  findEventActorCacheState,
  findEventActorRewardReceipt,
  findTournamentMatchForSyncEventTournament,
  insertTournamentForSaveEvent,
  insertTournamentMatchForLaunchEventGame,
  insertTournamentMatchForSyncEventTournament,
  insertTournamentRewardClaimForPayEventRewards,
  listRankedLoadoutForLaunchEventGame,
  listTournamentForListEvents,
  listTournamentForMaintainEventTournaments,
  listTournamentRewardClaimForPayEventRewards,
  listUserDataForLaunchEventGame,
  updateTournamentForPayEventRewards,
  updateTournamentForSaveEventState,
  updateTournamentMatchForRecordLaunchFailure,
  updateTournamentMatchForSyncEventTournament,
} from "@/queries/tournamentEvents";
import { initiateBattle } from "@/routers/combat";
import { updateRewards } from "@/routers/quests";
import { errorResponse, protectedProcedure } from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { isMysqlDuplicateKeyError, retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { cleanRankedProhibitedSelections } from "@/server/utils/ranked";
import { validateTitleRewardIds } from "@/server/utils/titleRewards";
import { canManageTournaments } from "@/utils/permissions";
import {
  type EventParticipant,
  type EventTournamentState,
  eventTournamentActionSchema,
  eventTournamentIdSchema,
  eventTournamentPlayerSchema,
  eventTournamentSaveSchema,
} from "@/validators/tournament";

import { userDeltaResponseSchema } from "@/validators/userCache";

const eventActionResponse = userDeltaResponseSchema.extend({
  eventNotices: z
    .array(
      z.object({
        tournamentId: z.string(),
        name: z.string(),
        message: z.string(),
        deadline: z.number(),
      }),
    )
    .optional(),
  isEventParticipant: z.boolean().optional(),
});

export const eventTournamentProcedures = {
  /** Return invitations and open ready checks that still need this player's response. */
  getEventNotices: protectedProcedure.query(async ({ ctx }) => {
    return (await fetchEventNoticeState(ctx.drizzle, ctx.userId)).notices;
  }),
  /** List public event summaries, including unpublished drafts only for tournament staff. */
  listEvents: protectedProcedure.query(async ({ ctx }) => {
    const [events, user] = await Promise.all([
      listTournamentForListEvents(ctx.drizzle),
      findUserRoleById(ctx.drizzle, ctx.userId),
    ]);
    return events
      .filter(
        (e) =>
          e.eventData &&
          (e.eventData.status !== "DRAFT" ||
            canManageTournaments(user?.role ?? "USER")),
      )
      .map((e) => {
        const state = e.eventData;
        return {
          id: e.id,
          eventData: state
            ? {
                status: state.status,
                participantCount: state.participants.filter((p) => !p.withdrawn).length,
                config: {
                  name: state.config.name,
                  description: state.config.description,
                  format: state.config.format,
                  rules: state.config.rules,
                  capacity: state.config.capacity,
                  registrationClosesAt: state.config.registrationClosesAt,
                },
              }
            : null,
        };
      });
  }),
  /** Synchronize authorized event reads before returning the bracket and player eligibility. */
  getEvent: protectedProcedure
    .input(eventTournamentIdSchema)
    .query(async ({ ctx, input }) => {
      const [user, initial] = await Promise.all([
        fetchEventUser(ctx.drizzle, ctx.userId),
        fetchEvent(ctx.drizzle, input.tournamentId),
      ]);
      if (
        !initial?.eventData ||
        !user ||
        (initial.eventData.status === "DRAFT" && !canManageTournaments(user.role))
      )
        return null;
      const needsRefresh = await syncEventTournament(
        ctx.drizzle,
        input.tournamentId,
        initial,
      );
      const row = needsRefresh
        ? await fetchEvent(ctx.drizzle, input.tournamentId)
        : initial;
      if (!row?.eventData) return null;
      const participant = row.eventData.participants.find(
        (p) => p.userId === ctx.userId && !p.withdrawn,
      );
      const { matches: _matches, ...publicRow } = row;
      return {
        ...publicRow,
        eligibility: eligibilityFailures(row.eventData.config, snapshotFor(user)),
        participantId: participant?.id ?? null,
      };
    }),
  /** Create or edit staff-owned drafts while registration remains in the future. */
  saveEvent: protectedProcedure
    .input(eventTournamentSaveSchema)
    .mutation(async ({ ctx, input }) => {
      const [user, titleError] = await Promise.all([
        findUserRoleById(ctx.drizzle, ctx.userId),
        validateTitleRewardIds(ctx.drizzle, input.config),
      ]);
      if (!canManageTournaments(user?.role ?? "USER"))
        return errorResponse("Tournament staff access required");
      if (input.config.registrationClosesAt <= Date.now())
        return errorResponse("Registration must close in the future");
      if (titleError) return errorResponse(titleError);
      if (input.tournamentId)
        return editEvent(ctx.drizzle, input.tournamentId, (event) => {
          if (event.status !== "DRAFT") return "Only drafts can be edited";
          event.config = input.config;
          audit(event, ctx.userId, "Updated draft");
        });
      const id = nanoid();
      const eventData = createEventState(input.config);
      audit(eventData, ctx.userId, "Created draft");
      await insertTournamentForSaveEvent(ctx.drizzle, id, input, eventData);
      return { success: true, message: "Tournament draft created", tournamentId: id };
    }),
  /** Apply staff lifecycle and roster changes through the event version guard. */
  manageEvent: protectedProcedure
    .input(
      eventTournamentActionSchema.extend({
        originSocketId: z.string().max(128).optional(),
      }),
    )
    .output(eventActionResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, target, beforeReceipt] = await Promise.all([
        findEventActorCacheState(ctx.drizzle, ctx.userId),
        input.userId ? fetchEventUser(ctx.drizzle, input.userId) : undefined,
        findEventActorRewardReceipt(ctx.drizzle, input.tournamentId, ctx.userId),
      ]);
      if (!canManageTournaments(user?.role ?? "USER"))
        return errorResponse("Tournament staff access required");
      await syncEventTournament(ctx.drizzle, input.tournamentId);
      const result = await editEvent(ctx.drizzle, input.tournamentId, (event) => {
        const now = Date.now();
        if (
          event.status === "COMPLETED" ||
          (event.status === "CANCELLED" &&
            (input.action !== "CANCEL" || event.payRewards || !input.payRewards))
        )
          return "Tournament has ended";
        if (input.action === "PUBLISH") {
          if (event.status !== "DRAFT" || now >= event.config.registrationClosesAt)
            return "Registration cannot be opened";
          event.status = "REGISTRATION";
        } else if (input.action === "SEED") {
          if (event.status !== "REGISTRATION")
            return "Open registration before generating the bracket";
          const entrants = event.participants.filter((p) => p.accepted && !p.withdrawn);
          if (entrants.length < 2)
            return "At least two accepted participants are required to start early";
          const shuffled = entrants.map((p) => p.id);
          for (let i = shuffled.length - 1; i > 0; i--) {
            const j = randomInt(i + 1);
            [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
          }
          generateEventBracket(event, shuffled);
        } else if (input.action === "BEGIN") {
          if (!["PREPARED", "RUNNING"].includes(event.status))
            return "Generate the bracket before beginning matches";
          if (input.scheduledAt) {
            if (input.scheduledAt <= now || input.scheduledAt >= event.config.endsAt)
              return "Choose a future time before the event ends";
            if (event.config.scheduling === "SEQUENTIAL" && input.seriesId) {
              const series = event.series.find((s) => s.id === input.seriesId);
              const round = Math.min(
                ...event.series.filter((s) => !s.complete).map((s) => s.round),
              );
              if (
                !series ||
                !series.resolved ||
                series.complete ||
                series.begun ||
                series.round !== round
              )
                return "Series is not ready in the current round";
              series.scheduledAt = input.scheduledAt;
            } else event.scheduledRoundAt = input.scheduledAt;
          } else {
            const error = beginEventRound(event, now, input.seriesId);
            if (error) return error;
          }
        } else if (input.action === "CANCEL") {
          if (
            event.series.some((s) =>
              s.games.some((g) => ["STARTING", "FIGHTING"].includes(g.status)),
            )
          )
            return "Wait for active games to finish before cancelling";
          event.status = "CANCELLED";
          event.finishedAt ??= now;
          event.payRewards = input.payRewards ?? false;
        } else if (input.action === "INVITE") {
          if (
            event.status !== "REGISTRATION" ||
            now >= event.config.registrationClosesAt
          )
            return "Invitations require open registration";
          if (!target || target.isAi || target.isBanned)
            return "An eligible player account is required";
          const failures = eligibilityFailures(event.config, snapshotFor(target));
          if (failures.length) return failures.join(". ");
          if (
            event.participants.some((p) => !p.withdrawn && p.userId === target.userId)
          )
            return "Player already has a reserved slot";
          const replacing = input.seatId
            ? event.participants.find(
                (p) =>
                  p.id === input.seatId && p.invited && !p.accepted && !p.withdrawn,
              )
            : undefined;
          if (input.seatId && !replacing)
            return "Only pending invitations can be overwritten";
          if (!replacing && occupiedSeats(event) >= event.config.capacity)
            return "Tournament is full, including reserved invitations";
          if (replacing)
            event.participants.splice(event.participants.indexOf(replacing), 1);
          event.participants = event.participants.filter(
            (p) => p.userId !== target.userId,
          );
          event.participants.push(makeParticipant(target, true, false));
        } else if (input.action === "REMOVE_INVITE") {
          if (event.status !== "REGISTRATION")
            return "Invitations can only be withdrawn during registration";
          const participant = event.participants.find(
            (p) => p.id === input.seatId && p.invited,
          );
          if (!participant) return "Invitation not found";
          participant.withdrawn = true;
        } else if (input.action === "SUBSTITUTE") {
          if (!["PREPARED", "RUNNING"].includes(event.status))
            return "Substitutions require a generated bracket";
          const seat = event.participants.find(
            (p) => p.id === input.seatId && p.accepted,
          );
          if (!seat || !target || target.isAi || target.isBanned)
            return "Participant or replacement not found";
          if (
            event.participants.some(
              (p) =>
                p.userId === target.userId ||
                p.previousUsers.some((u) => u.userId === target.userId),
            )
          )
            return "Replacement has already participated";
          if (
            event.series.some(
              (s) =>
                s.seats.includes(seat.id) &&
                s.games.some((g) => ["STARTING", "FIGHTING"].includes(g.status)),
            )
          )
            return "Wait for this participant's active game to finish";
          if (!event.series.some((s) => !s.complete && s.seats.includes(seat.id)))
            return "This seat has already been eliminated";
          const failures = eligibilityFailures(event.config, snapshotFor(target));
          if (failures.length) return failures.join(". ");
          const originalId = seat.userId;
          seat.previousUsers.push({ userId: seat.userId, username: seat.username });
          seat.userId = target.userId;
          seat.username = target.username;
          seat.snapshot = snapshotFor(target);
          seat.withdrawn = false;
          // Clear readiness tied to the outgoing player when reassigning their seat.
          for (const series of event.series)
            series.readyUserIds = series.readyUserIds?.filter(
              (id) => id !== originalId,
            );
          for (const s of event.series.filter(
            (s) => !s.complete && s.seats.includes(seat.id),
          )) {
            const game = s.games.at(-1);
            if (game?.status === "READY") {
              game.accepted = [];
              game.userIds = game.userIds.map((id) =>
                id === originalId ? target.userId : id,
              );
              game.opensAt = now;
              game.deadline = now + EVENT_TOURNAMENT_READY_SECONDS * 1000;
            }
          }
        } else if (input.action === "RECOVER") {
          // Launch recovery is handled by sync: never relaunch a battle with the same ID.
          return "Recovery synchronized; unfinished battles remain under combat ownership";
        }
        audit(
          event,
          ctx.userId,
          `${input.action}${input.userId ? ` ${input.userId}` : ""}${input.seatId ? ` seat ${input.seatId}` : ""}${input.scheduledAt ? ` at ${new Date(input.scheduledAt).toISOString()}` : ""}${input.action === "CANCEL" ? ` rewards=${event.payRewards}` : ""}`,
        );
      });
      if (result.success) {
        await syncEventTournament(ctx.drizzle, input.tournamentId);
        // Remote roster additions must wake notice polling in the incoming player's tabs.
        if (input.userId && ["INVITE", "SUBSTITUTE"].includes(input.action))
          await notifyEventParticipant(
            input.userId,
            input.userId === ctx.userId ? input.originSocketId : undefined,
          );
      }
      return result.success && user
        ? {
            ...result,
            ...(await eventActionCacheUpdate(
              ctx.drizzle,
              ctx.userId,
              input.tournamentId,
              user,
              beforeReceipt,
            )),
          }
        : result;
    }),
  /** Manage registration, advisory readiness and match acceptance through the event version guard. */
  participateEvent: protectedProcedure
    .input(
      eventTournamentPlayerSchema.extend({
        originSocketId: z.string().max(128).optional(),
      }),
    )
    .output(eventActionResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, beforeReceipt] = await Promise.all([
        fetchEventUser(ctx.drizzle, ctx.userId),
        findEventActorRewardReceipt(ctx.drizzle, input.tournamentId, ctx.userId),
      ]);
      if (!user || user.isAi || user.isBanned)
        return errorResponse("An active player account is required");
      await syncEventTournament(ctx.drizzle, input.tournamentId);
      const result = await editEvent(ctx.drizzle, input.tournamentId, (event) => {
        const now = Date.now();
        const seat = event.participants.find(
          (p) => p.userId === user.userId && !p.withdrawn,
        );
        if (["DRAFT", "COMPLETED", "CANCELLED"].includes(event.status))
          return "Tournament is not accepting player actions";
        if (input.action === "JOIN") {
          if (
            event.status !== "REGISTRATION" ||
            now >= event.config.registrationClosesAt
          )
            return "Registration is closed";
          if (user.sector !== MAP_WAKE_ISLAND_SECTOR || user.status !== "AWAKE")
            return "Register while awake at Wake Island";
          if (seat?.accepted) return "Already registered";
          if (event.config.registration === "INVITE_ONLY" && !seat?.invited)
            return "A staff invitation is required";
          const failures = eligibilityFailures(event.config, snapshotFor(user));
          if (failures.length) return failures.join(". ");
          if (seat) {
            seat.accepted = true;
            seat.snapshot = snapshotFor(user);
          } else {
            if (occupiedSeats(event) >= event.config.capacity)
              return "Tournament is full, including reserved invitations";
            event.participants = event.participants.filter(
              (p) => p.userId !== user.userId,
            );
            event.participants.push(makeParticipant(user, false, true));
          }
        } else if (input.action === "WITHDRAW" || input.action === "DECLINE") {
          if (!seat) return "No registration or invitation found";
          seat.withdrawn = true;
        } else if (input.action === "READY" || input.action === "NOT_READY") {
          const round = Math.min(
            ...event.series.filter((s) => !s.complete).map((s) => s.round),
          );
          const series = event.series.find((s) => s.id === input.seriesId);
          if (
            !seat?.accepted ||
            !series ||
            !series.resolved ||
            series.complete ||
            series.begun ||
            series.round !== round ||
            !series.seats.includes(seat.id)
          )
            return "This series is not waiting for staff to begin";
          // Players can cancel readiness anywhere; marking ready requires availability.
          if (
            input.action === "READY" &&
            (user.status !== "AWAKE" ||
              user.battleId ||
              user.sector !== MAP_WAKE_ISLAND_SECTOR)
          )
            return "Be awake and available at Wake Island to mark yourself ready";
          series.readyUserIds = (series.readyUserIds ?? []).filter(
            (id) => id !== user.userId,
          );
          if (input.action === "READY") series.readyUserIds.push(user.userId);
        } else {
          const series = event.series.find(
            (s) => s.id === input.seriesId && !s.complete,
          );
          const game = series?.games.at(-1);
          if (!seat || !series || !game || !series.seats.includes(seat.id))
            return "Ready check not found";
          if (game.status !== "READY" || now < game.opensAt || now >= game.deadline)
            return "Ready check is not open";
          if (
            user.status !== "AWAKE" ||
            user.battleId ||
            user.sector !== MAP_WAKE_ISLAND_SECTOR
          )
            return "Ready check failed: be awake and available at Wake Island, outside combat, travel, hospital or queues";
          if (!game.accepted.includes(user.userId)) game.accepted.push(user.userId);
        }
      });
      if (result.success) {
        await syncEventTournament(ctx.drizzle, input.tournamentId);
        // The action's local invalidation does not refresh this player's other tabs.
        if (["JOIN", "WITHDRAW", "DECLINE"].includes(input.action))
          await notifyEventParticipant(ctx.userId, input.originSocketId);
      }
      return result.success && user
        ? {
            ...result,
            ...(await eventActionCacheUpdate(
              ctx.drizzle,
              ctx.userId,
              input.tournamentId,
              user,
              beforeReceipt,
            )),
          }
        : result;
    }),
};

type EventRow = NonNullable<Awaited<ReturnType<typeof fetchEvent>>>;

/** Whole-event CAS serializes roster, bracket and score changes without missing-row locks. */
const saveEventState = async (
  client: DrizzleClient,
  row: EventRow,
  event: EventTournamentState,
) => {
  const saved = await updateTournamentForSaveEventState(client, event, row);
  return saved.rowsAffected === 1;
};

/** Retry a roster or bracket edit against the latest event when another writer wins its CAS. */
const editEvent = async (
  client: DrizzleClient,
  id: string,
  edit: (event: EventTournamentState) => string | undefined,
) => {
  for (let attempt = 0; attempt < 4; attempt++) {
    const row = await fetchEvent(client, id);
    if (!row?.eventData) return errorResponse("Tournament not found");
    const event = structuredClone(row.eventData);
    const message = edit(event);
    if (message) return errorResponse(message);
    if (await saveEventState(client, row, event))
      return { success: true, message: "Tournament updated" };
  }
  return errorResponse("Tournament changed; please try again");
};

/**
 * Reconcile combat results, recover abandoned launches and apply scheduled starts or event
 * expiry. Terminal events retry unpaid rewards; unscheduled rounds remain under staff control.
 * Return whether a write or competing claim requires readers to refresh their loaded snapshot.
 */
export const syncEventTournament = async (
  client: DrizzleClient,
  id: string,
  loadedRow?: EventRow,
) => {
  const row = loadedRow ?? (await fetchEvent(client, id));
  if (!row?.eventData) return false;
  const event = structuredClone(row.eventData);
  const now = Date.now();
  if (["COMPLETED", "CANCELLED"].includes(event.status)) {
    return payEventRewards(client, row);
  }
  if (
    event.status === "DRAFT" ||
    (event.status === "REGISTRATION" && now < event.config.endsAt)
  )
    return false;
  for (const series of event.series.filter((s) => !s.complete)) {
    const game = series.games.at(-1);
    if (!game) continue;
    const activeUserIds = event.participants
      .filter((p) => series.seats.includes(p.id) && !p.withdrawn)
      .map((p) => p.userId);
    const saved = row.matches.find((m) => m.id === game.id);
    if (saved?.state === "PLAYED") {
      const withdrawn = series.seats.some(
        (sid) => event.participants.find((p) => p.id === sid)?.withdrawn,
      );
      completeEventGame(
        event,
        series,
        saved.winnerId,
        saved.winnerId ? "BATTLE" : "DRAW",
        now,
        withdrawn,
      );
      if (withdrawn) {
        series.winnerId =
          series.seats.find(
            (sid) => sid && !event.participants.find((p) => p.id === sid)?.withdrawn,
          ) ?? null;
        series.loserId = null;
        series.winnerUserId =
          event.participants.find((p) => p.id === series.winnerId)?.userId ?? null;
      }
    } else if (
      game.status === "READY" &&
      game.accepted.length < 2 &&
      now >= game.deadline
    ) {
      const ready = game.accepted.filter((uid) => activeUserIds.includes(uid));
      completeEventGame(
        event,
        series,
        ready.length === 1 ? ready[0]! : null,
        ready.length === 1 ? "NO_SHOW" : "DOUBLE_NO_SHOW",
        now,
      );
    } else if (
      game.status === "READY" &&
      series.seats.some(
        (sid) => event.participants.find((p) => p.id === sid)?.withdrawn,
      )
    ) {
      game.accepted = game.userIds.filter((uid) => activeUserIds.includes(uid));
      completeEventGame(
        event,
        series,
        game.accepted[0] ?? null,
        game.accepted.length ? "NO_SHOW" : "DOUBLE_NO_SHOW",
        now,
        true,
      );
      // Withdrawn entrants do not advance into the losers bracket.
      series.loserId = null;
    } else if (
      ["STARTING", "FIGHTING"].includes(game.status) &&
      now > game.deadline + EVENT_TOURNAMENT_LAUNCH_RECOVERY_SECONDS * 1000
    ) {
      const running = await findBattleForSyncEventTournament(client, game);
      if (running) game.status = "FIGHTING";
      else {
        let token = saved;
        if (!token) {
          // STARTING can survive a crash before its token insert. Reserve that same ID
          // as revoked so the delayed launch cannot create a token after recovery.
          await insertTournamentMatchForSyncEventTournament(client, game, id, series);
          // FOUND_ROWS can report a matched WAITING row for the no-op duplicate branch.
          // Read its actual state before deciding whether this recovery owns the game.
          token = await findTournamentMatchForSyncEventTournament(client, game);
        }
        // Combat verifies this token while claiming both players in its transaction.
        // A committed battle wins; a revoked token rolls back a delayed initiation.
        const revoked =
          token?.state === "WAITING"
            ? await updateTournamentMatchForSyncEventTournament(client, game)
            : undefined;
        if (token?.state === "NO_SHOW" || revoked?.rowsAffected === 1)
          completeEventGame(event, series, null, "DRAW", now);
      }
    }
  }
  advanceEvent(event, now);
  if (
    !["COMPLETED", "CANCELLED"].includes(event.status) &&
    now >= event.config.endsAt
  ) {
    if (
      !event.series.some((s) =>
        s.games.some((g) => ["STARTING", "FIGHTING"].includes(g.status)),
      )
    ) {
      event.status = "CANCELLED";
      event.finishedAt = now;
      event.payRewards = false;
      audit(event, "system", "Event deadline reached; cancelled without rewards");
    }
  } else if (event.scheduledRoundAt && now >= event.scheduledRoundAt)
    beginEventRound(event, now);
  if (now < event.config.endsAt)
    for (const s of event.series)
      if (s.scheduledAt && now >= s.scheduledAt) beginEventRound(event, now, s.id);
  const changed = JSON.stringify(event) !== JSON.stringify(row.eventData);
  if (changed && !(await saveEventState(client, row, event))) return true;
  if (["COMPLETED", "CANCELLED"].includes(event.status)) {
    const paid = await payEventRewards(client, { ...row, eventData: event });
    return changed || paid;
  }
  let needsRefresh = changed;
  // Each launch first claims the event version. Acceptance never starts a second battle.
  for (const series of event.series.filter((s) => !s.complete)) {
    const game = series.games.at(-1);
    if (game?.status === "READY" && game.accepted.length === 2 && now >= game.opensAt) {
      await launchEventGame(client, id, series.id);
      needsRefresh = true;
    }
  }
  return needsRefresh;
};

/** Claim the current ready roster once, then publish the revocable token combat must claim. */
const launchEventGame = async (client: DrizzleClient, id: string, seriesId: string) => {
  const row = await fetchEvent(client, id);
  const event = row?.eventData;
  const series = event?.series.find((s) => s.id === seriesId && !s.complete);
  const game = series?.games.at(-1);
  if (
    !row ||
    !event ||
    !series ||
    !game ||
    game.status !== "READY" ||
    game.accepted.length !== 2 ||
    Date.now() >= event.config.endsAt
  )
    return;
  game.status = "STARTING";
  // READY substitutions keep the game ID but replace its users, so publish a token
  // only after winning the roster's version. Recovery tombstones any crash gap.
  if (!(await retryOnDeadlock(() => saveEventState(client, row, event)))) return;
  try {
    await insertTournamentMatchForLaunchEventGame(client, game, id, series);
  } catch (error) {
    // A duplicate belongs to another launch or recovery. Recovery alone advances
    // a tombstoned game; recording a setup failure here could overwrite its draw.
    if (isMysqlDuplicateKeyError(error)) return;
    throw error;
  }
  const [users, loadouts] = await Promise.all([
    listUserDataForLaunchEventGame(client, game),
    event.config.rules === "RANKED"
      ? listRankedLoadoutForLaunchEventGame(client, game)
      : [],
  ]);
  const available = users.filter(
    (u) =>
      u.status === "AWAKE" &&
      !u.battleId &&
      !u.isBanned &&
      u.sector === MAP_WAKE_ISLAND_SECTOR,
  );
  if (available.length !== 2) {
    await recordLaunchFailure(
      client,
      id,
      seriesId,
      game.id,
      available.map((u) => u.userId),
    );
    return;
  }
  const cleaned = await Promise.all(
    loadouts.map((l) => cleanRankedProhibitedSelections(client, l)),
  );
  if (
    event.config.rules === "RANKED" &&
    (cleaned.length !== 2 ||
      cleaned.some(
        (l) =>
          !l.loadout.loadout.jutsuIds.length &&
          !l.loadout.loadout.weaponIds.length &&
          !l.loadout.loadout.consumableIds.length,
      ))
  ) {
    await recordLaunchFailure(
      client,
      id,
      seriesId,
      game.id,
      [],
      "Ranked loadouts must contain allowed equipped selections",
    );
    return;
  }
  const result = await initiateBattle(
    {
      client,
      userIds: [game.userIds[0]!],
      targetIds: [game.userIds[1]!],
      biome: "arena",
      tournamentGame: {
        id: game.id,
        battleId: game.battleId,
        aiOnly: event.config.rules === "AI",
      },
      userStatDistribution:
        event.config.rules === "RANKED" ? RANKED_PVP_STATS : undefined,
      targetStatDistribution:
        event.config.rules === "RANKED" ? RANKED_PVP_STATS : undefined,
      forceLoadouts: cleaned.map((l) => l.loadout),
      autoCombatUserIds: event.config.rules === "AI" ? game.userIds : undefined,
    },
    event.config.rules === "RANKED" ? "RANKED_SPARRING" : "SPARRING",
    0,
  );
  if (!result.success) {
    await recordLaunchFailure(client, id, seriesId, game.id, [], result.message);
    return;
  }
  await editEvent(client, id, (e) => {
    const g = e.series
      .find((s) => s.id === seriesId)
      ?.games.find((g) => g.id === game.id);
    if (g?.status === "STARTING") g.status = "FIGHTING";
  });
};

/** Revoke an unclaimed launch and record player absence or a repairable setup failure. */
const recordLaunchFailure = async (
  client: DrizzleClient,
  id: string,
  seriesId: string,
  gameId: string,
  available: string[],
  message?: string,
) => {
  await updateTournamentMatchForRecordLaunchFailure(client, gameId);
  await editEvent(client, id, (event) => {
    const series = event.series.find((s) => s.id === seriesId);
    const game = series?.games.at(-1);
    if (!series || !game || game.id !== gameId || game.status !== "STARTING")
      return "Game already changed";
    if (message) {
      // Setup failures do not count as a player dodge. Staff can repair loadouts and begin again.
      game.status = "COMPLETE";
      game.outcome = "DRAW";
      series.begun = false;
      audit(event, "system", `Game setup failed: ${message}`);
    } else {
      game.accepted = available;
      completeEventGame(
        event,
        series,
        available.length === 1 ? available[0]! : null,
        available.length === 1 ? "NO_SHOW" : "DOUBLE_NO_SHOW",
        Date.now(),
      );
    }
  });
};

/**
 * Grant each entrant's configured rewards once. A single guarded update cannot deliver
 * rewards spanning multiple tables, so retention, the receipt and recipient grants commit
 * together. A receipt alone could lose a payout; grants without it could pay twice, and
 * cleanup must not delete receipts while a payer is in flight.
 */
const payEventRewards = async (client: DrizzleClient, row: EventRow) => {
  const event = row.eventData;
  if (!event?.payRewards) return false;
  const users = [
    ...new Set(
      event.participants
        .filter((p) => p.accepted && p.seed > 0)
        .flatMap((p) => [p.userId, ...p.previousUsers.map((u) => u.userId)]),
    ),
  ];
  const receipts = await listTournamentRewardClaimForPayEventRewards(client, row);
  const unpaid = users.filter((id) => !receipts.some((r) => r.userId === id));
  for (const userId of unpaid) {
    try {
      await retryOnDeadlock(() =>
        client.transaction(async (tx) => {
          const database = tx as unknown as DrizzleClient;
          // Claim the still-retained terminal event, preventing cleanup from removing receipts
          // while a delayed payer is in flight. The version increment also fences deletion.
          const retained = await updateTournamentForPayEventRewards(database, row);
          if (retained.rowsAffected !== 1) return;
          // Unique receipt and all grants roll back together; a duplicate never grants twice.
          await insertTournamentRewardClaimForPayEventRewards(database, row, userId);
          const user = await findUserById(database, userId);
          // Deleted entrants are nonpayable; retain their receipt so payout can finish.
          if (!user) return;
          const rewards = eventRewardFor(event, userId);
          if (!rewards) return;
          await updateRewards({
            client: database,
            inTransaction: true,
            user,
            rewards: postProcessRewards(rewards, user),
            reason: `TOURNAMENT_${row.id}`,
            persistQuestData: false,
          });
        }),
      );
    } catch (error) {
      if (!isMysqlDuplicateKeyError(error)) throw error;
    }
  }
  return unpaid.length > 0;
};

/** Synchronize events and remove expired terminal events only after pending payouts finish. */
export const maintainEventTournaments = async (client: DrizzleClient) => {
  const rows = await listTournamentForMaintainEventTournaments(client);
  for (const row of rows) {
    const event = row.eventData;
    if (!event) continue;
    if (
      event.finishedAt &&
      Date.now() - event.finishedAt > EVENT_TOURNAMENT_RETENTION_DAYS * 86400_000
    ) {
      // Finish any interrupted payout before removing its event and receipts.
      await syncEventTournament(client, row.id);
      const removed = await deleteTournamentForMaintainEventTournaments(client, row);
      if (removed.rowsAffected !== 1) continue;
      await Promise.all([
        deleteTournamentMatches(client, row.id),
        deleteTournamentRewardClaimForMaintainEventTournaments(client, row),
      ]);
    } else await syncEventTournament(client, row.id);
  }
};
/** Freeze the account's current eligibility values for its registration or substitution. */
const snapshotFor = (
  user: NonNullable<Awaited<ReturnType<typeof fetchEventUser>>>,
): EventParticipant["snapshot"] => ({
  bracket: getExpBracket(user.experience, user.rank),
  pvpWins: user.pvpWins,
  winRate:
    user.pvpWins + user.pvpLosses
      ? (user.pvpWins / (user.pvpWins + user.pvpLosses)) * 100
      : 0,
  masteredJutsu: user.masteredJutsu,
});
/** Reserve a stable bracket seat while retaining the player's eligibility snapshot. */
const makeParticipant = (
  user: NonNullable<Awaited<ReturnType<typeof fetchEventUser>>>,
  invited: boolean,
  accepted: boolean,
): EventParticipant => ({
  id: nanoid(),
  userId: user.userId,
  username: user.username,
  invited,
  accepted,
  withdrawn: false,
  seed: 0,
  snapshot: snapshotFor(user),
  previousUsers: [],
});
/** Count live registrations and reserved invitations against the shared event capacity. */
const occupiedSeats = (event: EventTournamentState) =>
  event.participants.filter((p) => !p.withdrawn).length;
/** Append a timestamped actor action to the versioned event's audit trail. */
const audit = (event: EventTournamentState, userId: string, action: string) => {
  event.audit.push({ userId, action, at: Date.now() });
};

/** Best-effort cache refresh; polling remains available when websocket delivery fails. */
const notifyEventParticipant = async (userId: string, originSocketId?: string) => {
  await Promise.allSettled([
    getServerPusher().trigger(userId, "event", {
      type: "eventTournament",
      ...(originSocketId ? { originSocketId } : {}),
    }),
  ]);
};

/** Reconcile event navigation and confirmed launches; new reward receipts use canonical reward hydration. */
const eventActionCacheUpdate = async (
  client: DrizzleClient,
  userId: string,
  tournamentId: string,
  before: NonNullable<Awaited<ReturnType<typeof findEventActorCacheState>>>,
  beforeReceipt: Awaited<ReturnType<typeof findEventActorRewardReceipt>>,
) => {
  const [actor, receipt, notices] = await Promise.all([
    findEventActorCacheState(client, userId),
    findEventActorRewardReceipt(client, tournamentId, userId),
    fetchEventNoticeState(client, userId),
  ]);
  const startedBattle =
    actor?.status === "BATTLE" &&
    !!actor.battleId &&
    actor.battleId !== before.battleId;
  const safeLaunch =
    startedBattle &&
    before.queue.length === 0 &&
    !before.currentlyTrainingMastery &&
    !before.currentlyTrainingElement;
  const canProject =
    actor &&
    (beforeReceipt || !receipt) &&
    (actor.updatedAt.getTime() === before.updatedAt.getTime() || safeLaunch);
  return {
    userPatch: canProject
      ? {
          status: actor.status,
          battleId: actor.battleId,
          ...(startedBattle
            ? {
                updatedAt: actor.updatedAt,
                curHealth: actor.curHealth,
                curChakra: actor.curChakra,
                curStamina: actor.curStamina,
                curEnergy: actor.curEnergy,
                regenAt: actor.regenAt,
              }
            : {}),
        }
      : undefined,
    eventNotices: notices.notices,
    isEventParticipant: notices.isEventParticipant,
  };
};
