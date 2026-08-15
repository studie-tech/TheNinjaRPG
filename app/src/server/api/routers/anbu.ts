import type { inferRouterOutputs } from "@trpc/server";
import { and, count, eq, exists, gt, gte, isNull, lt, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  ANBU_DELAY_SECS,
  ANBU_ESPIONAGE_BASE_CHANCE_PERC,
  ANBU_ESPIONAGE_CHANGE_PER_LEVEL,
  ANBU_ESPIONAGE_POINTS_COST,
  ANBU_ESPIONAGE_PRESTIGE_COST,
  ANBU_ESPIONAGE_UPGRADE_COST,
  ANBU_LEADER_RANK_REQUIREMENT,
  ANBU_MAX_ESPIONAGE_LEVEL,
  ANBU_MAX_MEMBERS,
  ANBU_MAX_STEALTH_LEVEL,
  ANBU_MEMBER_RANK_REQUIREMENT,
  ANBU_STEALTH_UPGRADE_COST,
  IMG_AVATAR_DEFAULT,
  KAGE_ANBU_DELETE_COST,
  type UserRequestState,
} from "@/drizzle/constants";
import type { AnbuSquad } from "@/drizzle/schema";
import {
  anbuSquad,
  clan,
  historicalAvatar,
  userData,
  userRequest,
} from "@/drizzle/schema";
import { getServerPusher } from "@/libs/pusher";
import { hasRequiredRank } from "@/libs/train";
import { createConvo } from "@/routers/comments";
import { updateNindo } from "@/routers/profile";
import { fetchRequest, fetchRequests, insertRequest } from "@/routers/sparring";
import { fetchVillage } from "@/routers/village";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { isMysqlDuplicateKeyError } from "@/server/utils/mysqlErrors";
import { canEditClans } from "@/utils/permissions";
import { checkForBadWords } from "@/utils/profanity";
import { secondsFromDate, secondsFromNow } from "@/utils/time";
import { getEffectiveStructureLevel } from "@/utils/village";
import {
  anbuCreateSchema,
  anbuEditSchema,
  strictAnbuNameField,
} from "@/validators/anbu";

const pusher = getServerPusher();

export const anbuRouter = createTRPCRouter({
  get: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get ANBU squad details" } })
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      // Query
      const [user, squad] = await Promise.all([
        fetchAnbuActor({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchSquad(ctx.drizzle, input.id),
      ]);
      // Derived
      const { isKage, isElder, inSquad } = getConvenienceStatus(user, squad);
      // Hide orders if not kage or elder
      if (squad && !isKage && !isElder && !inSquad) {
        if (squad.kageOrder?.content) squad.kageOrder.content = "Hidden";
        if (squad.leaderOrder?.content) squad.leaderOrder.content = "Hidden";
      }
      // Guard
      if (
        squad &&
        user &&
        (squad.villageId === user.villageId || canEditClans(user.role))
      ) {
        return squad;
      }
      return null;
    }),
  getAll: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get all ANBU squads for village" } })
    .input(z.object({ villageId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Fetch
      const [user, squads] = await Promise.all([
        fetchAnbuActor({ client: ctx.drizzle, userId: ctx.userId }),
        fetchSquads(ctx.drizzle, input.villageId),
      ]);
      // Guard
      if (user && (user.villageId === input.villageId || canEditClans(user.role))) {
        return squads;
      }
      return null;
    }),
  getAllNames: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get all ANBU squad names" } })
    .query(async ({ ctx }) => {
      return await ctx.drizzle.query.anbuSquad.findMany({
        columns: { id: true, name: true, image: true },
      });
    }),
  getRequests: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get ANBU join requests" } })
    .input(z.object({ squadId: z.string().optional() }).optional())
    .query(getAnbuRequests),
  createRequest: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Request to join an ANBU squad" } })
    .input(z.object({ squadId: z.string() }))
    .output(baseServerResponse)
    .mutation(createAnbuRequest),
  rejectRequest: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Reject ANBU join request" } })
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(rejectAnbuRequest),
  cancelRequest: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Cancel ANBU join request" } })
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const request = await fetchRequest(ctx.drizzle, input.id, "ANBU");
      if (request.senderId !== ctx.userId) {
        return errorResponse("You can only cancel requests created by you");
      }
      if (request.status !== "PENDING") {
        return errorResponse("You can only cancel pending requests");
      }
      const [notifyUserId, cancelled] = await Promise.all([
        fetchAnbuRequestNotificationTarget(ctx.drizzle, request),
        transitionAnbuRequestState(ctx.drizzle, input.id, "PENDING", "CANCELLED"),
      ]);
      if (!cancelled) {
        return errorResponse("You can only cancel pending requests");
      }
      void pusher.trigger(notifyUserId, "event", { type: "anbu" });
      return { success: true, message: "Request cancelled" };
    }),
  acceptRequest: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Accept ANBU join request" } })
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(acceptAnbuRequest),
  createSquad: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Create new ANBU squad" } })
    .input(anbuCreateSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, leader, village, anbuCount] = await Promise.all([
        fetchAnbuActor({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchAnbuMember(ctx.drizzle, input.leaderId),
        fetchVillage(ctx.drizzle, input.villageId),
        countAnbuSquads(ctx.drizzle, input.villageId),
      ]);
      // Derived
      const villageId = village?.id;
      const { isKage, isElder } = getConvenienceStatus(user);
      const structure = village?.structures.find((s) => s.name === "ANBU");
      // Guards
      if (!user) return errorResponse("User not found");
      if (!leader) return errorResponse("Leader not found");
      if (!village) return errorResponse("Village not found");
      if (!structure) return errorResponse("ANBU hall not found");
      if (!isKage && !isElder) return errorResponse("Not kage or elder");
      if (villageId !== user.villageId) return errorResponse("Wrong user village");
      if (villageId !== leader.villageId) return errorResponse("Wrong leader village");
      if (anbuCount > getEffectiveStructureLevel(structure))
        return errorResponse("Max squads reached");
      if (leader.anbuId) return errorResponse("Leader already in a squad");
      if (leader.isAi) return errorResponse("AI cannot be leader");
      if (leader.userId === village.kageId) return errorResponse("Cannot choose kage");
      if (leader.rank === "ELDER") return errorResponse("Cannot choose elder");
      if (!hasRequiredRank(leader.rank, ANBU_LEADER_RANK_REQUIREMENT)) {
        return errorResponse("Leader rank too low");
      }
      const moderationResult = await checkForBadWords(input.name);
      if (!moderationResult.success) return moderationResult;
      // Mutate
      const anbuId = nanoid();
      const leaderClaim = await ctx.drizzle
        .update(userData)
        .set({ anbuId })
        .where(and(eq(userData.userId, leader.userId), isNull(userData.anbuId)));
      if (leaderClaim.rowsAffected === 0) {
        return errorResponse("Leader already in a squad");
      }
      try {
        await ctx.drizzle.insert(anbuSquad).values({
          id: anbuId,
          image: IMG_AVATAR_DEFAULT,
          villageId: village.id,
          name: input.name,
          leaderId: leader.userId,
          memberCount: 1,
          kageOrderId: nanoid(),
          leaderOrderId: nanoid(),
        });
      } catch (error) {
        await ctx.drizzle
          .update(userData)
          .set({ anbuId: null })
          .where(and(eq(userData.userId, leader.userId), eq(userData.anbuId, anbuId)));
        throw error;
      }
      // Create
      return { success: true, message: "Squad created" };
    }),
  disbandSquad: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Disband ANBU squad" } })
    .input(z.object({ squadId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, squad] = await Promise.all([
        fetchAnbuActor({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchSquadSummary(ctx.drizzle, input.squadId),
      ]);
      // Derived
      const { isKage, isElder } = getConvenienceStatus(user, squad);
      // Guards
      if (!squad) return errorResponse("Squad not found");
      if (!user) return errorResponse("User not found");
      if (user.villageId !== squad.villageId) return errorResponse("Wrong village");
      if (!isKage && !isElder) return errorResponse("Must be kage or elder");
      if (
        user.village &&
        secondsFromDate(ANBU_DELAY_SECS, user.village.leaderUpdatedAt) > new Date()
      ) {
        return errorResponse("Must have been kage for 5 days");
      }
      // Mutate
      await Promise.all([
        ctx.drizzle.delete(anbuSquad).where(eq(anbuSquad.id, squad.id)),
        ctx.drizzle
          .update(userData)
          .set({ anbuId: null })
          .where(eq(userData.anbuId, squad.id)),
        ...(isKage && user.village
          ? [
              ctx.drizzle
                .update(userData)
                .set({
                  villagePrestige: sql`${userData.villagePrestige} - ${KAGE_ANBU_DELETE_COST}`,
                })
                .where(eq(userData.userId, user.userId)),
            ]
          : []),
      ]);
      // Create
      return { success: true, message: "Squad disbanded" };
    }),
  editSquad: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Edit ANBU squad name and image" } })
    .input(anbuEditSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, squad, image, squadWithName] = await Promise.all([
        fetchAnbuMember(ctx.drizzle, ctx.userId),
        fetchSquadSummary(ctx.drizzle, input.squadId),
        ctx.drizzle.query.historicalAvatar.findFirst({
          where: eq(historicalAvatar.avatar, input.image),
        }),
        ctx.drizzle.query.anbuSquad.findFirst({
          columns: { name: true, id: true },
          where: eq(anbuSquad.name, input.name),
        }),
      ]);
      // Guards
      if (!squad) return errorResponse("Squad not found");
      if (!user) return errorResponse("User not found");
      if (!image) return errorResponse("Image not found");
      if (!image.avatar) return errorResponse("Image not found");
      if (squadWithName && squadWithName.id !== squad.id) {
        return errorResponse("Squad name already exists");
      }
      if (squad.leaderId !== user.userId) return errorResponse("Not squad leader");
      if (squad.villageId !== user.villageId) return errorResponse("Wrong village");
      if (user.anbuId !== squad.id) return errorResponse("Wrong squad");
      if (input.name !== squad.name) {
        const validated = strictAnbuNameField.safeParse(input.name);
        if (!validated.success) {
          return errorResponse(
            validated.error.issues[0]?.message ?? "Invalid squad name",
          );
        }
        const moderationResult = await checkForBadWords(input.name);
        if (!moderationResult.success) return moderationResult;
      }
      // Short-circuit no-op submits so PlanetScale's rowsAffected=0 on
      // unchanged UPDATE isn't misread as a concurrent-rename conflict.
      if (input.name === squad.name && image.avatar === squad.image) {
        return { success: true, message: "Squad unchanged" };
      }
      // Mutate (CAS on current name to avoid clobbering a concurrent rename)
      const result = await ctx.drizzle
        .update(anbuSquad)
        .set({ name: input.name, image: image.avatar })
        .where(and(eq(anbuSquad.id, squad.id), eq(anbuSquad.name, squad.name)));
      if (result.rowsAffected === 0) {
        return errorResponse("Squad was modified, please try again");
      }
      // Create
      return { success: true, message: "Squad name changed" };
    }),
  promoteMember: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Promote ANBU member to leader" } })
    .input(z.object({ squadId: z.string(), memberId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, squad, member] = await Promise.all([
        fetchAnbuActor({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchSquadSummary(ctx.drizzle, input.squadId),
        fetchAnbuMember(ctx.drizzle, input.memberId),
      ]);
      // Derived
      const { isKage, isElder } = getConvenienceStatus(user, squad);
      const canStaffEdit = user ? canEditClans(user.role) : false;
      // Guards
      if (!squad) return errorResponse("Squad not found");
      if (!user) return errorResponse("User not found");
      if (!member) return errorResponse("Member not found");
      if (!canStaffEdit && squad.villageId !== user.villageId) {
        return errorResponse("Wrong village");
      }
      if (!isKage && !isElder && !canStaffEdit) return errorResponse("Not allowed");
      if (member.rank === "ELDER") return errorResponse("Cannot promote elder");
      if (member.anbuId !== squad.id) return errorResponse("Not in ANBU");
      if (!hasRequiredRank(member.rank, ANBU_LEADER_RANK_REQUIREMENT)) {
        return errorResponse("Leader rank too low");
      }
      if (squad.leaderId === member.userId) {
        return { success: true, message: "Member is already the leader" };
      }
      // Mutate — promote leader and keep pending join requests attached to this squad
      const promoted = await promoteAnbuLeader(
        ctx.drizzle,
        squad.id,
        member.userId,
        squad.leaderId,
      );
      if (!promoted) {
        return errorResponse("Squad or member changed, please try again");
      }
      await reassignPendingAnbuRequestsOnPromotion(
        ctx.drizzle,
        squad.id,
        squad.leaderId,
        member.userId,
      );
      // Create
      return { success: true, message: "Member promoted to leader" };
    }),
  kickMember: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Kick member from ANBU squad" } })
    .input(z.object({ squadId: z.string(), memberId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, squad, member] = await Promise.all([
        fetchAnbuActor({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchSquadSummary(ctx.drizzle, input.squadId),
        fetchAnbuMember(ctx.drizzle, input.memberId),
      ]);
      // Derived
      const { isKage, isElder, isLeader } = getConvenienceStatus(user, squad);
      const canStaffEdit = user ? canEditClans(user.role) : false;
      // Guards
      if (!squad) return errorResponse("Squad not found");
      if (!user) return errorResponse("User not found");
      if (!member) return errorResponse("Member not found");
      if (!canStaffEdit && squad.villageId !== user.villageId) {
        return errorResponse("Wrong village");
      }
      if (!isLeader && !isElder && !isKage && !canStaffEdit) {
        return errorResponse("Not allowed");
      }
      if (member.anbuId !== squad.id) return errorResponse("Not in this squad");
      if (squad.memberCount <= 1) {
        return errorResponse("Cannot kick the last member. Use disband squad instead.");
      }

      // Mutate
      const removed = await removeFromSquad(ctx.drizzle, squad, member.userId);
      if (!removed) {
        return errorResponse("Cannot kick the last member. Use disband squad instead.");
      }
      // Create
      return { success: true, message: "Member kicked" };
    }),
  leaveSquad: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Leave ANBU squad" } })
    .input(z.object({ squadId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, squad] = await Promise.all([
        fetchAnbuMember(ctx.drizzle, ctx.userId),
        fetchSquadSummary(ctx.drizzle, input.squadId),
      ]);
      // Guards
      if (!user) return errorResponse("User not found");
      if (!squad) return errorResponse("Squad not found");
      if (user.villageId !== squad.villageId) return errorResponse("Wrong village");
      if (!user.anbuId) return errorResponse("Not in a squad");
      if (user.anbuId !== squad.id) return errorResponse("Wrong squad");
      if (squad.memberCount <= 1) {
        return errorResponse("Cannot leave as the last member. Disband squad instead.");
      }
      // Derived
      const removed = await removeFromSquad(ctx.drizzle, squad, user.userId);
      if (!removed) {
        return errorResponse("Cannot leave as the last member. Disband squad instead.");
      }
      // Create
      return { success: true, message: "User left squad" };
    }),
  upsertNotice: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Update ANBU squad notice" } })
    .input(
      z.object({
        content: z.string(),
        squadId: z.string(),
        type: z.enum(["KAGE", "LEADER"]),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, squad] = await Promise.all([
        fetchAnbuActor({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchSquadSummary(ctx.drizzle, input.squadId),
      ]);
      // Derived
      const { isKage, isElder, isLeader, village } = getConvenienceStatus(user, squad);
      // Guards
      if (!user) return errorResponse("User not found");
      if (user.isBanned) return errorResponse("User is banned");
      if (user.isSilenced) return errorResponse("User is silenced");
      if (!squad) return errorResponse("Squad not found");
      if (!village) return errorResponse("Village not found");
      if (input.type === "KAGE") {
        if (!isKage && !isElder) return errorResponse("Not allowed");
      } else if (input.type === "LEADER") {
        if (!isLeader) return errorResponse("Not allowed");
      }
      const orderId = input.type === "KAGE" ? squad.kageOrderId : squad.leaderOrderId;
      // Update
      return updateNindo(ctx.drizzle, orderId, input.content, "anbuOrder");
    }),
  purchaseEspionageUpgrade: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Upgrade squad espionage level" } })
    .input(z.object({ squadId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, squad] = await Promise.all([
        fetchAnbuActor({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchSquadSummary(ctx.drizzle, input.squadId),
      ]);
      // Derived
      const { isLeader } = getConvenienceStatus(user, squad);
      // Guards
      if (!user) return errorResponse("User not found");
      if (!squad) return errorResponse("Squad not found");
      if (!isLeader) return errorResponse("Not squad leader");
      if (user.anbuId !== squad.id) return errorResponse("Not in this squad");
      if (squad.points < ANBU_ESPIONAGE_UPGRADE_COST) {
        return errorResponse("Not enough squad points");
      }
      if (squad.espionageLevel >= ANBU_MAX_ESPIONAGE_LEVEL) {
        return errorResponse("Max espionage level reached");
      }
      // Mutate
      const result = await ctx.drizzle
        .update(anbuSquad)
        .set({
          espionageLevel: sql`${anbuSquad.espionageLevel} + 1`,
          points: sql`${anbuSquad.points} - ${ANBU_ESPIONAGE_UPGRADE_COST}`,
        })
        .where(
          and(
            eq(anbuSquad.id, squad.id),
            gte(anbuSquad.points, ANBU_ESPIONAGE_UPGRADE_COST),
          ),
        );
      if (result.rowsAffected === 0) {
        return { success: false, message: "Not enough squad points" };
      }
      return { success: true, message: "Espionage level upgraded" };
    }),
  purchaseStealthUpgrade: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Upgrade squad stealth level" } })
    .input(z.object({ squadId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, squad] = await Promise.all([
        fetchAnbuActor({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchSquadSummary(ctx.drizzle, input.squadId),
      ]);
      // Derived
      const { isLeader } = getConvenienceStatus(user, squad);
      // Guards
      if (!user) return errorResponse("User not found");
      if (!squad) return errorResponse("Squad not found");
      if (!isLeader) return errorResponse("Not squad leader");
      if (user.anbuId !== squad.id) return errorResponse("Not in this squad");
      if (squad.points < ANBU_STEALTH_UPGRADE_COST) {
        return errorResponse("Not enough squad points");
      }
      if (squad.stealthLevel >= ANBU_MAX_STEALTH_LEVEL) {
        return errorResponse("Max stealth level reached");
      }
      // Mutate
      const result = await ctx.drizzle
        .update(anbuSquad)
        .set({
          stealthLevel: sql`${anbuSquad.stealthLevel} + 1`,
          points: sql`${anbuSquad.points} - ${ANBU_STEALTH_UPGRADE_COST}`,
        })
        .where(
          and(
            eq(anbuSquad.id, squad.id),
            gte(anbuSquad.points, ANBU_STEALTH_UPGRADE_COST),
          ),
        );
      if (result.rowsAffected === 0) {
        return { success: false, message: "Not enough squad points" };
      }
      return { success: true, message: "Stealth level upgraded" };
    }),
  performEspionage: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Perform espionage on enemy village" } })
    .input(z.object({ villageId: z.string(), anbuId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, targetVillage, userSquad] = await Promise.all([
        fetchAnbuActor({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchVillage(ctx.drizzle, input.villageId),
        fetchEspionageSquad(ctx.drizzle, input.anbuId),
      ]);

      // Derived
      // Guards
      if (!user) return errorResponse("User not found");
      if (!targetVillage) return errorResponse("Target village not found");
      if (!userSquad) return errorResponse("ANBU squad not found");
      if (user.anbuId !== input.anbuId) {
        return errorResponse("You don't belong to this ANBU squad");
      }
      if (user.villageId === targetVillage.id) {
        return errorResponse("Cannot spy on your own village");
      }
      if (user.villagePrestige < ANBU_ESPIONAGE_PRESTIGE_COST) {
        return errorResponse("Not enough village prestige");
      }
      if (userSquad.points < ANBU_ESPIONAGE_POINTS_COST) {
        return errorResponse("ANBU squad doesn't have enough points");
      }

      // Calculate success chance
      const successChance =
        ANBU_ESPIONAGE_BASE_CHANCE_PERC +
        userSquad.espionageLevel * ANBU_ESPIONAGE_CHANGE_PER_LEVEL;

      const rollResult = Math.random() * 100;
      const success = rollResult < successChance;

      // Deduct costs regardless of success
      await Promise.all([
        ctx.drizzle
          .update(userData)
          .set({
            villagePrestige: sql`${userData.villagePrestige} - ${ANBU_ESPIONAGE_PRESTIGE_COST}`,
          })
          .where(eq(userData.userId, user.userId)),
        ctx.drizzle
          .update(anbuSquad)
          .set({
            points: sql`${anbuSquad.points} - ${ANBU_ESPIONAGE_POINTS_COST}`,
          })
          .where(eq(anbuSquad.id, userSquad.id)),
      ]);

      if (!success) {
        return { success: false, message: "Espionage mission failed" };
      }

      // Gather intelligence on target village
      const [anbuSquadCount, clanCount] = await Promise.all([
        countAnbuSquads(ctx.drizzle, targetVillage.id),
        countVillageClans(ctx.drizzle, targetVillage.id),
      ]);

      // Create intelligence report
      const structureReportHtml = targetVillage.structures
        .map((structure) => {
          const healthPercentage = Math.round(
            (structure.curSp / structure.maxSp) * 100,
          );
          return `<li>${structure.name} (Level ${getEffectiveStructureLevel(structure)}) - ${healthPercentage}% Health</li>`;
        })
        .join("");

      const intelligenceReport = `
<div>
  <h2 style="margin-bottom:0.5em;">📋 <strong>ESPIONAGE REPORT - ${targetVillage.name}</strong></h2>
  <section style="margin-bottom:1em;">
  <br />
    <h3 style="margin-bottom:0.25em;">🏰 <strong>Village Status:</strong></h3>
    <ul style="margin:0 0 0 1em; padding:0;">
      <li>Village Tokens: <strong>${targetVillage.tokens.toLocaleString()}</strong></li>
      <li>ANBU Squads: <strong>${anbuSquadCount}</strong></li>
      <li>Active Clans: <strong>${clanCount}</strong></li>
    </ul>
  </section>
  <section style="margin-bottom:1em;">
  <br />
    <h3 style="margin-bottom:0.25em;">🏗️ <strong>Structure Status:</strong></h3>
    <ul style="margin:0 0 0 1em; padding:0;">
      ${structureReportHtml}
    </ul>
  </section>
  <br />
  <hr style="margin:1em 0;" />
  <br />
  <div style="font-size:0.95em; color:#555;">
    <em>Intelligence gathered by ${user.username}<br/>
    Mission conducted with ${successChance}% success rate</em>
    <p style="margin-top:0.5em;">
      This information is classified ANBU-only. Share at your own discretion with the village.
    </p>
  </div>
</div>
      `.trim();

      // Send message to all ANBU squad members
      const squadMemberIds = userSquad.members.map((member) => member.userId);
      await createConvo({
        client: ctx.drizzle,
        authorUserId: ctx.userId,
        senderUserId: ctx.userId,
        receiverUserIds: squadMemberIds.filter((id) => id !== ctx.userId),
        title: `🕵️ Espionage Report: ${targetVillage.name}`,
        content: intelligenceReport,
      });

      return {
        success: true,
        message: "Espionage mission successful - intelligence report sent to squad",
      };
    }),
});

type AnbuRequestContext = { drizzle: DrizzleClient; userId: string };

/**
 * Returns the ANBU join requests visible to the current user.
 * Managers receive every request linked to the selected squad, applicants
 * receive only their own request for that squad, and ordinary members receive
 * no request data. Without a squad filter, the caller's requests are returned.
 * @param args - Authenticated request context and optional squad filter.
 * @returns The requests the caller is authorized to view.
 */
export async function getAnbuRequests(args: {
  ctx: AnbuRequestContext;
  input?: { squadId?: string };
}) {
  const { ctx, input } = args;
  if (input?.squadId) {
    const squadId = input.squadId;
    const [user, squad] = await Promise.all([
      fetchAnbuActor({ client: ctx.drizzle, userId: ctx.userId }),
      fetchSquadSummary(ctx.drizzle, squadId),
    ]);
    if (!user || !squad) return [];
    const { isLeader, isKageOfSquadVillage, isElderOfSquadVillage } =
      getConvenienceStatus(user, squad);
    if (
      isLeader ||
      isKageOfSquadVillage ||
      isElderOfSquadVillage ||
      canEditClans(user.role)
    ) {
      return fetchRequests(ctx.drizzle, ["ANBU"], 3600 * 12, undefined, squadId);
    }
    if (user.anbuId) return [];
    const ownRequests = await fetchRequests(
      ctx.drizzle,
      ["ANBU"],
      3600 * 12,
      ctx.userId,
    );
    return ownRequests.filter(
      (request) =>
        request.senderId === ctx.userId &&
        isAnbuRequestForSquad(request, squadId, squad.leaderId),
    );
  }
  return fetchRequests(ctx.drizzle, ["ANBU"], 3600 * 12, ctx.userId);
}

/**
 * Creates a request to join an ANBU squad after validating village, rank, and
 * membership rules. Expired pending requests are cancelled before insertion,
 * while the database uniqueness constraint closes concurrent duplicate sends.
 *
 * @param args - Authenticated request context and target squad ID.
 * @returns A success response or a user-facing validation failure.
 */
export async function createAnbuRequest(args: {
  ctx: AnbuRequestContext;
  input: { squadId: string };
}) {
  const { ctx, input } = args;
  const [user, squad, pendingRequest] = await Promise.all([
    fetchAnbuActor({ client: ctx.drizzle, userId: ctx.userId }),
    fetchSquadSummary(ctx.drizzle, input.squadId),
    fetchRecentPendingAnbuRequest(ctx.drizzle, ctx.userId),
  ]);
  const { isKage, isElder } = getConvenienceStatus(user, squad);
  if (!squad) return errorResponse("Squad not found");
  if (!user) return errorResponse("User not found");
  if (user.villageId !== squad.villageId) return errorResponse("Wrong village");
  if (user.anbuId) return errorResponse("Already in a squad");
  if (isKage || isElder) return errorResponse("Kage or elder cannot join");
  if (pendingRequest) {
    return errorResponse("You already have a pending ANBU request");
  }
  if (!hasRequiredRank(user.rank, ANBU_MEMBER_RANK_REQUIREMENT)) {
    return errorResponse(`Rank must be at least ${ANBU_MEMBER_RANK_REQUIREMENT}`);
  }
  const receiverId = squad.leaderId ?? user.village?.kageId;
  if (!receiverId) {
    return errorResponse("No leader or kage available to receive request");
  }
  await ctx.drizzle
    .update(userRequest)
    .set({ status: "CANCELLED" })
    .where(
      and(
        eq(userRequest.senderId, user.userId),
        eq(userRequest.type, "ANBU"),
        eq(userRequest.status, "PENDING"),
        lt(userRequest.createdAt, secondsFromNow(-3600 * 12)),
      ),
    );
  try {
    await insertRequest(
      ctx.drizzle,
      user.userId,
      receiverId,
      "ANBU",
      undefined,
      squad.id,
    );
  } catch (error) {
    if (isMysqlDuplicateKeyError(error)) {
      return errorResponse("You already have a pending ANBU request");
    }
    throw error;
  }
  void pusher.trigger(receiverId, "event", { type: "anbu" });
  return { success: true, message: "Request to join squad sent" };
}

/**
 * Accepts a pending ANBU join request with compare-and-swap guards for the
 * request state, squad capacity, and requester membership. Failed claims are
 * compensated so concurrent accepts cannot overfill a squad or strand state.
 * Eligible members may atomically claim leadership of a leaderless squad.
 *
 * @param args - Authenticated request context and request ID to accept.
 * @returns A success response or the reason the request could not be accepted.
 */
export async function acceptAnbuRequest(args: {
  ctx: AnbuRequestContext;
  input: { id: string };
}) {
  const { ctx, input } = args;
  const [request, user] = await Promise.all([
    fetchRequest(ctx.drizzle, input.id, "ANBU"),
    fetchAnbuActor({ client: ctx.drizzle, userId: ctx.userId }),
  ]);
  const [squad, requester] = await Promise.all([
    fetchSquadForAnbuRequest(ctx.drizzle, request),
    fetchAnbuMember(ctx.drizzle, request.senderId),
  ]);
  const { isLeader, isKageOfSquadVillage, isElderOfSquadVillage } =
    getConvenienceStatus(user, squad);
  const canStaffEdit = user ? canEditClans(user.role) : false;
  if (!squad) return errorResponse("Squad not found");
  if (!user) return errorResponse("User not found");
  if (!requester) return errorResponse("Requester not found");
  if (!isLeader && !isKageOfSquadVillage && !isElderOfSquadVillage && !canStaffEdit) {
    return errorResponse("Not allowed");
  }
  if (request.status !== "PENDING") {
    return errorResponse("You can only accept pending requests");
  }
  if (requester.anbuId) return errorResponse("Requester already in a squad");
  if (requester.villageId !== squad.villageId) return errorResponse("!= village");
  if (!hasRequiredRank(requester.rank, ANBU_MEMBER_RANK_REQUIREMENT)) {
    return errorResponse(`Rank must be at least ${ANBU_MEMBER_RANK_REQUIREMENT}`);
  }
  const claimRequest = await transitionAnbuRequestState(
    ctx.drizzle,
    input.id,
    "PENDING",
    "ACCEPTED",
  );
  if (!claimRequest) {
    return errorResponse("You can only accept pending requests");
  }
  const capacityClaim = await ctx.drizzle
    .update(anbuSquad)
    .set({ memberCount: sql`${anbuSquad.memberCount} + 1` })
    .where(
      and(eq(anbuSquad.id, squad.id), lt(anbuSquad.memberCount, ANBU_MAX_MEMBERS)),
    );
  if (capacityClaim.rowsAffected === 0) {
    await transitionAnbuRequestState(ctx.drizzle, input.id, "ACCEPTED", "PENDING");
    return errorResponse("Squad is full");
  }
  const joinResult = await ctx.drizzle
    .update(userData)
    .set({ anbuId: squad.id })
    .where(and(eq(userData.userId, requester.userId), isNull(userData.anbuId)));
  if (joinResult.rowsAffected === 0) {
    await Promise.all([
      releaseAnbuCapacity(ctx.drizzle, squad.id),
      transitionAnbuRequestState(ctx.drizzle, input.id, "ACCEPTED", "PENDING"),
    ]);
    return errorResponse("Requester already in a squad");
  }
  if (
    !squad.leaderId &&
    hasRequiredRank(requester.rank, ANBU_LEADER_RANK_REQUIREMENT)
  ) {
    const leaderClaim = await ctx.drizzle
      .update(anbuSquad)
      .set({ leaderId: requester.userId })
      .where(and(eq(anbuSquad.id, squad.id), isNull(anbuSquad.leaderId)));
    if (leaderClaim.rowsAffected === 1) {
      await reassignPendingAnbuRequestsOnPromotion(
        ctx.drizzle,
        squad.id,
        null,
        requester.userId,
      );
    }
  }
  void pusher.trigger(request.senderId, "event", { type: "anbu" });
  return { success: true, message: "Request accepted" };
}

/**
 * Rejects a pending ANBU join request after confirming the caller manages the
 * request's squad. The state transition is compare-and-swap guarded so a
 * concurrent accept, reject, or cancellation cannot be overwritten.
 *
 * @param args - Authenticated request context and request ID to reject.
 * @returns A success response or the reason the request could not be rejected.
 */
export async function rejectAnbuRequest(args: {
  ctx: AnbuRequestContext;
  input: { id: string };
}) {
  const { ctx, input } = args;
  const [request, user] = await Promise.all([
    fetchRequest(ctx.drizzle, input.id, "ANBU"),
    fetchAnbuActor({ client: ctx.drizzle, userId: ctx.userId }),
  ]);
  const squad = await fetchSquadForAnbuRequest(ctx.drizzle, request);
  if (!squad) {
    return errorResponse("Squad not found");
  }
  const { isLeader, isKageOfSquadVillage, isElderOfSquadVillage } =
    getConvenienceStatus(user, squad);
  const canStaffEdit = user ? canEditClans(user.role) : false;
  if (!isLeader && !isKageOfSquadVillage && !isElderOfSquadVillage && !canStaffEdit) {
    return errorResponse("Not allowed to reject this request");
  }
  if (request.status !== "PENDING") {
    return errorResponse("You can only reject pending requests");
  }
  const rejected = await transitionAnbuRequestState(
    ctx.drizzle,
    input.id,
    "PENDING",
    "REJECTED",
  );
  if (!rejected) {
    return errorResponse("You can only reject pending requests");
  }
  void pusher.trigger(request.senderId, "event", { type: "anbu" });
  return { success: true, message: "Request rejected" };
}

/**
 * Removes a user from an ANBU squad. If the removed user was the leader,
 * leadership transfers to the next eligible member (or null) and pending join
 * requests are reassigned so the new leader can see/process them.
 *
 * @param client - The DrizzleClient instance used for database operations.
 * @param squad - The ANBU squad from which the user will be removed.
 * @param userId - The ID of the user to be removed from the squad.
 */
export const removeFromSquad = async (
  client: DrizzleClient,
  squad: { id: string },
  userId: string,
) => {
  // Reserve the removal first. Concurrent removals can decrement only to one,
  // making the last-member invariant atomic rather than snapshot-based.
  const capacityRelease = await client
    .update(anbuSquad)
    .set({ memberCount: sql`${anbuSquad.memberCount} - 1` })
    .where(and(eq(anbuSquad.id, squad.id), gt(anbuSquad.memberCount, 1)));
  if (capacityRelease.rowsAffected === 0) return false;

  const memberRemoval = await client
    .update(userData)
    .set({ anbuId: null })
    .where(and(eq(userData.userId, userId), eq(userData.anbuId, squad.id)));
  if (memberRemoval.rowsAffected === 0) {
    await client
      .update(anbuSquad)
      .set({ memberCount: sql`${anbuSquad.memberCount} + 1` })
      .where(eq(anbuSquad.id, squad.id));
    return false;
  }

  // Clear leadership even if a concurrent promotion made this member leader
  // after the caller's squad snapshot was read.
  const clearedLeadership = await client
    .update(anbuSquad)
    .set({ leaderId: null })
    .where(and(eq(anbuSquad.id, squad.id), eq(anbuSquad.leaderId, userId)));
  if (clearedLeadership.rowsAffected === 1) {
    const nextLeaderId = await electAnbuLeader(client, squad.id);
    await reassignPendingAnbuRequestsOnPromotion(
      client,
      squad.id,
      userId,
      nextLeaderId,
    );
  }

  return true;
};

/**
 * Atomically promotes a squad member while verifying both the candidate's live
 * membership and the expected outgoing leader. This prevents a stale caller
 * from installing a departed member or overwriting a concurrent promotion.
 *
 * @param client - The Drizzle client used for the guarded update.
 * @param squadId - The squad whose leadership should change.
 * @param memberId - The live squad member to promote.
 * @param expectedLeaderId - The leader that must still be installed, or null for a leaderless squad.
 * @returns Whether this caller won the leadership compare-and-swap.
 */
export const promoteAnbuLeader = async (
  client: DrizzleClient,
  squadId: string,
  memberId: string,
  expectedLeaderId: string | null,
) => {
  const expectedLeader = expectedLeaderId
    ? eq(anbuSquad.leaderId, expectedLeaderId)
    : isNull(anbuSquad.leaderId);
  const liveMembership = client
    .select({ userId: userData.userId })
    .from(userData)
    .where(and(eq(userData.userId, memberId), eq(userData.anbuId, squadId)));
  const result = await client
    .update(anbuSquad)
    .set({ leaderId: memberId })
    .where(and(eq(anbuSquad.id, squadId), expectedLeader, exists(liveMembership)));
  return result.rowsAffected === 1;
};

/**
 * Elects a deterministic successor for a leaderless squad. Candidates are
 * loaded from current memberships, filtered by the leader rank requirement,
 * and attempted in user-ID order using the guarded promotion helper.
 *
 * @param client - The Drizzle client used to load and promote members.
 * @param squadId - The leaderless squad that needs a successor.
 * @returns The promoted user's ID, or null when no eligible member can be claimed.
 */
export const electAnbuLeader = async (client: DrizzleClient, squadId: string) => {
  const members = await client.query.userData.findMany({
    columns: { userId: true, rank: true },
    where: eq(userData.anbuId, squadId),
  });
  const candidates = members
    .filter((member) => hasRequiredRank(member.rank, ANBU_LEADER_RANK_REQUIREMENT))
    .sort((a, b) => a.userId.localeCompare(b.userId));
  for (const candidate of candidates) {
    if (await promoteAnbuLeader(client, squadId, candidate.userId, null)) {
      return candidate.userId;
    }
  }
  return null;
};

/**
 * Changes an ANBU request state only when its current state matches the
 * caller's expectation. The compare-and-swap prevents concurrent request
 * actions from overwriting whichever action completed first.
 *
 * @param client - The Drizzle client used for the update.
 * @param requestId - The ANBU request to transition.
 * @param from - The state that must still be present.
 * @param to - The state to store when the comparison succeeds.
 * @returns Whether exactly one request was transitioned.
 */
const transitionAnbuRequestState = async (
  client: DrizzleClient,
  requestId: string,
  from: UserRequestState,
  to: UserRequestState,
) => {
  const result = await client
    .update(userRequest)
    .set({ status: to })
    .where(
      and(
        eq(userRequest.id, requestId),
        eq(userRequest.type, "ANBU"),
        eq(userRequest.status, from),
      ),
    );
  return result.rowsAffected === 1;
};

/**
 * Compensates a previously reserved squad slot without allowing the persisted
 * member count to become negative.
 *
 * @param client - The Drizzle client used for the counter update.
 * @param squadId - The squad whose reserved slot should be released.
 * @returns The result of the member-count update.
 */
const releaseAnbuCapacity = async (client: DrizzleClient, squadId: string) =>
  client
    .update(anbuSquad)
    .set({ memberCount: sql`GREATEST(${anbuSquad.memberCount} - 1, 0)` })
    .where(eq(anbuSquad.id, squadId));

/**
 * Resolves the user who should be notified when an applicant cancels a join
 * request. Requests linked to a squad use its current leader; legacy requests
 * and leaderless squads fall back to the receiver stored on the request.
 *
 * @param client - The Drizzle client used for the minimal leader lookup.
 * @param request - The request's durable squad link and legacy receiver.
 * @returns The user ID that should receive the ANBU update event.
 */
const fetchAnbuRequestNotificationTarget = async (
  client: DrizzleClient,
  request: { relatedId: string | null; receiverId: string },
) => {
  if (!request.relatedId) return request.receiverId;
  const squad = await client.query.anbuSquad.findFirst({
    columns: { leaderId: true },
    where: eq(anbuSquad.id, request.relatedId),
  });
  return squad?.leaderId ?? request.receiverId;
};

/**
 * Loads only the user and village fields used by ANBU authorization and
 * mutations. This avoids the regeneration, settings, wars, raids, and other
 * unrelated queries performed by the full profile refresh helper.
 *
 * @param client - The Drizzle client used for the focused actor lookup.
 * @param userId - The authenticated user's ID.
 * @returns The focused user and village state, or undefined when not found.
 */
const fetchAnbuActor = async ({
  client,
  userId,
}: {
  client: DrizzleClient;
  userId: string;
}) => {
  return client.query.userData.findFirst({
    columns: {
      userId: true,
      username: true,
      villageId: true,
      villagePrestige: true,
      anbuId: true,
      rank: true,
      role: true,
      isBanned: true,
      isSilenced: true,
    },
    with: {
      village: {
        columns: { id: true, kageId: true, leaderUpdatedAt: true },
      },
    },
    where: eq(userData.userId, userId),
  });
};

type AnbuActor = Awaited<ReturnType<typeof fetchAnbuActor>>;

/**
 * Loads only the identity, village, rank, and membership fields used when an
 * ANBU handler validates a leader, member, applicant, or departing user.
 *
 * @param client - The Drizzle client used for the focused member lookup.
 * @param userId - The user whose ANBU eligibility should be checked.
 * @returns The required user fields, or undefined when the user is missing.
 */
const fetchAnbuMember = async (client: DrizzleClient, userId: string) =>
  client.query.userData.findFirst({
    columns: {
      userId: true,
      villageId: true,
      anbuId: true,
      rank: true,
      isAi: true,
    },
    where: eq(userData.userId, userId),
  });

/**
 * Checks for a recent pending ANBU application using a single-column result
 * instead of loading request participants and their village relations.
 *
 * @param client - The Drizzle client used for the pending-request lookup.
 * @param senderId - The applicant whose pending request should be checked.
 * @returns The matching request ID, or undefined when no recent request exists.
 */
const fetchRecentPendingAnbuRequest = async (client: DrizzleClient, senderId: string) =>
  client.query.userRequest.findFirst({
    columns: { id: true },
    where: and(
      eq(userRequest.pendingAnbuSenderId, senderId),
      gt(userRequest.createdAt, secondsFromNow(-3600 * 12)),
    ),
  });

/**
 * Fetches a squad's scalar state without hydrating its leader, members, or
 * order relations. Mutation and authorization paths should use this snapshot
 * when they do not return the full squad payload.
 *
 * @param client - The Drizzle client used for the squad lookup.
 * @param squadId - The squad ID to load.
 * @returns The squad's persisted scalar fields, or undefined when not found.
 */
const fetchSquadSummary = async (client: DrizzleClient, squadId: string) =>
  client.query.anbuSquad.findFirst({
    where: eq(anbuSquad.id, squadId),
  });

/**
 * Loads the minimal squad payload needed to charge and report an espionage
 * mission, including only member IDs for the report recipients.
 *
 * @param client - The Drizzle client used for the espionage squad lookup.
 * @param squadId - The acting squad's ID.
 * @returns Focused squad state and member IDs, or undefined when not found.
 */
const fetchEspionageSquad = async (client: DrizzleClient, squadId: string) =>
  client.query.anbuSquad.findFirst({
    columns: { id: true, points: true, espionageLevel: true },
    with: { members: { columns: { userId: true } } },
    where: eq(anbuSquad.id, squadId),
  });

/**
 * Counts squads in a village without loading their leaders and members.
 *
 * @param client - The Drizzle client used for the aggregate query.
 * @param villageId - The village whose squads should be counted.
 * @returns The number of ANBU squads assigned to the village.
 */
const countAnbuSquads = async (client: DrizzleClient, villageId: string) => {
  const rows = await client
    .select({ count: count() })
    .from(anbuSquad)
    .where(eq(anbuSquad.villageId, villageId));
  return rows[0]?.count ?? 0;
};

/**
 * Counts clans in a village without hydrating their leaders, founders,
 * members, or village relation for an espionage report.
 *
 * @param client - The Drizzle client used for the aggregate query.
 * @param villageId - The village whose clans should be counted.
 * @returns The number of clans assigned to the village.
 */
const countVillageClans = async (client: DrizzleClient, villageId: string) => {
  const rows = await client
    .select({ count: count() })
    .from(clan)
    .where(eq(clan.villageId, villageId));
  return rows[0]?.count ?? 0;
};

/**
 * Retrieves the convenience status of a user in an Anbu squad.
 * @param user - The user object with relations.
 * @param squad - The Anbu squad object.
 * @returns An object containing convenience status properties.
 */
const getConvenienceStatus = (
  user: AnbuActor,
  squad: Pick<AnbuSquad, "id" | "leaderId" | "villageId"> | null = null,
) => {
  const isKage = user?.userId === user?.village?.kageId;
  const isElder = user?.rank === "ELDER";
  const inSquad = user?.anbuId === squad?.id;
  const isLeader = inSquad && user?.userId === squad?.leaderId;
  const village = user?.village;
  // Kage of / elder in the village that owns this squad (distinct from `isKage` /
  // `isElder`, which only check the user against their own village/rank).
  const isKageOfSquadVillage = !!squad && isKage && user?.villageId === squad.villageId;
  const isElderOfSquadVillage =
    !!squad && isElder && user?.villageId === squad.villageId;
  return {
    isKage,
    isElder,
    isLeader,
    inSquad,
    village,
    isKageOfSquadVillage,
    isElderOfSquadVillage,
  };
};

/**
 * Fetches squads based on the provided village ID.
 * @param client - The DrizzleClient instance used for querying.
 * @param villageId - The ID of the village to fetch squads for.
 * @returns A promise that resolves to an array of squads.
 */
export const fetchSquads = async (client: DrizzleClient, villageId: string) => {
  return await client.query.anbuSquad.findMany({
    with: {
      leader: {
        columns: {
          userId: true,
          username: true,
          level: true,
          rank: true,
          avatar: true,
          avatarLight: true,
        },
      },
      members: {
        columns: {
          userId: true,
          username: true,
          level: true,
          rank: true,
          avatar: true,
          avatarLight: true,
        },
      },
    },
    where: eq(anbuSquad.villageId, villageId),
  });
};

/**
 * Fetches a squad from the database based on the squad ID.
 *
 * @param  client - The Drizzle client used to query the database.
 * @param  squadId - The ID of the squad to fetch.
 * @returns - A promise that resolves to the fetched squad, or null if not found.
 */
export const fetchSquad = async (client: DrizzleClient, squadId: string) => {
  return await client.query.anbuSquad.findFirst({
    with: {
      leader: {
        columns: {
          userId: true,
          username: true,
          level: true,
          rank: true,
          avatar: true,
          avatarLight: true,
        },
      },
      members: {
        columns: {
          userId: true,
          username: true,
          level: true,
          rank: true,
          avatar: true,
          avatarLight: true,
          pvpActivity: true,
        },
      },
      kageOrder: true,
      leaderOrder: true,
    },
    where: eq(anbuSquad.id, squadId),
  });
};

/**
 * Determines whether an ANBU join request belongs to a squad. The durable
 * related ID is authoritative; the current leader is considered only for
 * legacy requests created before squad IDs were persisted.
 *
 * @param request - The request's durable squad link and legacy receiver.
 * @param squadId - The squad being matched.
 * @param leaderId - The squad's current leader, when one exists.
 * @returns Whether the request belongs to the supplied squad.
 */
export const isAnbuRequestForSquad = (
  request: { relatedId: string | null; receiverId: string },
  squadId: string,
  leaderId: string | null,
) =>
  request.relatedId === squadId ||
  (!request.relatedId && !!leaderId && request.receiverId === leaderId);

/**
 * Fetches the squad targeted by an ANBU join request. Modern requests resolve
 * directly through their durable related ID; legacy requests fall back to the
 * squad currently led by the stored receiver.
 *
 * @param client - The Drizzle client used to fetch the squad.
 * @param request - The request's durable squad link and legacy receiver.
 * @returns The matching squad, or null when no squad can be resolved.
 */
export const fetchSquadForAnbuRequest = async (
  client: DrizzleClient,
  request: { relatedId: string | null; receiverId: string },
) => {
  if (request.relatedId) {
    return await fetchSquadSummary(client, request.relatedId);
  }
  return await fetchSquadByLeader(client, request.receiverId);
};

/**
 * Repairs pending request routing after a squad leadership change. Every
 * matching request receives the durable squad ID, and requests are redirected
 * to the successor when one exists. Leaderless squads retain the old receiver
 * only as a notification fallback.
 *
 * @param client - The Drizzle client used to update pending requests.
 * @param squadId - The durable squad ID to attach to matching requests.
 * @param oldLeaderId - The former leader used to identify unlinked legacy requests.
 * @param newLeaderId - The successor who should receive requests, or null when leaderless.
 * @returns The result of the pending-request update.
 */
export const reassignPendingAnbuRequestsOnPromotion = async (
  client: DrizzleClient,
  squadId: string,
  oldLeaderId: string | null,
  newLeaderId: string | null,
) => {
  return await client
    .update(userRequest)
    .set({
      ...(newLeaderId ? { receiverId: newLeaderId } : {}),
      relatedId: squadId,
    })
    .where(
      and(
        eq(userRequest.type, "ANBU"),
        eq(userRequest.status, "PENDING"),
        or(
          eq(userRequest.relatedId, squadId),
          ...(oldLeaderId
            ? [
                and(
                  isNull(userRequest.relatedId),
                  eq(userRequest.receiverId, oldLeaderId),
                ),
              ]
            : []),
        ),
      ),
    );
};

/**
 * Fetches a squad's scalar state by leader ID without loading relations.
 * @param client - The Drizzle client instance.
 * @param leaderId - The ID of the squad leader.
 * @returns - A promise that resolves to the squad details.
 */
export const fetchSquadByLeader = async (client: DrizzleClient, leaderId: string) => {
  return await client.query.anbuSquad.findFirst({
    where: eq(anbuSquad.leaderId, leaderId),
  });
};

export type AnbuRouter = inferRouterOutputs<typeof anbuRouter>;
