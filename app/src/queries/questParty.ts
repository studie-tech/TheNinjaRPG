/**
 * Database access for quest party; authorization and transaction scopes stay in callers.
 */

import { and, desc, eq, inArray, isNull, or, type SQL, sql } from "drizzle-orm";
import {
  overworldAiPlacement,
  questHistory,
  questParty,
  user2conversation,
  userData,
} from "@/drizzle/schema";
import { nextSnapshotSql } from "@/queries/concurrency";
import type { DrizzleClient } from "@/server/db";
import type { QuestTrackerType } from "@/validators/objectives";

/** Preload synchronization inputs with the character query, avoiding per-member round trips. */
export const questPartyRelations = {
  quest: true,
  members: {
    columns: {
      userId: true,
      username: true,
      questData: true,
      updatedAt: true,
      status: true,
      sector: true,
      longitude: true,
      latitude: true,
      defaultAutoCombat: true,
      battleId: true,
    },
  },
} as const;

/** Build the `questParty` lookup for `disband`, using predicates on `id`. */
export const findQuestPartyForDisband = (
  client: Pick<DrizzleClient, "query">,
  input: { partyId: string },
) =>
  client.query.questParty.findFirst({
    where: eq(questParty.id, input.partyId),
    with: questPartyRelations,
  });

/**
 * Build the `questParty` update for `disband`, setting `battleId` and `version`, using
 * predicates on `id`, `version`, `battleId`.
 */
export const updateQuestPartyForDisband = (
  client: Pick<DrizzleClient, "update">,
  claimId: string,
  party: { version: number; id: string },
) =>
  client
    .update(questParty)
    .set({ battleId: claimId, version: party.version + 1 })
    .where(
      and(
        eq(questParty.id, party.id),
        eq(questParty.version, party.version),
        isNull(questParty.battleId),
      ),
    );

/** Build a quest party battle-claim release guarded by the claim ID, advancing its version. */
export const releaseQuestPartyBattleClaim = (
  client: Pick<DrizzleClient, "update">,
  partyId: string,
  claimId: string,
) =>
  client
    .update(questParty)
    .set({ battleId: null, version: sql`${questParty.version} + 1` })
    .where(and(eq(questParty.id, partyId), eq(questParty.battleId, claimId)));

/** Build deletion of a quest party guarded by its battle claim. */
export const deleteClaimedQuestParty = (
  client: Pick<DrizzleClient, "delete">,
  partyId: string,
  claimId: string,
) =>
  client
    .delete(questParty)
    .where(and(eq(questParty.id, partyId), eq(questParty.battleId, claimId)));

/** Build the `user2conversation` deletion for `disband`, using predicates on `conversationId`. */
export const deleteUser2conversationForDisband = (
  client: Pick<DrizzleClient, "delete">,
  party: { id: string },
) =>
  client
    .delete(user2conversation)
    .where(eq(user2conversation.conversationId, party.id));

/** Build the `questParty` listing for `overview`, using predicates on `isPublic`, `invitedUserIds`, `memberIds`. */
export const listQuestPartyForOverview = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.questParty.findMany({
    where: or(
      eq(questParty.isPublic, true),
      sql`JSON_CONTAINS(${questParty.invitedUserIds}, JSON_QUOTE(${ctx.userId}))`,
      sql`JSON_CONTAINS(${questParty.memberIds}, JSON_QUOTE(${ctx.userId}))`,
    ),
    with: {
      quest: {
        columns: {
          name: true,
          image: true,
          teamEnabled: true,
          hidden: true,
          content: true,
          consecutiveObjectives: true,
        },
      },
      members: {
        columns: { userId: true, username: true, status: true, sector: true },
      },
    },
    orderBy: [
      desc(
        sql`JSON_CONTAINS(${questParty.invitedUserIds}, JSON_QUOTE(${ctx.userId})) OR JSON_CONTAINS(${questParty.memberIds}, JSON_QUOTE(${ctx.userId}))`,
      ),
      desc(questParty.createdAt),
    ],
    limit: 100,
  });

/** Build the `overworldAiPlacement` lookup for `overview`, using predicates on `id` and `isActive`. */
export const findOverworldAiPlacementForOverview = (
  client: Pick<DrizzleClient, "query">,
  encounter: { overworldPlacementId: string },
) =>
  client.query.overworldAiPlacement.findFirst({
    where: and(
      eq(overworldAiPlacement.id, encounter.overworldPlacementId),
      eq(overworldAiPlacement.isActive, true),
    ),
    columns: { sector: true, longitude: true, latitude: true },
  });

/** Build the `questParty` insert for `create`. */
export const insertQuestPartyForCreate = (
  client: Pick<DrizzleClient, "insert">,
  partyId: string,
  definition: { id: string; teamMaxPlayers: number },
  ctx: { userId: string },
  input: { isPublic: false | true },
  tracker: Omit<QuestTrackerType, "party"> & { party: undefined },
) =>
  client.insert(questParty).values({
    id: partyId,
    questId: definition.id,
    maxPlayers: definition.teamMaxPlayers,
    leaderId: ctx.userId,
    isPublic: input.isPublic,
    memberIds: [ctx.userId],
    invitedUserIds: [],
    tracker,
    contributions: {},
  });

/** Build the `questParty` deletion for `create`, using predicates on `id`. */
export const deleteQuestPartyForCreate = (
  client: Pick<DrizzleClient, "delete">,
  partyId: string,
) => client.delete(questParty).where(eq(questParty.id, partyId));

/** Build the `questParty` update for `join`, including predicates on `id`, `version`, `battleId`. */
export const updateQuestPartyForJoin = (
  client: Pick<DrizzleClient, "update">,
  transition: { party: { memberIds: string[]; invitedIds: string[] } },
  joinClaimId: string,
  party: { version: number; id: string },
) =>
  client
    .update(questParty)
    .set({
      memberIds: transition.party.memberIds,
      invitedUserIds: transition.party.invitedIds,
      battleId: joinClaimId,
      version: party.version + 1,
    })
    .where(
      and(
        eq(questParty.id, party.id),
        eq(questParty.version, party.version),
        isNull(questParty.battleId),
        sql`JSON_LENGTH(${questParty.memberIds}) < ${questParty.maxPlayers}`,
      ),
    );

/** Build the `questParty` lookup for `invite`, using predicates on `id`. */
export const findQuestPartyForInvite = (
  client: Pick<DrizzleClient, "query">,
  input: { partyId: string },
) =>
  client.query.questParty.findFirst({
    where: eq(questParty.id, input.partyId),
  });

/** Build the `userData` lookup for `invite`, using predicates on `username`. */
export const findUserDataForInvite = (
  client: Pick<DrizzleClient, "query">,
  input: { username: string },
) =>
  client.query.userData.findFirst({
    where: eq(userData.username, input.username),
    columns: { userId: true, isBanned: true, isAi: true },
  });

/** Build the `userData` lookup for `invite`, selecting only `isBanned` and `questPartyId`, using predicates on `userId`. */
export const findUserDataForInvite2 = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, ctx.userId),
    columns: { isBanned: true, questPartyId: true },
  });

/**
 * Build the `questParty` update for `invite`, setting `invitedUserIds` and `version`,
 * using predicates on `id` and `version`.
 */
export const updateQuestPartyForInvite = (
  client: Pick<DrizzleClient, "update">,
  transition: { party: { invitedIds: string[] } },
  party: { version: number; id: string },
) =>
  client
    .update(questParty)
    .set({
      invitedUserIds: transition.party.invitedIds,
      version: party.version + 1,
    })
    .where(and(eq(questParty.id, party.id), eq(questParty.version, party.version)));

/** Build the `questHistory` update for `acceptTeamQuest`, setting `previousAttempts`, using predicates on `id`. */
export const updateQuestHistoryForAcceptTeamQuest = (
  client: Pick<DrizzleClient, "update">,
  history: { id: string },
) =>
  client
    .update(questHistory)
    .set({ previousAttempts: sql`${questHistory.previousAttempts} + 1` })
    .where(eq(questHistory.id, history.id));

/** Release only this party's character reservation and invalidate stale character snapshots. */
export const releaseTeamSlot = (
  client: DrizzleClient,
  userId: string,
  partyId: string,
) =>
  client
    .update(userData)
    .set({
      questPartyId: null,
      updatedAt: nextSnapshotSql(userData.updatedAt),
    })
    .where(and(eq(userData.userId, userId), eq(userData.questPartyId, partyId)));

/** Build the `questParty` lookup for `removeMember`, using predicates on `id`. */
export const findQuestPartyForRemoveMember = (
  client: Pick<DrizzleClient, "query">,
  partyId: string,
) =>
  client.query.questParty.findFirst({
    where: eq(questParty.id, partyId),
    with: { quest: true },
  });

/**
 * Build the `userData` lookup for `removeMember`, selecting only `questPartyId` and
 * `status`, using predicates on `userId`.
 */
export const findUserDataForRemoveMember = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, userId),
    columns: { questPartyId: true, status: true },
  });

/** Build the `questParty` deletion for `removeMember`, using predicates on `id`, `version`, `battleId`. */
export const deleteQuestPartyForRemoveMember = (
  client: Pick<DrizzleClient, "delete">,
  partyId: string,
  party: { version: number },
) =>
  client
    .delete(questParty)
    .where(
      and(
        eq(questParty.id, partyId),
        eq(questParty.version, party.version),
        isNull(questParty.battleId),
      ),
    );

/** Build the `questParty` update for `removeMember`, using predicates on `id` and `version`. */
export const updateQuestPartyForRemoveMember = (
  client: Pick<DrizzleClient, "update">,
  members: string[],
  party: { memberIds: string[]; version: number },
  departureClaimId: null | string,
  transition: { party: { leaderId: string; invitedIds: string[] } },
  partyId: string,
  battleGuard: SQL<unknown>,
) =>
  client
    .update(questParty)
    .set({
      memberIds: members.length ? members : party.memberIds,
      battleId: departureClaimId,
      leaderId: transition.party.leaderId,
      invitedUserIds: transition.party.invitedIds,
      version: party.version + 1,
    })
    .where(
      and(
        eq(questParty.id, partyId),
        eq(questParty.version, party.version),
        battleGuard,
      ),
    );

/** Build the `overworldAiPlacement` listing for `startQuestPartyEncounter`, using predicates on `id` and `isActive`. */
export const listOverworldAiPlacementForStartQuestPartyEncounter = (
  client: Pick<DrizzleClient, "query">,
  placementIds: string[],
) =>
  client.query.overworldAiPlacement.findMany({
    where: and(
      inArray(overworldAiPlacement.id, placementIds),
      eq(overworldAiPlacement.isActive, true),
    ),
    columns: { id: true, sector: true, longitude: true, latitude: true },
    with: { aiTemplate: { columns: { isAi: true } } },
  });

/**
 * Build the `questParty` update for `publish`, setting `battleId` and `version`, using
 * predicates on `id` and `battleId`.
 */
export const updateQuestPartyForPublish = (
  client: Pick<DrizzleClient, "update">,
  result: { battleId?: undefined | string },
  party: { id: string },
  claimId: string,
) =>
  client
    .update(questParty)
    .set({
      battleId: result.battleId ?? null,
      version: sql`${questParty.version} + 1`,
    })
    .where(and(eq(questParty.id, party.id), eq(questParty.battleId, claimId)));

/**
 * Build the `questParty` update for `recover`, setting `battleId` and `version`, using
 * predicates on `id` and `battleId`.
 */
export const updateQuestPartyForRecover = (
  client: Pick<DrizzleClient, "update">,
  party: { id: string },
  claimId: string,
  battleId: string,
) =>
  client
    .update(questParty)
    .set({ battleId: null, version: sql`${questParty.version} + 1` })
    .where(
      and(
        eq(questParty.id, party.id),
        or(eq(questParty.battleId, claimId), eq(questParty.battleId, battleId)),
      ),
    );

/** Build the `userData` listing for `synchronizeQuestParty`, using predicates on `userId` and `questPartyId`. */
export const listUserDataForSynchronizeQuestParty = (
  client: Pick<DrizzleClient, "query">,
  missingIds: string[],
  party: { id: string },
  relations: Pick<typeof questPartyRelations, "members">,
) =>
  client.query.userData.findMany({
    where: and(
      inArray(userData.userId, missingIds),
      eq(userData.questPartyId, party.id),
    ),
    columns: relations.members.columns,
  });

/** Build the `questParty` update for `synchronizeQuestParty`, using predicates on `id` and `version`. */
export const updateQuestPartyForSynchronizeQuestParty = (
  client: Pick<DrizzleClient, "update">,
  next: Pick<import("@/drizzle/schema").QuestParty, "contributions" | "tracker">,
  battleId: null | string,
  memberIds: string[],
  leaderId: string,
  party: { version: number; id: string },
) =>
  client
    .update(questParty)
    .set({ ...next, battleId, memberIds, leaderId, version: party.version + 1 })
    .where(and(eq(questParty.id, party.id), eq(questParty.version, party.version)));

/** Build the `questParty` lookup for `synchronizeQuestParty`, using predicates on `id`. */
export const findQuestPartyForSynchronizeQuestParty = (
  client: Pick<DrizzleClient, "query">,
  party: { id: string },
  relations: typeof questPartyRelations,
) =>
  client.query.questParty.findFirst({
    where: eq(questParty.id, party.id),
    with: relations,
  });

/** Build the `questParty` update for `resetQuestPartyProgress`, using predicates on `id` and `version`. */
export const updateQuestPartyForResetQuestPartyProgress = (
  client: Pick<DrizzleClient, "update">,
  tracker: import("@/validators/objectives").QuestTrackerType,
  current: { version: number },
  party: { id: string },
) =>
  client
    .update(questParty)
    .set({ tracker, contributions: {}, version: current.version + 1 })
    .where(and(eq(questParty.id, party.id), eq(questParty.version, current.version)));

/** Build the `userData` lookup for `saveQuestPartyMember`, using predicates on `userId`. */
export const findUserDataForSaveQuestPartyMember = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, userId),
    columns: { questData: true, questPartyId: true, updatedAt: true, status: true },
  });
