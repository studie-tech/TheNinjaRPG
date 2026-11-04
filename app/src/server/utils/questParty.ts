import { eq, ne } from "drizzle-orm";
import { type Quest, type QuestParty, type UserData, userData } from "@/drizzle/schema";

import {
  mergePartyProgress,
  PARTY_CLAIM_TTL_MS,
  parsePartyClaim,
  projectPartyTracker,
  questPartyHelperAttemptId,
} from "@/libs/questParty";
import {
  findQuestPartyForSynchronizeQuestParty,
  findUserDataForSaveQuestPartyMember,
  listUserDataForSynchronizeQuestParty,
  questPartyRelations,
  updateQuestPartyForResetQuestPartyProgress,
  updateQuestPartyForSynchronizeQuestParty,
} from "@/queries/questParty";
import type { UserWithRelations } from "@/server/api/routers/profile";
import type { DrizzleClient } from "@/server/db";
import { claimUserSnapshot } from "@/server/utils/concurrency";
import type { QuestTrackerType } from "@/validators/objectives";

/** Canonical progress plus the member snapshots needed for synchronization and encounter guards. */
export type LoadedQuestParty = QuestParty & {
  quest: Quest;
  members: Pick<
    UserData,
    | "userId"
    | "username"
    | "questData"
    | "updatedAt"
    | "status"
    | "sector"
    | "longitude"
    | "latitude"
    | "defaultAutoCombat"
    | "battleId"
  >[];
};

/** Synchronize a party whose quest still exists; a deleted quest has nothing to merge. */
export const synchronizeExistingQuestParty = async <
  T extends LoadedQuestParty | undefined,
>(
  client: DrizzleClient,
  loaded: T,
) => (loaded?.quest ? synchronizeQuestParty(client, loaded) : loaded);

/**
 * Merge contributions through party CAS, confirming missing members before pruning.
 * A committed member may have departed since preload; include that accepted progress once
 * without restoring their membership. Return the synchronized party with its live roster.
 */
export const synchronizeQuestParty = async (
  client: DrizzleClient,
  loaded: LoadedQuestParty,
  committedMember?: LoadedQuestParty["members"][number],
): Promise<LoadedQuestParty> => {
  let party = loaded;
  for (let attempt = 0; attempt < 5; attempt++) {
    const liveMembers = party.members.filter((member) =>
      party.memberIds.includes(member.userId),
    );
    // Confirm missing relations before pruning: an incomplete preload is not a departure.
    // Explicitly detached members still reconcile after interrupted cleanup.
    // Hydrate before merging contributions or reconciling battle locks.
    const missingIds = party.memberIds.filter(
      (id) => !liveMembers.some((member) => member.userId === id),
    );
    const attached = missingIds.length
      ? await listUserDataForSynchronizeQuestParty(
          client,
          missingIds,
          party,
          questPartyRelations,
        )
      : [];
    liveMembers.push(...attached);
    const members = committedMember
      ? [
          ...liveMembers.filter((member) => member.userId !== committedMember.userId),
          committedMember,
        ]
      : liveMembers;
    const memberIds = party.memberIds.filter((id) =>
      liveMembers.some((member) => member.userId === id),
    );
    const leaderId = memberIds.includes(party.leaderId)
      ? party.leaderId
      : (memberIds[0] ?? party.leaderId);
    const next = mergePartyProgress(party, members, party.quest);
    const claim = parsePartyClaim(party.battleId);
    const isFreshClaim = !!claim && claim.issuedAt > Date.now() - PARTY_CLAIM_TTL_MS;
    // A failed publication retains the encoded reservation. The preloaded members prove
    // whether that exact battle committed, without another database fetch.
    const reservedBattleId = claim?.reservedBattleId;
    const boundBattleId =
      reservedBattleId &&
      liveMembers.some((member) => member.battleId === reservedBattleId)
        ? reservedBattleId
        : undefined;
    const battleId =
      boundBattleId ??
      (party.battleId &&
      !isFreshClaim &&
      !liveMembers.some(
        (member) => member.battleId === (reservedBattleId ?? party.battleId),
      )
        ? null
        : party.battleId);
    if (
      memberIds.length === party.memberIds.length &&
      battleId === party.battleId &&
      JSON.stringify(next.tracker) === JSON.stringify(party.tracker) &&
      JSON.stringify(next.contributions) === JSON.stringify(party.contributions)
    )
      return { ...party, members: liveMembers };
    const saved = await updateQuestPartyForSynchronizeQuestParty(
      client,
      next,
      battleId,
      memberIds,
      leaderId,
      party,
    );
    if (saved.rowsAffected === 1)
      return {
        ...party,
        ...next,
        battleId,
        memberIds,
        leaderId,
        members: liveMembers,
        version: party.version + 1,
      };
    const fresh = await findQuestPartyForSynchronizeQuestParty(
      client,
      party,
      questPartyRelations,
    );
    if (!fresh) return party;
    party = fresh;
  }
  throw new Error("Quest team changed repeatedly; please try again");
};

/** Publish the guarded member snapshot; retained contributions allow a later sync to retry. */
export const publishQuestPartyProgress = async (
  client: DrizzleClient,
  user: NonNullable<UserWithRelations>,
  trackers: QuestTrackerType[],
) => {
  if (!user.questParty) return;
  const members = user.questParty.members.map((member) =>
    member.userId === user.userId ? { ...member, questData: trackers } : member,
  );
  user.questParty = await synchronizeQuestParty(
    client,
    {
      ...user.questParty,
      members,
    },
    members.find((member) => member.userId === user.userId),
  );
};

/**
 * Publish the caller's post-reset personal tracker with a new shared generation via CAS.
 * Clear acknowledged contributions and mark removed goals so unrelated receipts survive.
 * Adopt a concurrently advanced generation instead of applying the same reset twice.
 */
export const resetQuestPartyProgress = async (
  client: DrizzleClient,
  user: NonNullable<UserWithRelations>,
) => {
  const party = user.questParty;
  if (!party) return;
  const personal = user.questData?.find((entry) => entry.id === party.questId);
  const tracker: QuestTrackerType = {
    ...(personal ?? {
      id: party.questId,
      startAt: new Date().toISOString(),
      goals: [],
    }),
    generation: (party.tracker.generation ?? 0) + 1,
    resetGenerations: {
      ...party.tracker.resetGenerations,
      ...Object.fromEntries(
        party.quest.content.objectives
          .filter(
            (objective) => !personal?.goals.some((goal) => goal.id === objective.id),
          )
          .map((objective) => [objective.id, (party.tracker.generation ?? 0) + 1]),
      ),
    },
    party: undefined,
  };
  let current = party;
  for (let attempt = 0; attempt < 5; attempt++) {
    if ((current.tracker.generation ?? 0) !== (party.tracker.generation ?? 0)) {
      user.questParty = current;
      return;
    }
    const saved = await updateQuestPartyForResetQuestPartyProgress(
      client,
      tracker,
      current,
      party,
    );
    if (saved.rowsAffected === 1) {
      user.questParty = {
        ...current,
        tracker,
        contributions: {},
        version: current.version + 1,
      };
      return;
    }
    const fresh = await findQuestPartyForSynchronizeQuestParty(
      client,
      party,
      questPartyRelations,
    );
    if (!fresh) return;
    current = fresh;
  }
  throw new Error("Quest team reset changed repeatedly; please try again");
};

/**
 * Project shared progress onto the hydrated user in memory, retaining personal receipts.
 * Closed lifetime-completed helpers receive a synthetic zero-reward active quest;
 * their persisted history is never reopened by this projection.
 */
export const applyQuestParty = (
  user: NonNullable<UserWithRelations>,
  party: LoadedQuestParty,
) => {
  if (!party.quest || !party.memberIds.includes(user.userId)) return;
  const personal = user.questData?.find((entry) => entry.id === party.questId);
  const completed = user.completedQuests.some(
    (entry) => entry.questId === party.questId,
  );
  if (
    !user.userQuests.some((entry) => entry.questId === party.questId) &&
    completed &&
    !party.tracker.failed
  ) {
    // A completed helper has a temporary active projection, never a reopened reward receipt.
    user.userQuests.push({
      id: questPartyHelperAttemptId(party.id),
      userId: user.userId,
      questId: party.questId,
      questType: party.quest.questType,
      startedAt: party.createdAt,
      endAt: null,
      completed: 0,
      previousAttempts: 0,
      previousCompletes: 0,
      quest: structuredClone(party.quest),
    });
  }
  if (user.userQuests.some((entry) => entry.questId === party.questId))
    user.questData = [
      ...(user.questData ?? []).filter((entry) => entry.id !== party.questId),
      projectPartyTracker(party, personal),
    ];
};

/**
 * Save canonical progress and personal receipts through the character snapshot guard.
 * Detachment releases membership in the same write; false defers it until combat settles.
 * Already-detached or missing members are successful no-ops, making cleanup retryable.
 */
export const saveQuestPartyMember = async (
  client: DrizzleClient,
  party: Pick<QuestParty, "id" | "questId" | "tracker"> &
    Partial<Pick<QuestParty, "contributions">> & { quest?: Quest | null },
  userId: string,
  detach = false,
) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const member = await findUserDataForSaveQuestPartyMember(client, userId);
    if (!member || member.questPartyId !== party.id) return true;
    // Settlement would replace a detached tracker with the battle's older party copy.
    if (detach && member.status === "BATTLE") return false;
    // Keep a contribution accepted after the roster/disband claim in this player's
    // solo continuation, even if its publication has not reached the party snapshot.
    const progress =
      detach && party.quest && party.contributions
        ? {
            ...party,
            ...mergePartyProgress(
              party as QuestParty,
              [{ userId, questData: member.questData }],
              party.quest,
            ),
          }
        : party;
    const tracker = projectPartyTracker(
      progress,
      member.questData?.find((entry) => entry.id === party.questId),
    );
    if (detach) delete tracker.party;
    const saved = await claimUserSnapshot({
      client,
      userId,
      updatedAt: member.updatedAt,
      where: [
        eq(userData.questPartyId, party.id),
        ...(detach ? [ne(userData.status, "BATTLE")] : []),
      ],
      set: {
        questData: [
          ...(member.questData ?? []).filter((entry) => entry.id !== party.questId),
          tracker,
        ],
        ...(detach ? { questPartyId: null } : {}),
      },
    });
    if (saved.success) return true;
  }
  throw new Error("Character changed repeatedly; please try again");
};
