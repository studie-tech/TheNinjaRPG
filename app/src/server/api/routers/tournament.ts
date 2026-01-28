import { z } from "zod";
import { nanoid } from "nanoid";
import { eq, ne, and, or, sql, inArray } from "drizzle-orm";
import { clan, userData } from "@/drizzle/schema";
import { tournament, tournamentMatch, tournamentRecord } from "@/drizzle/schema";
import { fetchUser } from "@/routers/profile";
import { fetchClan } from "@/routers/clan";
import { checkCoLeader } from "@/validators/clan";
import { errorResponse, baseServerResponse } from "@/server/api/trpc";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { getServerPusher } from "@/libs/pusher";
import { tournamentCreateSchema } from "@/validators/tournament";
import { initiateBattle } from "@/routers/combat";
import { TOURNAMENT_ROUND_SECONDS } from "@/drizzle/constants";
import { secondsFromDate } from "@/utils/time";
import { updateRewards } from "@/routers/quests";
import { ObjectiveReward } from "@/validators/rewards";
import { postProcessRewards } from "@/libs/quest";
import type { TournamentMatch } from "@/drizzle/schema";
import type { TournamentMatchState } from "@/drizzle/constants";
import type { BaseServerResponse } from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";

const pusher = getServerPusher();

export const tournamentRouter = createTRPCRouter({
  getTournament: protectedProcedure
    .input(z.object({ tournamentId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Fetch data
      let data = await fetchTournament(ctx.drizzle, input.tournamentId);

      // Update status if needed
      const now = new Date();
      if (data?.status === "OPEN") {
        if (now > data.startedAt) {
          await ctx.drizzle
            .update(tournament)
            .set({ status: "IN_PROGRESS" })
            .where(eq(tournament.id, input.tournamentId));
          data.status = "IN_PROGRESS";
        }
      }

      // Derived
      const matches = data?.matches.filter((m) => m.round === data?.round) ?? [];
      const allWon = matches.every((m) => m.winnerId);
      const match = matches?.[0];
      const nMatches = matches.length;

      // If tournament is stated, check if the round is over and we should proceed to the next round
      if (data?.status === "IN_PROGRESS") {
        const roundEndAt = secondsFromDate(
          TOURNAMENT_ROUND_SECONDS,
          data.roundStartedAt,
        );

        // Progress to the next round
        if ((now > roundEndAt || allWon) && nMatches > 1) {
          const now = new Date();
          const values: TournamentMatch[] = [];
          for (let i = 0; i < nMatches; i += 2) {
            const match1 = matches[i];
            const match2 = matches[i + 1];
            const winner1 = match1 && getWinner(match1);
            const winner2 = match2 && getWinner(match2);
            if (winner1) {
              values.push({
                id: nanoid(),
                tournamentId: input.tournamentId,
                round: data.round + 1,
                userId1: winner1,
                userId2: winner2 ?? null,
                match: data.matches.length + i / 2 + 1,
                startedAt: now,
                createdAt: now,
                battleId: null,
                winnerId: null,
                state: "WAITING",
              });
            }
          }
          await Promise.all([
            ctx.drizzle
              .update(tournament)
              .set({ round: data.round + 1, roundStartedAt: now })
              .where(eq(tournament.id, input.tournamentId)),
            ctx.drizzle.insert(tournamentMatch).values(values),
          ]);
          data = await fetchTournament(ctx.drizzle, input.tournamentId);
        }

        // End tournament & send reward
        if (data && (now > roundEndAt || allWon) && nMatches === 1 && match) {
          const finalRewards = postProcessRewards(data.rewards);
          const winnerId = getWinner(match);
          const winner = await fetchUser(ctx.drizzle, winnerId);
          await Promise.all([
            updateRewards({
              client: ctx.drizzle,
              user: winner,
              rewards: finalRewards,
              reason: "TOURNAMENT",
            }),
            ctx.drizzle.delete(tournament).where(eq(tournament.id, input.tournamentId)),
            ctx.drizzle
              .delete(tournamentMatch)
              .where(eq(tournamentMatch.tournamentId, input.tournamentId)),
            ctx.drizzle.insert(tournamentRecord).values({
              id: nanoid(),
              name: data.name,
              image: data.image,
              description: data.description,
              round: data.round,
              type: data.type,
              rewards: data.rewards,
              startedAt: data.startedAt,
              winnerId: winnerId,
            }),
          ]);
          const users = [
            ...new Set(data.matches.map((m) => [m.userId1, m.userId2]).flat()),
          ];
          users.map((u) => {
            if (u) {
              void pusher.trigger(u, "event", {
                type: "userMessage",
                message: `The tournament has ended, ${winner?.username} has won!`,
                route: "/profile",
                routeText: "To profile",
              });
            }
          });
        }
      }

      // Return the data
      return data ?? null;
    }),
  createTournament: protectedProcedure
    .input(tournamentCreateSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, clanData, tournamentData] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchClan(ctx.drizzle, input.id),
        fetchTournament(ctx.drizzle, input.id),
      ]);
      // General guards
      if (!user) return errorResponse("User not found");
      if (tournamentData) return errorResponse("Tournament already exists found.");
      // Specific guards & updates
      if (input.type === "CLAN") {
        if (!clanData) return errorResponse("Clan not found.");
        const isLeader = user.userId === clanData?.leaderId;
        const isColeader = checkCoLeader(user.userId, clanData);
        if (!isLeader && !isColeader) return errorResponse("Must be leader");
        input.rewards = ObjectiveReward.parse({ reward_money: clanData.bank });
        await ctx.drizzle.update(clan).set({ bank: 0 }).where(eq(clan.id, clanData.id));
      }
      // Insert tournament
      await ctx.drizzle.insert(tournament).values(input);
      // Return
      return { success: true, message: "Tournament created." };
    }),
  joinTournament: protectedProcedure
    .input(z.object({ tournamentId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, clanData, tournamentData] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchClan(ctx.drizzle, input.tournamentId),
        fetchTournament(ctx.drizzle, input.tournamentId),
      ]);
      // Derived
      const matches = tournamentData?.matches ?? [];
      // General guards
      if (!user) return errorResponse("User not found");
      if (!tournamentData) return errorResponse("Tournament not found.");
      if (matches.find((m) => [m.userId1, m.userId2].includes(user.userId))) {
        return errorResponse("User already in tournament.");
      }
      // Specific guards
      if (tournamentData.type === "CLAN") {
        if (!clanData) return errorResponse("Clan not found.");
        if (user.clanId !== clanData.id) return errorResponse("User not in clan.");
      }
      // Mutate
      const availableMatch = matches.find((m) => !m.userId1 || !m.userId2);
      if (availableMatch) {
        await ctx.drizzle
          .update(tournamentMatch)
          .set({
            userId1: sql`CASE WHEN ${tournamentMatch.userId1} IS NULL THEN ${user.userId} ELSE ${tournamentMatch.userId1} END`,
            userId2: sql`CASE WHEN ${tournamentMatch.userId2} IS NULL THEN ${user.userId} ELSE ${tournamentMatch.userId2} END`,
          })
          .where(eq(tournamentMatch.id, availableMatch.id));
      } else {
        await ctx.drizzle.insert(tournamentMatch).values({
          id: nanoid(),
          tournamentId: input.tournamentId,
          round: tournamentData.round,
          userId1: user.userId,
          match: tournamentData.matches.length + 1,
          startedAt: tournamentData.startedAt,
        });
      }
      // Return
      return { success: true, message: "Joined Tournament" };
    }),
  joinMatch: protectedProcedure
    .input(z.object({ matchId: z.string(), tournamentId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, matchData, tournamentData] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchMatch(ctx.drizzle, input.matchId),
        fetchTournament(ctx.drizzle, input.tournamentId),
      ]);
      // General guards
      if (!user) return errorResponse("User not found");
      if (!matchData) return errorResponse("Match not found.");
      if (!tournamentData) return errorResponse("Tournament not found.");
      if (tournamentData.round !== matchData.round) {
        return errorResponse("Match not in current round.");
      }
      if (matchData?.tournamentId !== input.tournamentId) {
        return errorResponse("Match not in tournament.");
      }
      if (![matchData.userId1, matchData.userId2].includes(user.userId)) {
        return errorResponse("Not in this match.");
      }
      // Ensure all users are awake
      await ctx.drizzle
        .update(userData)
        .set({
          status: "AWAKE",
          curHealth: sql`CASE WHEN ${userData.curHealth} < 0 THEN 1 ELSE ${userData.curHealth} END`,
        })
        .where(
          inArray(userData.userId, [matchData.userId1 ?? "", matchData.userId2 ?? ""]),
        );
      // Start the battle
      let result: BaseServerResponse | undefined;
      if (matchData.userId1 && matchData.userId2) {
        result = await initiateBattle(
          {
            userIds: [matchData.userId2],
            targetIds: [matchData.userId1],
            client: ctx.drizzle,
            biome: "arena",
          },
          "TOURNAMENT",
        );
      }
      // We we failed to create battle, let this user win by default
      if (!result?.success) {
        await setMatchWinner(ctx.drizzle, input.matchId, user.userId, "NO_SHOW");
      } else {
      }
      // Return
      return { success: true, message: "Joined Match" };
    }),
});

/**
 * Fetches a tournament from the database.
 * @param {DrizzleClient} client - The Drizzle client used to query the database.
 * @param {string} tournamentId - The ID of the tournament to fetch.
 * @returns {Promise<Tournament>} - A promise that resolves to the fetched tournament.
 */
export const fetchTournament = async (client: DrizzleClient, tournamentId: string) => {
  return client.query.tournament.findFirst({
    where: and(eq(tournament.id, tournamentId), ne(tournament.status, "COMPLETED")),
    with: {
      matches: {
        with: {
          user1: { columns: { userId: true, username: true, avatar: true } },
          user2: { columns: { userId: true, username: true, avatar: true } },
        },
        orderBy: (table, { asc }) => [asc(table.match)],
      },
    },
  });
};

/**
 * Fetches a tournament match from the database.
 *
 * @param {DrizzleClient} client - The Drizzle client used to query the database.
 * @param {string} matchId - The ID of the match to fetch.
 * @returns {Promise<TournamentMatch | null>} - A promise that resolves to the fetched match, or null if not found.
 */
export const fetchMatch = async (client: DrizzleClient, matchId: string) => {
  return client.query.tournamentMatch.findFirst({
    where: eq(tournamentMatch.id, matchId),
    with: {
      user1: { columns: { userId: true, username: true, avatar: true } },
      user2: { columns: { userId: true, username: true, avatar: true } },
    },
  });
};

/**
 * Sets the winner of a match in a tournament.
 *
 * @param {DrizzleClient} client - The Drizzle client used to update the tournament match.
 * @param {string} matchId - The ID of the match.
 * @param {string} winnerId - The ID of the winner.
 * @returns {Promise<boolean>} - A promise that resolves to true if the winner is successfully set.
 * @throws {Error} - If the match is not found or the winner is not in the match.
 */
export const setMatchWinner = async (
  client: DrizzleClient,
  matchId: string,
  winnerId: string,
  state: TournamentMatchState = "PLAYED",
) => {
  const result = await client
    .update(tournamentMatch)
    .set({ winnerId, state })
    .where(
      and(
        eq(tournamentMatch.id, matchId),
        or(
          eq(tournamentMatch.userId1, winnerId),
          eq(tournamentMatch.userId2, winnerId),
        ),
      ),
    );
  if (result.rowsAffected === 0) {
    throw new Error("Match not found or winner not in match.");
  }
  return true;
};

/**
 * Retrieves the winner ID of a tournament match.
 * If the match has a winner ID, it is returned.
 * If the match has two user IDs, a random winner is determined.
 * If the match has only one user ID, that user is considered the winner.
 *
 * @param match - The tournament match object.
 * @returns The winner ID of the tournament match.
 */
const getWinner = (match: TournamentMatch) => {
  if (match.winnerId) return match.winnerId;
  if (match.userId2) return Math.random() > 0.5 ? match.userId1 : match.userId2;
  return match.userId1;
};
