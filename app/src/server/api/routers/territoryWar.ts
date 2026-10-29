import { nanoid } from "nanoid";
import { z } from "zod";
import {
  TERRITORY_WAR_INTERVAL_HOURS,
  TERRITORY_WAR_TEAM_SIZE,
} from "@/drizzle/constants";
import { getServerPusher } from "@/libs/pusher";
import { getTerritoryCompetitor, getTerritoryWarBoostUntil } from "@/libs/territoryWar";
import { deleteBattleQueueMemberById } from "@/queries/clan";
import { wakeQueuedUser } from "@/queries/profile";
import { claimBattleQueue, listQueueMembers } from "@/queries/raids";
import { findQueueUserCache } from "@/queries/socialUserCache";
import {
  deleteMpvpBattleQueueForCreateTeam,
  executeClaimedForJoinTeam,
  executeInsertedForJoinTeam,
  executeRemovedForLeaveTeam,
  executeRowsForStartBattle,
  fetchActiveTerritoryWar,
  fetchLatestTerritoryWar,
  findMpvpBattleQueueForStartBattle,
  findTerritoryWarById,
  insertMpvpBattleQueueForCreateTeam,
  listMpvpBattleQueueForGetCurrent,
  listTerritoryWarScoreForGetCurrent,
} from "@/queries/territoryWar";
import { initiateBattle } from "@/server/api/routers/combat";
import { createTRPCRouter, errorResponse, protectedProcedure } from "@/server/api/trpc";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { getBattleUserPatch } from "@/server/utils/socialUserCache";
import { fetchTerritoryWarUser as fetchUser } from "@/server/utils/territoryWar";
import { userDeltaResponseSchema } from "@/validators/userCache";

/** Read the global competition and manage same-competitor guardian lobbies. */
export const territoryWarRouter = createTRPCRouter({
  /** Read-only notice polling; synchronization belongs to the minute scheduler. */
  getNotice: protectedProcedure.query(
    async ({ ctx }) => (await fetchActiveTerritoryWar(ctx.drizzle)) ?? null,
  ),
  /** Include the latest result, standings, own competitor's lobbies and next opening. */
  getCurrent: protectedProcedure.query(async ({ ctx }) => {
    const [event, user] = await Promise.all([
      fetchLatestTerritoryWar(ctx.drizzle),
      fetchUser(ctx.drizzle, ctx.userId),
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
      const [event, user] = await Promise.all([
        findTerritoryWarById(ctx.drizzle, input.eventId),
        fetchUser(ctx.drizzle, ctx.userId),
      ]);
      if (!event || event.resolvedAt || event.endsAt <= new Date())
        return errorResponse("This Territory War has ended");
      if (user.isBanned || user.status !== "AWAKE" || user.sector !== event.sector)
        return errorResponse("You must be awake in the event sector");
      const competitor = getTerritoryCompetitor(user);
      const id = nanoid();
      await insertMpvpBattleQueueForCreateTeam(ctx.drizzle, id, event, competitor);
      const result = await joinTeam(ctx.drizzle, user, id, competitor.id);
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
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (user.isBanned || user.status !== "AWAKE")
        return errorResponse("You must be awake to join a team");
      return joinTeam(ctx.drizzle, user, input.teamId, getTerritoryCompetitor(user).id);
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
      await wakeQueuedUser(ctx.drizzle, ctx.userId);
      return {
        success: true,
        message: "Left the team",
        userPatch: await findQueueUserCache(ctx.drizzle, ctx.userId),
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
      if (!team.queue.length || team.queue.length > TERRITORY_WAR_TEAM_SIZE)
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
          roster.length < 1 ||
          roster.length > TERRITORY_WAR_TEAM_SIZE
        )
          return errorResponse("The team changed. Try again");
        const result = await initiateBattle(
          {
            client: ctx.drizzle,
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
        return {
          ...result,
          userPatch: await getBattleUserPatch(ctx.drizzle, ctx.userId),
        };
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
  client: import("@/server/db").DrizzleClient,
  user: Awaited<ReturnType<typeof fetchUser>>,
  teamId: string,
  competitorId: string,
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
      executeClaimedForJoinTeam(client, user, memberId),
    );
    joined = claimed.rowsAffected > 0;
    return joined
      ? {
          success: true,
          message: "Joined the team. Start solo or wait for teammates",
          userPatch: { status: "QUEUED" as const },
        }
      : errorResponse("Your status or this team changed. Try again");
  } finally {
    if (!joined) await deleteBattleQueueMemberById(client, memberId);
  }
};
