import { AutoBattleTypes } from "@/drizzle/constants";
import type { Battle } from "@/drizzle/schema";
import { stillInBattle } from "@/libs/combat/actions";
import type { BattleUserState, CombatAction } from "@/libs/combat/types";

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
 *  spawn). A dead summon (curHealth<=0) whose controller has left the battle is
 *  treated the same way, so its corpse stays hidden. curHealth<=0 is required so
 *  an ALIVE orphaned summon is not misread as a template. */
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

/** Active summon that can still act this battle: alive, not fled and not left. */
export const isLiveSummon = (
  u: BattleUserState,
  usersState: BattleUserState[],
): boolean => isActiveSummon(u, usersState) && stillInBattle(u) && !u.leftBattle;

/** A clone (e.g. shadow-clone jutsu) reuses isSummon for battlefield placement
 *  and orphan cleanup, but is NOT the controller's summon: it must not trip the
 *  one-per-controller cap or the AI re-summon gate, so a clone and a summon can
 *  coexist. It is the only live isSummon entity created with isOriginal === false
 *  (clone() sets it; summons keep the template's isOriginal === true), the same
 *  test process.ts uses to identify clones. */
export const isClone = (u: Pick<BattleUserState, "isSummon" | "isOriginal">): boolean =>
  !!u.isSummon && u.isOriginal === false;

/** The controller's live summons. Clones are excluded (see isClone) so they
 *  neither block summoning nor are blocked by a summon. */
export const liveSummonsOf = (
  usersState: BattleUserState[],
  controllerId: string,
): BattleUserState[] =>
  usersState.filter(
    (u) =>
      isLiveSummon(u, usersState) &&
      !isClone(u) &&
      !u.petId &&
      u.controllerId === controllerId,
  );

/** Whether the controller has any live summon. Backs the AI's
 *  `does_not_have_summon` rule condition, which asks about summons in general
 *  rather than about one particular creature. */
export const hasLiveSummon = (
  usersState: BattleUserState[],
  controllerId: string,
): boolean => liveSummonsOf(usersState, controllerId).length > 0;

/** Why a summon cast must be refused, or null when it may proceed.
 *
 *  Two independent caps:
 *   - **One of each creature.** A player with two different summon jutsus can
 *     still have both creatures out at once.
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
): string | null => {
  const live = liveSummonsOf(usersState, controllerId);
  const duplicate = live.find((u) => u.summonSourceId === sourceAiId);
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
): string | null => {
  for (const tag of action.effects) {
    if (tag.type !== "summon") continue;
    const reason = summonCastBlockedReason(
      usersState,
      actor.userId,
      tag.aiId,
      shouldPilotSummon(actor, tag.playerControlled),
    );
    if (reason) return reason;
  }
  return null;
};

/** Whether a summon should be human-piloted: the jutsu opts in via
 *  `playerControlled` and the controller is a human (non-AI). With the flag off
 *  (the default) the summon stays AI-driven.
 *
 *  No AutoBattleTypes check here: summon() refuses to spawn in those battle
 *  types, so no summon is ever piloted there. */
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
  summonsAllowedInBattle(battle) || !action.effects.some((e) => e.type === "summon");

/** An ACTIVE summon whose controller can no longer act (dead/fled/left/absent).
 *  Templates are excluded by isActiveSummon; the stillInBattle(summon) guard
 *  excludes dead summons; a controller missing from usersState counts as unable
 *  to act.
 *
 *  Clones are excluded, matching hasLiveSummon, the un-summon lookup in tags.ts
 *  and the AI does_not_have_summon gate. Removing a clone here would also strand
 *  its ground effect: clone() rebinds effect.creatorId to the spawned clone, so
 *  once the clone leaves usersState the effect can never be expired by its own
 *  tag function. Clones are torn down by that tag function instead. */
export const isOrphanedSummon = (
  summon: BattleUserState,
  usersState: BattleUserState[],
): boolean => {
  if (!isActiveSummon(summon, usersState)) return false;
  if (isClone(summon)) return false;
  if (!stillInBattle(summon)) return false;
  const controller = summonController(summon, usersState);
  return !controller || !stillInBattle(controller) || !!controller.leftBattle;
};

/** Splice out orphaned summons, in place. Classifies against a pre-mutation
 *  snapshot so removing one controller's summon cannot flip another's
 *  classification mid-pass. Returns the removed combatants (not just their ids)
 *  in array order, so callers can name them in the battle log without looking
 *  up entries that are no longer in usersState. */
export const spliceOrphanedSummons = (
  usersState: BattleUserState[],
): BattleUserState[] => {
  const snapshot = [...usersState];
  const orphans = snapshot.filter((u) => isOrphanedSummon(u, snapshot));
  if (orphans.length === 0) return [];
  const orphanIds = new Set(orphans.map((u) => u.userId));
  const survivors = snapshot.filter((u) => !orphanIds.has(u.userId));
  usersState.length = 0;
  usersState.push(...survivors);
  return orphans;
};

/** The participants a mid-battle loadout reprocess adds to the battle. Reprocessing
 *  one player also loads every summon template their new loadout can cast; a
 *  template the battle already holds (matched on controllerId, the source AI id)
 *  is dropped so summon() keeps a single clone source per creature. */
export const mergeLoadoutParticipants = (
  existing: BattleUserState[],
  processed: BattleUserState[],
): BattleUserState[] =>
  processed.filter(
    (u) =>
      !u.isSummonTemplate ||
      !existing.some(
        (e) => isSummonTemplate(e, existing) && e.controllerId === u.controllerId,
      ),
  );
