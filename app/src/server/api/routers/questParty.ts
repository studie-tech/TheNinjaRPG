import { eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { QUEST_PARTY_TYPES } from "@/drizzle/constants";
import { type Quest, questParty, userData } from "@/drizzle/schema";

import { questCoopParty, transitionCoopParty } from "@/libs/coop";
import { isQuestComplete } from "@/libs/objectives";
import { getServerPusher } from "@/libs/pusher";
import {
  getActiveObjectives,
  getNewTrackers,
  isAvailableUserQuests,
  isObjectiveLocationSatisfied,
  isQuestRankAllowed,
  type QuestConsequence,
  questTypeConcurrentBlockMessage,
  questUiAccessBlockMessage,
} from "@/libs/quest";
import { deleteConversationMembership } from "@/queries/comments";
import {
  deleteClaimedQuestParty,
  deleteQuestPartyForCreate,
  deleteQuestPartyForRemoveMember,
  deleteUser2conversationForDisband,
  findOverworldAiPlacementForOverview,
  findQuestPartyForDisband,
  findQuestPartyForInvite,
  findQuestPartyForRemoveMember,
  findUserDataForInvite,
  findUserDataForInvite2,
  findUserDataForRemoveMember,
  insertQuestPartyForCreate,
  listOverworldAiPlacementForStartQuestPartyEncounter,
  listQuestPartyForOverview,
  releaseQuestPartyBattleClaim,
  releaseTeamSlot,
  updateQuestHistoryForAcceptTeamQuest,
  updateQuestPartyForDisband,
  updateQuestPartyForInvite,
  updateQuestPartyForJoin,
  updateQuestPartyForPublish,
  updateQuestPartyForRecover,
  updateQuestPartyForRemoveMember,
} from "@/queries/questParty";
import { fetchQuest, fetchUserQuestByQuestId } from "@/queries/quests";
import { fetchSectorVillage } from "@/queries/village";
import { initiateBattle } from "@/routers/combat";
import { fetchUpdatedUser, type UserWithRelations } from "@/routers/profile";
import { assignQuestToUser } from "@/routers/quests";
import { createTRPCRouter, errorResponse, protectedProcedure } from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { claimUserSnapshot } from "@/server/utils/concurrency";
import {
  cleanupCoopBattleStart,
  joinCoopChat,
  launchCoopEncounter,
} from "@/server/utils/coop";
import { saveQuestPartyMember, synchronizeQuestParty } from "@/server/utils/questParty";
import { secondsPassed } from "@/utils/time";
import { QuestTracker } from "@/validators/objectives";
import {
  questPartyCreateSchema,
  questPartyIdSchema,
  questPartyInviteSchema,
  questPartyRemoveSchema,
} from "@/validators/questParty";

/** Shared quest progress uses party CAS; membership and reward receipts remain personal. */
export const questPartyRouter = createTRPCRouter({
  /** Preserve each member's solo continuation before deleting the canonical team tracker. */
  disband: protectedProcedure
    .input(questPartyIdSchema)
    .mutation(async ({ ctx, input }) => {
      const loaded = await findQuestPartyForDisband(ctx.drizzle, input);
      const party = loaded?.quest
        ? await synchronizeQuestParty(ctx.drizzle, loaded)
        : loaded;
      if (!party) return errorResponse("Quest team not found");
      const transition = transitionCoopParty(
        "quest",
        questCoopParty(party),
        ctx.userId,
        "disband",
      );
      if (!transition.success) return errorResponse(transition.message);
      // Include attached members whose roster removal still awaits personal detachment.
      const members = [...(loaded?.members ?? []), ...party.members];
      if (members.some((member) => member.status === "BATTLE"))
        return errorResponse("Finish all members' battles before disbanding the team");
      const claimId = `claiming:${Date.now()}:${nanoid()}`;
      const claimed = await updateQuestPartyForDisband(ctx.drizzle, claimId, party);
      if (claimed.rowsAffected !== 1)
        return errorResponse("The team changed. Please try again");
      // Keep canonical progress until every member has atomically saved it and detached.
      // A concurrent update to another quest retries from that member's fresh snapshot.
      try {
        const detached = await Promise.all(
          [...new Set(members.map((member) => member.userId))].map((userId) =>
            saveQuestPartyMember(ctx.drizzle, party, userId, true),
          ),
        );
        if (detached.some((saved) => !saved)) {
          await releaseQuestPartyBattleClaim(ctx.drizzle, party.id, claimId);
          return errorResponse(
            "Finish all members' battles before disbanding the team",
          );
        }
        await deleteClaimedQuestParty(ctx.drizzle, party.id, claimId);
        await deleteUser2conversationForDisband(ctx.drizzle, party);
      } catch (error) {
        await releaseQuestPartyBattleClaim(ctx.drizzle, party.id, claimId);
        throw error;
      }
      // Notifications are best effort once personal progress and membership have saved.
      await Promise.allSettled(
        [...new Set(members.map((member) => member.userId))].map((userId) =>
          getServerPusher().trigger(userId, "event", {
            type: "questTeam",
            message:
              "Your quest team disbanded. Your progress and unclaimed rewards are in your Logbook.",
            route: "/profile?tab=dashboard#progress-heading",
            routeText: "Open Logbook",
          }),
        ),
      );
      return {
        success: true,
        message: "Quest team disbanded. Members can continue their own quests",
      };
    }),
  /** Let the leader launch the current objective using the synchronized, co-located roster. */
  startEncounter: protectedProcedure
    .input(questPartyIdSchema)
    .mutation(async ({ ctx, input }) => {
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });
      return startQuestPartyEncounter({
        client: ctx.drizzle,
        user,
        userId: ctx.userId,
        partyId: input.partyId,
      });
    }),
  /** Return the current team and discoverable invitations without exposing private trackers. */
  overview: protectedProcedure.query(async ({ ctx }) => {
    const [{ user }, parties] = await Promise.all([
      fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
        allowQuestPartySyncFallback: true,
      }),
      listQuestPartyForOverview(ctx.drizzle, ctx),
    ]);
    const objectiveIds = new Set(
      user?.questParty?.quest.content.objectives.map((entry) => entry.id) ?? [],
    );
    const encounter =
      user &&
      getActiveObjectives(user).find(
        (entry) =>
          objectiveIds.has(entry.id) &&
          (entry.task === "start_battle" || entry.task === "defeat_opponents"),
      );
    // The bound placement comes from the active objective; its live tile overrides authored coordinates.
    const placement =
      encounter?.task === "defeat_opponents" && encounter.overworldPlacementId
        ? await findOverworldAiPlacementForOverview(ctx.drizzle, {
            overworldPlacementId: encounter.overworldPlacementId,
          })
        : undefined;
    // Generic battles gather at the leader; hidden map objectives reveal their tile in-sector.
    // An unavailable bound NPC has no fallback to potentially stale authored coordinates.
    const encounterLocation =
      encounter?.task === "start_battle"
        ? user?.questParty?.members.find(
            (member) => member.userId === user.questParty?.leaderId,
          )
        : encounter &&
            (!("hideLocation" in encounter && encounter.hideLocation) ||
              (placement?.sector ?? encounter.sector) === user?.sector)
          ? (placement ??
            ("sector" in encounter && !encounter.overworldPlacementId
              ? encounter
              : undefined))
          : undefined;
    return {
      current: user?.questParty
        ? {
            id: user.questParty.id,
            version: user.questParty.version,
            questId: user.questParty.questId,
            name: user.questParty.quest.name,
            leaderId: user.questParty.leaderId,
            isPublic: user.questParty.isPublic,
            encounterAtNpc: !!encounter?.overworldPlacementId,
            encounterLocation: encounterLocation
              ? {
                  sector: encounterLocation.sector,
                  longitude: encounterLocation.longitude,
                  latitude: encounterLocation.latitude,
                }
              : null,
            // Non-combat quests use their Logbook objectives instead of an unusable launch button.
            hasEncounter: !!encounter,
            members: user.questParty.members.map(
              ({ userId, username, sector, longitude, latitude, status }) => ({
                userId,
                username,
                sector,
                longitude,
                latitude,
                status,
              }),
            ),
            battleId: user.questParty.battleId,
            // Failed terminal goals are done but do not entitle members to final rewards.
            completed:
              !user.questParty.tracker.failed &&
              isQuestComplete(user.questParty.quest, user.questParty.tracker),
            failed: user.questParty.tracker.failed ?? false,
          }
        : null,
      teams: parties
        .filter(
          (party) =>
            party.quest?.teamEnabled &&
            !party.tracker.failed &&
            !isQuestComplete(party.quest, party.tracker) &&
            (!party.quest.hidden ||
              party.memberIds.includes(ctx.userId) ||
              party.invitedUserIds.includes(ctx.userId)),
        )
        .map((party) => ({
          id: party.id,
          questId: party.questId,
          name: party.quest.name,
          isPublic: party.isPublic,
          leaderId: party.leaderId,
          members: party.members,
          battleId: party.battleId,
          invited: party.invitedUserIds.includes(ctx.userId),
        })),
    };
  }),
  /** Reserve the character's team slot before accepting the quest and creating its shared tracker. */
  create: protectedProcedure
    .input(questPartyCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const [{ user }, definition, history] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        fetchQuest(ctx.drizzle, input.questId),
        fetchUserQuestByQuestId(ctx.drizzle, ctx.userId, input.questId),
      ]);
      if (!user) return errorResponse("User not found");
      const block = teamQuestBlock(user, definition);
      if (block) return errorResponse(block);
      if (!definition) return errorResponse("Quest not found");
      const partyId = nanoid();
      const reserved = await claimUserSnapshot({
        client: ctx.drizzle,
        userId: ctx.userId,
        updatedAt: user.updatedAt,
        set: { questPartyId: partyId },
        where: [isNull(userData.questPartyId), eq(userData.status, "AWAKE")],
      });
      if (!reserved.success)
        return errorResponse("You already have a quest team or your status changed");
      user.questPartyId = partyId;
      user.updatedAt = reserved.claimedAt;
      try {
        const result = await acceptTeamQuest(ctx.drizzle, user, definition, history);
        if (!result.success) {
          await releaseTeamSlot(ctx.drizzle, ctx.userId, partyId);
          return result;
        }
        const personal =
          user.questData?.find((tracker) => tracker.id === definition.id) ??
          QuestTracker.parse({ id: definition.id });
        const tracker = {
          ...personal,
          party: undefined,
          goals: personal.goals.map((goal) => ({ ...goal, collected: false })),
        };
        await insertQuestPartyForCreate(
          ctx.drizzle,
          partyId,
          definition,
          ctx,
          input,
          tracker,
        );
        await Promise.all([
          saveQuestPartyMember(
            ctx.drizzle,
            { id: partyId, questId: definition.id, tracker },
            ctx.userId,
          ),
          joinCoopChat(
            ctx.drizzle,
            partyId,
            `${definition.name} Quest Team`,
            ctx.userId,
          ),
        ]);
        return { success: true, message: "Quest team formed" };
      } catch (error) {
        await releaseTeamSlot(ctx.drizzle, ctx.userId, partyId);
        await deleteQuestPartyForCreate(ctx.drizzle, partyId);
        throw error;
      }
    }),
  /** Reserve membership and claim one roster version before adopting existing shared progress. */
  join: protectedProcedure
    .input(questPartyIdSchema)
    .mutation(async ({ ctx, input }) => {
      const [{ user }, loaded] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        findQuestPartyForDisband(ctx.drizzle, input),
      ]);
      if (!user || !loaded) return errorResponse("Quest team not found");
      const block = teamQuestBlock(user, loaded.quest);
      if (block) return errorResponse(block);
      const party = await synchronizeQuestParty(ctx.drizzle, loaded);
      if (party.tracker.failed || isQuestComplete(party.quest, party.tracker))
        return errorResponse(
          "This team has finished its quest. Form a new team to play again",
        );
      const transition = transitionCoopParty(
        "quest",
        questCoopParty(party),
        ctx.userId,
        "join",
      );
      if (!transition.success) return errorResponse(transition.message);
      const joinClaimId = `claiming:${Date.now()}:${nanoid()}`;
      const [history, reserved] = await Promise.all([
        fetchUserQuestByQuestId(ctx.drizzle, ctx.userId, party.questId),
        claimUserSnapshot({
          client: ctx.drizzle,
          userId: ctx.userId,
          updatedAt: user.updatedAt,
          set: { questPartyId: party.id },
          where: [isNull(userData.questPartyId), eq(userData.status, "AWAKE")],
        }),
      ]);
      if (!reserved.success)
        return errorResponse("You already have a quest team or your status changed");
      user.questPartyId = party.id;
      user.updatedAt = reserved.claimedAt;
      // One roster CAS enforces capacity and prevents joins while an encounter is starting.
      const joined = await updateQuestPartyForJoin(
        ctx.drizzle,
        transition,
        joinClaimId,
        party,
      );
      if (joined.rowsAffected !== 1) {
        await releaseTeamSlot(ctx.drizzle, ctx.userId, party.id);
        return errorResponse(
          "The team changed or is full. Please refresh and try again",
        );
      }
      try {
        const result = await acceptTeamQuest(ctx.drizzle, user, party.quest, history);
        if (!result.success) {
          await removeMember(ctx.drizzle, party.id, ctx.userId, joinClaimId);
          return result;
        }
        await Promise.all([
          saveQuestPartyMember(ctx.drizzle, party, ctx.userId),
          joinCoopChat(
            ctx.drizzle,
            party.id,
            `${party.quest.name} Quest Team`,
            ctx.userId,
          ),
        ]);
        await releaseQuestPartyBattleClaim(ctx.drizzle, party.id, joinClaimId);
        return {
          success: true,
          message: "Joined quest team. All objectives are shared",
        };
      } catch (error) {
        await removeMember(ctx.drizzle, party.id, ctx.userId, joinClaimId);
        throw error;
      }
    }),
  /** Add a username-resolved invitation through the leader's current party version. */
  invite: protectedProcedure
    .input(questPartyInviteSchema)
    .mutation(async ({ ctx, input }) => {
      const [party, invited, inviter] = await Promise.all([
        findQuestPartyForInvite(ctx.drizzle, input),
        findUserDataForInvite(ctx.drizzle, input),
        findUserDataForInvite2(ctx.drizzle, ctx),
      ]);
      if (
        !party ||
        party.leaderId !== ctx.userId ||
        inviter?.questPartyId !== party.id ||
        inviter.isBanned
      )
        return errorResponse("Only the team leader can invite players");
      if (!invited || invited.isBanned || invited.isAi)
        return errorResponse("Player not available");
      const transition = transitionCoopParty(
        "quest",
        questCoopParty(party),
        ctx.userId,
        "invite",
        invited.userId,
      );
      if (!transition.success) return errorResponse(transition.message);
      const saved = await updateQuestPartyForInvite(ctx.drizzle, transition, party);
      if (saved.rowsAffected !== 1)
        return errorResponse("Team changed. Please try again");
      await Promise.allSettled([
        getServerPusher().trigger(invited.userId, "event", {
          type: "questTeam",
          message: "You were invited to a quest team. Open Quest Teams to accept.",
        }),
      ]);
      return {
        success: true,
        message: "Invitation sent. The player can accept on the Quest Teams page",
      };
    }),
  /** Let the leader remove another member while preserving solo progress and reward receipts. */
  remove: protectedProcedure
    .input(questPartyRemoveSchema)
    .mutation(async ({ ctx, input }) => {
      const loaded = await findQuestPartyForDisband(ctx.drizzle, input);
      if (
        !loaded ||
        loaded.leaderId !== ctx.userId ||
        input.userId === ctx.userId ||
        !loaded.memberIds.includes(ctx.userId)
      )
        return errorResponse("Only the team leader can remove another member");
      if (
        !loaded.memberIds.includes(input.userId) &&
        !loaded.members.some((member) => member.userId === input.userId)
      )
        return errorResponse("This player is not in the team");
      const party = loaded.quest
        ? await synchronizeQuestParty(ctx.drizzle, loaded)
        : loaded;
      if (party.battleId)
        return errorResponse("Finish the team's encounter before removing members");
      const result = await removeMember(
        ctx.drizzle,
        party.id,
        input.userId,
        undefined,
        ctx.userId,
      );
      if (result.success)
        await Promise.allSettled([
          getServerPusher().trigger(input.userId, "event", {
            type: "questTeam",
            message:
              "You left the quest team. Your quest progress and unclaimed rewards are in your Logbook.",
            route: "/profile?tab=dashboard#progress-heading",
            routeText: "Open Logbook",
          }),
        ]);
      return result.success
        ? {
            success: true,
            message: "Member removed. Their quest progress and rewards are preserved",
          }
        : result;
    }),
  /** Detach with personal receipts intact; retries finish an earlier partial departure. */
  leave: protectedProcedure
    .input(questPartyIdSchema)
    .mutation(async ({ ctx, input }) => {
      const loaded = await findQuestPartyForDisband(ctx.drizzle, input);
      if (!loaded) return errorResponse("You are not in this team");
      if (!loaded.memberIds.includes(ctx.userId)) {
        const member = loaded.members.find((entry) => entry.userId === ctx.userId);
        const isEmptyLeader =
          !loaded.memberIds.length && loaded.leaderId === ctx.userId;
        // The last leader can finish empty-team cleanup after personal detachment.
        // Otherwise a saved tracker proves membership; an unsaved join keeps its grace period.
        if (
          !isEmptyLeader &&
          (!member ||
            (!member.questData?.some((entry) => entry.party?.id === loaded.id) &&
              secondsPassed(member.updatedAt) <= 60))
        )
          return errorResponse("You are not in this team");
        if (isEmptyLeader && loaded.quest)
          await synchronizeQuestParty(ctx.drizzle, loaded);
        return removeMember(ctx.drizzle, input.partyId, ctx.userId);
      }
      const party = loaded.quest
        ? await synchronizeQuestParty(ctx.drizzle, loaded)
        : loaded;
      if (party.battleId)
        return errorResponse("Finish the team's encounter before leaving");
      return removeMember(ctx.drizzle, input.partyId, ctx.userId);
    }),
});

/** Return an expected rejection for characters or quest types that cannot use teams. */
const teamQuestBlock = (
  user: NonNullable<UserWithRelations>,
  definition: Quest | undefined,
) => {
  if (user.isBanned || user.isAi) return "You cannot join quest teams";
  if (user.status !== "AWAKE") return "You must be awake to join a quest team";
  if (
    !definition?.teamEnabled ||
    !QUEST_PARTY_TYPES.some((type) => type === definition.questType)
  )
    return "Content staff have not enabled teams for this quest";
  // Entry receipts belong to personal runs; a shared projection must not bypass their fee.
  if (definition.content.entryItems?.length)
    return "Quests with entry items require a solo run";
  return null;
};

/**
 * Accept a quest after the caller reserves membership: reuse an active attempt,
 * consume an attempt for a closed completed helper without reopening its reward receipt,
 * or assign a new attempt through the existing UI eligibility guards.
 */
const acceptTeamQuest = async (
  client: DrizzleClient,
  user: NonNullable<UserWithRelations>,
  definition: Quest,
  history: Awaited<ReturnType<typeof fetchUserQuestByQuestId>>,
) => {
  if (user.userQuests.some((entry) => entry.questId === definition.id && !entry.endAt))
    return { success: true, message: "Using your active quest attempt" };
  const sectorVillage = await fetchSectorVillage(client, user.sector);
  if (history && ((history.previousCompletes ?? 0) > 0 || history.completed)) {
    // Helpers still meet rank, prerequisites, dates, location and concurrent quest limits.
    // Their existing completion receipt stays closed, preventing any additional reward payout.
    const availability = isAvailableUserQuests(
      { ...definition, completed: 0, previousAttempts: 0, previousCompletes: 0 },
      user,
    );
    const guard =
      questUiAccessBlockMessage(definition, user, sectorVillage) ??
      questTypeConcurrentBlockMessage(definition, user);
    if (!availability.check || guard || !isQuestRankAllowed(definition, user))
      return errorResponse(
        guard || availability.message || `Rank ${user.rank} not allowed`,
      );
    if (history?.pendingRewardChoice)
      return errorResponse("Claim your pending quest reward choice first");
    await updateQuestHistoryForAcceptTeamQuest(client, history);
    user.userQuests.push({
      id: `party-${user.questPartyId}`,
      userId: user.userId,
      questId: definition.id,
      questType: definition.questType,
      startedAt: new Date(),
      endAt: null,
      completed: 0,
      previousAttempts: 0,
      previousCompletes: 0,
      quest: structuredClone(definition),
    });
    user.questData = getNewTrackers(user, [{ task: "any" }]).trackers;
    return {
      success: true,
      message: "Joining as a helper; this completed quest pays no rewards",
    };
  }
  return assignQuestToUser({
    client,
    user,
    quest: definition,
    source: "ui",
    sectorVillage,
    prevAttempt: history,
  });
};

/**
 * Remove one roster member through CAS, then save their solo continuation and revoke chat access.
 * The canonical tracker survives partial cleanup; unrelated combat defers detachment so its
 * immutable quest snapshot cannot overwrite the saved personal receipts during settlement.
 */
const removeMember = async (
  client: DrizzleClient,
  partyId: string,
  userId: string,
  joinClaimId?: string,
  removingLeaderId?: string,
) => {
  // The roster and leader move in one CAS; no missing-row locks or transactions.
  for (let attempt = 0; attempt < 5; attempt++) {
    const [party, member] = await Promise.all([
      findQuestPartyForRemoveMember(client, partyId),
      findUserDataForRemoveMember(client, userId),
    ]);
    if (!party) return { success: true, message: "Already left quest team" };
    // Recheck leadership on each CAS retry so a transfer cannot authorize a stale removal.
    if (
      removingLeaderId &&
      (party.leaderId !== removingLeaderId ||
        !party.memberIds.includes(removingLeaderId))
    )
      return errorResponse("Only the team leader can remove another member");
    if (member?.questPartyId === party.id && member.status === "BATTLE")
      return errorResponse("Finish your battle before leaving the quest team");
    if (!party.memberIds.includes(userId)) {
      // The roster CAS may have committed before the personal save failed.
      if (!(await saveQuestPartyMember(client, party, userId, true)))
        return errorResponse("Finish your battle before leaving the quest team");
      await deleteConversationMembership(client, partyId, userId);
      if (!party.memberIds.length) {
        const deleted = await deleteQuestPartyForRemoveMember(client, partyId, party);
        if (deleted.rowsAffected !== 1) continue;
      }
      return { success: true, message: "Already left quest team" };
    }
    if (party.battleId && party.battleId !== joinClaimId)
      return errorResponse("Finish the team's encounter before leaving");
    const battleGuard = joinClaimId
      ? eq(questParty.battleId, joinClaimId)
      : isNull(questParty.battleId);
    const transition = transitionCoopParty(
      "quest",
      questCoopParty({ ...party, battleId: null }),
      userId,
      "leave",
    );
    if (!transition.success) return errorResponse(transition.message);
    const members = transition.party.memberIds;
    const departureClaimId = members.length
      ? null
      : `claiming:${Date.now()}:${nanoid()}`;
    // Retain the last roster and canonical progress while its personal save commits.
    const saved = await updateQuestPartyForRemoveMember(
      client,
      members,
      party,
      departureClaimId,
      transition,
      partyId,
      battleGuard,
    );
    if (saved.rowsAffected !== 1) continue;
    try {
      const detached = await saveQuestPartyMember(client, party, userId, true);
      if (!detached) {
        if (departureClaimId)
          await releaseQuestPartyBattleClaim(client, partyId, departureClaimId);
        return errorResponse("Finish your battle before leaving the quest team");
      }
      await deleteConversationMembership(client, partyId, userId);
      if (departureClaimId)
        await deleteClaimedQuestParty(client, partyId, departureClaimId);
    } catch (error) {
      if (departureClaimId)
        await releaseQuestPartyBattleClaim(client, partyId, departureClaimId);
      throw error;
    }
    return {
      success: true,
      message: "Left quest team. Remaining members keep the shared progress",
    };
  }
  return errorResponse("Team changed. Please try again");
};

/**
 * Start the shared encounter from the lobby, a bound NPC interaction or an authored ambush.
 * Server callers supply trusted selectors; the leader and awake, co-located roster are
 * validated before a versioned claim. Initiation preloads team quest state into combat,
 * and a failed initiation releases only this invocation's claim.
 */
export const startQuestPartyEncounter = async ({
  client,
  user,
  userId,
  partyId,
  objectiveId,
  atPlacementIds,
  ambush,
}: {
  client: DrizzleClient;
  user: UserWithRelations;
  userId: string;
  partyId: string;
  /** Objective selected by an authoritative server interaction, never client input. */
  objectiveId?: string;
  /** Server-verified placements; lobby launches resolve live NPC tiles when omitted. */
  atPlacementIds?: ReadonlySet<string>;
  /** Authored quest attackers rolled by the server's travel consequence handler. */
  ambush?: QuestConsequence;
}) => {
  const party = user?.questParty;
  if (!user || !party || party.id !== partyId || party.leaderId !== userId)
    return errorResponse("Only the team leader can start encounters");
  const block = teamQuestBlock(user, party.quest);
  if (block || party.tracker.failed)
    return errorResponse(block ?? "This team cannot start encounters");
  if (party.battleId)
    return errorResponse("The team's encounter is already starting or in progress");
  const objectiveIds = new Set(party.quest.content.objectives.map((entry) => entry.id));
  const activeObjectives = ambush
    ? []
    : getActiveObjectives(user).filter(
        (entry) =>
          objectiveIds.has(entry.id) &&
          (!objectiveId || entry.id === objectiveId) &&
          (entry.task === "start_battle" || entry.task === "defeat_opponents"),
      );
  if (!atPlacementIds) {
    const placementIds = activeObjectives.flatMap((entry) =>
      entry.overworldPlacementId ? [entry.overworldPlacementId] : [],
    );
    // Only bound encounters need a placement lookup; its live tile is authoritative.
    const placements = placementIds.length
      ? await listOverworldAiPlacementForStartQuestPartyEncounter(client, placementIds)
      : [];
    atPlacementIds = new Set(
      placements
        .filter(
          (placement) =>
            placement.aiTemplate?.isAi &&
            placement.sector === user.sector &&
            placement.longitude === user.longitude &&
            placement.latitude === user.latitude,
        )
        .map((placement) => placement.id),
    );
  }
  const activeObjective = activeObjectives.find(
    (entry) =>
      entry.task === "start_battle" ||
      isObjectiveLocationSatisfied(user, entry, atPlacementIds),
  );
  const objective =
    activeObjective && "opponentAIs" in activeObjective ? activeObjective : undefined;
  if (!ambush && !objective)
    return errorResponse(
      activeObjectives.length > 0
        ? "Travel to the objective location before starting the encounter"
        : "There is no active combat objective",
    );
  if (
    party.members.length !== party.memberIds.length ||
    party.members.some(
      (member) =>
        member.status !== "AWAKE" ||
        member.sector !== user.sector ||
        member.longitude !== user.longitude ||
        member.latitude !== user.latitude,
    )
  )
    return errorResponse("All team members must be awake and on the leader's tile");
  const transition = transitionCoopParty(
    "quest",
    questCoopParty(party),
    userId,
    "start",
  );
  if (!transition.success) return errorResponse(transition.message);
  return launchCoopEncounter({
    reserve: async ({ claimId }) => {
      const claim = await updateQuestPartyForDisband(client, claimId, party);
      return claim.rowsAffected === 1;
    },
    initiate: ({ battleId }) =>
      initiateBattle(
        {
          client: client,
          cacheUserId: userId,
          userIds: party.memberIds,
          targetIds:
            ambush?.ids ??
            objective?.opponentAIs.flatMap(
              (opponent) =>
                Array(opponent.number).fill(opponent.ids).flat() as string[],
            ) ??
            [],
          allyAiIds:
            objective && "allyAIs" in objective
              ? objective.allyAIs.flatMap(
                  (ally) => Array(ally.number).fill(ally.ids).flat() as string[],
                )
              : [],
          sector: user.sector,
          longitude: user.longitude,
          latitude: user.latitude,
          scaleTarget: ambush?.scaleStats ?? objective?.opponent_scaled_to_user,
          forceKeepPools:
            ambush?.forceKeepPools ?? objective?.keepOriginalPools ?? false,
          questBattleSource: objective
            ? { questId: party.questId, objectiveId: objective.id }
            : undefined,
          givePools: ambush?.givePools ?? objective?.givePools,
          startingEffects: ambush?.startingEffects ?? [
            ...(objective?.applyBuffs ?? []),
            ...(objective?.applyDebuffs ?? []),
          ],
          autoCombatUserIds: party.members
            .filter((member) => member.defaultAutoCombat)
            .map((member) => member.userId),
          coop: {
            kind: "quest",
            battleId,
            id: party.id,
            quest: party.quest,
            tracker: party.tracker,
          },
        },
        ambush ? "RANDOM_ENCOUNTER" : "QUEST",
        ambush?.scaleGains ?? objective?.scaleGains ?? 1,
      ),
    publish: async ({ claimId }, result) => {
      await updateQuestPartyForPublish(client, result, party, claimId);
    },
    recover: async ({ claimId, battleId }) => {
      await cleanupCoopBattleStart(client, battleId, party.memberIds);
      await updateQuestPartyForRecover(client, party, claimId, battleId);
    },
  });
};
