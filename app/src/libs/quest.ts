import {
  type LetterRank,
  type MasteryType,
  type QuestType,
  SECTOR_HEIGHT,
  SECTOR_WIDTH,
  TERMINAL_DIALOG_PREFIX,
} from "@/drizzle/constants";
import type { Quest, UserData, UserItem, UserQuest } from "@/drizzle/schema";
import { getActivityBonuses } from "@/libs/activityBonuses";
import type { BloodlineCollectionProgress } from "@/libs/bloodline";
import { getFarmingLevel } from "@/libs/farming";
import { isCarriedUserItem } from "@/libs/item";
import {
  findCompletedPredecessor,
  findPredecessor,
  isQuestObjectiveAvailable,
  orderObjectivesByPrerequisites,
} from "@/libs/objectives";
import { getWarSide } from "@/libs/objectiveWar";
import {
  earlierBoundObjectivesComplete,
  isSupportedOverworldBindingTask,
  pickPlaceableSector,
} from "@/libs/overworldAi";
import { getUnscaledLevel, isAvailableUserQuests } from "@/libs/quest/availability";
import { recordPartyContributions } from "@/libs/questParty";
import {
  getIsolatedPyramid,
  hasQuestContentChanged,
  isBetweenPyramidBattles,
} from "@/libs/questRun";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import { findNearestReachableCoordinate } from "@/libs/sector-map/validation";
import { isTutorialActive } from "@/libs/tutorial";
import type { UserWithRelations } from "@/routers/profile";
import { getRandomElement, isInArray, shuffle } from "@/utils/array";
import { getUnique } from "@/utils/grouping";
import {
  formatSecondsToTimeDisplay,
  getCollectDeadline,
  reduceActivitySeconds,
  secondsPassed,
} from "@/utils/time";
import type { ZodAllTags } from "@/validators/combat";
import {
  type AllObjectivesType,
  type AllObjectiveTask,
  CombatActivityTasks,
  CompletionTasks,
  ObjectiveTracker,
  type ObjectiveTrackerType,
  QuestCompletionTasks,
  QuestTracker,
  type QuestTrackerType,
} from "@/validators/objectives";

/** Select playable definitions; raw history remains available for isolation and recovery controls. */
export const getUserQuests = (
  user: UserData & {
    userQuests: UserQuest[];
    completedQuests: { id: string; questId: string; completed?: number }[];
  },
) => {
  const userQuests =
    user?.userQuests
      .filter((uq) => !!uq.quest && !hasQuestContentChanged(uq))
      // Delegation owns the attempt until return; player events cannot advance its objectives.
      .filter((uq) => user.petTask?.questId !== uq.questId)
      .filter((uq) => isAvailableUserQuests({ ...uq.quest, ...uq }, user, true).check)
      .map((uq) => ({ ...uq, ...uq.quest })) ?? [];
  return userQuests;
};

/**
 * Project a user's active quests into the `{ questId, objectives }` shape consumed by
 * {@link findActionableBoundObjective}. Shared by the server overworld-interaction path
 * (`interactWithOverworldAi`) and the client arrival-prompt CTA so both resolve the same bound
 * sub-path (`defeat_opponents` / `dialog` / `deliver_item`) for a placement.
 *
 * `available` gates reachability so a bound objective can't fire out of sequence, combining two
 * independent conditions:
 *  1. Consecutive-chain reachability (`isQuestObjectiveAvailable`) — a no-op `true` for
 *     non-consecutive quests and for the fresh-quest first interaction (no tracker yet).
 *  2. Objective-order reachability (`earlierBoundObjectivesComplete`), applied only to
 *     non-consecutive quests (consecutive quests already order via the tracker chain): every
 *     EARLIER placement-bound objective on the quest must be done first.
 */
export const getBoundObjectiveCandidates = (user: NonNullable<UserWithRelations>) =>
  getUserQuests(user).map((q) => {
    const tracker = (user.questData ?? []).find((t) => t.id === q.id);
    const objectives = q.content.objectives;
    // Placement + done per objective, precomputed so the ordering gate is a plain array scan.
    const meta = objectives.map((objective) => ({
      task: objective.task,
      overworldPlacementId: objective.overworldPlacementId,
      done: !!tracker?.goals.find((g) => g.id === objective.id)?.done,
    }));
    return {
      questId: q.id,
      objectives: objectives.map((objective, i) => ({
        id: objective.id,
        task: objective.task,
        overworldPlacementId: objective.overworldPlacementId,
        done: meta[i]?.done ?? false,
        deliverItemIds:
          "deliverItemIds" in objective ? objective.deliverItemIds : undefined,
        available: tracker
          ? isQuestObjectiveAvailable(q.quest, tracker, i) &&
            (q.quest.consecutiveObjectives || earlierBoundObjectivesComplete(meta, i))
          : true,
        // Carry the un-projected objective through: the bound sub-paths read task-specific fields
        // the projection drops, and would otherwise re-scan every quest's objectives to find it.
        source: objective,
      })),
    };
  });

/**
 * A `QuestHistory`-shaped row is an in-memory-only mock from {@link mockAchievementHistoryEntries}
 * (an achievement with no backing `QuestHistory` yet) when its `id` equals its `questId`; real rows
 * carry a nanoid `id` distinct from `questId`. Use this to skip mocks wherever a real, persisted row
 * is required — e.g. before a completion CAS that needs an existing row to update.
 */
export const isMockQuestHistoryRow = (row: { id: string; questId: string }): boolean =>
  row.id === row.questId;

/**
 * Strip in-memory-only achievement trackers before persisting `UserData.questData`, except
 * instantiated locations, completed collection goals and event counters that must survive reloads.
 * Mock rows from `mockAchievementHistoryEntries` use `id === questId`; real `QuestHistory.id` is a nanoid.
 * @param preserveUnloadedTrackers Keep omitted progress in sparse reads; loaded orphan rows still allow cleanup.
 */
export const filterQuestTrackersForDbPersist = (
  trackers: QuestTrackerType[],
  user: NonNullable<UserWithRelations>,
  preserveUnloadedTrackers = false,
) => {
  // Sparse quest reads omit achievements without history rows. Their persisted counters
  // and earned completion snapshots must survive updates to the loaded quests.
  const unloadedTrackers = preserveUnloadedTrackers
    ? (user.questData ?? []).filter(
        (tracker) => !user.userQuests.some((entry) => entry.questId === tracker.id),
      )
    : [];
  const inMemoryOnlyAchievements = new Map(
    user.userQuests
      // `uq.quest` is null for an orphaned QuestHistory row (its quest was deleted). Most callers
      // pass userQuests from fetchUpdatedUser, which already strips these, but item.ts's buy path
      // uses a bespoke fetch that does not — so guard the deref here as a defensive backstop for
      // every caller. An orphan is not an in-memory achievement, so skipping it is correct;
      // getNewTrackers already drops orphans, so no tracker is emitted for them anyway.
      .filter(
        (uq) => uq.quest?.questType === "achievement" && isMockQuestHistoryRow(uq),
      )
      .map((uq) => [uq.questId, uq.quest]),
  );
  const persistedTrackers = trackers.filter((tracker) => {
    const achievement = inMemoryOnlyAchievements.get(tracker.id);
    return (
      !achievement ||
      // Keep rolled targets and their reachability checks so hydration converges.
      tracker.goals.some(
        (goal) =>
          goal.sector !== undefined ||
          goal.longitude !== undefined ||
          goal.latitude !== undefined,
      ) ||
      achievement.content?.objectives.some(
        (objective) =>
          ((objective.task === "bloodline_collection" ||
            isInArray(objective.task, CompletionTasks)) &&
            tracker.goals.some((goal) => goal.id === objective.id && goal.done)) ||
          (isInArray(objective.task, CombatActivityTasks) &&
            tracker.goals.some((goal) => goal.id === objective.id && goal.value > 0)) ||
          // A won battle cannot be derived again, so its goal waits here to be claimed.
          (objective.task === "defeat_opponents" &&
            tracker.goals.some((goal) => goal.id === objective.id && goal.done)),
      )
    );
  });
  return [...persistedTrackers, ...unloadedTrackers];
};

/**
 * Project active targets without changing the authored or public quest definitions.
 */
export const getActiveObjectives = (user: NonNullable<UserWithRelations>) => {
  const activeQuests = user.userQuests.map((uq) => uq.quest);
  const activeObjectives: AllObjectivesType[] = [];
  activeQuests.forEach((quest) => {
    const tracker = user.questData?.find((q) => q.id === quest.id);
    quest?.content.objectives.forEach((objective, i) => {
      if (tracker && !isQuestObjectiveAvailable(quest, tracker, i)) {
        return;
      }
      const goal = tracker?.goals.find((g) => g.id === objective.id);
      if (goal && goal.done === false) {
        const resolved = { ...objective };
        resolved.sector = goal.sector ?? objective.sector;
        resolved.longitude = goal.longitude ?? objective.longitude;
        resolved.latitude = goal.latitude ?? objective.latitude;
        activeObjectives.push(resolved);
      }
    });
  });
  return activeObjectives;
};

/**
 * Roll the ambush attackers of the given active objectives. Each attacker set joins with its
 * `number` percent chance, capped at `attackers_max_per_battle`; a `win_encounter_at_location`
 * objective only ambushes inside its own sector. The first objective that produces attackers
 * decides the encounter.
 *
 * @returns the random encounter to start, or undefined when nobody attacks.
 */
export const rollObjectiveAttackers = (
  objectives: AllObjectivesType[],
  sector: number,
  random: () => number = Math.random,
  questForObjective?: (objective: AllObjectivesType) => string | undefined,
): QuestConsequence | undefined => {
  for (const objective of objectives) {
    if (!("attackers" in objective) || objective.attackers.length === 0) continue;
    if (objective.task === "win_encounter_at_location" && sector !== objective.sector) {
      continue;
    }
    let opponents = objective.attackers
      .filter((ai) => random() * 100 < ai.number)
      .flatMap((ai) => ai.ids);
    if (
      "attackers_max_per_battle" in objective &&
      objective.attackers_max_per_battle > 0 &&
      opponents.length > objective.attackers_max_per_battle
    ) {
      opponents = shuffle(opponents, (n) => Math.floor(random() * n)).slice(
        0,
        objective.attackers_max_per_battle,
      );
    }
    if (opponents.length > 0) {
      const questId = questForObjective?.(objective);
      return {
        type: "random_encounter",
        ...(questId ? { questId } : {}),
        ids: opponents,
        scaleStats: objective.attackers_scaled_to_user,
        scaleGains: objective.attackers_scale_gains,
      };
    }
  }
  return undefined;
};

/**
 * Check if this is a location objective and user is at the location
 */
export const isLocationObjective = (
  location: { latitude: number; longitude: number; sector: number },
  objective: AllObjectivesType,
) => {
  if ("sector" in objective) {
    if (
      location.sector === Number(objective.sector) &&
      location.latitude === Number(objective.latitude) &&
      location.longitude === Number(objective.longitude)
    ) {
      return true;
    }
  }
  return false;
};

/**
 * Whether an objective's location requirement is satisfied for the user. An
 * objective bound to an overworld NPC placement is location-satisfied when the
 * player is interacting with that placement (its id is in `atPlacementIds`),
 * since the placement — not the objective's stored coordinates — is the
 * authoritative location. Those stored coordinates drift from a roaming NPC's
 * daily reposition (and default to 0/0/0 for fixed NPCs), so for a bound objective
 * the coordinates are ignored entirely — it resolves only when the player is
 * interacting with the bound placement. An unbound objective uses plain coordinate
 * matching.
 */
export const isObjectiveLocationSatisfied = (
  location: { latitude: number; longitude: number; sector: number },
  objective: AllObjectivesType,
  atPlacementIds?: ReadonlySet<string>,
) => {
  // A placement-bound objective resolves off the placement, never its stored coordinates
  // (which could otherwise coincidentally match a tile and auto-complete on travel).
  if (
    "overworldPlacementId" in objective &&
    objective.overworldPlacementId &&
    isSupportedOverworldBindingTask(objective.task)
  ) {
    return !!atPlacementIds && atPlacementIds.has(objective.overworldPlacementId);
  }
  return isLocationObjective(location, objective);
};

/**
 * Client-side quest triggers after arriving at a position: whether the server should
 * check quest progress, and the quests whose dialog objective opens in the logbook.
 */
export const getArrivalQuestTriggers = (
  userData: NonNullable<UserWithRelations>,
  data: { sector: number; longitude: number; latitude: number },
) => {
  let shouldCheckQuest = false;
  const dialogQuestIds: string[] = [];
  userData?.userQuests?.forEach((userquest) => {
    const tracker = userData.questData?.find((q) => q.id === userquest.questId);
    userquest.quest.content.objectives.forEach((objective, i) => {
      const isOnLocation = isLocationObjective(
        {
          sector: data.sector,
          longitude: data.longitude,
          latitude: data.latitude,
        },
        objective,
      );
      if (
        (!tracker || isQuestObjectiveAvailable(userquest.quest, tracker, i)) &&
        (isOnLocation ||
          // A masked target cannot be matched locally; the server owns its coordinates.
          ("hideLocation" in objective && objective.hideLocation) ||
          ("attackers" in objective &&
            objective.attackers &&
            objective.attackers.length > 0))
      ) {
        shouldCheckQuest = true;
      }
      const goal = tracker?.goals.find((g) => g.id === objective.id);
      if (
        (!tracker || isQuestObjectiveAvailable(userquest.quest, tracker, i)) &&
        objective.task === "collect_item" &&
        "collect_time_minutes" in objective &&
        objective.collect_time_minutes &&
        goal?.timestamp &&
        !goal.done &&
        !isOnLocation
      ) {
        shouldCheckQuest = true;
      }
      if (
        objective.task === "dialog" &&
        !objective.overworldPlacementId &&
        isOnLocation &&
        !isTutorialActive(userData)
      ) {
        dialogQuestIds.push(userquest.questId);
      }
    });
  });
  return { shouldCheckQuest, dialogQuestIds };
};

/** One id per spawned copy of each authored `{ ids, number }` AI entry. */
export const expandAiCopies = (entries: { ids: string[]; number: number }[]) =>
  entries.flatMap((entry) => Array(entry.number).fill(entry.ids).flat() as string[]);

/** Tracker increments a finished craft earns, whether it ran directly or from the queue. */
export const getCraftTrackerTasks = (
  expGain: number,
  quantity: number,
  itemId: string,
) => [
  { task: "crafting_experience_gained" as const, increment: expGain },
  { task: "items_crafted" as const, increment: quantity },
  { task: "craft_specific_item" as const, increment: quantity, contentId: itemId },
];

/** Tracker increments for gaining a jutsu through training or evolution. */
export const getJutsuLearnedTrackerTasks = (
  jutsuId: string,
  masteryTypes: MasteryType[],
) => [
  { task: "jutsus_mastered" as const, increment: 1 },
  {
    task: "train_specific_jutsu" as const,
    increment: 1,
    contentId: jutsuId,
    masteryTypes,
  },
];

export const GATHERING_CANCEL_PREFIX = "Gathering cancelled";

/**
 * Applies `reset_quest` consequences to the user's trackers. Without an objective id the whole
 * tracker is dropped; otherwise the target objective and the branch it routed into are cleared.
 *
 * A lost battle that routes into a reset (lose -> `failObjectiveId` -> reset to the battle) keeps
 * its `recentlyDied` mark on the fresh goal. Otherwise the reset battle starts again on the first
 * request after the player wakes up (typically the moment they pay to leave hospital), with no
 * chance to restore their pools; they restart it with the Retry action instead. Managed runs
 * (isolated / entry-item / Pyramid) resume their authored checkpoint directly, so callers
 * exclude them with `awaitsRetry`.
 */
export const applyQuestResets = <T extends QuestTrackerType[] | null | undefined>(
  questData: T,
  resets: QuestConsequence[],
  awaitsRetry: (questId: string) => boolean = () => true,
): T => {
  let trackers: QuestTrackerType[] | null | undefined = questData;
  for (const resetQuest of resets) {
    if (!trackers) break;
    // If no text, which contains the objective id, then reset the entire quest
    if (!resetQuest.info) {
      trackers = trackers.filter((t) => !resetQuest.ids.includes(t.id));
      continue;
    }
    const questId = resetQuest.ids[0]; // We only reset one quest at a time ever
    const quest = trackers.find((t) => t.id === questId);
    if (!quest) continue;
    const target = quest.goals.find((g) => g.id === resetQuest.info);
    const objectiveIdsToRemove = [resetQuest.info];
    let goal = target;
    while (goal?.selectedNextObjectiveId) {
      objectiveIdsToRemove.push(goal.selectedNextObjectiveId);
      goal = quest.goals.find((g) => g.id === goal?.selectedNextObjectiveId);
    }
    quest.goals = quest.goals.filter((g) => !objectiveIdsToRemove.includes(g.id));
    if (target?.recentlyDied && awaitsRetry(quest.id)) {
      quest.goals.push(ObjectiveTracker.parse({ id: target.id, recentlyDied: true }));
    }
  }
  return trackers as T;
};

/**
 * Decide whether a war-context kill objective (`pvp_kills` / `defeat_opponents`) should advance
 * for a given quest type and battle context:
 * - `pvp` quests count in the war-torn sector or human PvP in a Territory War.
 * - `war` quests count only active-war kills: a per-opponent `warFoe` flag when available (e.g.
 *   `defeat_opponents`), otherwise the battle-global war-participant flag (e.g. the `pvp_kills`
 *   counter, which is only emitted on a win).
 * - every other quest type counts anywhere.
 * Context is only passed from combat, so an absent context conservatively denies pvp/war
 * counting; non-combat callers never emit kill progress for these tasks.
 */
export const killObjectiveCountsForQuest = (
  questType: QuestType | undefined,
  context: CombatQuestContext | undefined,
  warFoe: boolean | undefined,
): boolean => {
  if (questType === "pvp")
    return context?.inWarTornSector === true || context?.inTerritoryWar === true;
  if (questType === "war") {
    return warFoe !== undefined ? warFoe : context?.isWarParticipant === true;
  }
  return true;
};

/**
 * For each content-gated task, the objective field holding its id-list (or, for
 * tag_usage_win, the single tagType value). The `satisfies` clause ties every entry to a
 * real key of that task's objective schema, so renaming a schema field without updating
 * this map is a compile error rather than a silently un-completable objective.
 */
const CONTENT_ID_FIELD = {
  craft_specific_item: "craftItemIds",
  train_specific_jutsu: "trainJutsuIds",
  complete_specific_quest: "completeQuestIds",
  buy_item: "buyItemIds",
  use_specific_item_combat: "useItemIds",
  use_specific_jutsu_combat: "useJutsuIds",
  tag_usage_win: "tagType",
} as const satisfies {
  [K in AllObjectiveTask]?: keyof Extract<AllObjectivesType, { task: K }>;
};

/**
 * Tasks whose progress is gated by a contentId that must match one of the objective's own
 * configured ids. Derived from CONTENT_ID_FIELD so the guard in getNewTrackers and the
 * matcher below can never disagree on which tasks are content-gated.
 */
const CONTENT_GATED_TASKS: Set<AllObjectiveTask> = new Set(
  Object.keys(CONTENT_ID_FIELD) as (keyof typeof CONTENT_ID_FIELD)[],
);

/**
 * Returns the content ids an objective matches against. For id-list tasks this is the array
 * field; for tag_usage_win it is the single tagType wrapped in an array.
 */
export const objectiveContentIds = (objective: AllObjectivesType): string[] => {
  const field = (CONTENT_ID_FIELD as Partial<Record<AllObjectiveTask, string>>)[
    objective.task
  ];
  if (!field) return [];
  const raw = (objective as Record<string, unknown>)[field];
  if (Array.isArray(raw)) {
    return raw.filter((v): v is string => typeof v === "string");
  }
  return typeof raw === "string" ? [raw] : [];
};

/**
 * Updates active quest trackers for emitted objective tasks and returns any resulting
 * notifications, consequences, and changed quest ids.
 *
 * @param user - Fully hydrated user whose active quest trackers are evaluated.
 * @param tasks - Objective events to apply; `any` re-evaluates passive objective state.
 * @param combatContext - Optional battle context for kill eligibility and team settlement.
 * @param boundPlacementStatus - Optional placement state keyed by id (`true` active, `false`
 * deactivated, absent deleted). Deleted bindings fail while deactivated bindings stay frozen.
 * @param atPlacementIds - Placement ids the user is authoritatively interacting with now.
 * @param applyPartyEffects - Reconcile personal team effects, including pending receipts
 * after departure, for callers that handle guarded consequences. Tracker-only callers
 * leave this false; ordinary solo effects are unaffected.
 * This function returns consequences without executing their database writes.
 */
export const getNewTrackers = (
  user: TrackerUser,
  tasks: ObjectiveTrackerTaskInput[],
  combatContext?: CombatQuestContext,
  boundPlacementStatus?: ReadonlyMap<string, boolean>,
  atPlacementIds?: ReadonlySet<string>,
  applyPartyEffects = false,
) => {
  for (const tracker of user.questData ?? []) {
    if (tracker.party && tracker.party.id !== user.questPartyId) delete tracker.party;
  }
  const previousPartyTrackers = structuredClone(
    (user.questData ?? []).filter((tracker) => tracker.party),
  );
  const questData = user.questData ?? [];
  const activeQuests = getUserQuests(user);
  const notifications: string[] = [];
  const questIdsUpdated: string[] = [];
  const consequences: QuestConsequence[] = [];
  const trackers = activeQuests.map((quest) => {
    const isInMemoryOnlyAchievement =
      quest.questType === "achievement" &&
      user.userQuests.some(
        (entry) => entry.questId === quest.id && isMockQuestHistoryRow(entry),
      ) &&
      !questData.some((tracker) => tracker.id === quest.id);
    // Get the quest tracker for this quest, or create it
    const questTracker =
      questData.find((q) => q.id === quest.id) ?? QuestTracker.parse({ id: quest.id });
    if (questTracker.party && questTracker.failed) {
      consequences.push({ type: "fail_quest", ids: [quest.id] });
      notifications.push(`Your quest team failed: ${quest.name}`);
      return questTracker;
    }
    const pendingItemEffects =
      applyPartyEffects &&
      questTracker.goals.some(
        (goal) =>
          goal.done &&
          !goal.partyEffectsApplied &&
          (questTracker.party || goal.partyEffectsApplied === false),
      )
        ? getPendingQuestItemEffects(quest, questTracker)
        : undefined;
    // Evaluate each objective once, with predecessors first so their newly unlocked
    // consequences are included in this update regardless of content storage order.
    const objectives = quest.content.objectives;
    const evaluationOrder = quest.consecutiveObjectives
      ? orderObjectivesByPrerequisites(objectives)
      : objectives;
    questTracker.goals = evaluationOrder.map((objective) => {
      const i = objectives.indexOf(objective);
      // Get the current goal, or create it
      const status =
        questTracker.goals.find((goal) => goal.id === objective.id) ??
        ObjectiveTracker.parse({ id: objective.id });

      // Self-healing: if a selectedNextObjectiveId is set, but this ID does not exist anymore, reset the objective
      if (
        status.selectedNextObjectiveId &&
        !quest.content.objectives.find((o) => o.id === status.selectedNextObjectiveId)
      ) {
        status.selectedNextObjectiveId = undefined;
        status.done = false;
      }

      instantiateGoalLocation(
        user,
        quest,
        questTracker,
        objective,
        status,
        consequences,
      );

      // Departure retains personal receipts, so completed shared goals can still
      // deliver their pending effects through the guarded consequence handler.
      if (status.done) {
        if (
          applyPartyEffects &&
          (questTracker.party || status.partyEffectsApplied === false) &&
          !status.partyEffectsApplied
        ) {
          if (objective.task === "new_quest") {
            consequences.push({ type: "start_quest", ids: objective.newQuestIds });
          } else if (objective.task === "collect_item") {
            // Each member carries undelivered quest items, so a collector leaving cannot
            // strand the team. Replacements never receive already-delivered items.
            const outstanding = pendingItemEffects?.collections.get(objective.id) ?? [];
            if (outstanding.length > 0)
              consequences.push({ type: "add_item", ids: outstanding });
          } else if (objective.task === "deliver_item") {
            const removed = pendingItemEffects?.deliveries.get(objective.id) ?? [];
            if (removed.length > 0)
              consequences.push({ type: "remove_item", ids: removed });
          } else return status;
          status.partyEffectsApplied = true;
          consequences.push({ type: "update_user", ids: [quest.id] });
        }
        return status;
      }

      // If not available yet, just skip. This must run before the bound-placement
      // check below: for a consecutiveObjectives quest, an objective the player has
      // not reached yet must not fail (or freeze) the quest just because an admin
      // deleted or deactivated its bound placement — the player never got there.
      if (!isQuestObjectiveAvailable(quest, questTracker, i)) {
        return status;
      }

      // Missing map entry means deleted; false means present but deactivated; true means active.
      // Callers that do not load the map skip this check.
      const boundPlacementId = objective.overworldPlacementId;
      if (
        boundPlacementStatus &&
        boundPlacementId &&
        isSupportedOverworldBindingTask(objective.task)
      ) {
        if (!boundPlacementStatus.has(boundPlacementId)) {
          // Placement was hard-deleted → auto-fail the objective.
          if ("failObjectiveId" in objective && objective.failObjectiveId) {
            status.selectedNextObjectiveId = objective.failObjectiveId;
          } else {
            if (questTracker.party) questTracker.failed = true;
            consequences.push({ type: "fail_quest", ids: [quest.id] });
          }
          status.done = true;
          notifications.push(
            `An objective for "${quest.name}" could not be completed because its destination was removed.`,
          );
          questIdsUpdated.push(quest.id);
          return status;
        }
        if (!boundPlacementStatus.get(boundPlacementId)) {
          // Placement exists but is deactivated → freeze: skip without failing.
          return status;
        }
        // else: placement is active → fall through to normal matching.
      }

      // Convenience
      const task = objective.task;
      // Kill objectives whose counting is gated by battle context per quest type
      const isWarContextKillTask = task === "pvp_kills" || task === "defeat_opponents";

      evaluatePassiveGoalValue(
        user,
        questTracker,
        objective,
        status,
        isInMemoryOnlyAchievement,
        consequences,
      );

      // If opponentAIs is in objective, get the ids
      let opponentIds: string[] = [];
      if ("opponentAIs" in objective) {
        opponentIds = expandAiCopies(objective.opponentAIs).filter(
          (id): id is string => id !== undefined,
        );
      }

      /** Helper function to put the user in combat */
      const putInCombat = () => {
        // Quest teams explicitly assemble through their leader's encounter action.
        if (questTracker.party) return;
        if (
          opponentIds.length > 0 &&
          "opponentAIs" in objective &&
          (user.status === "AWAKE" ||
            (isBetweenPyramidBattles(user) &&
              getIsolatedPyramid(user)?.questId === quest.id))
        ) {
          notifications.push(
            `Attacking ${opponentIds.length} target${opponentIds.length > 1 ? "s" : ""} for ${quest.name}.`,
          );
          consequences.push({
            type: "combat",
            ids: opponentIds,
            // Each selected template contributes the authored number of allied copies.
            allyAiIds: "allyAIs" in objective ? expandAiCopies(objective.allyAIs) : [],
            scaleStats: objective.opponent_scaled_to_user,
            scaleGains: objective.scaleGains,
            forceKeepPools: objective.keepOriginalPools ?? false,
            questId: quest.id,
            objectiveId: objective.id,
            givePools: objective.givePools,
            startingEffects: [
              ...(objective.applyBuffs ?? []),
              ...(objective.applyDebuffs ?? []),
            ],
          });
        }
      };

      // Instant objectives
      if (task === "win_quest") {
        status.done = true;
      } else if (task === "reset_quest") {
        consequences.push({
          type: "reset_quest",
          ids: [quest.id],
          info: objective.resetObjectiveId,
        });
      } else if (task === "fail_quest") {
        if (questTracker.party) questTracker.failed = true;
        consequences.push({ type: "fail_quest", ids: [quest.id] });
        notifications.push(objective.description || `Failed: ${quest.name}`);
      } else if (task === "new_quest" && "newQuestIds" in objective) {
        status.done = true;
        if (!questTracker.party || applyPartyEffects) {
          if (questTracker.party || status.partyEffectsApplied === false)
            status.partyEffectsApplied = true;
          consequences.push({ type: "start_quest", ids: objective.newQuestIds });
        }
      } else if (task === "start_battle") {
        if (!status.recentlyDied) {
          putInCombat();
        }
      }

      // Specific updates requested by the caller
      tasks
        .filter((taskUpdate) => taskUpdate.task === task || taskUpdate.task === "any")
        .forEach((taskUpdate) => {
          // A location action can match both `any` and its explicit task in one
          // pass. Once it completes, its inventory side effects must run only once.
          if (status.done && (task === "collect_item" || task === "deliver_item"))
            return;
          // War-context kill objectives only advance in their required context (pvp →
          // war-torn sector; war → active-war kill). All other tasks always count.
          // `defeat_opponents` is per-opponent, so a missing `warFoe` must deny rather than
          // fall back to the battle-global flag (which would credit a non-war target in a
          // mixed war battle); `pvp_kills` keeps the battle-global fallback by design.
          const taskWarFoe =
            task === "defeat_opponents"
              ? (taskUpdate.warFoe ?? false)
              : taskUpdate.warFoe;
          const killCounts =
            !isWarContextKillTask ||
            killObjectiveCountsForQuest(quest.questType, combatContext, taskWarFoe);
          // Generic counter objectives: increment/set on task-name match. Requires an exact
          // `taskUpdate.task === task` (not the `"any"` re-evaluation trigger, which carries
          // no increment/value) so a future `"any"` update can't inflate counters. Content-
          // gated (specific-X + tag_usage_win) and damage_dealt tasks own the gated branches
          // below and must NOT also run this path, or they would double-count.
          if (
            "value" in objective &&
            taskUpdate.task === task &&
            !CONTENT_GATED_TASKS.has(task) &&
            task !== "damage_dealt"
          ) {
            if (taskUpdate.increment && killCounts) {
              status.value += taskUpdate.increment;
            }
            if (taskUpdate.value !== undefined && killCounts) {
              status.value = taskUpdate.value;
            }
          }
          // Content objectives use their ID filter and, for jutsu, optional discipline
          // and combat filters. The matcher rejects unconfigured and "any" events.
          if (
            "value" in objective &&
            CONTENT_GATED_TASKS.has(task) &&
            matchesContentObjective(objective, taskUpdate) &&
            // A quest can never satisfy its own complete_specific_quest objective: the
            // resolving quest is still active in getUserQuests when getReward emits this
            // (its `completed` flag flips later in checkRewards), so guard the self-tick.
            !(task === "complete_specific_quest" && quest.id === taskUpdate.contentId)
          ) {
            status.value += taskUpdate.increment ?? 1;
          }
          // Damage dealt: cumulative across the quest, or single-battle max when toggled.
          // Requires an exact `taskUpdate.task === "damage_dealt"` (not the `"any"` re-
          // evaluation trigger) so a future `"any"` update carrying an increment can't
          // inflate progress toward the damage threshold. The stored counter is not reset
          // when a designer flips singleBattle on a live quest, so an accumulated sum would
          // be re-read as a single-battle max (and vice versa) — content edits that flip the
          // flag must ship with a user-tracker reset.
          if (
            task === "damage_dealt" &&
            taskUpdate.task === "damage_dealt" &&
            "value" in objective
          ) {
            const dealt = taskUpdate.increment ?? 0;
            if ("singleBattle" in objective && objective.singleBattle) {
              status.value = Math.max(status.value, dealt);
              if (questTracker.party && combatContext?.battleId) {
                status.battleValues ??= {};
                status.battleValues[combatContext.battleId] = Math.max(
                  status.battleValues[combatContext.battleId] ?? 0,
                  dealt,
                );
              }
            } else {
              status.value += dealt;
            }
          }
          // Dialog objective
          if (
            task === "dialog" &&
            taskUpdate.contentId &&
            // A placement-bound dialog can only advance through the authoritative NPC
            // interaction path. This blocks direct Logbook/API completion from anywhere.
            (!questTracker.party || user.questParty?.leaderId === user.userId) &&
            (!objective.overworldPlacementId ||
              isObjectiveLocationSatisfied(user, objective, atPlacementIds))
          ) {
            // A terminal branch carries no follow-up objective, so the client sends an
            // objective-scoped sentinel (prefix + this objective's id) instead of a next id.
            // Complete this objective without routing onward — but only if it genuinely owns
            // a terminal branch, so a spoofed sentinel can't finish an arbitrary dialog
            // objective (parity with the routing branch, which requires a matching branch id).
            const isTerminalForThis =
              taskUpdate.contentId === `${TERMINAL_DIALOG_PREFIX}${objective.id}` &&
              objective.nextObjectiveId?.some(
                (next) => next.nextObjectiveId === undefined,
              );
            if (isTerminalForThis) {
              status.done = true;
            } else {
              const objectiveHasNext = objective.nextObjectiveId?.find(
                (next) => next.nextObjectiveId === taskUpdate.contentId,
              );
              if (objectiveHasNext) {
                status.done = true;
                status.selectedNextObjectiveId = taskUpdate.contentId;
              }
            }
          } else if (
            quest.consecutiveObjectives &&
            "nextObjectiveId" in objective &&
            typeof objective.nextObjectiveId === "string" &&
            !status.selectedNextObjectiveId
          ) {
            status.selectedNextObjectiveId = objective.nextObjectiveId;
          }

          // If objective has a location (sector & longitude/latitude), set to completed.
          // A placement-bound objective is also satisfied when the player is interacting
          // with that placement (atPlacementIds), since the placement is authoritative
          // over the objective's stored coordinates.
          if (isObjectiveLocationSatisfied(user, objective, atPlacementIds)) {
            if (task === "move_to_location") {
              notifications.push(`You arrived at destination for ${quest.name}.`);
              status.done = true;
            } else if (
              status.partyEffectsApplied &&
              (task === "collect_item" || task === "deliver_item")
            ) {
              // Joining can copy an earlier shared goal over a completed personal one.
              // Its inventory receipt still proves completion for this attempt.
              status.done = true;
            } else if (
              task === "collect_item" &&
              (!questTracker.party || applyPartyEffects) &&
              "item_name" in objective &&
              "collectItemIds" in objective &&
              objective.collectItemIds
            ) {
              let doCollect = true;
              if (
                "collect_time_minutes" in objective &&
                objective.collect_time_minutes
              ) {
                if ("timestamp" in status && status.timestamp) {
                  if (
                    Date.now() <
                    getCollectDeadline(
                      status,
                      objective.collect_time_minutes,
                    )!.getTime()
                  ) {
                    doCollect = false;
                  }
                } else {
                  // Snapshot once so later passive changes cannot alter a running collection.
                  const bonuses =
                    quest.questType === "gathering"
                      ? getActivityBonuses(user)
                      : undefined;
                  const seconds = reduceActivitySeconds(
                    objective.collect_time_minutes * 60,
                    bonuses?.gatheringReductionPercent ?? 0,
                  );
                  const startedAt = Date.now();
                  status.timestamp = new Date(startedAt).toISOString();
                  status.collectDeadline = new Date(
                    startedAt + seconds * 1000,
                  ).toISOString();
                  status.gatheringBonusQuantity = bonuses?.gatheringBonusQuantity;
                  notifications.push(
                    `You started collecting. This will take ${formatSecondsToTimeDisplay(seconds)}.`,
                  );
                  doCollect = false;
                }
              }
              if (doCollect) {
                // An untimed collection starts and completes in this same evaluation.
                if (
                  quest.questType === "gathering" &&
                  !(
                    "collect_time_minutes" in objective &&
                    objective.collect_time_minutes
                  )
                )
                  status.gatheringBonusQuantity =
                    getActivityBonuses(user).gatheringBonusQuantity;
                consequences.push({
                  type: "add_item",
                  ids: objective.collectItemIds,
                });
                if (questTracker.party || status.partyEffectsApplied === false)
                  status.partyEffectsApplied = true;
                status.done = true;
              } else {
                questIdsUpdated.push(quest.id);
              }
            } else if (
              task === "deliver_item" &&
              (!questTracker.party || applyPartyEffects) &&
              "item_name" in objective &&
              "deliverItemIds" in objective &&
              objective.deliverItemIds
            ) {
              // Verify user carries these items
              const check = objective.deliverItemIds.every((id) =>
                user.useritems?.some((ui) => ui.itemId === id && isCarriedUserItem(ui)),
              );
              if (!check) {
                notifications.push(
                  `You don't have ${objective.item_name} to deliver for ${quest.name}.`,
                );
                return;
              }
              // Remove items & complete objective
              notifications.push(`Delivered ${objective.item_name} for ${quest.name}.`);
              consequences.push({
                type: "remove_item",
                ids: objective.deliverItemIds,
              });
              if (questTracker.party || status.partyEffectsApplied === false)
                status.partyEffectsApplied = true;
              status.done = true;
            } else if (task === "defeat_opponents" && opponentIds.length > 0) {
              if (!opponentIds.includes(taskUpdate.contentId || "1337")) {
                putInCombat();
              }
            }
          }

          // If user has a pending collect timer but left the location, reset the timer
          else if (
            task === "collect_item" &&
            "collect_time_minutes" in objective &&
            objective.collect_time_minutes &&
            status.timestamp &&
            !status.done
          ) {
            status.timestamp = undefined;
            status.collectDeadline = undefined;
            status.gatheringBonusQuantity = undefined;
            notifications.push(
              `${GATHERING_CANCEL_PREFIX} for ${quest.name}: you left the collection area.`,
            );
          }

          // If we're at a win_encounter_at_location objective, set to completed if we won
          else if (task === "win_encounter_at_location") {
            if (taskUpdate.text === "Won" && user.sector === objective.sector) {
              status.done = true;
            }
          }

          // Defeating specific opponents
          if (
            ["start_battle", "defeat_opponents"].includes(task) &&
            "opponentAIs" in objective &&
            opponentIds.length > 0
          ) {
            if (
              questTracker.party &&
              combatContext?.questTeamStillFighting &&
              taskUpdate.text !== "Won"
            )
              return;
            if (
              killCounts &&
              (!(
                quest.content.entryItems?.length ||
                quest.content.isolated ||
                (quest.questType === "battlepyramid" && quest.questVersion)
              ) ||
                (combatContext?.questBattleSource?.questId === quest.id &&
                  combatContext.questBattleSource.objectiveId === objective.id)) &&
              taskUpdate.text &&
              opponentIds.includes(taskUpdate.contentId || "1337")
            ) {
              const completionOutcome = objective.completionOutcome || "Win";
              if (completionOutcome === "Any") {
                status.done = true;
              }
              if (taskUpdate.text === "Won") {
                if (objective.successDescription) {
                  notifications.push(objective.successDescription);
                }
                if (completionOutcome === "Win") {
                  status.done = true;
                }
              } else if (taskUpdate.text === "Lost") {
                if (objective.failDescription) {
                  notifications.push(objective.failDescription);
                }
                if (completionOutcome === "Lose") {
                  status.done = true;
                }
                if (task === "start_battle") {
                  status.recentlyDied = true;
                }
              } else if (taskUpdate.text === "Draw") {
                if (objective.drawDescription) {
                  notifications.push(objective.drawDescription);
                }
                if (completionOutcome === "Draw") {
                  status.done = true;
                }
              } else if (taskUpdate.text === "Fled") {
                if (objective.fleeDescription) {
                  notifications.push(objective.fleeDescription);
                }
                if (completionOutcome === "Flee") {
                  status.done = true;
                }
              }
              if (
                !status.done &&
                "failObjectiveId" in objective &&
                objective.failObjectiveId
              ) {
                status.selectedNextObjectiveId = objective.failObjectiveId;
                status.done = true;
              }
            }
          }

          // Handle manual retriggering of start_battle objectives
          if (task === "start_battle" && taskUpdate.text === "retry") {
            status.recentlyDied = false;
            putInCombat();
            return;
          }
        });
      if ("value" in objective && status.value >= objective.value) {
        status.done = true;
        // Latch an earned completion before its source content can be retired.
        // Goals already done return above, so passive reads request this write once.
        if (isInArray(task, CompletionTasks))
          consequences.push({ type: "update_user", ids: ["activity_completion"] });
      }

      // If status is now done, then add quest id to list of updated quests
      if (status.done) {
        questIdsUpdated.push(quest.id);
      }
      return status;
    });
    // Trackers retain the authored array order; only evaluation follows the links.
    questTracker.goals.sort(
      (a, b) =>
        objectives.findIndex((objective) => objective.id === a.id) -
        objectives.findIndex((objective) => objective.id === b.id),
    );
    return questTracker;
  });

  // Hidden Pyramids pause without losing their checkpoint; never evaluate their objectives.
  trackers.push(
    ...questData.filter((tracker) =>
      user.userQuests.some(
        (entry) =>
          entry.questId === tracker.id &&
          entry.questType === "battlepyramid" &&
          entry.quest?.hidden &&
          !entry.completed &&
          !entry.endAt &&
          !hasQuestContentChanged(entry),
      ),
    ),
  );

  recordPartyContributions(previousPartyTrackers, trackers);
  return {
    trackers: getUnique(trackers, "id"),
    notifications,
    consequences,
    questIdsUpdated,
  };
};

/**
 * Resolve a goal's map location: recover masked placeholders, roll sector and coordinates,
 * follow public landmarks and completed predecessors. The result is written onto the shared
 * objective, which every later reader of this quest expects to see instantiated.
 */
const instantiateGoalLocation = (
  user: TrackerUser,
  quest: Pick<Quest, "content" | "publicLocations">,
  questTracker: QuestTrackerType,
  objective: AllObjectivesType,
  status: ObjectiveTrackerType,
  consequences: QuestConsequence[],
) => {
  // Older masked snapshots could persist the public placeholder as a real target.
  // Recover only those fields; valid rolls and completion/progress stay authoritative.
  const hasMaskedLocation =
    status.sector === 1337 || status.longitude === 1337 || status.latitude === 1337;
  if (hasMaskedLocation) {
    if (status.sector === 1337) {
      delete status.sector;
      if (!("sectorType" in objective) && "sector" in objective) {
        status.sector = objective.sector;
      }
    }
    if (status.longitude === 1337) {
      delete status.longitude;
      if (!("locationType" in objective) && "longitude" in objective) {
        status.longitude = objective.longitude;
      }
    }
    if (status.latitude === 1337) {
      delete status.latitude;
      if (!("locationType" in objective) && "latitude" in objective) {
        status.latitude = objective.latitude;
      }
    }
    delete status.locationChecked;
    consequences.push({ type: "update_user", ids: ["location_update"] });
  }

  if ("sectorType" in objective && status.sector === undefined) {
    if (objective.sectorType === "specific") {
      status.sector = objective.sector;
    } else if (objective.sectorType === "random") {
      status.sector = pickPlaceableSector();
    } else if (objective.sectorType === "from_list") {
      if (objective.sectorList.length === 0) {
        status.sector = pickPlaceableSector();
      } else {
        status.sector = Number(getRandomElement(objective.sectorList));
      }
    } else if (objective.sectorType === "user_village") {
      status.sector = user?.village?.sector || user.sector;
    } else if (objective.sectorType === "current_sector") {
      status.sector = user.sector;
    } else if (objective.sectorType === "enemy_village") {
      // Find an active war and get the enemy village sector
      for (const w of user.activeWars ?? []) {
        const side = getWarSide(w, user.villageId);
        if (side) {
          status.sector =
            side === w.attackerVillageId
              ? w.defenderVillage.sector
              : w.attackerVillage.sector;
          break;
        }
      }

      // Fallback to random sector if no war found
      if (status.sector === undefined) {
        status.sector = pickPlaceableSector();
      }
    }
    if (status.sector !== undefined) {
      consequences.push({ type: "update_user", ids: ["location_update"] });
    }
  }

  // Public landmarks share one canonical entrance across all accepted attempts.
  if (
    quest.publicLocations &&
    objective.structureAssetId &&
    "sectorType" in objective &&
    objective.sectorType === "specific" &&
    "locationType" in objective &&
    objective.locationType === "specific" &&
    (status.sector !== objective.sector ||
      status.longitude !== objective.longitude ||
      status.latitude !== objective.latitude)
  ) {
    status.sector = objective.sector;
    status.longitude = objective.longitude;
    status.latitude = objective.latitude;
    status.locationChecked = false;
    consequences.push({ type: "update_user", ids: ["location_update"] });
  }

  // If locationType is not specific, update the location accordingly
  if (
    "locationType" in objective &&
    (status.longitude === undefined || status.latitude === undefined)
  ) {
    if (objective.locationType === "specific") {
      status.longitude = objective.longitude;
      status.latitude = objective.latitude;
    } else if (objective.locationType === "random") {
      status.longitude = Math.ceil(Math.random() * (SECTOR_WIDTH - 1));
      status.latitude = Math.ceil(Math.random() * (SECTOR_HEIGHT - 1));
    }
    if (status.longitude !== undefined && status.latitude !== undefined) {
      consequences.push({ type: "update_user", ids: ["location_update"] });
    }
  }

  // If a dialog, find any previous objective pointing to this one, and set the location to the same location
  const previousObjective = findCompletedPredecessor(
    quest.content.objectives,
    objective.id,
    questTracker,
  );

  // Implicit dialogs follow live NPC positions, never a bound objective's fallback coordinates.
  let locationPredecessor = previousObjective;
  const visited = new Set([objective.id]);
  while (
    locationPredecessor?.task === "dialog" &&
    !locationPredecessor.overworldPlacementId &&
    locationPredecessor.sector === undefined &&
    locationPredecessor.longitude === undefined &&
    locationPredecessor.latitude === undefined &&
    !visited.has(locationPredecessor.id)
  ) {
    visited.add(locationPredecessor.id);
    locationPredecessor = findCompletedPredecessor(
      quest.content.objectives,
      locationPredecessor.id,
      questTracker,
    );
  }
  const hasBoundLocation =
    objective.task === "dialog" &&
    !objective.overworldPlacementId &&
    !!locationPredecessor?.overworldPlacementId &&
    isSupportedOverworldBindingTask(locationPredecessor.task);
  if (hasBoundLocation) {
    for (const field of ["sector", "longitude", "latitude"] as const) {
      if (objective[field] === undefined && status[field] !== undefined) {
        delete status[field];
        delete status.locationChecked;
        consequences.push({ type: "update_user", ids: ["location_update"] });
      }
    }
  }

  if (previousObjective && !hasBoundLocation) {
    if (status.sector === undefined && "sector" in previousObjective) {
      status.sector = previousObjective.sector;
      consequences.push({ type: "update_user", ids: [`sector_update`] });
    }
    if (status.longitude === undefined && "longitude" in previousObjective) {
      status.longitude = previousObjective.longitude;
      consequences.push({ type: "update_user", ids: [`longitude_update`] });
    }
    if (status.latitude === undefined && "latitude" in previousObjective) {
      status.latitude = previousObjective.latitude;
      consequences.push({ type: "update_user", ids: [`latitude_update`] });
    }
  }

  // If we have a location on the status (i.e. instantiated for the user, overwrite objective)
  if ("sector" in objective) {
    if (status.longitude !== undefined) objective.longitude = status.longitude;
    if (status.latitude !== undefined) objective.latitude = status.latitude;
    if (status.sector !== undefined) objective.sector = status.sector;
    if ("locationType" in objective) {
      objective.locationType = "specific";
    }
  }
};

/** Overwrite a goal's value from player state on every evaluation. */
const evaluatePassiveGoalValue = (
  user: TrackerUser,
  questTracker: QuestTrackerType,
  objective: AllObjectivesType,
  status: ObjectiveTrackerType,
  isInMemoryOnlyAchievement: boolean,
  consequences: QuestConsequence[],
) => {
  const task = objective.task;
  const isKage = user.village?.kageId === user.userId;

  // General updates we want to apply every time. Team progress treats these
  // overwrites as snapshots: keep PassiveSnapshotTasks in step with them.
  if (objective.task === "bloodline_collection") {
    // Sum the selected rank snapshots; no rank has an implicit exemption.
    const progress = user.bloodlineCollectionProgress
      ?.filter((entry) => objective.bloodlineRanks.includes(entry.rank))
      .reduce(
        (total, entry) => ({
          collected: total.collected + entry.collected,
          total: total.total + entry.total,
        }),
        { collected: 0, total: 0 },
      );
    if (progress) {
      const isComplete = progress.total > 0 && progress.collected === progress.total;
      if (
        (isComplete || !isInMemoryOnlyAchievement) &&
        (status.value !== progress.collected ||
          status.target !== progress.total ||
          status.done !== isComplete)
      ) {
        consequences.push({
          type: "update_user",
          ids: ["bloodline_collection_update"],
        });
      }
      status.value = progress.collected;
      status.target = progress.total;
      // An empty catalogue cannot award a collection achievement. Done goals are
      // retained above, so catalogue growth never revokes a recorded completion.
      status.done = isComplete;
    }
  } else if (task === "dungeons_completed" && user.dungeonsCompleted !== undefined) {
    status.value = Number(user.dungeonsCompleted);
  } else if (task === "raids_completed" && user.raidsCompleted !== undefined) {
    status.value = Number(user.raidsCompleted);
  } else if (isInArray(task, Object.values(QuestCompletionTasks))) {
    // Repeatable quests reset completed; retain lifetime totals and legacy completions.
    status.value = user.completedQuests.reduce(
      (total, history) =>
        history.questType &&
        QuestCompletionTasks[history.questType as keyof typeof QuestCompletionTasks] ===
          task
          ? total + Math.max(history.completed, history.previousCompletes ?? 0)
          : total,
      0,
    );
  } else if (task === "user_level") {
    status.value = getUnscaledLevel(user);
  } else if (task === "farming_level") {
    status.value = getFarmingLevel(user.farmingExperience);
  } else if (
    task === "farming_collection_log" &&
    typeof user.farmingCollectionCount === "number"
  ) {
    status.value = user.farmingCollectionCount;
  } else if (
    task === "train_specific_jutsu" &&
    user.ownedObjectiveJutsus &&
    objectiveContentIds(objective).length > 0
  ) {
    // Learning emits once, and is lost if this objective was not reached yet. A
    // named jutsu cannot be learned twice, so owning it has to count as well.
    const owned = user.ownedObjectiveJutsus.filter(({ jutsuId, masteryTypes }) =>
      matchesContentObjective(objective, {
        task,
        contentId: jutsuId,
        masteryTypes,
      }),
    ).length;
    if (owned > status.value) {
      status.value = owned;
      consequences.push({ type: "update_user", ids: ["owned_jutsu_update"] });
    }
  } else if (task === "days_in_village") {
    const days = Math.floor(secondsPassed(user.joinedVillageAt) / 60 / 60 / 24);
    status.value = days;
  } else if (task === "days_as_kage" && isKage && user.village) {
    const seconds = secondsPassed(user.village.leaderUpdatedAt);
    const days = Math.floor(seconds / 60 / 60 / 24);
    status.value = days;
  } else if (task === "reputation_points") {
    status.value = user.reputationPointsTotal;
  } else if (task === "minutes_passed") {
    const minutes = Math.floor(secondsPassed(new Date(questTracker.startAt)) / 60);
    status.value = minutes;
  } else if (task.includes("missions_total") || task.includes("crimes_total")) {
    const type = task.includes("missions") ? "mission" : "crime";
    const rank = task.split("_")[0]?.toUpperCase() as LetterRank;
    const field = getQuestCounterFieldName(type, rank);
    if (field) status.value = user[field];
  } else if (task === "errands_total") {
    const field = getQuestCounterFieldName("errand", "D");
    if (field) status.value = user[field];
  } else if (task === "medical_experience") {
    status.value = user.medicalExperience;
  } else if (task === "crafting_experience") {
    status.value = user.craftingExperience;
  } else if (task === "hunting_experience") {
    status.value = user.huntingExperience;
  } else if (task === "gathering_experience") {
    status.value = user.gatheringExperience;
  }
};

/**
 * Return remaining collection grants and inventory removals by completed objective ID.
 * Follow the selected consecutive path, or match applied receipts first for parallel goals.
 * A collection/delivery pair that never ran personally cancels both effects, preserving the
 * member's prior inventory; an already-applied collection still requires its matching removal.
 */
const getPendingQuestItemEffects = (
  quest: Pick<Quest, "content" | "consecutiveObjectives">,
  tracker: QuestTrackerType,
) => {
  const objectives = quest.content.objectives;
  const definitions = new Map(objectives.map((objective) => [objective.id, objective]));
  const goals = new Map(tracker.goals.map((goal) => [goal.id, goal]));
  let completedObjectives: AllObjectivesType[] = [];
  if (quest.consecutiveObjectives) {
    const visited = new Set<string>();
    let objectiveId = objectives.find(
      (objective) => !findPredecessor(objectives, objective.id),
    )?.id;
    while (objectiveId && !visited.has(objectiveId)) {
      const objective = definitions.get(objectiveId);
      const goal = goals.get(objectiveId);
      if (!objective || !goal?.done) break;
      visited.add(objectiveId);
      completedObjectives.push(objective);
      objectiveId = goal.selectedNextObjectiveId;
    }
  } else {
    const completed = objectives.filter((objective) => goals.get(objective.id)?.done);
    // Parallel goals have no completion order. Match applied receipts first on
    // both sides so an earlier delivery cannot consume a later pending collection.
    const byAppliedReceipt = (a: AllObjectivesType, b: AllObjectivesType) =>
      Number(!!goals.get(b.id)?.partyEffectsApplied) -
      Number(!!goals.get(a.id)?.partyEffectsApplied);
    const collections = completed
      .filter((objective) => objective.task === "collect_item")
      .sort(byAppliedReceipt);
    const deliveries = completed
      .filter((objective) => objective.task === "deliver_item")
      .sort(byAppliedReceipt);
    completedObjectives = [...collections, ...deliveries];
  }

  const outstanding = new Map<string, string[]>();
  const pendingDeliveries = new Map<string, string[]>();
  const collectionsByItem = new Map<string, string[]>();
  for (const objective of completedObjectives) {
    if (objective.task === "collect_item") {
      outstanding.set(objective.id, [...objective.collectItemIds]);
      for (const itemId of objective.collectItemIds) {
        const collections = collectionsByItem.get(itemId) ?? [];
        collections.push(objective.id);
        collectionsByItem.set(itemId, collections);
      }
    } else if (objective.task === "deliver_item") {
      const removed: string[] = [];
      // The consequence handler takes one unit per distinct item ID.
      for (const itemId of new Set(objective.deliverItemIds)) {
        const collectionId = collectionsByItem.get(itemId)?.shift();
        const items = collectionId ? outstanding.get(collectionId) : undefined;
        if (items) items.splice(items.indexOf(itemId), 1);
        // A suppressed personal collection must not consume the member's prior inventory.
        if (!collectionId || goals.get(collectionId)?.partyEffectsApplied)
          removed.push(itemId);
      }
      pendingDeliveries.set(objective.id, removed);
    }
  }
  return { collections: outstanding, deliveries: pendingDeliveries };
};

/**
 * Unfinished goals with concrete map locations. Checked goals can be included in the player's
 * current sector so a republished map cannot leave an active mission on blocked terrain.
 * Placement-bound objectives use the overworld placement's location instead.
 */
const getLocatedGoalsToCheck = (
  user: NonNullable<UserWithRelations>,
  trackers: QuestTrackerType[],
  recheckCurrentSector = false,
) => {
  const located: { goal: ObjectiveTrackerType; objective: AllObjectivesType }[] = [];
  for (const quest of getUserQuests(user)) {
    const tracker = trackers.find((t) => t.id === quest.id);
    if (!tracker) continue;
    for (const goal of tracker.goals) {
      if (
        goal.done ||
        (goal.locationChecked && !(recheckCurrentSector && goal.sector === user.sector))
      ) {
        continue;
      }
      if (
        goal.sector === undefined ||
        goal.longitude === undefined ||
        goal.latitude === undefined
      ) {
        continue;
      }
      const objective = quest.content.objectives.find((o) => o.id === goal.id);
      if (!objective) continue;
      if (
        "overworldPlacementId" in objective &&
        objective.overworldPlacementId &&
        isSupportedOverworldBindingTask(objective.task)
      ) {
        continue;
      }
      located.push({ goal, objective });
    }
  }
  return located;
};

/** Sectors whose published maps are needed by {@link snapQuestTargetsToReachable}. */
export const getQuestTargetSectorsToCheck = (
  user: NonNullable<UserWithRelations>,
  trackers: QuestTrackerType[],
  recheckCurrentSector = false,
) => [
  ...new Set(
    getLocatedGoalsToCheck(user, trackers, recheckCurrentSector).map(
      ({ goal }) => goal.sector as number,
    ),
  ),
];

/**
 * Checks new quest targets and existing targets in the player's current sector against the
 * published map, moving them onto the nearest reachable tile when needed. Checked remote
 * targets wait until the player visits their sector to avoid fetching every mission's map
 * on every profile read. Mutates the trackers and the active
 * quests' objectives in place, mirroring how getNewTrackers instantiates locations.
 *
 * @returns whether any tracker changed and must be persisted.
 */
export const snapQuestTargetsToReachable = (
  user: NonNullable<UserWithRelations>,
  trackers: QuestTrackerType[],
  maps: ReadonlyMap<
    number,
    Pick<NormalizedSectorMap, "width" | "height" | "tiles" | "anchors">
  >,
) => {
  let changed = false;
  for (const { goal, objective } of getLocatedGoalsToCheck(user, trackers, true)) {
    // Without a published map (or any walkable tile) the goal stays unchecked so it is
    // re-evaluated once the sector has a usable map.
    const map = maps.get(goal.sector as number);
    const reachable = map
      ? findNearestReachableCoordinate(map, {
          x: goal.longitude as number,
          y: goal.latitude as number,
        })
      : null;
    if (!reachable) continue;
    if (
      goal.locationChecked &&
      goal.longitude === reachable.x &&
      goal.latitude === reachable.y
    ) {
      continue;
    }
    goal.longitude = reachable.x;
    goal.latitude = reachable.y;
    if ("sector" in objective) {
      objective.longitude = reachable.x;
      objective.latitude = reachable.y;
    }
    goal.locationChecked = true;
    changed = true;
  }
  return changed;
};

/**
 * Match one content event against an objective's configured filters.
 * Jutsu IDs and mastery filters intersect when both are set; a mastery-only objective
 * permits an empty ID list, but leaving both unset cannot credit arbitrary content.
 * Combat-type restrictions require matching event metadata. Exact task and content ID
 * checks keep passive "any" re-evaluation events from incrementing content counters.
 */
const matchesContentObjective = (
  objective: AllObjectivesType,
  event: ObjectiveTrackerTaskInput,
): boolean => {
  if (event.task !== objective.task || event.contentId === undefined) return false;
  const contentIds = objectiveContentIds(objective);
  if (!("masteryType" in objective)) return contentIds.includes(event.contentId);

  const hasMasteryFilter = !!objective.masteryType && objective.masteryType !== "None";
  if (contentIds.length === 0 && !hasMasteryFilter) return false;
  if (contentIds.length > 0 && !contentIds.includes(event.contentId)) return false;
  if (
    objective.masteryType &&
    objective.masteryType !== "None" &&
    !event.masteryTypes?.includes(objective.masteryType)
  )
    return false;

  return (
    !("combatType" in objective) ||
    !objective.combatType ||
    objective.combatType === "Any" ||
    objective.combatType === event.combatType
  );
};

/** Select the persistent errand, mission or crime counter for a quest type and letter rank. */
export const getQuestCounterFieldName = (
  type: QuestType | undefined,
  rank: LetterRank | undefined,
) => {
  if (type === undefined || rank === undefined) return undefined;
  switch (type) {
    case "errand":
      return "errands";
    case "mission":
      return `missions${rank}` as const;
    case "crime":
      return `crimes${rank}` as const;
    default:
      return undefined;
  }
};
export type QuestCounterFieldName = ReturnType<typeof getQuestCounterFieldName>;
export type QuestConsequence = {
  type:
    | "add_item"
    | "remove_item"
    | "combat"
    | "random_encounter"
    | "fail_quest"
    | "start_quest"
    | "reset_quest"
    | "update_user";
  ids: string[];
  info?: string;
  scaleStats?: boolean;
  scaleGains?: number;
  forceKeepPools?: boolean;
  /** Owning battle objective, carried through consequences into battle progress attribution. */
  questId?: string;
  objectiveId?: string;
  /** Optional shared HP/CP/SP starting percentage; absence preserves carried pools. */
  givePools?: number;
  /** Fully configured player tags whose duration includes the opening round. */
  startingEffects?: ZodAllTags[];
  /** Expanded NPC template IDs for combat consequences; duplicates request separate allies. */
  allyAiIds?: string[];
};

/**
 * Combat-only context for war kill eligibility, managed-run attribution and shared settlement.
 * The battle ID groups teammates' damage within one battle; a team still fighting
 * defers defeat/retry handling until the remaining participants have settled.
 */
export type CombatQuestContext = {
  battleId?: string;
  questTeamStillFighting?: boolean;
  inWarTornSector: boolean;
  /** Human PvP in a Territory War captured at initiation; excludes guardian fights. */
  inTerritoryWar?: boolean;
  isWarParticipant: boolean;
  /** Prevent unrelated fights from advancing ticketed or versioned run objectives. */
  questBattleSource?: { questId: string; objectiveId: string };
};

/** Fully hydrated user, with the optional collections objectives read as snapshots. */
type TrackerUser = NonNullable<UserWithRelations> & {
  useritems?: UserItem[];
  farmingCollectionCount?: number;
  bloodlineCollectionProgress?: BloodlineCollectionProgress;
  ownedObjectiveJutsus?: { jutsuId: string; masteryTypes: MasteryType[] }[];
};

export type ObjectiveTrackerTaskInput = {
  task: AllObjectiveTask | "any";
  increment?: number;
  value?: number;
  text?: string;
  contentId?: string;
  /** Distinct jutsu disciplines captured when training starts or an action is performed. */
  masteryTypes?: MasteryType[];
  /** Opponent classification for combat-use filters, independent of the battle outcome. */
  combatType?: "PVP" | "PVE";
  warFoe?: boolean;
};
