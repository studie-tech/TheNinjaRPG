import { actionPointsAfterAction } from "@/libs/combat/actions";
import { areBattleAllies } from "@/libs/combat/participants";
import { spliceOrphanedSummons } from "@/libs/combat/summon";
import { availableUserActions, calcActiveUser, stillInBattle } from "./actions";
import { refreshMasteries } from "./mastery";
import {
  applySageModeAfterRoundTransition,
  checkFriendlyFire,
  expireGroundEffects,
} from "./process";
import { settleCurse } from "./tags";
import type {
  BattleUserState,
  CombatAction,
  CompleteBattle,
  ReturnedBattle,
} from "./types";
import { getActiveTargetEffects, isEffectActive } from "./util";

/**
 * Align the round, active actor and action points in place using the battle timer.
 * Expire battlefield entities before exposing the next turn and return teardown effects for history.
 */
export const alignBattle = (
  battle: CompleteBattle,
  actionRounds: number[], // Rounds present in this endpoint call
  userId?: string, // Session user ID
) => {
  const now = new Date();
  // Orphan cleanup runs BEFORE actor selection: a summon whose controller has
  // died/fled/left must be gone from usersState by the time calcActiveUser walks
  // the turn ring, or it can be picked as the actor and then removed underneath
  // the caller -- leaving battle.activeUserId pointing at a user that no longer
  // exists and naming a ghost in the "It is now X's turn" line.
  const orphanedSummons = spliceOrphanedSummons(battle.usersState).map(
    (u) => u.username,
  );
  const precomputedActions = userId
    ? availableUserActions(battle as unknown as ReturnedBattle, userId)
    : undefined;
  let { actor, changedActor, progressRound } = calcActiveUser(battle, userId, 0, {
    precomputedUserId: userId,
    precomputedActions: precomputedActions,
  });
  // A variable for the current round to be used in the battle
  const actionRound = progressRound ? battle.round + 1 : battle.round;
  // Update round timer if new actor
  if (changedActor || progressRound) {
    battle.roundStartAt = now;
  }
  const expiredEffects: ReturnType<typeof expireGroundEffects> = [];
  // If we progress the battle round;
  // 1. refill action points
  // 2. update round info on battle
  // 3. update all user effect rounds
  // 4. update all updatedAt fields on items & jutsus
  if (progressRound) {
    const expiringCurses = battle.usersEffects.filter(
      (e) =>
        e.type === "curse" && e.rounds === 1 && !e.castThisRound && isEffectActive(e),
    );
    battle.usersState.forEach((u) => {
      u.actionPoints = 100;
    });
    battle.round = actionRound;
    // Effects can be persisted without passing through the pruning gate in
    // applyEffects, so the counter must floor at 0; a negative value survives
    // in the battle row and fails the tag schemas, which all require rounds >= 0.
    for (const e of [...battle.usersEffects, ...battle.groundEffects]) {
      if (e.rounds === undefined) continue;
      if (!e.castThisRound) e.rounds = Math.max(0, e.rounds - 1);
      e.isNew = false;
      e.castThisRound = false;
    }

    const actorIndex = battle.usersState.findIndex(
      (user) => user.userId === actor.userId,
    );
    const nextActors = [
      ...battle.usersState.slice(actorIndex + 1),
      ...battle.usersState.slice(0, actorIndex),
    ];
    // Only the duration transition pays Curse; Clear and replacement never enter this list.
    for (const effect of expiringCurses) {
      const holder = battle.usersState.find((u) => u.userId === effect.targetId);
      if (!holder) continue;
      if (
        !battle.usersState.some(
          (u) => !areBattleAllies(u, holder) && stillInBattle(u),
        ) &&
        !battle.extraState.encounter?.pendingWaves.length
      ) {
        if (effect.curseState) {
          effect.curseState.storedHealing = 0;
          effect.curseState.settled = true;
        }
        continue;
      }
      const info = settleCurse(effect, holder, battle.usersEffects);
      if (info) expiredEffects.push(info);
    }
    expiredEffects.push(...expireGroundEffects(battle, actionRounds));
    // Preserve cyclic initiative if the next actor expired; refilled action
    // points can make recalculation restart at a different combatant.
    if (!battle.usersState.some((user) => user.userId === actor.userId)) {
      actor =
        nextActors.find(
          (candidate) =>
            battle.usersState.some((user) => user.userId === candidate.userId) &&
            stillInBattle(candidate),
        ) ?? calcActiveUser(battle, userId).actor;
      changedActor = actor.userId !== battle.activeUserId;
    }
    // Tags that expired or landed last round change what the next actor may use
    refreshMasteries(battle.usersState, battle.usersEffects);
    // Sage exhaustion must run on every round advance, including idle-timeout polls, or
    // it stays stranded until the next action. In-memory and guarded on `sageModeActivated`.
    applySageModeAfterRoundTransition(battle);
    // Remaining pool adjustment deltas are reconciled in the applyEffects post-pass.
  }
  // Update the active user on the battle
  battle.activeUserId = actor.userId;
  battle.updatedAt = now;
  return {
    actor,
    progressRound,
    changedActor,
    actionRound,
    orphanedSummons,
    expiredEffects,
  };
};

/**
 * Evaluate whether we should forward battle to next round
 */
export const hasNoAvailableActions = (
  battle: ReturnedBattle,
  actorId: string,
  precomputedActions?: CombatAction[],
) => {
  const actor = battle.usersState.find((u) => u.userId === actorId);
  if (!actor || actor.curHealth <= 0 || actor.fledBattle || actor.leftBattle)
    return true;
  // Public actors omit private loadouts. Their remaining actions are unknown,
  // even if the timeline has already normalized missing jutsus to an empty list.
  if (!actor.jutsus || !actor.items) return false;
  const actions =
    precomputedActions && precomputedActions.length > 0
      ? precomputedActions
      : availableUserActions(battle, actorId, wantsHumanActionSet(actor));
  return !actions.some(
    (action) =>
      action.id !== "wait" && actionPointsAfterAction(actor, battle, action).canAct,
  );
};

/** Return the strongest active stun AP penalty, including hostile ground effects on the combatant's tile. */
export const calcApReduction = (
  battle?: ReturnedBattle | null,
  userId?: string | null,
) => {
  const user = battle?.usersState.find((u) => u.userId === userId);
  const stunEffects = [
    ...getActiveTargetEffects(battle?.usersEffects, userId, "stun"),
    ...(battle?.groundEffects?.filter((e) => {
      // Basic checks for stun effect at user's location
      const locationMatch =
        e.type === "stun" &&
        e.longitude === user?.longitude &&
        e.latitude === user?.latitude &&
        !e.castThisRound &&
        isEffectActive(e);

      if (!locationMatch || !user) return false;

      // Use the existing checkFriendlyFire function to determine if effect should be applied
      return checkFriendlyFire(e, user, battle.usersState);
    }) ?? []),
  ];
  return stunEffects.reduce(
    (acc, e) => ("apReduction" in e && e.apReduction > acc ? e.apReduction : acc),
    0,
  );
};

/**
 * Determine whose turn the dispatch loop should treat this actor as.
 * A piloted summon (isPiloted) is human-driven on its turn even though it
 * keeps isAi=true for accounting; only its controller may act for it.
 * The inverse also holds: a human on auto combat (isAutoCombat) keeps
 * isAi=false for accounting but their turns are driven by their AI profile.
 */
export const getTurnControl = (
  actor: Pick<BattleUserState, "isAi" | "isPiloted" | "controllerId" | "isAutoCombat">,
  sessionUserId: string,
): { isUserTurn: boolean; isAITurn: boolean } => {
  const isMyActor = actor.controllerId === sessionUserId;
  const isUserTurn = isMyActor && wantsHumanActionSet(actor) && !actor.isAutoCombat;
  const isAITurn = (actor.isAi && !actor.isPiloted) || !!actor.isAutoCombat;
  return { isUserTurn, isAITurn };
};

/**
 * The actor `myUserId` drives right now: themselves on their turn, or their
 * piloted summon on the summon's turn (control is sequential, so exactly one).
 * Falls back to `myUserId` whenever the active actor is not theirs to drive.
 *
 * Deliberately a projection of getTurnControl rather than its own predicate:
 * the client picks the actor for the action menu with exactly the rule the
 * server authorizes the action with, so the two cannot disagree about whose
 * turn it is. Accepts both ReturnedBattle and the extraState-less dynamic
 * update returned by performAction.
 */
export const resolveControlledActorId = (
  battle: Pick<ReturnedBattle, "activeUserId" | "usersState"> | null | undefined,
  myUserId: string | undefined,
): string | undefined => {
  if (!battle || !myUserId) return myUserId;
  const actor = battle.usersState.find((u) => u.userId === battle.activeUserId);
  if (!actor) return myUserId;
  return getTurnControl(actor, myUserId).isUserTurn ? actor.userId : myUserId;
};

/**
 * Returns true when the actor should receive the human (basic-move-inclusive)
 * action set. A piloted summon is isAi=true for accounting purposes but must
 * be evaluated against the human set so its turn is never falsely skipped.
 */
export const wantsHumanActionSet = (
  actor: Pick<BattleUserState, "isAi" | "isPiloted">,
): boolean => !actor.isAi || !!actor.isPiloted;
