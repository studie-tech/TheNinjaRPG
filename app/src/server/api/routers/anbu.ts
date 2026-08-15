import type { inferRouterOutputs } from "@trpc/server";
import { and, eq, gt, gte, isNull, lt, or, sql } from "drizzle-orm";
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
import { anbuSquad, historicalAvatar, userData, userRequest } from "@/drizzle/schema";
import { getServerPusher } from "@/libs/pusher";
import { hasRequiredRank } from "@/libs/train";
import { fetchClans } from "@/routers/clan";
import { createConvo } from "@/routers/comments";
import type { UserWithRelations } from "@/routers/profile";
import { fetchUpdatedUser, fetchUser, updateNindo } from "@/routers/profile";
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
      const [updatedUser, squad] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchSquad(ctx.drizzle, input.id),
      ]);
      // Derived
      const { user } = updatedUser;
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
        fetchUser(ctx.drizzle, ctx.userId),
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
    .query(async ({ ctx, input }) => {
      // When viewing a specific squad, leaders and village kage see that squad's requests
      if (input?.squadId) {
        const squadId = input.squadId;
        const [updatedUser, squad, ownRequests, squadRequests] = await Promise.all([
          fetchUpdatedUser({
            client: ctx.drizzle,
            userId: ctx.userId,
          }),
          fetchSquad(ctx.drizzle, squadId),
          fetchRequests(ctx.drizzle, ["ANBU"], 3600 * 12, ctx.userId),
          fetchRequests(ctx.drizzle, ["ANBU"], 3600 * 12, undefined, squadId),
        ]);
        const { user } = updatedUser;
        if (!user || !squad) {
          return [];
        }
        const ownSquadRequests = ownRequests.filter(
          (request) =>
            request.senderId === ctx.userId &&
            isAnbuRequestForSquad(request, squadId, squad.leaderId),
        );
        const { isLeader, isKageOfSquadVillage, isElderOfSquadVillage } =
          getConvenienceStatus(user, squad);
        const canStaffEdit = canEditClans(user.role);
        if (isLeader || isKageOfSquadVillage || isElderOfSquadVillage || canStaffEdit) {
          return squadRequests;
        }
        // Applicants (not already in an ANBU) see their own outgoing requests
        if (!user.anbuId) {
          return ownSquadRequests;
        }
        return [];
      }
      return fetchRequests(ctx.drizzle, ["ANBU"], 3600 * 12, ctx.userId);
    }),
  createRequest: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Request to join an ANBU squad" } })
    .input(z.object({ squadId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [updatedUser, squad, ownRequests] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchSquad(ctx.drizzle, input.squadId),
        fetchRequests(ctx.drizzle, ["ANBU"], 3600 * 12, ctx.userId),
      ]);
      // Derived
      const { user } = updatedUser;
      const { isKage, isElder } = getConvenienceStatus(user, squad);
      // Guards
      if (!squad) return errorResponse("Squad not found");
      if (!user) return errorResponse("User not found");
      if (user.villageId !== squad.villageId) return errorResponse("Wrong village");
      if (user.anbuId) return errorResponse("Already in a squad");
      if (isKage || isElder) return errorResponse("Kage or elder cannot join");
      if (
        ownRequests.some(
          (request) => request.senderId === user.userId && request.status === "PENDING",
        )
      ) {
        return errorResponse("You already have a pending ANBU request");
      }
      if (!hasRequiredRank(user.rank, ANBU_MEMBER_RANK_REQUIREMENT)) {
        return errorResponse(`Rank must be at least ${ANBU_MEMBER_RANK_REQUIREMENT}`);
      }
      // Leaderless squads stay joinable — route the request to the village kage so
      // kage/elder/staff can accept (relatedId still identifies the squad).
      const receiverId = squad.leaderId ?? user.village?.kageId;
      if (!receiverId) {
        return errorResponse("No leader or kage available to receive request");
      }
      // Expire invisible requests before the unique pending-request constraint is
      // exercised, then rely on that constraint to close concurrent double-clicks.
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
    }),
  rejectRequest: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Reject ANBU join request" } })
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [request, updatedUser] = await Promise.all([
        fetchRequest(ctx.drizzle, input.id, "ANBU"),
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
      ]);
      const squad = await fetchSquadForAnbuRequest(ctx.drizzle, request);
      const { user } = updatedUser;
      const { isLeader, isKageOfSquadVillage, isElderOfSquadVillage } =
        getConvenienceStatus(user, squad);
      const canStaffEdit = user ? canEditClans(user.role) : false;
      if (
        !isLeader &&
        !isKageOfSquadVillage &&
        !isElderOfSquadVillage &&
        !canStaffEdit
      ) {
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
    }),
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
    .mutation(async ({ ctx, input }) => {
      // Fetch — request + acting user are independent; squad/requester need the request
      const [request, updatedUser] = await Promise.all([
        fetchRequest(ctx.drizzle, input.id, "ANBU"),
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
      ]);
      const [squad, requester] = await Promise.all([
        fetchSquadForAnbuRequest(ctx.drizzle, request),
        fetchUser(ctx.drizzle, request.senderId),
      ]);
      // Derived
      const { user } = updatedUser;
      const { isLeader, isKageOfSquadVillage, isElderOfSquadVillage } =
        getConvenienceStatus(user, squad);
      const canStaffEdit = user ? canEditClans(user.role) : false;
      // Guards
      if (!squad) return errorResponse("Squad not found");
      if (!user) return errorResponse("User not found");
      if (!requester) return errorResponse("Requester not found");
      if (
        !isLeader &&
        !isKageOfSquadVillage &&
        !isElderOfSquadVillage &&
        !canStaffEdit
      ) {
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
      // Claim the request first so concurrent accept/reject/cancel calls have one
      // winner. The memberCount CAS then reserves exactly one capacity slot.
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
      // Leaderless recovery: if the squad has no leader and the joiner is eligible,
      // make them leader so the squad is not stuck empty/leaderless.
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
            null, // squad is leaderless; avoid touching other squads' relatedId=null requests
            requester.userId,
          );
        }
      }
      void pusher.trigger(request.senderId, "event", { type: "anbu" });
      // Create
      return { success: true, message: "Request accepted" };
    }),
  createSquad: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Create new ANBU squad" } })
    .input(anbuCreateSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [updatedUser, leader, village, anbus] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchUser(ctx.drizzle, input.leaderId),
        fetchVillage(ctx.drizzle, input.villageId),
        fetchSquads(ctx.drizzle, input.villageId),
      ]);
      // Derived
      const { user } = updatedUser;
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
      if (anbus.length > getEffectiveStructureLevel(structure))
        return errorResponse("Max squads reached");
      if (leader.anbuId) return errorResponse("Leader already in a squad");
      if (leader.isAi) return errorResponse("AI cannot be leader");
      if (leader.userId === village.kageId) return errorResponse("Cannot choose kage");
      if (leader.rank === "ELDER") return errorResponse("Cannot choose elder");
      if (!hasRequiredRank(leader.rank, ANBU_LEADER_RANK_REQUIREMENT)) {
        return errorResponse("Leader rank too low");
      }
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
      const [updatedUser, squad] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchSquad(ctx.drizzle, input.squadId),
      ]);
      // Derived
      const { user } = updatedUser;
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
        fetchUser(ctx.drizzle, ctx.userId),
        fetchSquad(ctx.drizzle, input.squadId),
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
      const [updatedUser, squad, member] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchSquad(ctx.drizzle, input.squadId),
        fetchUser(ctx.drizzle, input.memberId),
      ]);
      // Derived
      const { user } = updatedUser;
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
      const [updatedUser, squad, member] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchSquad(ctx.drizzle, input.squadId),
        fetchUser(ctx.drizzle, input.memberId),
      ]);
      // Derived
      const { user } = updatedUser;
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
      if (squad.members.length <= 1) {
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
        fetchUser(ctx.drizzle, ctx.userId),
        fetchSquad(ctx.drizzle, input.squadId),
      ]);
      // Guards
      if (!user) return errorResponse("User not found");
      if (!squad) return errorResponse("Squad not found");
      if (user.villageId !== squad.villageId) return errorResponse("Wrong village");
      if (!user.anbuId) return errorResponse("Not in a squad");
      if (user.anbuId !== squad.id) return errorResponse("Wrong squad");
      if (squad.members.length <= 1) {
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
      const [updatedUser, squad] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchSquad(ctx.drizzle, input.squadId),
      ]);
      // Derived
      const { user } = updatedUser;
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
      const [updatedUser, squad] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchSquad(ctx.drizzle, input.squadId),
      ]);
      // Derived
      const { user } = updatedUser;
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
      const [updatedUser, squad] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchSquad(ctx.drizzle, input.squadId),
      ]);
      // Derived
      const { user } = updatedUser;
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
      const [updatedUser, targetVillage, userSquad] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchVillage(ctx.drizzle, input.villageId),
        fetchSquad(ctx.drizzle, input.anbuId),
      ]);

      // Derived
      const { user } = updatedUser;

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
      const [anbuSquads, clans] = await Promise.all([
        fetchSquads(ctx.drizzle, targetVillage.id),
        fetchClans(ctx.drizzle, targetVillage.id),
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
      <li>ANBU Squads: <strong>${anbuSquads.length}</strong></li>
      <li>Active Clans: <strong>${clans.length}</strong></li>
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
  squad: NonNullable<AnbuRouter["get"]>,
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

/** Atomically changes the leader only while the candidate is still a member. */
export const promoteAnbuLeader = async (
  client: DrizzleClient,
  squadId: string,
  memberId: string,
  expectedLeaderId: string | null,
) => {
  const expectedLeader = expectedLeaderId
    ? sql`squad.leaderId = ${expectedLeaderId}`
    : sql`squad.leaderId IS NULL`;
  const result = await client.execute(sql`
    UPDATE ${anbuSquad} AS squad
    INNER JOIN ${userData} AS member
      ON member.userId = ${memberId}
      AND member.anbuId = squad.id
    SET squad.leaderId = ${memberId}
    WHERE squad.id = ${squadId}
      AND ${expectedLeader}
  `);
  return result.rowsAffected === 1;
};

/** Elects the first eligible live member into a currently leaderless squad. */
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

const releaseAnbuCapacity = async (client: DrizzleClient, squadId: string) =>
  client
    .update(anbuSquad)
    .set({ memberCount: sql`GREATEST(${anbuSquad.memberCount} - 1, 0)` })
    .where(eq(anbuSquad.id, squadId));

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
 * Retrieves the convenience status of a user in an Anbu squad.
 * @param user - The user object with relations.
 * @param squad - The Anbu squad object.
 * @returns An object containing convenience status properties.
 */
const getConvenienceStatus = (
  user: UserWithRelations,
  squad: AnbuSquad | null = null,
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
 * Whether an ANBU join request belongs to a squad. Prefers relatedId (set on
 * create / backfill / promotion); falls back to receiverId === current leader
 * for legacy rows created before relatedId was persisted.
 */
export const isAnbuRequestForSquad = (
  request: { relatedId: string | null; receiverId: string },
  squadId: string,
  leaderId: string | null,
) =>
  request.relatedId === squadId ||
  (!request.relatedId && !!leaderId && request.receiverId === leaderId);

/**
 * Fetches the squad for an ANBU join request via relatedId (preferred), falling
 * back to the request receiver for legacy rows created before squad id was stored.
 */
export const fetchSquadForAnbuRequest = async (
  client: DrizzleClient,
  request: { relatedId: string | null; receiverId: string },
) => {
  if (request.relatedId) {
    return await fetchSquad(client, request.relatedId);
  }
  return await fetchSquadByLeader(client, request.receiverId);
};

/**
 * After a leader change, ensure pending ANBU join requests are tied to this
 * squad via relatedId. When a successor exists, also point receiverId at them.
 * When there is no successor, only set relatedId so legacy rows cannot later
 * match a different squad via the receiverId === leaderId fallback.
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
 * Fetches the squad details by leader ID.
 * @param client - The Drizzle client instance.
 * @param leaderId - The ID of the squad leader.
 * @returns - A promise that resolves to the squad details.
 */
export const fetchSquadByLeader = async (client: DrizzleClient, leaderId: string) => {
  return await client.query.anbuSquad.findFirst({
    with: {
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
    where: eq(anbuSquad.leaderId, leaderId),
  });
};

export type AnbuRouter = inferRouterOutputs<typeof anbuRouter>;
