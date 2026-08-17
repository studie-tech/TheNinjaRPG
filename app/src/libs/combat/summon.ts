import { AutoBattleTypes } from "@/drizzle/constants";
import type { Battle } from "@/drizzle/schema";
import { stillInBattle } from "@/libs/combat/actions";
import type { BattleUserState, UserEffect } from "@/libs/combat/types";

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

/** One-summon-per-controller cap predicate. Clones are excluded (see isClone)
 *  so they neither block summoning nor are blocked by a summon. */
export const hasLiveSummon = (
  usersState: BattleUserState[],
  controllerId: string,
  effects: UserEffect[],
): boolean =>
  usersState.some(
    (u) =>
      isLiveSummon(u, usersState, effects) &&
      !isClone(u) &&
      u.controllerId === controllerId,
  );

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
