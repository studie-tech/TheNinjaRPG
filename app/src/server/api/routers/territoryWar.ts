import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  TERRITORY_WAR_INTERVAL_HOURS,
  TERRITORY_WAR_TEAM_SIZE,
} from "@/drizzle/constants";
import {
  mpvpBattleQueue,
  mpvpBattleUser,
  territoryWar,
  territoryWarScore,
  userData,
} from "@/drizzle/schema";
import { getServerPusher } from "@/libs/pusher";
import { getTerritoryCompetitor, getTerritoryWarBoostUntil } from "@/libs/territoryWar";
import { initiateBattle } from "@/server/api/routers/combat";
import { createTRPCRouter, errorResponse, protectedProcedure } from "@/server/api/trpc";
import {
  fetchActiveTerritoryWar,
  fetchLatestTerritoryWar,
  fetchTerritoryWarUser as fetchUser,
} from "@/server/utils/territoryWar";

export const territoryWarRouter = createTRPCRouter({
  getNotice: protectedProcedure.query(
    async ({ ctx }) => (await fetchActiveTerritoryWar(ctx.drizzle)) ?? null,
  ),
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
      ctx.drizzle.query.territoryWarScore.findMany({
        where: eq(territoryWarScore.warId, event.id),
        orderBy: (row, { desc }) => [desc(row.points), asc(row.name)],
      }),
      ctx.drizzle.query.mpvpBattleQueue.findMany({
        where: and(
          eq(mpvpBattleQueue.territoryWarId, event.id),
          isNull(mpvpBattleQueue.battleId),
        ),
        with: {
          queue: {
            orderBy: asc(mpvpBattleUser.slot),
            with: { user: { columns: { userId: true, username: true } } },
          },
        },
      }),
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

  createTeam: protectedProcedure
    .input(z.object({ eventId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [event, user] = await Promise.all([
        ctx.drizzle.query.territoryWar.findFirst({
          where: eq(territoryWar.id, input.eventId),
        }),
        fetchUser(ctx.drizzle, ctx.userId),
      ]);
      if (!event || event.resolvedAt || event.endsAt <= new Date())
        return errorResponse("This Territory War has ended");
      if (user.isBanned || user.status !== "AWAKE" || user.sector !== event.sector)
        return errorResponse("You must be awake in the event sector");
      const competitor = getTerritoryCompetitor(user);
      const id = nanoid();
      await ctx.drizzle.insert(mpvpBattleQueue).values({
        id,
        battleType: "TERRITORY_WAR",
        territoryWarId: event.id,
        attackerEntityId: competitor.id,
        defenderEntityId: event.guardianId,
        sector: event.sector,
      });
      const result = await joinTeam(ctx.drizzle, user, id, competitor.id);
      if (!result.success)
        await ctx.drizzle.delete(mpvpBattleQueue).where(eq(mpvpBattleQueue.id, id));
      return result;
    }),

  joinTeam: protectedProcedure
    .input(z.object({ teamId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (user.isBanned || user.status !== "AWAKE")
        return errorResponse("You must be awake to join a team");
      return joinTeam(ctx.drizzle, user, input.teamId, getTerritoryCompetitor(user).id);
    }),

  leaveTeam: protectedProcedure
    .input(z.object({ teamId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const removed = await ctx.drizzle.execute(sql`
      DELETE ${mpvpBattleUser} FROM ${mpvpBattleUser} INNER JOIN ${mpvpBattleQueue} ON ${mpvpBattleQueue.id} = ${mpvpBattleUser.clanBattleId}
      WHERE ${mpvpBattleUser.userId} = ${ctx.userId} AND ${mpvpBattleQueue.id} = ${input.teamId} AND ${mpvpBattleQueue.battleType} = 'TERRITORY_WAR' AND ${mpvpBattleQueue.battleId} IS NULL
    `);
      if (!removed.rowsAffected)
        return errorResponse("This team has already started or you have left it");
      await ctx.drizzle
        .update(userData)
        .set({ status: "AWAKE" })
        .where(and(eq(userData.userId, ctx.userId), eq(userData.status, "QUEUED")));
      return { success: true, message: "Left the team" };
    }),

  startBattle: protectedProcedure
    .input(z.object({ teamId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const team = await ctx.drizzle.query.mpvpBattleQueue.findFirst({
        where: and(
          eq(mpvpBattleQueue.id, input.teamId),
          eq(mpvpBattleQueue.battleType, "TERRITORY_WAR"),
        ),
        with: { queue: true },
      });
      if (
        !team?.territoryWarId ||
        team.battleId ||
        !team.queue.some((member) => member.userId === ctx.userId)
      )
        return errorResponse("This team is no longer available");
      const event = await ctx.drizzle.query.territoryWar.findFirst({
        where: eq(territoryWar.id, team.territoryWarId),
      });
      if (!event || event.resolvedAt || event.endsAt <= new Date())
        return errorResponse("This Territory War has ended");
      if (!team.queue.length || team.queue.length > TERRITORY_WAR_TEAM_SIZE)
        return errorResponse("Invalid team size");
      const battleId = nanoid();
      const claimed = await ctx.drizzle
        .update(mpvpBattleQueue)
        .set({ battleId })
        .where(and(eq(mpvpBattleQueue.id, team.id), isNull(mpvpBattleQueue.battleId)));
      if (!claimed.rowsAffected)
        return errorResponse("Another teammate already started this battle");
      try {
        // Reservation excludes further successful joins; reload members after it commits.
        const roster = await ctx.drizzle.query.mpvpBattleUser.findMany({
          where: eq(mpvpBattleUser.clanBattleId, team.id),
        });
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
        return result;
      } finally {
        // Failed launches restore the lobby; a real battle keeps its membership until settlement.
        await ctx.drizzle.execute(
          sql`UPDATE ${mpvpBattleQueue} SET ${mpvpBattleQueue.battleId} = NULL WHERE ${mpvpBattleQueue.id} = ${team.id} AND ${mpvpBattleQueue.battleId} = ${battleId} AND NOT EXISTS (SELECT 1 FROM Battle WHERE Battle.id = ${battleId})`,
        );
      }
    }),
});

/** Membership precedes the guarded queued-status claim; a concurrent launch can only fail and retry. */
const joinTeam = async (
  client: import("@/server/db").DrizzleClient,
  user: Awaited<ReturnType<typeof fetchUser>>,
  teamId: string,
  competitorId: string,
) => {
  const memberId = nanoid();
  let joined = false;
  try {
    const inserted = await client.execute(sql`
      INSERT IGNORE INTO MpvpBattleUser (id, clanBattleId, userId, side, slot)
      SELECT ${memberId}, q.id, ${user.userId}, 'ATTACKER', slots.slot
      FROM MpvpBattleQueue q INNER JOIN TerritoryWar w ON w.id = q.territoryWarId
      CROSS JOIN (SELECT 0 AS slot UNION ALL SELECT 1 UNION ALL SELECT 2) slots
      WHERE q.id = ${teamId} AND q.battleType = 'TERRITORY_WAR' AND q.battleId IS NULL
        AND q.attackerEntityId = ${competitorId} AND q.sector = ${user.sector}
        AND w.resolvedAt IS NULL AND w.startsAt <= NOW(3) AND w.endsAt > NOW(3)
        AND NOT EXISTS (SELECT 1 FROM MpvpBattleUser m WHERE m.clanBattleId = q.id AND m.slot = slots.slot AND m.side = 'ATTACKER')
      ORDER BY slots.slot LIMIT 1
    `);
    if (!inserted.rowsAffected)
      return errorResponse(
        "The team is full, has started, or belongs to another competitor",
      );
    // Updating q in the same statement serializes this admission against startBattle's reservation.
    // A missing-row/slot race is reversible, so no transaction or locking read is needed.
    const claimed = await client.execute(sql`
      UPDATE UserData u INNER JOIN MpvpBattleUser m ON m.userId = u.userId
      INNER JOIN MpvpBattleQueue q ON q.id = m.clanBattleId
      INNER JOIN TerritoryWar w ON w.id = q.territoryWarId
      SET u.status = 'QUEUED', q.createdAt = q.createdAt
      WHERE u.userId = ${user.userId} AND m.id = ${memberId} AND q.battleId IS NULL
        AND u.status = 'AWAKE' AND u.isBanned = false AND u.sector = ${user.sector}
        AND u.isOutlaw = ${user.isOutlaw} AND u.clanId <=> ${user.clanId} AND u.villageId <=> ${user.villageId}
        AND w.resolvedAt IS NULL AND w.endsAt > NOW(3)
    `);
    joined = claimed.rowsAffected > 0;
    return joined
      ? { success: true, message: "Joined the team. Start solo or wait for teammates" }
      : errorResponse("Your status or this team changed. Try again");
  } finally {
    if (!joined)
      await client.delete(mpvpBattleUser).where(eq(mpvpBattleUser.id, memberId));
  }
};
