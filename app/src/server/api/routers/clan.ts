import type { inferRouterOutputs } from "@trpc/server";
import { and, eq, gte, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  ASSASSIN_MAX_PER_FACTION,
  CLAN_ASSASSIN_SLOTS,
  CLAN_BOOST_CONFIG,
  CLAN_BOOST_MAX_LEVEL,
  CLAN_BOOST_PERCENT_PER_LEVEL,
  CLAN_COLOR_CHANGE_REP_COST,
  CLAN_CREATE_PRESTIGE_REQUIREMENT,
  CLAN_CREATE_RYO_COST,
  CLAN_LOBBY_SECONDS,
  CLAN_MAX_MEMBERS,
  CLAN_POINT_RYO_RATE,
  CLAN_RANK_REQUIREMENT,
  CLANS_PER_STRUCTURE_LEVEL,
  ELDER_NOMINATION_CUTOFF_DAY,
  ELDER_NOMINATION_DEADLINE_DAY,
  FACTION_MIN_MEMBERS_FOR_STRONGHOLD,
  FACTION_REPUTATION_TREASURY_LIMIT,
  HIDEOUT_COST,
  STRONGHOLD_REESTABLISH_COST,
  VILLAGE_SYNDICATE_ID,
} from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import { clan, userData, village } from "@/drizzle/schema";
import { checkIfSectorIsAvailable } from "@/libs/clan";
import { getServerPusher } from "@/libs/pusher";
import { hasEnergyQueue } from "@/libs/queue";
import { hasRequiredRank } from "@/libs/train";
import { findHistoricalAvatarByImage } from "@/queries/avatar";
import {
  deleteBattleQueueMemberById,
  deleteBattleQueueMembersForUser,
  deleteClanForRemoveFromClan,
  deleteMpvpBattleQueueForRemoveFromClanBattle,
  deleteSectorForRemoveFromClan,
  deleteUserRequestForRemoveFromClan,
  deleteVillageForRemoveFromClan,
  deleteVillageStructureForRemoveFromClan,
  deleteWarAllyForRemoveFromClan,
  deleteWarForRemoveFromClan,
  deleteWarForRemoveFromClan2,
  deleteWarKillForRemoveFromClan,
  deleteWarKillForRemoveFromClan2,
  executeResultForUpgradeHideoutToStronghold,
  fetchActiveUserMpvpBattles,
  fetchClan,
  fetchClanBattle,
  fetchClanBattles,
  fetchClanByName,
  fetchClans,
  findMpvpBattleQueueForHasClanBattleJoin,
  findUserDataForGetRequests,
  findVillageForCreateClan,
  insertActionLogForClanDonate,
  insertActionLogForDeleteClanBattle,
  insertActionLogForEditClanColor,
  insertActionLogForRemoveFromClan,
  insertClanForCreateClan,
  insertConversationForPurchaseHideout,
  insertMpvpBattleQueueForChallengeClan,
  insertMpvpBattleUserForJoinClanBattle,
  insertSectorForPurchaseHideout,
  insertVillageForPurchaseHideout,
  insertVillageStructureForPurchaseHideout,
  listClanForDeleteClanBattle,
  listClanForGetAllNames,
  listClanForNominateElder,
  listClanForSearchClans,
  setClanVillageKage,
  updateClanForClanDonate,
  updateClanForClearLeadership,
  updateClanForConvertPointsToRyo,
  updateClanForDemoteMember,
  updateClanForEditClan,
  updateClanForInstantJoinAndLead,
  updateClanForKickMember,
  updateClanForNominateElder,
  updateClanForPromoteMember,
  updateClanForPurchaseBoost,
  updateClanForPurchaseHideout,
  updateClanForRemoveFromClan,
  updateClanForToBank,
  updateMpvpBattleQueueForInitiateClanBattle,
  updateUserDataForAcceptRequest,
  updateUserDataForChallengeClan,
  updateUserDataForClanDonate,
  updateUserDataForCreateClan,
  updateUserDataForEditClanColor,
  updateUserDataForInitiateClanBattle,
  updateUserDataForInstantJoinAndLead,
  updateUserDataForPurchaseHideout,
  updateUserDataForRemoveFromClan,
  updateUserDataForRemoveFromClan2,
  updateUserDataForUndoClanBattleJoin,
  updateVillageForEditClanColor,
  updateVillageForRemoveFromClan,
} from "@/queries/clan";
import {
  debitUserMoney,
  fetchUser,
  incrementUserMoney,
  refundUserReputationPoints,
} from "@/queries/profile";
import { deleteQueueById } from "@/queries/raids";
import {
  findClanUserCache,
  findQueueUserCache,
  findVillageUserCache,
} from "@/queries/socialUserCache";
import { fetchRequests, insertRequest } from "@/queries/sparring";
import { fetchStructures, fetchVillage, fetchVillages } from "@/queries/village";
import { initiateBattle } from "@/routers/combat";
import { updateNindo } from "@/routers/profile";
import { fetchRequest, updateRequestState } from "@/routers/sparring";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { clearClanCombat, deleteClanBattle } from "@/server/utils/clanBattle";
import { syncStrongholdMembership } from "@/server/utils/faction";
import { isMysqlDuplicateKeyError, retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { deferPushToUsers } from "@/server/utils/push/defer";
import { membershipUpdate } from "@/server/utils/push/messages";
import {
  getBattleUserPatch,
  getMembershipUserPatch,
  getVillageChangeUserUpdate,
} from "@/server/utils/socialUserCache";
import { canEditClans } from "@/utils/permissions";
import { checkForBadWords } from "@/utils/profanity";
import { secondsFromDate } from "@/utils/time";
import { getEffectiveStructureLevel } from "@/utils/village";
import {
  checkAssassin,
  checkCoLeader,
  clanBankDepositSchema,
  clanBattleIdSchema,
  clanBoostTypeSchema,
  clanCreateSchema,
  clanGetRequestSchema,
  clanPointConversionSchema,
  factionEditSchema,
  restoreStrongholdSchema,
  strictClanNameField,
} from "@/validators/clan";
import { idSchema } from "@/validators/misc";
import { userDeltaResponseSchema } from "@/validators/userCache";

const pusher = getServerPusher();

export const clanRouter = createTRPCRouter({
  purchaseHideout: protectedProcedure
    .meta({ mcp: { description: "Purchase faction hideout" } })
    .input(z.object({ clanId: z.string(), sector: z.number() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, fetchedClan, villages, structures, available] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchClan(ctx.drizzle, input.clanId),
        fetchVillages(ctx.drizzle),
        fetchStructures(ctx.drizzle),
        checkIfSectorIsAvailable(input.sector),
      ]);
      const clanVillage = fetchedClan?.village;
      // Guards
      if (!fetchedClan) return errorResponse("Faction not found");
      if (!user) return errorResponse("User not found");
      if (fetchedClan.bank < HIDEOUT_COST) return errorResponse("Not enough ryo");
      if (user.clanId !== input.clanId) return errorResponse("User not in clan");
      if (villages.find((v) => v.sector === input.sector)) {
        return errorResponse("This location is already occupied.");
      }
      if (!user.isOutlaw) {
        return errorResponse("Only outlaw factions can have hideouts");
      }
      if (fetchedClan.leaderId !== user.userId) {
        return errorResponse("Not faction leader");
      }
      if (clanVillage?.type !== "OUTLAW") {
        return errorResponse("Only outlaw factions can have hideouts");
      }
      if (clanVillage?.kageId === user.userId) {
        return errorResponse("Cannot create hideout as the leader of the outlaws");
      }
      if (!available) {
        return errorResponse("This location is reserved or not possible to build on.");
      }
      // New structures (same as syndicate, except without ANBU & Clan)
      const newStructures = structures.filter((s) => s.route !== "/anbu");

      // Mutate step 1 - pay up
      const hideoutId = nanoid();
      const result = await updateClanForPurchaseHideout(ctx.drizzle, hideoutId, input);
      if (result.rowsAffected === 0) return errorResponse("Failed to purchase hideout");
      // Mutate step 2 - set hideout
      await Promise.all([
        insertVillageStructureForPurchaseHideout(ctx.drizzle, newStructures, hideoutId),
        updateUserDataForPurchaseHideout(ctx.drizzle, hideoutId, input),
        insertConversationForPurchaseHideout(ctx.drizzle, fetchedClan),
        insertSectorForPurchaseHideout(ctx.drizzle, input, hideoutId),
        insertVillageForPurchaseHideout(ctx.drizzle, hideoutId, fetchedClan, input),
      ]);
      return {
        success: true,
        message: "Hideout purchased successfully",
        ...(await getVillageChangeUserUpdate(ctx.drizzle, ctx.userId)),
      };
    }),
  upgradeHideoutToStronghold: protectedProcedure
    .meta({ mcp: { description: "Restore a former Stronghold" } })
    .input(restoreStrongholdSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, fetchedClan] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchClan(ctx.drizzle, input.clanId),
      ]);
      const clanHideout = fetchedClan?.village;
      // Guards
      if (!fetchedClan) return errorResponse("Faction not found");
      if (!user) return errorResponse("User not found");
      if (!clanHideout) return errorResponse("Clan village not found");
      if (!user.isOutlaw)
        return errorResponse("Only outlaw factions can have strongholds");
      if (user.clanId !== input.clanId) return errorResponse("User not in clan");
      if (fetchedClan.leaderId !== user.userId) {
        return errorResponse("Not faction leader");
      }
      if (fetchedClan.village?.type !== "HIDEOUT") {
        return errorResponse("Must have a hideout first");
      }
      if (fetchedClan.members.length < FACTION_MIN_MEMBERS_FOR_STRONGHOLD) {
        return errorResponse("Need more faction members");
      }
      if (!clanHideout.wasDowngraded)
        return errorResponse(
          "New Stronghold upgrades are disabled; only former Strongholds can be restored",
        );
      if (fetchedClan.bank < STRONGHOLD_REESTABLISH_COST)
        return errorResponse(
          `Restoring a Stronghold costs ${STRONGHOLD_REESTABLISH_COST.toLocaleString()} Ryo`,
        );
      const guards = and(
        eq(clan.id, input.clanId),
        eq(clan.leaderId, user.userId),
        gte(clan.bank, STRONGHOLD_REESTABLISH_COST),
        eq(village.id, clanHideout.id),
        eq(village.type, "HIDEOUT"),
        eq(village.wasDowngraded, true),
        eq(village.kageId, user.userId),
        sql`(SELECT COUNT(*) FROM ${userData} WHERE ${userData.clanId} = ${fetchedClan.id} AND ${userData.isAi} = 0) >= ${FACTION_MIN_MEMBERS_FOR_STRONGHOLD}`,
      );
      // A joined write restores the guarded settlement and charges its owning faction
      // together; a duplicate request or changed balance cannot leave a partial payment.
      const result = await retryOnDeadlock(() =>
        executeResultForUpgradeHideoutToStronghold(ctx.drizzle, guards),
      );
      if (result.rowsAffected === 0)
        return errorResponse(
          "Stronghold could not be restored; refresh the faction and check its balance and membership",
        );
      const savedVillage = await findVillageUserCache(
        ctx.drizzle,
        clanHideout.id,
      ).catch(() => undefined);
      return {
        success: true,
        message: "Stronghold restored successfully",
        userDelta: savedVillage
          ? { clan: { id: fetchedClan.id, bank: -STRONGHOLD_REESTABLISH_COST } }
          : undefined,
        userPatch: savedVillage ? { village: savedVillage } : undefined,
      };
    }),
  clanDonate: protectedProcedure
    .meta({
      mcp: { description: "Donate reputation to faction treasury" },
    })
    .input(
      z.object({
        reputationPoints: z.number().min(0),
        clanId: z.string(),
      }),
    )
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, fetchedClan] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchClan(ctx.drizzle, input.clanId),
      ]);
      // Guards
      if (!fetchedClan) return errorResponse("Faction not found");
      if (!user) return errorResponse("User not found");
      if (!user.isOutlaw) return errorResponse("Only outlaws can donate to faction");
      if (user.clanId !== input.clanId) return errorResponse("User not in faction");
      if (user.reputationPoints < input.reputationPoints) {
        return errorResponse("You do not have enough reputation points");
      }
      // Derived - prevent people over-donating reputation points
      // TODO: Remove if these gain a permanent value for clans -
      // right now its only purpose is hideouts. We should implement
      // it so that users can do aesthetics for their hideouts/strongholds,
      // e.g. move around building, change skins, etc.
      const repsCost = Math.min(
        input.reputationPoints,
        FACTION_REPUTATION_TREASURY_LIMIT - fetchedClan.repTreasury,
      );
      if (repsCost === 0) {
        return {
          success: true,
          message: `${user.username} donated 0 reputation points to faction`,
          userDelta: hasEnergyQueue(user) ? undefined : {},
          userPatch: { clan: { id: fetchedClan.id } },
        };
      }
      // Mutate step 1 - update user
      const result = await updateUserDataForClanDonate(ctx.drizzle, repsCost, ctx);
      if (result.rowsAffected === 0) {
        return errorResponse("Failed to deduct points from user");
      }
      // Mutate step 2 - update the clan
      const result2 = await updateClanForClanDonate(ctx.drizzle, repsCost, fetchedClan);
      if (result2.rowsAffected === 0) {
        await refundUserReputationPoints(ctx.drizzle, repsCost, ctx.userId);
        return errorResponse("Failed to update the treasury");
      } else {
        // Create donation message
        const message = `${user.username} donated ${repsCost} reputation points to faction`;
        await insertActionLogForClanDonate(ctx.drizzle, ctx, message, fetchedClan);
        return {
          success: true,
          message,
          userDelta: hasEnergyQueue(user)
            ? undefined
            : {
                reputationPoints: -repsCost,
                // The INT treasury rounds fractional donations; personal reputation is FLOAT.
                clan: { id: fetchedClan.id, repTreasury: Math.round(repsCost) },
              },
        };
      }
    }),
  get: protectedProcedure
    .meta({ mcp: { description: "Get clan/faction details" } })
    .input(z.object({ clanId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Query
      const [user, fetchedClan] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchClan(ctx.drizzle, input.clanId),
      ]);
      // Guard
      if (
        user.villageId === fetchedClan?.villageId ||
        fetchedClan?.id === user.clanId ||
        (fetchedClan?.hasHideout && user.isOutlaw)
      ) {
        return fetchedClan;
      }
      return null;
    }),
  getAll: protectedProcedure
    .meta({ mcp: { description: "Get all clans/factions in village" } })
    .input(z.object({ villageId: z.string(), isOutlaw: z.boolean() }))
    .query(async ({ ctx, input }) => {
      // Fetch
      const [user, fetchedClans] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchClans(ctx.drizzle, input.villageId, input.isOutlaw),
      ]);
      // Guard
      if (user.villageId === input.villageId) return fetchedClans;
      return null;
    }),
  getAllNames: protectedProcedure
    .meta({ mcp: { description: "Get all clan/faction names" } })
    .query(async ({ ctx }) => {
      return await listClanForGetAllNames(ctx.drizzle);
    }),
  getRequests: protectedProcedure
    .meta({ mcp: { description: "Get pending clan join requests" } })
    .input(clanGetRequestSchema)
    .query(async ({ ctx, input }) => {
      // Fetch
      const [user, requests] = await Promise.all([
        findUserDataForGetRequests(ctx.drizzle, ctx),
        fetchRequests(ctx.drizzle, ["CLAN"], 3600 * 12, [
          ctx.userId,
          input.clanLeaderId,
        ]),
      ]);
      // Early Return For Non Clan User
      if (!user) return [];
      if (!user.clanId) {
        return requests.filter(
          (r) => r.senderId === ctx.userId || r.receiverId === ctx.userId,
        );
      }
      // Authorize against the user's clan before exposing speculatively loaded requests.
      const fetchedClan = user.clan;
      // Guards
      if (!fetchedClan) {
        return [];
      }
      // Derived
      const isLeader = user.userId === fetchedClan.leaderId;
      const isColeader = checkCoLeader(user.userId, fetchedClan);
      // Authorization: verify calling user is leader or co-leader
      if (!isLeader && !isColeader) {
        return [];
      }
      return requests.filter(
        (r) => r.senderId === input.clanLeaderId || r.receiverId === input.clanLeaderId,
      );
    }),
  searchClans: protectedProcedure
    .meta({ mcp: { description: "Search clans/factions by name" } })
    .input(z.object({ name: z.string().trim() }))
    .query(async ({ ctx, input }) => {
      return listClanForSearchClans(ctx.drizzle, input);
    }),
  createRequest: protectedProcedure
    .meta({ mcp: { description: "Request to join clan/faction" } })
    .input(z.object({ clanId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, fetchedClan] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchClan(ctx.drizzle, input.clanId),
      ]);
      const groupLabel = user?.isOutlaw ? "faction" : "clan";
      const locationLabel = user?.isOutlaw ? "syndicate" : "village";
      // Guards
      if (!fetchedClan) return errorResponse(`${groupLabel} not found`);
      if (!user) return errorResponse("User not found");
      if (!fetchedClan.leaderId) return errorResponse("No leader currently");
      if (user.clanId) return errorResponse(`Already in a ${groupLabel}`);
      if (
        !(
          user.villageId === fetchedClan.villageId ||
          (user.isOutlaw && fetchedClan.hasHideout)
        )
      ) {
        return errorResponse(`Wrong ${locationLabel}`);
      }
      if (!hasRequiredRank(user.rank, CLAN_RANK_REQUIREMENT)) {
        return errorResponse(`Rank must be at least ${CLAN_RANK_REQUIREMENT}`);
      }
      // Mutate
      await insertRequest(ctx.drizzle, user.userId, fetchedClan.leaderId, "CLAN");
      deferPushToUsers(ctx.drizzle, [fetchedClan.leaderId], membershipUpdate("clan"));
      void pusher.trigger(fetchedClan.id, "event", {
        type: "userMessage",
        message: `${user.username} requested to join your ${user.isOutlaw ? "faction" : "clan"}`,
        route: `/clanhall`,
        routeText: `To ${user.isOutlaw ? "faction" : "clan"}`,
      });
      // Create
      return {
        success: true,
        message: `User requested to join ${user.isOutlaw ? "faction" : "clan"}`,
      };
    }),
  rejectRequest: protectedProcedure
    .meta({ mcp: { description: "Reject clan join request" } })
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [request, user] = await Promise.all([
        fetchRequest(ctx.drizzle, input.id, "CLAN"),
        fetchUser(ctx.drizzle, ctx.userId),
      ]);
      // Derived
      const groupLabel = user?.isOutlaw ? "faction" : "clan";
      // Guards
      if (!user.clanId) return errorResponse(`Not in a ${groupLabel}`);
      // Secondary fetch using user's clanId (resilient to leader changes)
      const fetchedClan = await fetchClan(ctx.drizzle, user.clanId);
      if (!fetchedClan) return errorResponse(`${groupLabel} not found`);
      const isLeader = user.userId === fetchedClan.leaderId;
      const isColeader = checkCoLeader(user.userId, fetchedClan);
      if (!isLeader && !isColeader) {
        return errorResponse(
          `Only ${groupLabel} leader or co-leaders can reject requests`,
        );
      }
      if (request.status !== "PENDING") {
        return errorResponse("You can only reject pending requests");
      }
      const result = await updateRequestState(
        ctx.drizzle,
        input.id,
        "REJECTED",
        "CLAN",
        undefined,
        "PENDING",
      );
      if (!result.success) return result;
      void pusher.trigger(request.senderId, "event", { type: "clan" });
      deferPushToUsers(ctx.drizzle, [request.senderId], membershipUpdate("clan"));
      return result;
    }),
  cancelRequest: protectedProcedure
    .meta({ mcp: { description: "Cancel your clan join request" } })
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const request = await fetchRequest(ctx.drizzle, input.id, "CLAN");
      if (request.senderId !== ctx.userId) {
        return errorResponse("You can only cancel requests created by you");
      }
      if (request.status !== "PENDING") {
        return errorResponse("You can only cancel pending requests");
      }
      return await updateRequestState(ctx.drizzle, input.id, "CANCELLED", "CLAN");
    }),
  acceptRequest: protectedProcedure
    .meta({ mcp: { description: "Accept clan join request" } })
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [request, user] = await Promise.all([
        fetchRequest(ctx.drizzle, input.id, "CLAN"),
        fetchUser(ctx.drizzle, ctx.userId),
      ]);
      // Derived
      const groupLabel = user?.isOutlaw ? "faction" : "clan";
      const locationLabel = user?.isOutlaw ? "syndicate" : "village";
      // Guards
      if (!user.clanId) return errorResponse(`Not in a ${groupLabel}`);
      // Secondary fetches using user's clanId (resilient to leader changes)
      const [fetchedClan, requester] = await Promise.all([
        fetchClan(ctx.drizzle, user.clanId),
        fetchUser(ctx.drizzle, request.senderId),
      ]);
      if (!fetchedClan) return errorResponse(`${groupLabel} not found`);
      if (!requester) return errorResponse("Requester not found");
      const nMembers = fetchedClan.members.length || 0;
      const isLeader = user.userId === fetchedClan.leaderId;
      const isColeader = checkCoLeader(user.userId, fetchedClan);
      if (nMembers >= CLAN_MAX_MEMBERS) return errorResponse(`${groupLabel} is full`);
      if (!isLeader && !isColeader) {
        return errorResponse(
          `Only ${groupLabel} leader or co-leaders can accept requests`,
        );
      }
      if (requester.clanId) {
        return errorResponse(`Requester already in a ${groupLabel}`);
      }
      if (
        !(
          requester.villageId === fetchedClan.villageId ||
          (fetchedClan.hasHideout && requester.isOutlaw)
        )
      ) {
        return errorResponse(`!= ${locationLabel}`);
      }
      if (!hasRequiredRank(requester.rank, CLAN_RANK_REQUIREMENT)) {
        return errorResponse(`Rank must be at least ${CLAN_RANK_REQUIREMENT}`);
      }
      // Mutate
      await Promise.all([
        updateRequestState(ctx.drizzle, input.id, "ACCEPTED", "CLAN"),
        updateUserDataForAcceptRequest(ctx.drizzle, fetchedClan, requester),
      ]);
      if (fetchedClan.hasHideout)
        await syncStrongholdMembership(ctx.drizzle, fetchedClan.villageId);
      deferPushToUsers(ctx.drizzle, [request.senderId], membershipUpdate("clan"));
      void pusher.trigger(request.senderId, "event", {
        type: "userMessage",
        message: `You have been accepted to ${groupLabel}`,
        route: `/clanhall`,
        routeText: `To ${groupLabel}`,
      });
      // Create
      return { success: true, message: "Request accepted" };
    }),
  createClan: protectedProcedure
    .meta({ mcp: { description: "Create new clan/faction" } })
    .input(clanCreateSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [
        user,
        villageData,
        clans,
        clanWithName,
        villageWithName,
        moderationResult,
      ] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchVillage(ctx.drizzle, input.villageId),
        fetchClans(ctx.drizzle, input.villageId),
        fetchClanByName(ctx.drizzle, input.name),
        findVillageForCreateClan(ctx.drizzle, input),
        checkForBadWords(input.name),
      ]);
      // Derived
      const villageId = villageData?.id;
      const structure = villageData?.structures.find((s) => s.route === "/clanhall");
      const groupLabel = user?.isOutlaw ? "faction" : "clan";
      const locationLabel = user?.isOutlaw ? "syndicate" : "village";
      // Guards
      if (!user) return errorResponse("User not found");
      if (!villageData) return errorResponse(`${locationLabel} not found`);
      if (!structure) return errorResponse(`${groupLabel} hall not found`);
      if (clanWithName)
        return errorResponse("Clan name already exists, please pick another.");
      if (villageWithName) return errorResponse("Name taken by village/faction");
      if (villageId !== user.villageId) return errorResponse(`Wrong ${locationLabel}`);
      if (clans.find((c) => c.name === input.name)) return errorResponse("Name taken");
      if (clans.find((c) => c.leaderId === ctx.userId))
        if (user.clanId) return errorResponse(`Already in a ${groupLabel}`);
      if (user.isAi) return errorResponse("AI cannot be leader");
      if (user.money < CLAN_CREATE_RYO_COST) return errorResponse("Not enough ryo");
      if (
        clans.length >
        getEffectiveStructureLevel(structure) * CLANS_PER_STRUCTURE_LEVEL
      ) {
        return errorResponse(`Max ${user.isOutlaw ? "factions" : "clans"} reached`);
      }
      if (user.villagePrestige < CLAN_CREATE_PRESTIGE_REQUIREMENT) {
        return errorResponse(
          user.isOutlaw ? "Not enough notoriety" : "Not enough prestige",
        );
      }
      if (!hasRequiredRank(user.rank, CLAN_RANK_REQUIREMENT)) {
        return errorResponse("Rank too low");
      }
      if (!moderationResult.success) return moderationResult;
      // Reduce money
      const clanId = nanoid();
      const result = await updateUserDataForCreateClan(ctx.drizzle, clanId, user);
      if (result.rowsAffected === 0) return errorResponse("Failed to reduce money");
      // Mutate
      await insertClanForCreateClan(ctx.drizzle, clanId, villageData, input, user);
      const savedClan = await findClanUserCache(ctx.drizzle, clanId).catch(
        () => undefined,
      );
      // Create
      return {
        success: true,
        message: `${groupLabel} created`,
        userDelta: savedClan ? { money: -CLAN_CREATE_RYO_COST } : undefined,
        userPatch: savedClan ? { clanId, clan: savedClan } : undefined,
      };
    }),
  editClan: protectedProcedure
    .meta({ mcp: { description: "Edit clan/faction name and image" } })
    .input(factionEditSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, fetchedClan, clanWithName, image, moderationResult] =
        await Promise.all([
          fetchUser(ctx.drizzle, ctx.userId),
          fetchClan(ctx.drizzle, input.clanId),
          fetchClanByName(ctx.drizzle, input.name),
          findHistoricalAvatarByImage(ctx.drizzle, input),
          checkForBadWords(input.name),
        ]);
      const groupLabel = user?.isOutlaw ? "faction" : "clan";
      const locationLabel = user?.isOutlaw ? "syndicate" : "village";
      // Guards
      if (!fetchedClan) return errorResponse(`${groupLabel} not found`);
      if (!user) return errorResponse("User not found");
      if (!image) return errorResponse("Image not found");
      if (!image.avatar) return errorResponse("Image not found");
      if (clanWithName && clanWithName.id !== fetchedClan.id) {
        return errorResponse("Clan name already exists");
      }
      if (fetchedClan.leaderId !== user.userId)
        return errorResponse(`Not ${groupLabel} leader`);
      if (fetchedClan.villageId !== user.villageId)
        return errorResponse(`!= ${locationLabel}`);
      if (user.clanId !== fetchedClan.id) return errorResponse(`Wrong ${groupLabel}`);
      if (input.name !== fetchedClan.name) {
        const validated = strictClanNameField.safeParse(input.name);
        if (!validated.success) {
          return errorResponse(
            validated.error.issues[0]?.message ?? "Invalid clan name",
          );
        }
        if (!moderationResult.success) return moderationResult;
      }
      // Short-circuit no-op submits so PlanetScale's rowsAffected=0 on
      // unchanged UPDATE isn't misread as a concurrent-rename conflict.
      if (input.name === fetchedClan.name && image.avatar === fetchedClan.image) {
        return { success: true, message: `${groupLabel} unchanged` };
      }
      // Mutate (CAS on current name to avoid clobbering a concurrent rename)
      const result = await updateClanForEditClan(
        ctx.drizzle,
        input,
        { avatar: image.avatar },
        fetchedClan,
      );
      if (result.rowsAffected === 0) {
        return errorResponse(`${groupLabel} was modified, please try again`);
      }
      // Create
      return { success: true, message: `${groupLabel} updated` };
    }),
  editClanColor: protectedProcedure
    .meta({ mcp: { description: "Change faction color" } })
    .input(z.object({ clanId: z.string(), color: z.string() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, fetchedClan] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchClan(ctx.drizzle, input.clanId),
      ]);
      const groupLabel = user?.isOutlaw ? "faction" : "clan";

      // Guards
      if (!fetchedClan) return errorResponse(`${groupLabel} not found`);
      if (!user) return errorResponse("User not found");
      if (fetchedClan.leaderId !== user.userId)
        return errorResponse(`Not ${groupLabel} leader`);
      if (!user.isOutlaw) return errorResponse(`Only factions can set colors`);
      if (user.clanId !== fetchedClan.id) return errorResponse(`Wrong ${groupLabel}`);
      if (!fetchedClan.hasHideout)
        return errorResponse(`${groupLabel} needs a hideout to change colors`);
      if (user.reputationPoints < CLAN_COLOR_CHANGE_REP_COST)
        return errorResponse(`Not enough reputation points`);
      if (!/^#[0-9A-F]{6}$/i.test(input.color)) {
        return errorResponse(
          "Invalid color format. Must be a valid hex color (e.g. #FF0000)",
        );
      }

      // Mutate - deduct reputation points from the user
      const result = await updateUserDataForEditClanColor(ctx.drizzle, user);

      if (result.rowsAffected === 0) {
        return errorResponse("Failed to deduct reputation points");
      }

      // Create a log entry for the color change
      const [, colorResult] = await Promise.all([
        insertActionLogForEditClanColor(
          ctx.drizzle,
          ctx,
          groupLabel,
          input,
          fetchedClan,
          user,
        ),
        updateVillageForEditClanColor(ctx.drizzle, input, fetchedClan),
      ]);

      // Create
      return {
        success: true,
        userDelta:
          hasEnergyQueue(user) || colorResult.rowsAffected === 0
            ? undefined
            : { reputationPoints: -CLAN_COLOR_CHANGE_REP_COST },
        userPatch: { village: { id: fetchedClan.villageId, hexColor: input.color } },
        message: `${groupLabel} color updated`,
      };
    }),
  promoteMember: protectedProcedure
    .meta({ mcp: { description: "Promote clan member to leadership" } })
    .input(z.object({ clanId: z.string(), memberId: z.string() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, fetchedClan, member] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchClan(ctx.drizzle, input.clanId),
        fetchUser(ctx.drizzle, input.memberId),
      ]);
      const groupLabel = user?.isOutlaw ? "faction" : "clan";
      if (!fetchedClan) return errorResponse(`${groupLabel} not found`);
      // Derived
      const isLeader = user.userId === fetchedClan?.leaderId;
      const isColeader = checkCoLeader(user.userId, fetchedClan);
      const isMemberAssassin = checkAssassin(input.memberId, fetchedClan);
      const isMemberColeader = checkCoLeader(input.memberId, fetchedClan);
      const canEdit = canEditClans(user.role);
      const isMemberLeader = input.memberId === fetchedClan?.leaderId;
      const hadHideout = ["HIDEOUT", "STRONGHOLD"].includes(
        fetchedClan.village?.type ?? "",
      );
      // Guards
      if (!user) return errorResponse("User not found");
      if (!member) return errorResponse("Member not found");
      if (member.userId === user.userId) return errorResponse("Not yourself");
      if (isMemberLeader)
        return errorResponse(`${groupLabel} leader cannot be promoted`);
      if (!isLeader && !isColeader && !canEdit)
        return errorResponse(`Only ${groupLabel} leaders can promote`);
      if (isMemberColeader && !isLeader && !canEdit)
        return errorResponse(`Only for ${groupLabel} leader`);
      if (member.clanId !== fetchedClan.id)
        return errorResponse(`Not in ${groupLabel}`);
      if (!hasRequiredRank(member.rank, CLAN_RANK_REQUIREMENT))
        return errorResponse("Leader rank too low");
      // Derived
      const currentAssassins = CLAN_ASSASSIN_SLOTS.map((k) => fetchedClan[k]).filter(
        Boolean,
      ).length;
      // Userdata to update
      let updateData = null;
      // If member is a co-leader and the user is either a leader or has canEdit, promote them to leader
      if (isMemberColeader && (isLeader || canEdit)) {
        updateData = {
          leaderId: input.memberId, // Promote co-leader to leader
          coLeader1:
            fetchedClan.coLeader1 === input.memberId
              ? fetchedClan.leaderId
              : fetchedClan.coLeader1, // Demote leader to first available co-leader slot
          coLeader2:
            fetchedClan.coLeader2 === input.memberId
              ? fetchedClan.coLeader1
              : fetchedClan.coLeader2,
          coLeader3:
            fetchedClan.coLeader3 === input.memberId
              ? fetchedClan.coLeader2
              : fetchedClan.coLeader3,
        };
      }
      // If member is NOT a co-leader, allow promotion to co-leader instead
      else if (!isMemberColeader) {
        if (member.isOutlaw && !isMemberAssassin) {
          if (currentAssassins >= ASSASSIN_MAX_PER_FACTION) {
            return errorResponse(
              `Maximum ${ASSASSIN_MAX_PER_FACTION} assassins allowed`,
            );
          }
          const slotKey = CLAN_ASSASSIN_SLOTS.find(
            (k) => fetchedClan[k] === null || fetchedClan[k] === undefined,
          );
          if (!slotKey) {
            return errorResponse(`No more assassin slots available in ${groupLabel}`);
          }
          updateData = { [slotKey]: input.memberId };
        } else {
          if (!fetchedClan.coLeader1) updateData = { coLeader1: input.memberId };
          else if (!fetchedClan.coLeader2) updateData = { coLeader2: input.memberId };
          else if (!fetchedClan.coLeader3) updateData = { coLeader3: input.memberId };
          else
            return errorResponse(`No more co-leader slots available in ${groupLabel}`);
        }
      }
      // If the member is already a co-leader but the user isn't a leader or can't edit, deny the promotion attempt
      else {
        return errorResponse(
          `Only ${groupLabel} leader or canEdit users can promote to leader`,
        );
      }
      // Mutate
      await Promise.all([
        updateClanForPromoteMember(ctx.drizzle, updateData, fetchedClan),
        ...(isMemberColeader && hadHideout
          ? [setClanVillageKage(ctx.drizzle, input.memberId, fetchedClan.villageId)]
          : []),
      ]);
      // Create
      return {
        success: true,
        message: "Member promoted",
        userPatch: {
          ...(user.clanId === fetchedClan.id
            ? { clan: { id: fetchedClan.id, ...updateData } }
            : {}),
          ...(isMemberColeader && hadHideout && user.villageId === fetchedClan.villageId
            ? { village: { id: fetchedClan.villageId, kageId: input.memberId } }
            : {}),
        },
      };
    }),
  demoteMember: protectedProcedure
    .meta({ mcp: { description: "Demote clan member from leadership" } })
    .input(z.object({ clanId: z.string(), memberId: z.string() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, clanData, member] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchClan(ctx.drizzle, input.clanId),
        fetchUser(ctx.drizzle, input.memberId),
      ]);
      // Derived
      const isLeader = user.userId === clanData?.leaderId;
      const isColeader = checkCoLeader(user.userId, clanData);
      const isMemberLeader = input.memberId === clanData?.leaderId;
      const isMemberColeader = checkCoLeader(input.memberId, clanData);
      const isMemberAssassin = checkAssassin(input.memberId, clanData);
      const canEdit = canEditClans(user.role);
      const isYourself = ctx.userId === input.memberId;
      const groupLabel = user?.isOutlaw ? "faction" : "clan";
      // Guards
      if (!clanData) return errorResponse(`${groupLabel} not found`);
      if (!user) return errorResponse("User not found");
      if (!member) return errorResponse("Member not found");
      if (!isLeader && !isColeader && !canEdit) return errorResponse(`Not allowed`);
      if (isMemberLeader)
        return errorResponse(`New ${groupLabel} leader must be promoted first`);
      if (member.clanId !== clanData.id) return errorResponse(`Not in ${groupLabel}`);
      if (isMemberColeader && !isLeader && !canEdit && !isYourself) {
        return errorResponse(`Only ${groupLabel} leader can demote`);
      }
      const assasinField = CLAN_ASSASSIN_SLOTS.find(
        (k) => clanData[k] === member.userId,
      );
      // Mutate
      await updateClanForDemoteMember(
        ctx.drizzle,
        clanData,
        member,
        isMemberAssassin,
        assasinField,
      );
      const savedClan =
        user.clanId === clanData.id
          ? await findClanUserCache(ctx.drizzle, clanData.id).catch(() => undefined)
          : undefined;
      // Create
      return {
        success: true,
        message: "Member demoted",
        userPatch:
          user.clanId === clanData.id
            ? savedClan
              ? { clan: savedClan }
              : undefined
            : {},
      };
    }),
  kickMember: protectedProcedure
    .meta({ mcp: { description: "Kick member from clan" } })
    .input(z.object({ clanId: z.string(), memberId: z.string() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, fetchedClan, member] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchClan(ctx.drizzle, input.clanId),
        fetchUser(ctx.drizzle, input.memberId),
      ]);
      // Derived
      const isLeader = user.userId === fetchedClan?.leaderId;
      const isColeader = checkCoLeader(user.userId, fetchedClan);
      const isMemberColeader = checkCoLeader(input.memberId, fetchedClan);
      const isMemberLeader = input.memberId === fetchedClan?.leaderId;
      const canEdit = canEditClans(user.role);
      const groupLabel = user?.isOutlaw ? "faction" : "clan";
      // Guards
      if (!fetchedClan) return errorResponse(`${groupLabel} not found`);
      if (!user) return errorResponse("User not found");
      if (!member) return errorResponse("Member not found");
      if (isMemberLeader && !canEdit)
        return errorResponse(`Cannot kick ${groupLabel} leader`);
      if (fetchedClan.villageId !== user.villageId)
        return errorResponse(user.isOutlaw ? "!= syndicate" : "!= village");
      if (!isLeader && !isColeader && !canEdit) return errorResponse("Not allowed");
      if (!isLeader && isMemberColeader && !canEdit)
        return errorResponse(`Only ${groupLabel} leader can kick`);
      // If the leader is being kicked, promote the kicker to leader
      if (isMemberLeader && canEdit) {
        await updateClanForKickMember(ctx.drizzle, user, fetchedClan);
      }
      // Mutate
      await removeFromClan(ctx.drizzle, fetchedClan, member, [
        `Kicked by ${user.username}`,
      ]);
      // Create
      return {
        success: true,
        message: "Member kicked",
        ...(member.userId === ctx.userId &&
        user.isOutlaw &&
        user.villageId !== VILLAGE_SYNDICATE_ID
          ? await getVillageChangeUserUpdate(ctx.drizzle, ctx.userId)
          : { userPatch: await getMembershipUserPatch(ctx.drizzle, user) }),
      };
    }),
  leaveClan: protectedProcedure
    .meta({ mcp: { description: "Leave current clan/faction" } })
    .input(z.object({ clanId: z.string() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, fetchedClan] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchClan(ctx.drizzle, input.clanId),
      ]);
      const groupLabel = user?.isOutlaw ? "faction" : "clan";
      const locationLabel = user?.isOutlaw ? "syndicate" : "village";
      // Guards
      if (!user) return errorResponse("User not found");
      if (!fetchedClan) return errorResponse(`${groupLabel} not found`);
      if (!user.clanId) return errorResponse(`Not in a ${groupLabel}`);
      if (user.status !== "AWAKE") return errorResponse("Must be awake to leave");
      if (user.clanId !== fetchedClan.id) return errorResponse(`Wrong ${groupLabel}`);
      if (user.villageId !== fetchedClan.villageId) {
        return errorResponse(`Wrong ${locationLabel}`);
      }
      // Derived
      await removeFromClan(ctx.drizzle, fetchedClan, user, [
        `Left ${groupLabel} on own accord`,
      ]);
      // Create
      return {
        success: true,
        message: `User left ${groupLabel}`,
        ...(user.isOutlaw && user.villageId !== VILLAGE_SYNDICATE_ID
          ? await getVillageChangeUserUpdate(ctx.drizzle, ctx.userId)
          : { userPatch: await getMembershipUserPatch(ctx.drizzle, user) }),
      };
    }),
  upsertNotice: protectedProcedure
    .meta({ mcp: { description: "Update clan notice/order" } })
    .input(z.object({ content: z.string(), clanId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, fetchedClan] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchClan(ctx.drizzle, input.clanId),
      ]);
      const groupLabel = user?.isOutlaw ? "faction" : "clan";
      // Derived
      const isLeader = fetchedClan?.leaderId === user.userId;
      const isCoLeader = checkCoLeader(ctx.userId, fetchedClan);
      const leaderLike = isLeader || isCoLeader;
      // Guards
      if (!user) return errorResponse("User not found");
      if (!fetchedClan) return errorResponse(`${groupLabel} not found`);
      if (user.isBanned) return errorResponse("User is banned");
      if (user.isSilenced) return errorResponse("User is silenced");
      if (!leaderLike) return errorResponse(`Not in ${groupLabel} leadership`);
      // Update
      return updateNindo(
        ctx.drizzle,
        fetchedClan.leaderOrderId,
        input.content,
        "clanOrder",
      );
    }),
  fightLeader: protectedProcedure
    .meta({
      mcp: { description: "Challenge clan leader for leadership" },
    })
    .input(z.object({ clanId: z.string(), villageId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, clanData, village] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchClan(ctx.drizzle, input.clanId),
        fetchVillage(ctx.drizzle, input.villageId),
      ]);
      const groupLabel = user?.isOutlaw ? "faction" : "clan";
      const locationLabel = user?.isOutlaw ? "syndicate" : "village";
      // Guards
      if (!village)
        return errorResponse(
          user?.isOutlaw ? "Syndicate not found" : "Village not found",
        );
      if (!user.clanId)
        return errorResponse(`Must be within the ${groupLabel} to challenge`);
      if (!clanData) return errorResponse(`${groupLabel} not found`);
      if (user.villageId !== village.id) return errorResponse(`Wrong ${locationLabel}`);
      if (clanData.id !== user.clanId) return errorResponse(`Wrong ${groupLabel}`);
      if (!hasRequiredRank(user.rank, CLAN_RANK_REQUIREMENT)) {
        return errorResponse("Rank too low");
      }
      // Start the battle
      return await initiateBattle(
        {
          userIds: [ctx.userId],
          targetIds: [clanData.leaderId],
          client: ctx.drizzle,
          biome: "arena",
        },
        "CLAN_CHALLENGE",
      );
    }),
  /** Convert spendable clan points into banked ryo for current clan leadership. */
  convertPointsToRyo: protectedProcedure
    .meta({ mcp: { description: "Convert clan points into clan bank ryo" } })
    .input(clanPointConversionSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const [user, fetchedClan] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchClan(ctx.drizzle, input.clanId),
      ]);
      if (!fetchedClan) return errorResponse("Clan not found");
      if (user.isBanned) return errorResponse("You are banned");
      if (
        user.clanId !== fetchedClan.id ||
        (fetchedClan.leaderId !== ctx.userId && !checkCoLeader(ctx.userId, fetchedClan))
      ) {
        return errorResponse("Only clan leaders and co-leaders can convert points");
      }
      const ryo = input.points * CLAN_POINT_RYO_RATE;
      // Recheck both balance and leadership in the write so stale reads cannot spend
      // points twice or authorize a leader whose appointment has been revoked.
      const converted = await updateClanForConvertPointsToRyo(
        ctx.drizzle,
        input,
        ryo,
        ctx,
      );
      if (converted.rowsAffected !== 1)
        return errorResponse("Not enough clan points or leadership changed");
      return {
        success: true,
        userDelta: { clan: { id: fetchedClan.id, points: -input.points, bank: ryo } },
        message: `Converted ${input.points.toLocaleString()} clan points to ${ryo.toLocaleString()} ryo in the clan bank`,
      };
    }),
  toBank: protectedProcedure
    .meta({ mcp: { description: "Deposit ryo to clan bank" } })
    .input(clanBankDepositSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const [user, fetchedClan] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchClan(ctx.drizzle, input.clanId),
      ]);
      if (user.money < input.amount) return errorResponse("Not enough money in pocket");
      if (user.isBanned) return errorResponse("You are banned");
      if (!user.clanId) return errorResponse("Not in a clan");
      if (fetchedClan?.id !== user.clanId) return errorResponse("Not in the clan");
      const needsUserRefresh = hasEnergyQueue(user);
      if (input.amount === 0) {
        return {
          success: true,
          message: "Successfully deposited 0 ryo",
          userDelta: needsUserRefresh ? undefined : {},
          userPatch: { clan: { id: fetchedClan.id } },
        };
      }
      const result = await debitUserMoney(ctx.drizzle, input.amount, ctx);
      if (result.rowsAffected === 0) {
        return { success: false, message: "Not enough money in pocket" };
      }
      const creditResult = await updateClanForToBank(ctx.drizzle, input);
      if (creditResult.rowsAffected === 0) {
        await incrementUserMoney(ctx.drizzle, input.amount, ctx.userId);
        return errorResponse("Clan bank no longer exists; your deposit was refunded");
      }
      return {
        success: true,
        message: `Successfully deposited ${input.amount} ryo`,
        userDelta: needsUserRefresh
          ? undefined
          : { money: -input.amount, clan: { id: fetchedClan.id, bank: input.amount } },
      };
    }),
  purchaseBoost: protectedProcedure
    .meta({ mcp: { description: "Purchase clan stat boost" } })
    .input(z.object({ clanId: z.string(), boostType: clanBoostTypeSchema }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const config = CLAN_BOOST_CONFIG[input.boostType];
      // Query
      const [user, clanData] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchClan(ctx.drizzle, input.clanId),
      ]);
      const groupLabel = user?.isOutlaw ? "faction" : "clan";
      // Derived
      const isLeader = clanData?.leaderId === user.userId;
      const isCoLeader = checkCoLeader(ctx.userId, clanData);
      const leaderLike = isLeader || isCoLeader;
      // Convert stored percentage to actual level (e.g., 10% -> level 5)
      const currentBoost = clanData?.[input.boostType] ?? 0;
      const currentLevel = currentBoost / CLAN_BOOST_PERCENT_PER_LEVEL;
      const cost = config.baseCost + currentLevel * config.perLevelCost;
      // Guard
      if (!user) return errorResponse("User not found");
      if (!clanData) return errorResponse(`${groupLabel} not found`);
      if (config.factionOnly && !user.isOutlaw) {
        return errorResponse("Only available for factions");
      }
      if (user.clanId !== clanData.id) {
        return errorResponse(`Not in the ${groupLabel}`);
      }
      if (!leaderLike) {
        return errorResponse(`Not in ${groupLabel} leadership`);
      }
      if (clanData.bank < cost) {
        return errorResponse(`Not enough Ryo in ${groupLabel} bank`);
      }
      if (currentLevel >= CLAN_BOOST_MAX_LEVEL) {
        return errorResponse(`Max ${config.label.toLowerCase()} reached`);
      }
      // Mutate - deduct from clan bank (Ryo) and increment boost
      const result = await updateClanForPurchaseBoost(
        ctx.drizzle,
        input,
        cost,
        clanData,
        currentBoost,
      );
      if (result.rowsAffected === 0) {
        return errorResponse(
          `The ${groupLabel} balance or boost changed; refresh and try again`,
        );
      }
      return { success: true, message: `${config.label} purchased` };
    }),
  nominateElder: protectedProcedure
    .meta({
      mcp: { description: "Nominate clan member for village elder" },
    })
    .input(z.object({ clanId: z.string(), nomineeId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, clanData, nominee] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchClan(ctx.drizzle, input.clanId),
        fetchUser(ctx.drizzle, input.nomineeId),
      ]);
      const groupLabel = user?.isOutlaw ? "faction" : "clan";
      // Derived
      const isLeader = clanData?.leaderId === user.userId;
      const isCoLeader = checkCoLeader(ctx.userId, clanData);
      const leaderLike = isLeader || isCoLeader;
      // Guard
      if (!user) return errorResponse("User not found");
      if (!clanData) return errorResponse(`${groupLabel} not found`);
      if (!nominee) return errorResponse("Nominee not found");
      if (user.clanId !== clanData.id) return errorResponse(`Not in the ${groupLabel}`);
      if (!leaderLike) return errorResponse(`Not in ${groupLabel} leadership`);
      if (nominee.clanId !== clanData.id) {
        return errorResponse(`Nominee must be a ${groupLabel} member`);
      }
      if (!hasRequiredRank(nominee.rank, "JONIN")) {
        return errorResponse("Nominee must be at least Jonin rank");
      }
      if (nominee.villageId !== clanData.villageId) {
        return errorResponse("Nominee must be in the same village");
      }
      if (nominee.anbuId) {
        return errorResponse("ANBU members cannot be nominated as elders");
      }
      // Date validation - only allow nominations between 25th and 28th (UTC)
      const now = new Date();
      const dayOfMonth = now.getUTCDate();
      if (
        dayOfMonth < ELDER_NOMINATION_CUTOFF_DAY ||
        dayOfMonth > ELDER_NOMINATION_DEADLINE_DAY
      ) {
        return errorResponse(
          `Elder nominations are only open from the ${ELDER_NOMINATION_CUTOFF_DAY}th to the ${ELDER_NOMINATION_DEADLINE_DAY}th of each month`,
        );
      }
      // Eligibility validation - clan must be in top 3 by activity (cutoff snapshot or live fallback)
      const currentMonth = now.getUTCMonth() + 1;
      const currentYear = now.getUTCFullYear();
      const hasCutoffSnapshot =
        clanData.elderCutoffMonth === currentMonth &&
        clanData.elderCutoffYear === currentYear;
      if (!hasCutoffSnapshot) {
        // Fallback: calculate live eligibility if cutoff snapshot is missing
        const liveRankings = await listClanForNominateElder(ctx.drizzle, clanData);
        const isInTop3 = liveRankings.some((c) => c.id === clanData.id);
        if (!isInTop3) {
          return errorResponse(
            "Your clan is not eligible for elder nomination this month (not in top 3 by activity points)",
          );
        }
      }
      // Mutate
      await updateClanForNominateElder(ctx.drizzle, input, clanData);
      return { success: true, message: `${nominee.username} nominated as elder` };
    }),
  getClanBattles: protectedProcedure
    .meta({ mcp: { description: "Get clan battle history" } })
    .input(z.object({ clanId: z.string() }))
    .query(async ({ ctx, input }) => {
      return await fetchClanBattles(ctx.drizzle, input.clanId);
    }),
  challengeClan: protectedProcedure
    .meta({ mcp: { description: "Challenge another clan to battle" } })
    .input(z.object({ challengerClanId: z.string(), targetClanId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, challenger, defender, queries] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchClan(ctx.drizzle, input.challengerClanId),
        fetchClan(ctx.drizzle, input.targetClanId),
        fetchActiveUserMpvpBattles(ctx.drizzle, ctx.userId),
      ]);
      const groupLabel = user?.isOutlaw ? "faction" : "clan";
      // Derived
      const isLeader = challenger?.leaderId === user.userId;
      const isCoLeader = checkCoLeader(ctx.userId, challenger);
      const leaderLike = isLeader || isCoLeader;
      // Guards
      if (!user) return errorResponse("User not found");
      if (user.status !== "AWAKE") return errorResponse("Must be awake to challenge");
      if (!challenger) return errorResponse("Challenger not found");
      if (!defender) return errorResponse("Defender not found");
      if (challenger.id === defender.id) return errorResponse("Cannot challenge self");
      if (!leaderLike) return errorResponse(`Not in ${groupLabel} leadership`);
      if (queries.length > 0) return errorResponse("Already in queue");
      if (user.clanId !== challenger.id)
        return errorResponse(`Not in ${groupLabel} clan`);
      // Wait for retained clan memberships and claimed ranked owners to finish cleanup.
      const clanBattleId = nanoid();
      const entryId = nanoid();
      const result = await retryOnDeadlock(() =>
        updateUserDataForChallengeClan(ctx.drizzle, user),
      );
      if (result.rowsAffected === 0)
        return errorResponse(
          `Queue changed or a previous ${groupLabel} battle still needs deletion; refresh and try again`,
        );
      // Settle both writes before compensation so a late insert cannot recreate the lobby.
      const inserted = await Promise.allSettled([
        insertMpvpBattleQueueForChallengeClan(
          ctx.drizzle,
          clanBattleId,
          challenger,
          defender,
        ),
        insertMpvpBattleUserForJoinClanBattle(
          ctx.drizzle,
          entryId,
          user,
          { clanBattleId },
          "ATTACKER",
          0,
        ),
      ]);
      const failedInsert = inserted.find((result) => result.status === "rejected");
      // Cleanup can release the status claim before the parallel membership insert.
      // Verify the published owner before announcing the challenge.
      if (
        failedInsert ||
        !(await hasClanBattleJoin(ctx.drizzle, clanBattleId, user.userId, entryId))
      ) {
        const deleted = await deleteClanBattle(ctx.drizzle, {
          id: clanBattleId,
          battleId: null,
        });
        // A failed member insert leaves no row for lobby deletion to find and release.
        if (!deleted || failedInsert)
          await undoClanBattleJoin(ctx.drizzle, user.userId, entryId);
        if (failedInsert && !isMysqlDuplicateKeyError(failedInsert.reason))
          throw failedInsert.reason;
        return errorResponse(
          "Clan battle was deleted or queue changed during challenge; refresh and try again",
        );
      }
      // Notify all clan members of both clans
      [
        ...challenger.members.map((m) => m.userId),
        ...defender.members.map((m) => m.userId),
      ].forEach((userId) => {
        void pusher.trigger(userId, "event", {
          type: "userMessage",
          message: `${challenger.name} ${groupLabel} has challenged ${defender.name} to a ${groupLabel} battle.`,
          route: "/clanhall",
          routeText: `To ${groupLabel} Hall`,
        });
      });
      return { success: true, message: `${groupLabel} challenge initiated` };
    }),
  joinClanBattle: protectedProcedure
    .meta({ mcp: { description: "Join ongoing clan battle queue" } })
    .input(clanBattleIdSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, clanBattleData, queries] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchClanBattle(ctx.drizzle, input.clanBattleId),
        fetchActiveUserMpvpBattles(ctx.drizzle, ctx.userId),
      ]);
      const groupLabel = user?.isOutlaw ? "faction" : "clan";
      // Guards
      if (!user) return errorResponse("User not found");
      if (!clanBattleData) return errorResponse(`${groupLabel} battle not found`);
      if (clanBattleData.battleId)
        return errorResponse(`${groupLabel} battle already started`);
      if (!user.clanId) return errorResponse(`Not in a ${groupLabel}`);
      if (user.status !== "AWAKE") return errorResponse("Must be awake to join");
      if (queries.length > 0) return errorResponse("Already in queue");
      if (
        clanBattleData.attackerEntityId !== user.clanId &&
        clanBattleData.defenderEntityId !== user.clanId
      ) {
        return errorResponse("Not in the clan battle");
      }
      // Derive side based on clan membership
      const side =
        clanBattleData.attackerEntityId === user.clanId ? "ATTACKER" : "DEFENDER";

      // Find available slots for this side
      const existingSlots = clanBattleData.queue
        .filter((q) => q.side === side)
        .map((q) => q.slot)
        .filter((s): s is number => s !== null);

      // Find first available slot (0-based) - clan battles have no max limit like shrine battles
      let availableSlot = 0;
      while (existingSlots.includes(availableSlot)) {
        availableSlot++;
      }

      // Wait for retained clan memberships and claimed ranked owners to finish cleanup.
      const result = await retryOnDeadlock(() =>
        updateUserDataForChallengeClan(ctx.drizzle, user),
      );
      if (result.rowsAffected === 0)
        return errorResponse(
          `Queue changed or a previous ${groupLabel} battle still needs deletion; refresh and try again`,
        );

      const entryId = nanoid();
      // This reversible membership write may race a start/delete. Revalidate afterward
      // and remove only our own entry, without locking a missing row or another combat.
      try {
        await insertMpvpBattleUserForJoinClanBattle(
          ctx.drizzle,
          entryId,
          user,
          input,
          side,
          availableSlot,
        );
        if (
          !(await hasClanBattleJoin(
            ctx.drizzle,
            input.clanBattleId,
            user.userId,
            entryId,
          ))
        ) {
          await undoClanBattleJoin(ctx.drizzle, user.userId, entryId);
          return errorResponse(
            "Battle started, was deleted, or queue changed; refresh and try again",
          );
        }
      } catch {
        await undoClanBattleJoin(ctx.drizzle, user.userId, entryId);
        return errorResponse("Slot was taken. Please try again.");
      }
      return {
        success: true,
        message: `Joined ${groupLabel} battle`,
        userPatch: { status: "QUEUED" },
      };
    }),
  leaveClanBattle: protectedProcedure
    .meta({ mcp: { description: "Leave clan battle queue" } })
    .input(clanBattleIdSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, clanBattleData] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchClanBattle(ctx.drizzle, input.clanBattleId),
      ]);
      const groupLabel = user?.isOutlaw ? "faction" : "clan";
      // Derived
      const queued = clanBattleData?.queue.some((q) => q.userId === user.userId);
      const battleId = input.clanBattleId;
      // Guards
      if (!user) return errorResponse("User not found");
      if (!clanBattleData) return errorResponse(`${groupLabel} battle not found`);
      if (user.status !== "QUEUED") return errorResponse(`Not queued in ${battleId}`);
      if (!queued) return errorResponse("Not in the queue");
      // Mutation
      await removeFromClanBattle(
        ctx.drizzle,
        clanBattleData.queue,
        input.clanBattleId,
        ctx.userId,
      );
      return {
        success: true,
        message: `Left ${groupLabel} battle`,
        userPatch: await findQueueUserCache(ctx.drizzle, ctx.userId).catch(
          () => undefined,
        ),
      };
    }),
  kickFromClanBattle: protectedProcedure
    .meta({ mcp: { description: "Kick member from clan battle queue" } })
    .input(
      z.object({ clanBattleId: z.string(), targetId: z.string(), clanId: z.string() }),
    )
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, target, fetchedClan, clanBattleData] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.targetId),
        fetchClan(ctx.drizzle, input.clanId),
        fetchClanBattle(ctx.drizzle, input.clanBattleId),
      ]);
      const groupLabel = user?.isOutlaw ? "faction" : "clan";
      // Derived
      const queued = clanBattleData?.queue.some((q) => q.userId === target.userId);
      const battleId = input.clanBattleId;
      // Derived
      const isLeader = user.userId === fetchedClan?.leaderId;
      const isColeader = checkCoLeader(user.userId, fetchedClan);
      const isMemberColeader = checkCoLeader(input.targetId, fetchedClan);
      // Guards
      if (!clanBattleData) return errorResponse(`${groupLabel} battle not found`);
      if (target.status !== "QUEUED") return errorResponse(`Not queued in ${battleId}`);
      if (!queued) return errorResponse("Not in the queue");
      if (!isLeader && !isColeader) return errorResponse("Not allowed");
      if (!isLeader && isMemberColeader)
        return errorResponse(`Only ${groupLabel} leader can kick`);
      // Mutation
      void pusher.trigger(target.userId, "event", {
        type: "userMessage",
        message: `${user.username} kicked you out of a ${groupLabel} battle.`,
        route: "/clanhall",
        routeText: `To ${groupLabel} Hall`,
      });
      await removeFromClanBattle(
        ctx.drizzle,
        clanBattleData.queue,
        input.clanBattleId,
        target.userId,
      );
      return {
        success: true,
        message: `Kicked from ${groupLabel} battle`,
        userPatch:
          input.targetId === ctx.userId
            ? await findQueueUserCache(ctx.drizzle, ctx.userId).catch(() => undefined)
            : {},
      };
    }),
  /** Authorize staff or participating leadership, then remove the observed battle. */
  deleteClanBattle: protectedProcedure
    .meta({ mcp: { description: "Delete a clan battle and release its participants" } })
    .input(clanBattleIdSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const [user, clanBattleData, ledClans] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchClanBattle(ctx.drizzle, input.clanBattleId),
        listClanForDeleteClanBattle(ctx.drizzle, ctx),
      ]);
      if (!clanBattleData || clanBattleData.battleType !== "CLAN_BATTLE")
        return errorResponse("Clan battle not found");
      const isParticipantLeader = ledClans.some(
        (c) =>
          c.id === user.clanId &&
          [clanBattleData.attackerEntityId, clanBattleData.defenderEntityId].includes(
            c.id,
          ),
      );
      if (user.isBanned) return errorResponse("You are banned");
      if (!canEditClans(user.role) && !isParticipantLeader)
        return errorResponse("Not allowed to delete this clan battle");
      if (!(await deleteClanBattle(ctx.drizzle, clanBattleData)))
        return errorResponse("Battle changed; refresh and try again");
      clanBattleData.queue.forEach((participant) => {
        void pusher.trigger(participant.userId, "event", { type: "battleEnded" });
      });
      await insertActionLogForDeleteClanBattle(ctx.drizzle, ctx, clanBattleData);
      return {
        success: true,
        message: "Clan battle deleted and participants released",
        userPatch: await findQueueUserCache(ctx.drizzle, ctx.userId).catch(
          () => undefined,
        ),
      };
    }),
  initiateClanBattle: protectedProcedure
    .meta({ mcp: { description: "Start clan battle combat" } })
    .input(clanBattleIdSchema)
    .output(userDeltaResponseSchema.extend({ battleId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, clanBattleData] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchClanBattle(ctx.drizzle, input.clanBattleId),
      ]);
      const groupLabel = user?.isOutlaw ? "faction" : "clan";
      // Guards
      if (!user) return errorResponse("User not found");
      if (!clanBattleData) return errorResponse(`${groupLabel} battle not found`);
      if (clanBattleData.battleId) return errorResponse("Battle already initiated");
      if (
        clanBattleData.attackerEntityId !== user.clanId &&
        clanBattleData.defenderEntityId !== user.clanId
      ) {
        return errorResponse(`Not in the ${groupLabel} battle`);
      }
      if (new Date() < secondsFromDate(CLAN_LOBBY_SECONDS, clanBattleData.createdAt)) {
        return errorResponse(`${groupLabel} battle not started yet`);
      }
      // Derived - use side field for determining attackers/defenders
      clanBattleData.queue.sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      );
      const allIds = clanBattleData.queue.map((q) => q.userId);
      const challengers = clanBattleData.queue.filter((q) => q.side === "ATTACKER");
      const defenders = clanBattleData.queue.filter((q) => q.side === "DEFENDER");
      if (challengers.length === 0 || defenders.length === 0) {
        return errorResponse("Not enough users on both sides");
      }
      // Limit challengers & defenders to maximum allowed
      const maxOnEachSide = Math.min(challengers.length, defenders.length);
      const challengerIds = challengers.slice(0, maxOnEachSide).map((u) => u.userId);
      const defenderIds = defenders.slice(0, maxOnEachSide).map((u) => u.userId);
      // Reserve the combat ID before expensive preloading so simultaneous starts cannot
      // create multiple battles and deletion can identify a startup already in flight.
      const battleId = nanoid();
      const reserved = await updateMpvpBattleQueueForInitiateClanBattle(
        ctx.drizzle,
        battleId,
        input,
      );
      if (reserved.rowsAffected !== 1)
        return errorResponse("Battle already started or deleted");
      try {
        const result = await initiateBattle(
          {
            userIds: challengerIds,
            targetIds: defenderIds,
            client: ctx.drizzle,
            biome: "default",
            clanBattle: { queueId: input.clanBattleId, battleId },
          },
          "CLAN_BATTLE",
        );
        if (!result.success) {
          await deleteClanBattle(ctx.drizzle, { id: input.clanBattleId, battleId });
          return errorResponse(result.message);
        }
        // Startup writes can finish after deletion. Clean that exclusive combat ID
        // instead of leaving participants in a battle whose lobby no longer exists.
        const current = await fetchClanBattle(ctx.drizzle, input.clanBattleId);
        if (current?.battleId !== battleId) {
          await clearClanCombat(ctx.drizzle, battleId);
          return errorResponse("Clan battle was deleted during startup");
        }
        await retryOnDeadlock(() =>
          updateUserDataForInitiateClanBattle(ctx.drizzle, allIds, input, battleId),
        );
        return {
          success: true,
          message: `${groupLabel} battle initiated`,
          battleId,
          userPatch: await getBattleUserPatch(
            ctx.drizzle,
            ctx.userId,
            result.requiresUserRefresh,
          ),
        };
      } catch (error) {
        if (
          !(await deleteClanBattle(ctx.drizzle, { id: input.clanBattleId, battleId }))
        ) {
          await clearClanCombat(ctx.drizzle, battleId);
        }
        throw error;
      }
    }),
  instantJoinAndLead: protectedProcedure
    .input(z.object({ clanId: z.string() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, fetchedClan] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchClan(ctx.drizzle, input.clanId),
      ]);
      // Guard
      if (!fetchedClan) return errorResponse("Faction not found");
      if (!user) return errorResponse("User not found");
      if (!canEditClans(user.role)) return errorResponse("Permission denied");
      if (user.clanId && user.clanId !== fetchedClan.id) {
        return errorResponse("Already in a faction");
      }
      // Update
      await Promise.all([
        updateUserDataForInstantJoinAndLead(ctx.drizzle, fetchedClan, user),
        updateClanForInstantJoinAndLead(ctx.drizzle, user, fetchedClan),
        ...(["HIDEOUT", "STRONGHOLD"].includes(fetchedClan.village?.type ?? "")
          ? [setClanVillageKage(ctx.drizzle, user.userId, fetchedClan.villageId)]
          : []),
      ]);

      await syncStrongholdMembership(ctx.drizzle, fetchedClan.villageId);
      return {
        success: true,
        ...(user.villageId !== fetchedClan.village?.id
          ? await getVillageChangeUserUpdate(ctx.drizzle, ctx.userId)
          : { userPatch: await getMembershipUserPatch(ctx.drizzle, user) }),
        message: `You have instantly joined and taken leadership of ${fetchedClan.name}`,
      };
    }),

  clearLeadership: protectedProcedure
    .input(z.object({ clanId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, fetchedClan] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchClan(ctx.drizzle, input.clanId),
      ]);

      // Derived
      const isLeader = user.userId === fetchedClan?.leaderId;
      const canEdit = canEditClans(user.role);
      const groupLabel = user?.isOutlaw ? "faction" : "clan";

      // Guards
      if (!fetchedClan) return errorResponse(`${groupLabel} not found`);
      if (!user) return errorResponse("User not found");
      if (!isLeader && !canEdit)
        return errorResponse("Only leader or staff can clear leadership");
      if (fetchedClan.villageId !== user.villageId && isLeader)
        return errorResponse(user.isOutlaw ? "!= syndicate" : "!= village");

      // Mutate - Clear all co-leader and assassin slots
      await updateClanForClearLeadership(ctx.drizzle, fetchedClan);

      return {
        success: true,
        message: `All co-leaders and assassins have been removed from ${groupLabel} leadership`,
      };
    }),
});

/**
 * Confirm the published membership still owns QUEUED in a pending lobby.
 * Cleanup can wake an unpublished claim, allowing ranked PvP or combat to take over.
 * Once published, the active membership prevents delayed leave/kick cleanup from waking it.
 */
const hasClanBattleJoin = async (
  client: DrizzleClient,
  clanBattleId: string,
  userId: string,
  entryId: string,
) => {
  const lobby = await findMpvpBattleQueueForHasClanBattleJoin(
    client,
    clanBattleId,
    entryId,
    userId,
  );
  return !!lobby;
};

/**
 * Remove an observed membership without disturbing another queue or combat.
 * Only the given membership is removed; the wake-up guard leaves
 * a user alone if another active clan lobby, ranked queue or combat has claimed them.
 */
const undoClanBattleJoin = async (
  client: DrizzleClient,
  userId: string,
  entryId: string,
) => {
  await deleteBattleQueueMemberById(client, entryId);
  await retryOnDeadlock(() => updateUserDataForUndoClanBattleJoin(client, userId));
};

/**
 * Removes a user from an clan.
 *
 * @param client - The DrizzleClient instance used for database operations.
 * @param clanData - The clan from which the user will be removed.
 * @param userId - The ID of the user to be removed from the clan.
 */
export const removeFromClan = async (
  client: DrizzleClient,
  clanData: NonNullable<ClanRouter["get"]>,
  user: UserData,
  reasons: string[],
) => {
  // Derived
  const userId = user.userId;
  const isLeader = clanData?.leaderId === userId;
  // Find another user, prefer coleaders in case it's leader being removed
  const otherUser = clanData?.members
    .filter((m) => hasRequiredRank(m.rank, CLAN_RANK_REQUIREMENT))
    .sort((a, b) => {
      if (checkCoLeader(a.userId, clanData)) return -1;
      if (checkCoLeader(b.userId, clanData)) return 1;
      return 0;
    })
    .find((m) => m.userId !== userId);
  const coLeadersToRemove = isLeader ? [userId, otherUser?.userId ?? null] : [userId];
  // Mutate
  await Promise.all([
    updateUserDataForRemoveFromClan(client, userId),
    deleteUserRequestForRemoveFromClan(client, userId),
    deleteBattleQueueMembersForUser(client, userId),
    insertActionLogForRemoveFromClan(client, userId, reasons, clanData, user),
    ...(!otherUser && ["HIDEOUT", "STRONGHOLD"].includes(clanData.village?.type)
      ? [
          deleteVillageForRemoveFromClan(client, clanData),
          deleteVillageStructureForRemoveFromClan(client, clanData),
          deleteWarForRemoveFromClan(client, clanData),
          deleteWarForRemoveFromClan2(client, clanData),
          deleteWarAllyForRemoveFromClan(client, clanData),
          deleteWarKillForRemoveFromClan(client, clanData),
          deleteWarKillForRemoveFromClan2(client, clanData),
          deleteSectorForRemoveFromClan(client, clanData),
        ]
      : []),
    ...(!otherUser
      ? [
          deleteClanForRemoveFromClan(client, clanData),
          updateUserDataForRemoveFromClan2(client, clanData, userId),
          deleteQueueById(client, clanData.id),
        ]
      : [
          updateClanForRemoveFromClan(
            client,
            isLeader,
            otherUser,
            clanData,
            coLeadersToRemove,
            userId,
          ),
          updateVillageForRemoveFromClan(client, isLeader, otherUser, clanData, user),
        ]),
  ]);
  if (otherUser) await syncStrongholdMembership(client, clanData.villageId);
};

/**
 * Remove the observed membership and an empty lobby, then release its queue ownership.
 * A delayed leave or kick must preserve a newer membership, ranked claim or combat.
 * The preloaded member count only permits a deletion attempt: recheck pending combat
 * and all entries except the departing ID, which parallel member cleanup may already remove.
 */
export const removeFromClanBattle = async (
  client: DrizzleClient,
  currentQueue: { id: string; userId: string }[],
  clanBattleId: string,
  userId: string,
) => {
  const entry = currentQueue.find((q) => q.userId === userId);
  if (!entry) return;
  await Promise.all([
    ...(currentQueue.length === 1
      ? [
          retryOnDeadlock(() =>
            deleteMpvpBattleQueueForRemoveFromClanBattle(client, clanBattleId, entry),
          ),
        ]
      : []),
    undoClanBattleJoin(client, userId, entry.id),
  ]);
};

export type ClanRouter = inferRouterOutputs<typeof clanRouter>;
