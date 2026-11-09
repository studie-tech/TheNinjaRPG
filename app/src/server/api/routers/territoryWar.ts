import { nanoid } from "nanoid";
import { z } from "zod";
import {
  getCreateTeamUserUpdate,
  getJoinTeamUserUpdate,
  getLeaveTeamUserUpdate,
  getTerritoryWarNotice,
} from "@/deltas/territoryWar";
import {
  TERRITORY_WAR_INTERVAL_HOURS,
  TERRITORY_WAR_TEAM_SIZE,
} from "@/drizzle/constants";
import { getServerPusher } from "@/libs/pusher";
import { getTerritoryCompetitor, getTerritoryWarBoostUntil } from "@/libs/territoryWar";
import { fetchActionUser } from "@/queries/actionReadiness";
import { deleteBattleQueueMemberById } from "@/queries/clan";
import { fetchAllGameSettings, wakeQueuedUser } from "@/queries/profile";
import { claimBattleQueue, listQueueMembers } from "@/queries/raids";
import {
  deleteMpvpBattleQueueForCreateTeam,
  executeClaimedForJoinTeam,
  executeInsertedForJoinTeam,
  executeRemovedForLeaveTeam,
  executeRowsForStartBattle,
  fetchLatestTerritoryWar,
  findMpvpBattleQueueForStartBattle,
  findTerritoryWarById,
  insertMpvpBattleQueueForCreateTeam,
  listMpvpBattleQueueForGetCurrent,
  listTerritoryWarScoreForGetCurrent,
} from "@/queries/territoryWar";
import { initiateBattle } from "@/server/api/routers/combat";
import { createTRPCRouter, errorResponse, protectedProcedure } from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import type { ActionReadiness } from "@/server/utils/actionReadiness";
import {
  actionReadinessResponse,
  prepareActionReadiness,
} from "@/server/utils/actionReadiness";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { fetchTerritoryWarUser } from "@/server/utils/territoryWar";
import { userDeltaResponseSchema } from "@/validators/userCache";

/** Read the global competition and manage same-competitor guardian lobbies. */
export const territoryWarRouter = createTRPCRouter({
  /** Read the notice and quiet-window deadline; synchronization belongs to the scheduler. */
  getNotice: protectedProcedure.query(async ({ ctx }) =>
    getTerritoryWarNotice(await fetchLatestTerritoryWar(ctx.drizzle), Date.now()),
  ),
  /** Include the latest result, standings, own competitor's lobbies and next opening. */
  getCurrent: protectedProcedure.query(async ({ ctx }) => {
    const [event, user] = await Promise.all([
      fetchLatestTerritoryWar(ctx.drizzle),
      fetchTerritoryWarUser(ctx.drizzle, ctx.userId),
    ]);
    const competitor = getTerritoryCompetitor(user);
    const boostUntil = getTerritoryWarBoostUntil(user);
    if (!event)
      return {
        event: null,
        scores: [],
        teams: [],
        competitor,
        boostUntil,
        nextStartsAt: null,
      };
    const [scores, teams] = await Promise.all([
      listTerritoryWarScoreForGetCurrent(ctx.drizzle, event),
      listMpvpBattleQueueForGetCurrent(ctx.drizzle, event),
    ]);
    const endedAt =
      event.resolvedAt ?? (event.endsAt <= new Date() ? event.endsAt : null);
    return {
      event,
      scores,
      teams: teams.filter((team) => team.attackerEntityId === competitor.id),
      competitor,
      boostUntil,
      nextStartsAt: endedAt
        ? new Date(endedAt.getTime() + TERRITORY_WAR_INTERVAL_HOURS * 3600000)
        : null,
    };
  }),

  /** Create a lobby; failed creator admission removes only an unused, unreserved lobby. */
  createTeam: protectedProcedure
    .input(z.object({ eventId: z.string() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Recovery needs equipment, skills and quest history from the same actor read.
      let [event, user, settings] = await Promise.all([
        findTerritoryWarById(ctx.drizzle, input.eventId),
        fetchActionUser(ctx.drizzle, ctx.userId),
        fetchAllGameSettings(ctx.drizzle),
      ]);
      if (!event || event.resolvedAt || event.endsAt <= new Date())
        return {
          ...errorResponse("This Territory War has ended"),
          ...getCreateTeamUserUpdate(),
        };
      const readiness = prepareActionReadiness(user, settings);
      if (readiness.error) return errorResponse(readiness.error);
      user = readiness.user;
      if (user.isBanned || user.status !== "AWAKE" || user.sector !== event.sector)
        return errorResponse("You must be awake in the event sector");
      const competitor = getTerritoryCompetitor(user);
      const id = nanoid();
      await insertMpvpBattleQueueForCreateTeam(ctx.drizzle, id, event, competitor);
      const result = await joinTeam(ctx.drizzle, user, id, competitor.id, readiness);
      if (!result.success)
        // Another member may have joined or reserved launch while the creator lost eligibility.
        await retryOnDeadlock(() =>
          deleteMpvpBattleQueueForCreateTeam(ctx.drizzle, id),
        );
      return result;
    }),

  /** Changed eligibility/capacity returns recoverable feedback without reserving a place. */
  joinTeam: protectedProcedure
    .input(z.object({ teamId: z.string() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Recovery settles queued training before the guarded admission.
      let [user, settings] = await Promise.all([
        fetchActionUser(ctx.drizzle, ctx.userId),
        fetchAllGameSettings(ctx.drizzle),
      ]);
      const readiness = prepareActionReadiness(user, settings);
      if (readiness.error) return errorResponse(readiness.error);
      user = readiness.user;
      if (user.isBanned || user.status !== "AWAKE")
        return errorResponse("You must be awake to join a team");
      return joinTeam(
        ctx.drizzle,
        user,
        input.teamId,
        getTerritoryCompetitor(user).id,
        readiness,
      );
    }),

  /** Membership may be removed only before the launch reservation is claimed. */
  leaveTeam: protectedProcedure
    .input(z.object({ teamId: z.string() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const removed = await retryOnDeadlock(() =>
        executeRemovedForLeaveTeam(ctx.drizzle, ctx, input),
      );
      if (!removed.rowsAffected)
        return errorResponse("This team has already started or you have left it");
      const woke = await wakeQueuedUser(ctx.drizzle, ctx.userId);
      return {
        success: true,
        message: "Left the team",
        ...getLeaveTeamUserUpdate({ wokeRowsAffected: woke.rowsAffected }),
      };
    }),

  /** Reserve once before reloading the roster; combat initiation validates its final members. */
  startBattle: protectedProcedure
    .input(z.object({ teamId: z.string() }))
    .output(userDeltaResponseSchema.extend({ battleId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const team = await findMpvpBattleQueueForStartBattle(ctx.drizzle, input);
      if (
        !team?.territoryWarId ||
        team.battleId ||
        !team.queue.some((member) => member.userId === ctx.userId)
      )
        return errorResponse("This team is no longer available");
      const event = await findTerritoryWarById(ctx.drizzle, team.territoryWarId);
      if (!event || event.resolvedAt || event.endsAt <= new Date())
        return errorResponse("This Territory War has ended");
      if (team.queue.length > TERRITORY_WAR_TEAM_SIZE)
        return errorResponse("Invalid team size");
      const battleId = nanoid();
      const claimed = await claimBattleQueue(ctx.drizzle, battleId, team.id);
      if (!claimed.rowsAffected)
        return errorResponse("Another teammate already started this battle");
      try {
        // Reservation excludes further successful joins; reload members after it commits.
        const roster = await listQueueMembers(ctx.drizzle, team.id);
        if (
          !roster.some((member) => member.userId === ctx.userId) ||
          roster.length > TERRITORY_WAR_TEAM_SIZE
        )
          return errorResponse("The team changed. Try again");
        const result = await initiateBattle(
          {
            client: ctx.drizzle,
            cacheUserId: ctx.userId,
            userIds: roster.map((member) => member.userId),
            targetIds: [event.guardianId],
            sector: event.sector,
            territoryWar: event,
            clanBattle: { queueId: team.id, battleId },
            autoCombatFromDefaults: true,
          },
          "TERRITORY_WAR",
        );
        if (!result.success) return result;
        const pusher = getServerPusher();
        await Promise.all(
          roster.map((member) =>
            pusher.trigger(member.userId, "event", {
              type: "userMessage",
              message: "Territory War battle started!",
              route: "/combat",
              routeText: "To combat",
            }),
          ),
        );
        return result;
      } finally {
        // Failed launches restore the lobby; a real battle keeps its membership until settlement.
        await retryOnDeadlock(() =>
          executeRowsForStartBattle(ctx.drizzle, team, battleId),
        );
      }
    }),
});

/**
 * Insert a unique slot before claiming queued status against the launch reservation.
 * Failed claims remove only this attempt's reversible membership; no transaction or
 * locking read is needed. Each guarded statement can restart after a deadlock rollback.
 */
const joinTeam = async (
  client: DrizzleClient,
  user: Awaited<ReturnType<typeof fetchActionUser>>,
  teamId: string,
  competitorId: string,
  readiness?: ActionReadiness,
) => {
  const memberId = nanoid();
  let joined = false;
  try {
    const inserted = await retryOnDeadlock(() =>
      executeInsertedForJoinTeam(client, memberId, user, teamId, competitorId),
    );
    if (!inserted.rowsAffected)
      return errorResponse(
        "The team is full, has started, or belongs to another competitor",
      );
    // Updating q in the same statement serializes this admission against startBattle's reservation.
    // A missing-row/slot race is reversible, so no transaction or locking read is needed.
    const claimed = await retryOnDeadlock(() =>
      executeClaimedForJoinTeam(client, user, memberId, readiness),
    );
    joined = claimed.rowsAffected > 0;
    return joined
      ? actionReadinessResponse(
          {
            success: true,
            message: "Joined the team. Start solo or wait for teammates",
            ...getJoinTeamUserUpdate(),
          },
          readiness,
          client,
        )
      : errorResponse("Your status or this team changed. Try again");
  } finally {
    if (!joined) await deleteBattleQueueMemberById(client, memberId);
  }
};
