import { randomInt } from "crypto";
import { and, desc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  ELDER_KAGE_REMOVAL_VOTE_DAYS,
  ELDER_MIN_VOTING_COUNT,
  KAGE_CHALLENGE_ACCEPT_PRESTIGE,
  KAGE_CHALLENGE_MAX_DAILY_LOCKED_HOURS,
  KAGE_CHALLENGE_OPEN_FOR_SECONDS,
  KAGE_CHALLENGE_REJECT_COST,
  KAGE_CHALLENGE_SECS,
  KAGE_DEFAULT_PRESTIGE,
  KAGE_DELAY_SECS,
  KAGE_ELDER_REMOVAL_LOCK_SECS,
  KAGE_MAX_DAILIES,
  KAGE_MAX_WEEKLY_PRESTIGE_SEND,
  KAGE_PRESTIGE_REQUIREMENT,
  KAGE_REQUESTS_SHOW_SECONDS,
  KAGE_UNACCEPTED_CHALLENGE_COST,
} from "@/drizzle/constants";
import {
  actionLog,
  clan,
  kageDefendedChallenges,
  notification,
  userData,
  village,
  villageElderVote,
  villageElderVoteEntry,
  villageStructure,
} from "@/drizzle/schema";
import { getServerPusher } from "@/libs/pusher";
import { fetchClan } from "@/routers/clan";
import { initiateBattle } from "@/routers/combat";
import { fetchUpdatedUser, fetchUser, updateNindo } from "@/routers/profile";
import {
  fetchRequest,
  fetchRequests,
  insertRequest,
  updateRequestState,
} from "@/routers/sparring";
import { fetchVillage } from "@/routers/village";
import { fetchActiveWars, fetchElderVote, resolveElderVote } from "@/routers/war";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { calculateDailyLockedTime, canChallengeKage } from "@/utils/kage";
import { canTakeKage } from "@/utils/permissions";
import { secondsFromDate, secondsFromNow, secondsPassed } from "@/utils/time";
import { calcStructureUpgrade } from "@/utils/village";

const pusher = getServerPusher();

export const kageRouter = createTRPCRouter({
  /**
   * Get the daily locked time for the current user
   */
  getDailyLockedTime: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get kage daily locked time" } })
    .query(async ({ ctx }) => {
      const dailyLockedTimeSeconds = await calculateDailyLockedTime(
        ctx.drizzle,
        ctx.userId,
      );
      return { dailyLockedTimeSeconds };
    }),

  /**
   * Kage challenge & request challenge system
   */
  getUserChallenges: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get user's kage challenges" } })
    .query(async ({ ctx }) => {
      return fetchRequests(
        ctx.drizzle,
        ["KAGE"],
        KAGE_REQUESTS_SHOW_SECONDS,
        ctx.userId,
      );
    }),
  createChallenge: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Challenge the kage for position" } })
    .input(z.object({ kageId: z.string(), villageId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [
        user,
        kage,
        elders,
        recent,
        village,
        previous,
        activeWars,
        kageChallenges,
      ] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.kageId),
        fetchElders(ctx.drizzle, input.villageId),
        // Recent challenges by THIS challenger (rate limit)
        fetchRequests(ctx.drizzle, ["KAGE"], KAGE_CHALLENGE_SECS, ctx.userId),
        fetchVillage(ctx.drizzle, input.villageId),
        ctx.drizzle
          .select({ count: sql`count(*)`.mapWith(Number) })
          .from(kageDefendedChallenges)
          .where(
            and(
              eq(kageDefendedChallenges.villageId, input.villageId),
              eq(kageDefendedChallenges.userId, ctx.userId),
              gte(kageDefendedChallenges.createdAt, sql`NOW() - INTERVAL 1 DAY`),
            ),
          ),
        fetchActiveWars(ctx.drizzle, input.villageId),
        // All recent Kage requests involving this Kage (to prevent parallel challenges)
        fetchRequests(ctx.drizzle, ["KAGE"], KAGE_CHALLENGE_SECS, input.kageId),
      ]);
      const previousCount = previous?.[0]?.count ?? 0;
      const activeVillageWars = activeWars?.filter((w) => w.type === "VILLAGE_WAR");

      // Check if this Kage already has a pending Kage challenge in this window
      const activeKageChallenges =
        kageChallenges?.filter(
          (r) => r.status === "PENDING" && r.receiverId === kage.userId,
        ) ?? [];

      if (activeKageChallenges.length > 0) {
        return errorResponse("Kage is already defending a challenge");
      }

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
        // Set challenger status to KAGE_QUEUED while waiting for kage response
        ctx.drizzle
          .update(userData)
          .set({ status: "KAGE_QUEUED" })
          .where(and(eq(userData.userId, ctx.userId), eq(userData.status, "AWAKE"))),
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
    .meta({ mcp: { enabled: true, description: "Accept a kage challenge" } })
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
          biome: "arena",
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
    .meta({ mcp: { enabled: true, description: "Reject a kage challenge" } })
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
          message: "Your kage challenge was rejected",
        }),
        ctx.drizzle
          .update(userData)
          .set({
            villagePrestige: sql`${userData.villagePrestige} - ${KAGE_CHALLENGE_REJECT_COST}`,
          })
          .where(eq(userData.userId, ctx.userId)),
        // Set challenger status back to AWAKE when challenge is rejected
        ctx.drizzle
          .update(userData)
          .set({ status: "AWAKE" })
          .where(
            and(
              eq(userData.userId, challenge.senderId),
              eq(userData.status, "KAGE_QUEUED"),
            ),
          ),
        updateRequestState(ctx.drizzle, input.id, "REJECTED", "KAGE"),
      ]);
      return { success: true, message: "Challenge rejected" };
    }),
  cancelChallenge: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Cancel a kage challenge" } })
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
              biome: "arena",
            },
            "KAGE_AI",
          ),
          ctx.drizzle
            .update(userData)
            .set({
              villagePrestige: sql`${userData.villagePrestige} - ${KAGE_UNACCEPTED_CHALLENGE_COST}`,
            })
            .where(eq(userData.userId, challenge.receiverId)),
          // Set challenger status back to AWAKE when challenge expires
          ctx.drizzle
            .update(userData)
            .set({ status: "AWAKE" })
            .where(
              and(
                eq(userData.userId, challenge.senderId),
                eq(userData.status, "KAGE_QUEUED"),
              ),
            ),
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
        // Set challenger status back to AWAKE when challenge is cancelled
        await Promise.all([
          updateRequestState(ctx.drizzle, input.id, "CANCELLED", "KAGE"),
          ctx.drizzle
            .update(userData)
            .set({ status: "AWAKE" })
            .where(
              and(eq(userData.userId, ctx.userId), eq(userData.status, "KAGE_QUEUED")),
            ),
        ]);
        return { success: true, message: "Challenge cancelled" };
      }
    }),
  /**
   * Misc other kage features
   */
  resignKage: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Resign from kage position" } })
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
    .meta({ mcp: { enabled: true, description: "Send prestige to the kage as elder" } })
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
          id: crypto.randomUUID(),
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
  takeKage: protectedProcedure
    .output(baseServerResponse)
    .input(
      z.object({
        reason: z
          .string()
          .min(10, "Reason must be at least 10 characters")
          .transform((val) => val.trim()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });

      // Guards
      if (!user) return errorResponse("User not found");

      // Fetch village data for logging
      if (user.anbuId) return errorResponse("Cannot be kage while in ANBU");
      if (user.village?.type !== "VILLAGE") return errorResponse("Only for villages");
      if (!canTakeKage(user.role)) return errorResponse("Not staff");
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
        ctx.drizzle.insert(actionLog).values({
          id: crypto.randomUUID(),
          userId: ctx.userId,
          tableName: "user",
          relatedId: user.userId,
          relatedMsg: `Staff took kage position in ${user?.village?.name || "Unknown Village"}`,
          changes: [
            `Previous KageId: ${user?.village?.kageId}`,
            `Reason: ${input.reason}`,
          ],
        }),
      ]);
      if (result.rowsAffected === 0) return errorResponse("No village found");
      return { success: true, message: "You have taken the kage position" };
    }),
  upsertNotice: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Update village notice as kage" } })
    .input(z.object({ content: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });
      const village = user?.village;
      // Apply 24-hour lockout to all kages (villages, hideouts, and towns)
      const lockout = KAGE_DELAY_SECS;
      // Guards
      if (!user) return errorResponse("User not found");
      if (!village) return errorResponse("Village not found");
      if (user.isBanned) return errorResponse("User is banned");
      if (user.isSilenced) return errorResponse("User is silenced");
      if (village.kageId !== ctx.userId) return errorResponse("Not kage");
      if (secondsFromDate(lockout, village.leaderUpdatedAt) > new Date()) {
        return errorResponse("Must have been kage for 5 days");
      }
      // Update
      return updateNindo(ctx.drizzle, village.id, input.content, "kageOrder");
    }),
  getElders: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get village elders" } })
    .input(z.object({ villageId: z.string() }))
    .query(async ({ ctx, input }) => {
      return await fetchElders(ctx.drizzle, input.villageId);
    }),
  upgradeStructure: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Upgrade village structure as kage" } })
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
    .meta({ mcp: { enabled: true, description: "Toggle kage challenge availability" } })
    .input(z.object({ villageId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch all data in parallel
      const [user, requests, userVillage, lastToggle, dailyLockedTimeSeconds] =
        await Promise.all([
          fetchUser(ctx.drizzle, ctx.userId),
          fetchRequests(ctx.drizzle, ["KAGE"], KAGE_REQUESTS_SHOW_SECONDS, ctx.userId),
          fetchVillage(ctx.drizzle, input.villageId),
          ctx.drizzle
            .select({
              createdAt: actionLog.createdAt,
            })
            .from(actionLog)
            .where(
              and(
                eq(actionLog.userId, ctx.userId),
                eq(actionLog.tableName, "kageChallengeToggle"),
              ),
            )
            .orderBy(desc(actionLog.createdAt))
            .limit(1),
          calculateDailyLockedTime(ctx.drizzle, ctx.userId),
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

      const lastToggleEntry = lastToggle[0];
      if (lastToggleEntry?.createdAt) {
        const secondsSinceLastToggle = secondsPassed(lastToggleEntry.createdAt);
        if (secondsSinceLastToggle < KAGE_CHALLENGE_OPEN_FOR_SECONDS) {
          return errorResponse(
            `Please wait ${Math.floor(KAGE_CHALLENGE_OPEN_FOR_SECONDS - secondsSinceLastToggle)} seconds before toggling`,
          );
        }
      }

      // Check if trying to close challenges and daily limit has been reached
      if (!userVillage.openForChallenges) {
        // Currently closed, trying to open - this is always allowed
      } else {
        // Currently open, trying to close - check daily limit
        const maxDailySeconds = KAGE_CHALLENGE_MAX_DAILY_LOCKED_HOURS * 60 * 60;
        if (dailyLockedTimeSeconds >= maxDailySeconds) {
          return errorResponse(
            `Daily challenge lock limit of ${KAGE_CHALLENGE_MAX_DAILY_LOCKED_HOURS} hours has been reached. Challenges will be automatically unlocked at the start of the next day.`,
          );
        }
      }

      // Update village and log the toggle
      await Promise.all([
        ctx.drizzle
          .update(village)
          .set({
            openForChallenges: !userVillage.openForChallenges,
            openForChallengesAt: new Date(),
          })
          .where(eq(village.id, input.villageId)),
        ctx.drizzle.insert(actionLog).values({
          id: crypto.randomUUID(),
          userId: ctx.userId,
          tableName: "kageChallengeToggle",
          changes: [
            `Challenges ${!userVillage.openForChallenges ? "opened" : "closed"}`,
          ],
          relatedId: input.villageId,
          relatedMsg: `Toggle: ${userVillage.openForChallenges ? "CLOSE" : "OPEN"}`,
        }),
      ]);

      return {
        success: true,
        message: `Village is now ${!userVillage.openForChallenges ? "open" : "closed"} for challenges`,
      };
    }),

  // Initiate a kage removal vote (elder-only, once per 7 days, requires 4-day kage lock to have passed)
  initiateKageRemovalVote: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Initiate a vote to remove the current kage" },
    })
    .input(z.object({ villageId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [{ user }, uVillage] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        fetchVillage(ctx.drizzle, input.villageId),
      ]);

      // Guards
      if (!user) return errorResponse("User not found");
      if (!uVillage) return errorResponse("Village not found");
      if (uVillage.type !== "VILLAGE") return errorResponse("Only for villages");
      if (user.villageId !== input.villageId) return errorResponse("Wrong village");
      if (user.rank !== "ELDER")
        return errorResponse("Only elders can initiate a removal vote");
      if (user.userId === uVillage.kageId)
        return errorResponse("You cannot remove yourself as kage");

      // Check 4-day kage action lock
      const lockExpiry = new Date(
        uVillage.leaderUpdatedAt.getTime() + KAGE_ELDER_REMOVAL_LOCK_SECS * 1000,
      );
      if (new Date() < lockExpiry) {
        const daysLeft = Math.ceil(
          (lockExpiry.getTime() - Date.now()) / (1000 * 3600 * 24),
        );
        return errorResponse(
          `The kage is protected for ${daysLeft} more day${daysLeft !== 1 ? "s" : ""}`,
        );
      }

      // Fetch all eligible elders (excluding the kage who is the vote target)
      const eligibleElders = await ctx.drizzle.query.userData.findMany({
        columns: { userId: true },
        where: and(
          eq(userData.villageId, input.villageId),
          eq(userData.rank, "ELDER"),
          eq(userData.isAi, false),
          ne(userData.userId, uVillage.kageId),
        ),
      });
      if (eligibleElders.length < ELDER_MIN_VOTING_COUNT)
        return errorResponse(
          `At least ${ELDER_MIN_VOTING_COUNT} elders are required to initiate a vote`,
        );

      // Create the vote — unique constraint on (villageId, type, activeFlag) prevents concurrent dupes
      const endsAt = secondsFromNow(ELDER_KAGE_REMOVAL_VOTE_DAYS * 24 * 3600);
      try {
        await ctx.drizzle.insert(villageElderVote).values({
          id: crypto.randomUUID(),
          villageId: input.villageId,
          type: "KAGE_REMOVAL",
          initiatedByUserId: user.userId,
          targetId: uVillage.kageId,
          status: "PENDING",
          endsAt,
        });
      } catch (e) {
        const isDupe =
          typeof e === "object" && e !== null && "errno" in e && e.errno === 1062;
        if (isDupe)
          return errorResponse("There is already a pending kage removal vote");
        throw e;
      }

      // Notify all eligible elders (including the initiator) that the vote has started
      const notifyContent = `${user.username} has initiated a vote to remove the Kage. You have ${ELDER_KAGE_REMOVAL_VOTE_DAYS} days to vote.`;
      const notifyUserIds = eligibleElders.map((e) => e.userId);
      await Promise.all([
        ctx.drizzle
          .insert(notification)
          .values(notifyUserIds.map((userId) => ({ userId, content: notifyContent }))),
        ctx.drizzle
          .update(userData)
          .set({ unreadNotifications: sql`unreadNotifications + 1` })
          .where(inArray(userData.userId, notifyUserIds)),
      ]);

      return {
        success: true,
        message: `Kage removal vote initiated. Elders have ${ELDER_KAGE_REMOVAL_VOTE_DAYS} days to vote.`,
      };
    }),

  // Cast a vote on a kage removal motion (elder-only)
  voteOnKageRemoval: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Vote on a pending kage removal motion" },
    })
    .input(z.object({ voteId: z.string(), vote: z.enum(["YES", "NO"]) }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [{ user }, voteRecord] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        fetchElderVote(ctx.drizzle, input.voteId),
      ]);

      // Guards
      if (!user) return errorResponse("User not found");
      if (!user.villageId) return errorResponse("You must be in a village");
      if (user.rank !== "ELDER") return errorResponse("Only elders can vote");
      if (!voteRecord) return errorResponse("Vote not found");
      if (voteRecord.status !== "PENDING")
        return errorResponse("Vote is no longer pending");
      if (voteRecord.villageId !== user.villageId)
        return errorResponse("Vote is not for your village");
      if (voteRecord.type !== "KAGE_REMOVAL")
        return errorResponse("Not a kage removal vote");
      if (new Date() > voteRecord.endsAt)
        return errorResponse("Voting period has ended");
      if (user.userId === voteRecord.targetId)
        return errorResponse("The kage cannot vote on their own removal");
      const alreadyVoted = voteRecord.entries.some((e) => e.userId === user.userId);
      if (alreadyVoted) return errorResponse("You have already voted");

      // Count eligible elders (all elders except the kage being voted on)
      const elderCount = await ctx.drizzle
        .select({ count: sql<number>`count(*)` })
        .from(userData)
        .where(
          and(
            eq(userData.villageId, user.villageId),
            eq(userData.rank, "ELDER"),
            eq(userData.isAi, false),
            ne(userData.userId, voteRecord.targetId),
          ),
        )
        .then(([r]) => r?.count ?? 0);

      // Enforce minimum elder count (excluding the kage being voted on)
      if (elderCount < ELDER_MIN_VOTING_COUNT)
        return errorResponse(
          `At least ${ELDER_MIN_VOTING_COUNT} elders are required for a vote`,
        );

      // Insert vote entry — unique constraint on (voteId, userId) guards concurrent dupes
      try {
        await ctx.drizzle.insert(villageElderVoteEntry).values({
          id: crypto.randomUUID(),
          voteId: input.voteId,
          userId: user.userId,
          vote: input.vote,
        });
      } catch (e) {
        const isDupe =
          typeof e === "object" && e !== null && "errno" in e && e.errno === 1062;
        if (isDupe) return errorResponse("You have already voted");
        throw e;
      }

      // Re-fetch entries from DB to avoid stale snapshot races
      const freshEntries = await ctx.drizzle.query.villageElderVoteEntry.findMany({
        where: eq(villageElderVoteEntry.voteId, input.voteId),
      });
      const yesCount = freshEntries.filter((e) => e.vote === "YES").length;
      const noCount = freshEntries.filter((e) => e.vote === "NO").length;
      const outcome = resolveElderVote(yesCount, noCount, elderCount);

      if (outcome === "APPROVED") {
        // Early exit if kage already changed (atomic claim below is the real guard)
        const currentVillage = await ctx.drizzle.query.village.findFirst({
          columns: { kageId: true },
          where: eq(village.id, user.villageId),
        });
        if (currentVillage?.kageId !== voteRecord.targetId) {
          await ctx.drizzle
            .update(villageElderVote)
            .set({ status: "REJECTED" })
            .where(eq(villageElderVote.id, input.voteId));
          return errorResponse(
            "The kage has already changed — vote is no longer valid",
          );
        }

        const replacement = await fetchKageReplacement(
          ctx.drizzle,
          user.villageId,
          voteRecord.targetId,
        );
        if (!replacement) {
          await ctx.drizzle
            .update(villageElderVote)
            .set({ status: "REJECTED" })
            .where(eq(villageElderVote.id, input.voteId));
          return errorResponse("No eligible replacement elder found");
        }

        // Atomically claim the motion — only one concurrent request can proceed to side effects
        const claimResult = await ctx.drizzle
          .update(villageElderVote)
          .set({ status: "APPROVED" })
          .where(
            and(
              eq(villageElderVote.id, input.voteId),
              eq(villageElderVote.status, "PENDING"),
            ),
          );
        if (claimResult.rowsAffected === 0) {
          return errorResponse("Vote already processed");
        }

        await Promise.all([
          // Reset kicked kage prestige to 0
          ctx.drizzle
            .update(userData)
            .set({ villagePrestige: 0 })
            .where(eq(userData.userId, voteRecord.targetId)),
          // Install replacement kage, guarded by expected kageId
          ctx.drizzle
            .update(village)
            .set({ kageId: replacement.userId, leaderUpdatedAt: new Date() })
            .where(
              and(
                eq(village.id, user.villageId),
                eq(village.kageId, voteRecord.targetId),
              ),
            ),
          // Notify the removed kage
          ctx.drizzle.insert(notification).values({
            userId: voteRecord.targetId,
            content: `You have been removed as Kage by the Elder Council. ${replacement.username} is the new Kage.`,
          }),
          // Notify the new kage
          ctx.drizzle.insert(notification).values({
            userId: replacement.userId,
            content: `You have been appointed as the new Kage following the removal of the previous Kage.`,
          }),
          // Increment unread for removed kage and new kage (their individual notifications)
          ctx.drizzle
            .update(userData)
            .set({ unreadNotifications: sql`unreadNotifications + 1` })
            .where(inArray(userData.userId, [voteRecord.targetId, replacement.userId])),
          // Increment unread for all other elders (excluding replacement who already got +1 above)
          ctx.drizzle
            .update(userData)
            .set({ unreadNotifications: sql`unreadNotifications + 1` })
            .where(
              and(
                eq(userData.villageId, user.villageId),
                eq(userData.rank, "ELDER"),
                eq(userData.isAi, false),
                ne(userData.userId, replacement.userId),
              ),
            ),
        ]);
        return {
          success: true,
          message: `Kage removed. ${replacement.username} is the new kage.`,
        };
      }

      if (outcome === "REJECTED") {
        // Atomically claim the rejection to prevent double notifications on concurrent votes
        const claimResult = await ctx.drizzle
          .update(villageElderVote)
          .set({ status: "REJECTED" })
          .where(
            and(
              eq(villageElderVote.id, input.voteId),
              eq(villageElderVote.status, "PENDING"),
            ),
          );
        if (claimResult.rowsAffected === 0) {
          return { success: true, message: "Kage removal vote already resolved" };
        }
        const voterIds = freshEntries.map((e) => e.userId);
        if (voterIds.length > 0) {
          await Promise.all([
            ctx.drizzle.insert(notification).values(
              voterIds.map((userId) => ({
                userId,
                content: `The vote to remove the Kage did not pass.`,
              })),
            ),
            ctx.drizzle
              .update(userData)
              .set({ unreadNotifications: sql`unreadNotifications + 1` })
              .where(inArray(userData.userId, voterIds)),
          ]);
        }
        return { success: true, message: "Kage removal vote failed" };
      }

      return {
        success: true,
        message: `Vote recorded. Current tally: ${yesCount} YES, ${noCount} NO`,
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
      updatedAt: true,
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
    return userElders[randomInt(userElders.length)];
  }
  return elders[randomInt(elders.length)];
};
