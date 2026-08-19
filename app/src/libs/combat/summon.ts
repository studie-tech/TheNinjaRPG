import { AutoBattleTypes } from "@/drizzle/constants";
import type { Battle } from "@/drizzle/schema";
import { stillInBattle } from "@/libs/combat/actions";
import type { BattleUserState, CombatAction, UserEffect } from "@/libs/combat/types";

/** The combatant that owns this summon, or null. Only meaningful when
 *  u.isSummon is already known true (templates point controllerId at the
 *  source AI, which is never a combatant). */
export const summonController = (
  u: Pick<BattleUserState, "controllerId">,
  usersState: BattleUserState[],
): BattleUserState | null =>
  usersState.find((c) => c.userId === u.controllerId) ?? null;

/** The hidden clone-source template, not a battlefield entity.
 *  Primary signal: the explicit isSummonTemplate flag (set at load, cleared on
 *  spawn). Legacy fallback for battles predating the flag: a non-live summon
 *  (curHealth<=0) whose controllerId matches no combatant. curHealth<=0 is
 *  required so an ALIVE orphaned summon is not misread as a template. */
export const isSummonTemplate = (
  u: Pick<
    BattleUserState,
    "isSummon" | "isSummonTemplate" | "curHealth" | "controllerId"
  >,
  usersState: BattleUserState[],
): boolean =>
  !!u.isSummonTemplate ||
  (!!u.isSummon && u.curHealth <= 0 && !summonController(u, usersState));

/** A spawned summon or clone actually on the battlefield. */
export const isActiveSummon = (
  u: Pick<
    BattleUserState,
    "isSummon" | "isSummonTemplate" | "curHealth" | "controllerId"
  >,
  usersState: BattleUserState[],
): boolean => !!u.isSummon && !isSummonTemplate(u, usersState);

/** Active summon that can still act this battle. Collapses the
 *  `stillInBattle && !leftBattle` clause previously hand-copied at 3 sites. */
export const isLiveSummon = (
  u: BattleUserState,
  usersState: BattleUserState[],
  effects: UserEffect[],
): boolean =>
  isActiveSummon(u, usersState) && stillInBattle(u, effects) && !u.leftBattle;

/** A clone (e.g. shadow-clone jutsu) reuses isSummon for battlefield placement
 *  and orphan cleanup, but is NOT the controller's summon: it must not trip the
 *  one-per-controller cap or the AI re-summon gate, so a clone and a summon can
 *  coexist (as they did pre-pilot). It is the only live isSummon entity created
 *  with isOriginal === false (clone() sets it; summons keep the template's
 *  isOriginal === true), mirroring how process.ts already treats !isOriginal as
 *  a clone. */
export const isClone = (u: Pick<BattleUserState, "isSummon" | "isOriginal">): boolean =>
  !!u.isSummon && u.isOriginal === false;

/** The controller's live summons. Clones are excluded (see isClone) so they
 *  neither block summoning nor are blocked by a summon. */
export const liveSummonsOf = (
  usersState: BattleUserState[],
  controllerId: string,
  effects: UserEffect[],
): BattleUserState[] =>
  usersState.filter(
    (u) =>
      isLiveSummon(u, usersState, effects) &&
      !isClone(u) &&
      u.controllerId === controllerId,
  );

/** Whether the controller has any live summon. Backs the AI's
 *  `does_not_have_summon` rule condition, which asks about summons in general
 *  rather than about one particular creature. */
export const hasLiveSummon = (
  usersState: BattleUserState[],
  controllerId: string,
  effects: UserEffect[],
): boolean => liveSummonsOf(usersState, controllerId, effects).length > 0;

/** Why a summon cast must be refused, or null when it may proceed.
 *
 *  Two independent caps:
 *   - **One of each creature.** Preserves the pre-PR rule, so a player with two
 *     different summon jutsus can still have both creatures out at once.
 *   - **One piloted summon overall.** Each piloted summon hands its owner an
 *     extra turn per round, so a second one is a turn-economy problem no matter
 *     which creature it is. Non-piloted summons are unaffected.
 *
 *  Returns a player-facing sentence: callers surface it as a notification. */
export const summonCastBlockedReason = (
  usersState: BattleUserState[],
  controllerId: string,
  sourceAiId: string,
  wantsPilot: boolean,
  effects: UserEffect[],
): string | null => {
  const live = liveSummonsOf(usersState, controllerId, effects);
  // Legacy fallback for battles that started before summonSourceId existed:
  // compare against the template's username, which is what the pre-PR rule used
  // and which a spawned summon still inherits.
  const template = usersState.find((u) => u.controllerId === sourceAiId);
  const duplicate = live.find((u) =>
    u.summonSourceId
      ? u.summonSourceId === sourceAiId
      : !!template && u.username === template.username,
  );
  if (duplicate) return `${duplicate.username} is already summoned`;
  if (wantsPilot && live.some((u) => u.isPiloted)) {
    return "You can only control one summon at a time";
  }
  return null;
};

/** Why an ACTION must be refused because of the summon caps, or null when it may
 *  proceed. Walks the action's summon tags (an action may legitimately carry
 *  none, in which case this is always null) and applies summonCastBlockedReason.
 *
 *  Callers check this BEFORE spending pools: insertAction deducts chakra/stamina/AP,
 *  so refusing here keeps a blocked cast free while the jutsu stays visible in the
 *  action bar. Gating in availableUserActions would hide it until castable. */
export const summonActionBlockedReason = (
  action: Pick<CombatAction, "effects">,
  actor: Pick<BattleUserState, "userId" | "isAi">,
  usersState: BattleUserState[],
  effects: UserEffect[],
): string | null => {
  for (const tag of action.effects) {
    if (tag.type !== "summon") continue;
    const reason = summonCastBlockedReason(
      usersState,
      actor.userId,
      tag.aiId,
      shouldPilotSummon(actor, tag.playerControlled),
      effects,
    );
    if (reason) return reason;
  }
  return null;
};

/** Whether a summon should be human-piloted: the jutsu opts in via
 *  `playerControlled` and the controller is a human (non-AI). With the flag off
 *  (the default) the summon stays AI-driven.
 *
 *  No AutoBattleTypes check here: summon() already refuses to spawn anything in
 *  those battle types before this is reached, so a second check would be dead
 *  code that tests could only pin by lying about the call order. */
export const shouldPilotSummon = (
  controller: Pick<BattleUserState, "isAi"> | undefined,
  playerControlled: boolean | undefined,
): boolean => !!playerControlled && !!controller && !controller.isAi;

/** Whether summons may be created at all in this battle. Auto-resolved battle
 *  types (KAGE_AI / CLAN_CHALLENGE) have no human turns and must not spawn
 *  summons — not even AI-cast ones. */
export const summonsAllowedInBattle = (battle: Pick<Battle, "battleType">): boolean =>
  !AutoBattleTypes.includes(battle.battleType);

/** Whether an action is worth considering in this battle type. Auto-resolved
 *  battles refuse to spawn summons, so a summon action there is a guaranteed
 *  no-op that would still cost the caster its turn -- and because
 *  `does_not_have_summon` stays true afterwards, an AI would re-cast it every
 *  single round. Actions with no summon tag are always castable. */
export const isSummonActionCastable = (
  action: Pick<CombatAction, "effects">,
  battle: Pick<Battle, "battleType">,
): boolean =>
  summonsAllowedInBattle(battle) ||
  !action.effects.some((e) => "type" in e && e.type === "summon");

/** An ACTIVE summon whose controller can no longer act (dead/fled/left/absent).
 *  Templates are excluded by isActiveSummon; the stillInBattle(summon) guard
 *  excludes dead summons; the tri-condition keeps the absent-controller branch
 *  that shipped tests depend on.
 *
 *  Clones are excluded, matching hasLiveSummon, the un-summon lookup in tags.ts
 *  and the AI does_not_have_summon gate. Removing a clone here would also strand
 *  its ground effect: clone() rebinds effect.creatorId to the spawned clone, so
 *  once the clone leaves usersState the effect can never be expired by its own
 *  tag function. Clones are torn down by that tag function instead. */
export const isOrphanedSummon = (
  summon: BattleUserState,
  usersState: BattleUserState[],
  effects: UserEffect[],
): boolean => {
  if (!isActiveSummon(summon, usersState)) return false;
  if (isClone(summon)) return false;
  if (!stillInBattle(summon, effects)) return false;
  const controller = summonController(summon, usersState);
  return !controller || !stillInBattle(controller, effects) || !!controller.leftBattle;
};

/** Splice out orphaned summons, in place. Classifies against a pre-mutation
 *  snapshot so removing one controller's summon cannot flip another's
 *  classification mid-pass. Returns the removed combatants (not just their ids)
 *  in array order, so callers can name them in the battle log without looking
 *  up entries that are no longer in usersState. */
export const spliceOrphanedSummons = (
  usersState: BattleUserState[],
  effects: UserEffect[],
): BattleUserState[] => {
  const snapshot = [...usersState];
  const orphans = snapshot.filter((u) => isOrphanedSummon(u, snapshot, effects));
  if (orphans.length === 0) return [];
  const orphanIds = new Set(orphans.map((u) => u.userId));
  const survivors = snapshot.filter((u) => !orphanIds.has(u.userId));
  usersState.length = 0;
  usersState.push(...survivors);
  return orphans;
};
