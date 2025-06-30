import { z } from "zod";
import { nanoid } from "nanoid";
import { eq, or, and, ne, sql, gte, isNull } from "drizzle-orm";
import {
  clan,
  userData,
  village,
  villageStructure,
  kageDefendedChallenges,
  actionLog,
} from "@/drizzle/schema";
import { canChangeContent } from "@/utils/permissions";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { errorResponse, baseServerResponse } from "@/server/api/trpc";
import { initiateBattle } from "@/routers/combat";
import { fetchVillage } from "@/routers/village";
import { fetchUser, fetchUpdatedUser, updateNindo } from "@/routers/profile";
import { canChallengeKage, canBeElder } from "@/utils/kage";
import { calcStructureUpgrade } from "@/utils/village";
import {
  KAGE_MAX_DAILIES,
  KAGE_MAX_ELDERS,
  KAGE_DELAY_SECS,
  KAGE_PRESTIGE_REQUIREMENT,
  KAGE_DEFAULT_PRESTIGE,
  KAGE_CHALLENGE_SECS,
  KAGE_REQUESTS_SHOW_SECONDS,
  KAGE_CHALLENGE_ACCEPT_PRESTIGE,
  KAGE_CHALLENGE_OPEN_FOR_SECONDS,
  KAGE_MAX_WEEKLY_PRESTIGE_SEND,
  KAGE_UNACCEPTED_CHALLENGE_COST,
  KAGE_CHALLENGE_REJECT_COST,
} from "@/drizzle/constants";
import {
  fetchRequests,
  fetchRequest,
  updateRequestState,
  insertRequest,
} from "@/routers/sparring";
import { getServerPusher } from "@/libs/pusher";
import type { DrizzleClient } from "@/server/db";
import { secondsFromDate, secondsPassed } from "@/utils/time";
import { fetchClan } from "@/routers/clan";
import { fetchActiveWars } from "@/routers/war";

const pusher = getServerPusher();

export const kageRouter = createTRPCRouter({
  /**
   * Kage challenge & request challenge system
   */
  getUserChallenges: protectedProcedure.query(async ({ ctx }) => {
    return fetchRequests(ctx.drizzle, ["KAGE"], KAGE_REQUESTS_SHOW_SECONDS, ctx.userId);
  }),
  createChallenge: protectedProcedure
    .input(z.object({ kageId: z.string(), villageId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, kage, elders, recent, village, previous, activeWars] =
        await Promise.all([
          fetchUser(ctx.drizzle, ctx.userId),
          fetchUser(ctx.drizzle, input.kageId),
          fetchElders(ctx.drizzle, input.villageId),
          fetchRequests(ctx.drizzle, ["KAGE"], KAGE_CHALLENGE_SECS, ctx.userId),
          fetchVillage(ctx.drizzle, input.villageId),
          ctx.drizzle
            .select({ count: sql<number>`count(*)`.mapWith(Number) })
            .from(kageDefendedChallenges)
            .where(
              and(
                eq(kageDefendedChallenges.villageId, input.villageId),
                eq(kageDefendedChallenges.userId, ctx.userId),
                gte(kageDefendedChallenges.createdAt, sql`NOW() - INTERVAL 1 DAY`),
              ),
            ),
          fetchActiveWars(ctx.drizzle, input.villageId),
        ]);
      const previousCount = previous?.[0]?.count ?? 0;
      const activeVillageWars = activeWars?.filter((w) => w.type === "VILLAGE_WAR");
      // Guard
      if (!village) return errorResponse("Village not found");
      if (!canChallengeKage(user)) return errorResponse("Not eligible to challenge");
      if (previousCount >= KAGE_MAX_DAILIES) return errorResponse("Max for today");
      if (kage.villageId !== village.id) return errorResponse("No longer kage");
      if (kage.villageId !== user.villageId) return errorResponse("Wrong village");
      if (!village.openForChallenges) return errorResponse("Challenges are closed!");
      if (user.anbuId) return errorResponse("Cannot be kage while in ANBU");
      if (user.status !== "AWAKE") return errorResponse("User is not awake");
      if (recent.length > 0) {
        return errorResponse(`Max 1 challenge per ${KAGE_CHALLENGE_SECS} seconds`);
      }
      if (activeVillageWars && activeVillageWars.length > 0) {
        return errorResponse("Cannot challenge kage while village is at war");
      }
      // Mutate
      await Promise.all([
        insertRequest(ctx.drizzle, user.userId, kage.userId, "KAGE"),
        pusher.trigger(input.kageId, "event", {
          type: "userMessage",
          message: "Your position as kage is being challenged",
          route: "/townhall",
          routeText: "To Town Hall",
        }),
        ...(elders.length > 0
          ? elders.map((e) => {
              return pusher.trigger(e.userId, "event", {
                type: "userMessage",
                message: "The kage is being challenged",
                route: "/townhall",
                routeText: "To Town Hall",
              });
            })
          : []),
      ]);

      return { success: true, message: "Challenge created" };
    }),
  acceptChallenge: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse.extend({ battleId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      // Fetch village and war data
      const [user, challenge] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchRequest(ctx.drizzle, input.id, "KAGE"),
      ]);
      const [village, activeWars] = await Promise.all([
        fetchVillage(ctx.drizzle, user.villageId || ""),
        fetchActiveWars(ctx.drizzle, user.villageId || ""),
      ]);
      const activeVillageWars = activeWars?.filter((w) => w.type === "VILLAGE_WAR");
      // Guards
      if (!village) return errorResponse("Village not found");
      if (village.kageId !== user.userId) return errorResponse("Not kage");
      if (challenge.receiverId !== ctx.userId) {
        return errorResponse("Not your challenge to accept");
      }
      if (challenge.status !== "PENDING") {
        return errorResponse("Challenge not pending");
      }
      if (activeVillageWars && activeVillageWars.length > 0) {
        return errorResponse("Cannot accept challenge while village is at war");
      }
      // Mutate
      const result = await initiateBattle(
        {
          sector: user.sector,
          userIds: [challenge.senderId],
          targetIds: [challenge.receiverId],
          client: ctx.drizzle,
          asset: "arena",
        },
        "KAGE_PVP",
      );
      if (result.success) {
        await Promise.all([
          updateRequestState(ctx.drizzle, input.id, "ACCEPTED", "KAGE"),
          ctx.drizzle
            .update(userData)
            .set({
              villagePrestige: sql`${userData.villagePrestige} + ${KAGE_CHALLENGE_ACCEPT_PRESTIGE}`,
            })
            .where(eq(userData.userId, ctx.userId)),
          pusher.trigger(challenge.senderId, "event", {
            type: "userMessage",
            message: "Your kage challenge has been accepted",
            route: "/combat",
            routeText: "To Combat",
          }),
        ]);
      }
      return result;
    }),
  rejectChallenge: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const challenge = await fetchRequest(ctx.drizzle, input.id, "KAGE");
      // Guard
      if (challenge.receiverId !== ctx.userId) {
        return errorResponse("You can only reject challenge for yourself");
      }
      if (challenge.status !== "PENDING") {
        return errorResponse("Can only reject pending challenges");
      }
      // Mutate
      await Promise.all([
        pusher.trigger(challenge.senderId, "event", {
          type: "userMessage",
          message: "Your kage challenge has was rejected",
        }),
        ctx.drizzle
          .update(userData)
          .set({
            villagePrestige: sql`${userData.villagePrestige} - ${KAGE_CHALLENGE_REJECT_COST}`,
          })
          .where(eq(userData.userId, ctx.userId)),
        updateRequestState(ctx.drizzle, input.id, "REJECTED", "KAGE"),
      ]);
      return { success: true, message: "Challenge rejected" };
    }),
  cancelChallenge: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse.extend({ battleId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      // Query
      const challenge = await fetchRequest(ctx.drizzle, input.id, "KAGE");
      // Derived
      const secondsSinceChallenge = secondsPassed(challenge.createdAt);
      // Guard
      if (challenge.senderId !== ctx.userId) {
        return errorResponse("You can only cancel challenges created by you");
      }
      if (challenge.status !== "PENDING") {
        return errorResponse("Can only cancel pending challenges");
      }
      if (secondsSinceChallenge > KAGE_CHALLENGE_SECS) {
        const [result] = await Promise.all([
          initiateBattle(
            {
              userIds: [challenge.senderId],
              targetIds: [challenge.receiverId],
              client: ctx.drizzle,
              asset: "arena",
            },
            "KAGE_AI",
          ),
          ctx.drizzle
            .update(userData)
            .set({
              villagePrestige: sql`${userData.villagePrestige} - ${KAGE_UNACCEPTED_CHALLENGE_COST}`,
            })
            .where(eq(userData.userId, challenge.receiverId)),
          pusher.trigger(challenge.senderId, "event", {
            type: "userMessage",
            message:
              "Kage did not accept the challenge, it will be executed as AI vs AI",
            route: "/combat",
            routeText: "To Combat",
          }),
          updateRequestState(ctx.drizzle, input.id, "EXPIRED", "KAGE"),
        ]);
        return result;
      } else {
        return await updateRequestState(ctx.drizzle, input.id, "CANCELLED", "KAGE");
      }
    }),
  /**
   * Misc other kage features
   */
  resignKage: protectedProcedure
    .input(z.object({ villageId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Destructure
      const villageId = input.villageId;
      // Fetch
      const [user, uVillage, elder] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchVillage(ctx.drizzle, input.villageId),
        fetchKageReplacement(ctx.drizzle, input.villageId, ctx.userId),
      ]);
      // Guards
      if (!elder) return errorResponse("No elder found");
      if (!user) return errorResponse("User not found");
      if (!uVillage) return errorResponse("Village not found");
      if (uVillage.type !== "VILLAGE") return errorResponse("Only for villages");
      if (user.villageId !== villageId) return errorResponse("Wrong village");
      if (user.userId !== uVillage?.kageId) return errorResponse("Not kage");
      // Update
      await ctx.drizzle
        .update(village)
        .set({ kageId: elder.userId, leaderUpdatedAt: new Date() })
        .where(eq(village.id, user.villageId));
      return { success: true, message: "You have resigned as kage" };
    }),

  sendKagePrestige: protectedProcedure
    .input(z.object({ kageId: z.string(), amount: z.number() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, kage, records] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.kageId),
        ctx.drizzle.query.actionLog.findMany({
          columns: { relatedValue: true },
          where: and(
            eq(actionLog.userId, ctx.userId),
            eq(actionLog.relatedId, input.kageId),
            gte(actionLog.createdAt, sql`NOW() - INTERVAL 1 WEEK`),
          ),
        }),
      ]);
      // Derived
      const previousSent = records?.reduce((acc, curr) => acc + curr.relatedValue, 0);
      // Guards
      if (user.rank !== "ELDER") return errorResponse("Must be an elder");
      if (user.villageId !== kage.villageId) return errorResponse("Wrong village");
      if (input.amount <= 0) return errorResponse("Invalid amount");
      if (previousSent + input.amount > KAGE_MAX_WEEKLY_PRESTIGE_SEND) {
        return errorResponse(
          `You have already sent ${previousSent} prestige this week. You can only send ${KAGE_MAX_WEEKLY_PRESTIGE_SEND - previousSent} more.`,
        );
      }
      if (user.villagePrestige < input.amount) {
        return errorResponse("Not enough prestige");
      }
      // Create transfer request
      await Promise.all([
        ctx.drizzle
          .update(userData)
          .set({ villagePrestige: sql`${userData.villagePrestige} - ${input.amount}` })
          .where(eq(userData.userId, ctx.userId)),
        ctx.drizzle
          .update(userData)
          .set({ villagePrestige: sql`${userData.villagePrestige} + ${input.amount}` })
          .where(eq(userData.userId, input.kageId)),
        ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "user",
          changes: [`${input.amount} prestige sent to ${kage.username}`],
          relatedId: input.kageId,
          relatedMsg: `Sent ${input.amount} prestige to ${kage.username}`,
          relatedImage: user.avatarLight,
          relatedValue: input.amount,
        }),
      ]);
      return {
        success: true,
        message: `Sent ${input.amount} prestige to ${kage.username}`,
      };
    }),
  takeKage: protectedProcedure.output(baseServerResponse).mutation(async ({ ctx }) => {
    // Fetch
    const { user } = await fetchUpdatedUser({
      client: ctx.drizzle,
      userId: ctx.userId,
    });
    // Guards
    if (!user) return errorResponse("User not found");
    if (user.anbuId) return errorResponse("Cannot be kage while in ANBU");
    if (user.village?.type !== "VILLAGE") return errorResponse("Only for villages");
    if (!canChangeContent(user.role)) return errorResponse("Not staff");
    // Update
    const [result] = await Promise.all([
      ctx.drizzle
        .update(village)
        .set({ kageId: user.userId, leaderUpdatedAt: new Date() })
        .where(eq(village.id, user.villageId ?? "")),
      ctx.drizzle
        .update(userData)
        .set({ villagePrestige: KAGE_PRESTIGE_REQUIREMENT })
        .where(eq(userData.userId, user?.village?.kageId ?? "")),
      ctx.drizzle
        .update(userData)
        .set({
          rank: sql`CASE WHEN ${userData.rank} = 'ELDER' THEN 'JONIN' ELSE ${userData.rank} END`,
          villagePrestige:
            user.villagePrestige > KAGE_DEFAULT_PRESTIGE
              ? user.villagePrestige
              : KAGE_DEFAULT_PRESTIGE,
        })
        .where(eq(userData.userId, user.userId)),
    ]);
    if (result.rowsAffected === 0) return errorResponse("No village found");
    return { success: true, message: "You have taken the kage position" };
  }),
  upsertNotice: protectedProcedure
    .input(z.object({ content: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });
      const village = user?.village;
      const isHideoutOrTown = ["HIDEOUT", "TOWN"].includes(village?.type ?? "");
      const lockout = isHideoutOrTown ? KAGE_DELAY_SECS : 0;
      // Guards
      if (!user) return errorResponse("User not found");
      if (!village) return errorResponse("Village not found");
      if (user.isBanned) return errorResponse("User is banned");
      if (user.isSilenced) return errorResponse("User is silenced");
      if (village.kageId !== ctx.userId) return errorResponse("Not kage");
      if (secondsFromDate(lockout, village.leaderUpdatedAt) > new Date()) {
        return errorResponse("Must have been kage for 24 hours");
      }
      // Update
      return updateNindo(ctx.drizzle, village.id, input.content, "kageOrder");
    }),
  getElders: protectedProcedure
    .input(z.object({ villageId: z.string() }))
    .query(async ({ ctx, input }) => {
      return await fetchElders(ctx.drizzle, input.villageId);
    }),
  toggleElder: protectedProcedure
    .input(z.object({ userId: z.string(), villageId: z.string().nullish() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const villageId = input.villageId ?? "syndicate";
      const [kage, prospect, village, elders] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.userId),
        fetchVillage(ctx.drizzle, villageId),
        fetchElders(ctx.drizzle, villageId),
      ]);
      // Derived
      const isHideoutOrTown = ["HIDEOUT", "TOWN"].includes(village?.type ?? "");
      const lockout = isHideoutOrTown ? KAGE_DELAY_SECS : 0;
      const newRank = prospect.rank === "ELDER" ? "JONIN" : "ELDER";
      // Guards
      if (!kage) return errorResponse("User not found");
      if (!prospect) return errorResponse("Target not found");
      if (!village) return errorResponse("Village not found");
      if (newRank !== "ELDER") return errorResponse("Demotion of elder is disabled");
      if (prospect.anbuId) return errorResponse("Cannot promote ANBU to elder");
      if (prospect.isAi) return errorResponse("Do not touch the AI");
      if (kage.villageId !== village.id) return errorResponse("Wrong village");
      if (village.kageId !== kage.userId) return errorResponse("Not kage");
      if (village.type !== "VILLAGE") return errorResponse("Only for village");
      if (prospect.villageId !== village.id) return errorResponse("Not in village");
      if (elders.length > KAGE_MAX_ELDERS) {
        return errorResponse(`Already have ${KAGE_MAX_ELDERS} elders`);
      }
      if (secondsFromDate(lockout, village.leaderUpdatedAt) > new Date()) {
        return errorResponse("Must have been kage for 24 hours");
      }
      if (prospect.rank !== "ELDER" && !canBeElder(prospect)) {
        return errorResponse("Must be in village for 100 days to be elder");
      }
      // Mutate
      await ctx.drizzle
        .update(userData)
        .set({ rank: newRank })
        .where(eq(userData.userId, prospect.userId));
      return {
        success: true,
        message: `User rank updated to ${newRank.toLowerCase()}`,
      };
    }),
  upgradeStructure: protectedProcedure
    .input(
      z.object({
        structureId: z.string(),
        villageId: z.string(),
        clanId: z.string().nullish(),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, userVillage, clanData] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchVillage(ctx.drizzle, input.villageId),
        input.clanId ? fetchClan(ctx.drizzle, input.clanId) : null,
      ]);

      // Derived
      const structure = userVillage?.structures.find((s) => s.id === input.structureId);
      const isHideoutOrTown = ["HIDEOUT", "TOWN"].includes(userVillage?.type ?? "");
      const lockout = isHideoutOrTown ? KAGE_DELAY_SECS : 0;

      // Guards
      if (!user) return errorResponse("User not found");
      if (!userVillage) return errorResponse("Village not found");
      if (!structure) return errorResponse("Structure not found");
      if (isHideoutOrTown && !clanData) return errorResponse("Faction not found");
      if (userVillage.kageId !== user.userId) return errorResponse("Not the leader");
      if (structure.level === 0) return errorResponse("Can't upgrade from lvl 0 yet");
      if (user.villageId !== structure.villageId) return errorResponse("Wrong village");
      if (!["VILLAGE", "TOWN"].includes(userVillage.type)) {
        return errorResponse("Only for villages");
      }
      if (clanData && clanData.id !== user.clanId) {
        return errorResponse("Not in faction");
      }
      if (secondsFromDate(lockout, userVillage.leaderUpdatedAt) > new Date()) {
        return errorResponse("Must have been in charge for 24 hours");
      }
      // Guard on cost & mutate
      const { total } = calcStructureUpgrade(structure, userVillage);
      if (isHideoutOrTown && clanData) {
        if (clanData.points < total) return errorResponse("Not enough clan points");
        const update = await ctx.drizzle
          .update(clan)
          .set({ points: sql`${clan.points} - ${total}` })
          .where(and(eq(clan.id, clanData.id), gte(clan.points, total)));
        if (update.rowsAffected === 0) return errorResponse("Point update failed");
      } else {
        if (userVillage.tokens < total) return errorResponse("Not enough tokens");
        const update = await ctx.drizzle
          .update(village)
          .set({ tokens: sql`${village.tokens} - ${total}` })
          .where(and(eq(village.id, input.villageId), gte(village.tokens, total)));
        if (update.rowsAffected === 0) return errorResponse("Token update failed");
      }
      // If success, upgrade structure
      const result = await ctx.drizzle
        .update(villageStructure)
        .set({ level: structure.level + 1 })
        .where(
          and(
            eq(villageStructure.id, input.structureId),
            eq(villageStructure.villageId, user.villageId),
          ),
        );
      if (result.rowsAffected === 0) return errorResponse("Upgrade failed");

      return { success: true, message: "Structure upgraded" };
    }),
  toggleOpenForChallenges: protectedProcedure
    .input(z.object({ villageId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, requests, userVillage] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchRequests(ctx.drizzle, ["KAGE"], KAGE_REQUESTS_SHOW_SECONDS, ctx.userId),
        fetchVillage(ctx.drizzle, input.villageId),
      ]);

      // Derived
      const pendingRequests = requests?.filter((r) => r.status === "PENDING");
      const nPendingRequests = pendingRequests?.length ?? 0;

      // Guards
      if (!user) return errorResponse("User not found");
      if (!userVillage) return errorResponse("Village not found");
      if (userVillage.kageId !== user.userId) return errorResponse("Not kage");
      if (userVillage.type !== "VILLAGE") return errorResponse("Only for villages");
      if (nPendingRequests > 0) {
        return errorResponse("Cannot toggle while there are pending challenges");
      }
      const secondsSinceOpen = secondsPassed(userVillage.openForChallengesAt);
      if (secondsSinceOpen < KAGE_CHALLENGE_OPEN_FOR_SECONDS) {
        return errorResponse(
          `Please wait ${Math.floor(KAGE_CHALLENGE_OPEN_FOR_SECONDS - secondsSinceOpen)} seconds before toggling`,
        );
      }

      // Update
      await ctx.drizzle
        .update(village)
        .set({
          openForChallenges: !userVillage.openForChallenges,
          openForChallengesAt: new Date(),
        })
        .where(eq(village.id, input.villageId));

      return {
        success: true,
        message: `Village is now ${!userVillage.openForChallenges ? "open" : "closed"} for challenges`,
      };
    }),
});

/**
 * Fetches the elders from the user data table based on the provided village ID.
 * @param client - The DrizzleClient instance used for querying the database.
 * @param villageId - The ID of the village to fetch elders from.
 * @returns A Promise that resolves to an array of elder user data objects.
 */
export const fetchElders = async (client: DrizzleClient, villageId: string) => {
  return await client.query.userData.findMany({
    columns: {
      username: true,
      userId: true,
      villageId: true,
      avatar: true,
      level: true,
      rank: true,
      isOutlaw: true,
    },
    where: and(
      eq(userData.villageId, villageId),
      eq(userData.rank, "ELDER"),
      eq(userData.isAi, false),
    ),
  });
};

/**
 * Fetches a kage replacement from the user data table based on the provided village ID and current kage ID.
 * @param client - The DrizzleClient instance used for querying the database.
 * @param villageId - The ID of the village to fetch a replacement from.
 * @param currentKageId - The ID of the current kage.
 * @returns A Promise that resolves to a user data object representing the replacement kage.
 */
export const fetchKageReplacement = async (
  client: DrizzleClient,
  villageId: string,
  currentKageId: string,
) => {
  const elders = await client.query.userData.findMany({
    where: and(
      eq(userData.villageId, villageId),
      eq(userData.rank, "ELDER"),
      ne(userData.userId, currentKageId),
      isNull(userData.anbuId),
      or(
        gte(userData.villagePrestige, KAGE_PRESTIGE_REQUIREMENT),
        eq(userData.isAi, true),
      ),
    ),
  });
  const userElders = elders.filter((e) => !e.isAi);
  if (userElders.length > 0) {
    return userElders[Math.floor(Math.random() * userElders.length)];
  }
  return elders[Math.floor(Math.random() * elders.length)];
};
