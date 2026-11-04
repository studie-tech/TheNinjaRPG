import type { Quest, QuestParty } from "@/drizzle/schema";
import { isInArray } from "@/utils/array";
import type { ObjectiveTrackerType, QuestTrackerType } from "@/validators/objectives";
import { PassiveSnapshotTasks } from "@/validators/objectives";

const PARTY_CLAIM_PREFIX = "claiming:";

/** How long a party battle reservation blocks others before synchronization may release it. */
export const PARTY_CLAIM_TTL_MS = 60_000;

/**
 * Party `battleId` placeholder `claiming:<epochMs>:<suffix>`, held while a battle or a departure
 * is being settled. The suffix is the reserved battle's id, or a nonce matching no battle.
 */
export const createPartyClaimId = (suffix: string) =>
  `${PARTY_CLAIM_PREFIX}${Date.now()}:${suffix}`;

/** Decode a reservation; a real battle id or an empty slot yields null. */
export const parsePartyClaim = (battleId: string | null | undefined) => {
  if (!battleId?.startsWith(PARTY_CLAIM_PREFIX)) return null;
  const [, issuedAt, reservedBattleId] = battleId.split(":");
  return { issuedAt: Number(issuedAt), reservedBattleId };
};

/** Id of the in-memory active row standing in for a completed helper's finished attempt. */
export const questPartyHelperAttemptId = (partyId: string | null) => `party-${partyId}`;

/** Whether an attempt row is that synthetic helper projection rather than a real attempt. */
export const isQuestPartyHelperAttempt = (
  attempt: { id: string } | undefined,
  partyId: string | null,
) => attempt?.id === questPartyHelperAttemptId(partyId);

/** Record personal deltas in the outgoing trackers in place; copied team totals never contribute. */
export const recordPartyContributions = (
  before: QuestTrackerType[],
  after: QuestTrackerType[],
) => {
  for (const tracker of after) {
    if (!tracker.party) continue;
    const previous = before.find((entry) => entry.id === tracker.id);
    const contributions = structuredClone(tracker.party.contributions);
    for (const goal of tracker.goals) {
      const old = previous?.goals.find((entry) => entry.id === goal.id);
      let contribution = contributions.find((entry) => entry.id === goal.id);
      if (!contribution) {
        contribution = {
          id: goal.id,
          value: 0,
          done: false,
          collected: false,
          recentlyDied: false,
        };
        contributions.push(contribution);
      }
      contribution.value += Math.max(0, goal.value - (old?.value ?? 0));
      if (goal.battleValues)
        contribution.battleValues = structuredClone(goal.battleValues);
      if (goal.done && !old?.done) contribution.done = true;
      if (goal.selectedNextObjectiveId && !old?.selectedNextObjectiveId)
        contribution.selectedNextObjectiveId = goal.selectedNextObjectiveId;
      if (goal.recentlyDied !== old?.recentlyDied)
        contribution.recentlyDied = goal.recentlyDied;
    }
    tracker.party.contributions = contributions;
  }
};

/**
 * Return cloned canonical progress and acknowledged contribution receipts without changing inputs.
 * Counter deltas accumulate once; snapshot objectives use maxima, and damage totals stay scoped
 * to their battle. Departed contributions and the first selected dialogue branch remain canonical.
 */
export const mergePartyProgress = (
  party: QuestParty,
  members: { userId: string; questData: QuestTrackerType[] | null }[],
  quest: Quest,
) => {
  const tracker = structuredClone(party.tracker);
  const contributions = structuredClone(party.contributions);
  for (const member of members) {
    const personal = member.questData?.find((entry) => entry.id === party.questId);
    if (
      personal?.party?.id !== party.id ||
      personal.party.generation !== (tracker.generation ?? 0)
    )
      continue;
    tracker.failed ||= personal.failed;
    const acknowledged = contributions[member.userId] ?? [];
    for (const contribution of personal.party.contributions) {
      let goal = tracker.goals.find((entry) => entry.id === contribution.id);
      if (!goal) {
        const local = personal.goals.find((entry) => entry.id === contribution.id);
        if (local) {
          goal = {
            ...local,
            value: 0,
            done: false,
            collected: false,
            battleValues: undefined,
          };
          tracker.goals.push(goal);
        }
      }
      if (!goal) continue;
      const previous = acknowledged.find((entry) => entry.id === contribution.id);
      const objective = quest.content.objectives.find((entry) => entry.id === goal.id);
      const usesMaximum =
        objective &&
        (("singleBattle" in objective && objective.singleBattle) ||
          isInArray(objective.task, PassiveSnapshotTasks));
      if (
        objective?.task === "damage_dealt" &&
        objective.singleBattle &&
        contribution.battleValues
      ) {
        goal.battleValues ??= {};
        for (const [battleId, value] of Object.entries(contribution.battleValues)) {
          goal.battleValues[battleId] =
            (goal.battleValues[battleId] ?? 0) +
            Math.max(0, value - (previous?.battleValues?.[battleId] ?? 0));
        }
        goal.value = Math.max(goal.value, ...Object.values(goal.battleValues));
      } else {
        goal.value = usesMaximum
          ? Math.max(
              goal.value,
              personal.goals.find((entry) => entry.id === goal.id)?.value ?? 0,
            )
          : goal.value + Math.max(0, contribution.value - (previous?.value ?? 0));
      }
      if (!goal.selectedNextObjectiveId && contribution.selectedNextObjectiveId)
        goal.selectedNextObjectiveId = contribution.selectedNextObjectiveId;
      goal.done ||= contribution.done;
      if (objective && "value" in objective && goal.value >= objective.value)
        goal.done = true;
      // Death only blocks automatic retries; it does not revoke a teammate's success.
      if (!goal.done && contribution.recentlyDied) goal.recentlyDied = true;
    }
    contributions[member.userId] = structuredClone(personal.party.contributions);
    for (const goal of tracker.goals) {
      const local = personal.goals.find((entry) => entry.id === goal.id);
      // Collection timers remain tied to each player's uninterrupted stay on the tile.
      goal.timestamp = undefined;
      goal.collectDeadline = undefined;
      goal.gatheringBonusQuantity = undefined;
      if (local?.locationChecked && local.sector === goal.sector) {
        goal.longitude = local.longitude;
        goal.latitude = local.latitude;
        goal.locationChecked = true;
      }
    }
  }
  return { tracker, contributions };
};

/** Copy team progress into a personal tracker, preserving only receipts valid for its reset epoch. */
export const projectPartyTracker = (
  party: Pick<QuestParty, "id" | "tracker">,
  personal?: QuestTrackerType,
): QuestTrackerType => {
  const current =
    !personal?.party ||
    (personal.party.id === party.id &&
      personal.party.generation === (party.tracker.generation ?? 0))
      ? personal
      : undefined;
  return {
    ...structuredClone(party.tracker),
    goals: party.tracker.goals.map((goal): ObjectiveTrackerType => {
      const canRetainPersonalGoal =
        !personal?.party ||
        (personal.party.id === party.id &&
          (party.tracker.resetGenerations?.[goal.id] ?? 0) <=
            personal.party.generation);
      const local = canRetainPersonalGoal
        ? personal?.goals.find((entry) => entry.id === goal.id)
        : undefined;
      return {
        ...goal,
        // Completed solo goals have already run their personal side effects.
        partyEffectsApplied:
          local?.partyEffectsApplied ?? (!personal?.party && !!local?.done),
        battleValues: local?.battleValues,
        timestamp: local?.timestamp,
        collectDeadline: local?.collectDeadline,
        gatheringBonusQuantity: local?.gatheringBonusQuantity,
        collected: local?.collected ?? false,
      };
    }),
    party: {
      id: party.id,
      generation: party.tracker.generation ?? 0,
      contributions: structuredClone(current?.party?.contributions ?? []),
    },
  };
};
