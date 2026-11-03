import type { ActionEffect, CombatAction, CompleteBattle, UserEffect } from "./types";

/** A Counter cast has no public presentation until it resolves. */
export const isCounterAction = (action: Pick<CombatAction, "effects">): boolean =>
  action.effects.some((effect) => effect.type === "counter");

/** Retain the source definition after its caster leaves combat. */
export const revealCounter = (battle: CompleteBattle, effect: UserEffect): string => {
  battle.extraState.revealedActions ??= { jutsuIds: [], itemIds: [] };
  const ids = battle.extraState.revealedActions.jutsuIds;
  if (!ids.includes(effect.actionId)) ids.push(effect.actionId);
  return (
    effect.counterName ?? battle.extraState.jutsus?.[effect.actionId]?.name ?? "Counter"
  );
};

/** Emit unused expiry once at the round boundary, including idle advancement. */
export const expireCounters = (battle: CompleteBattle): ActionEffect[] => {
  const messages: ActionEffect[] = [];
  battle.usersEffects = battle.usersEffects.filter((effect) => {
    if (effect.type !== "counter" || effect.rounds > 0) return true;
    const owner = battle.usersState.find((user) => user.userId === effect.targetId);
    const name = revealCounter(battle, effect);
    messages.push({
      txt: `${owner?.username ?? "A combatant"}'s ${name} expires without triggering.`,
      color: "blue",
      types: ["counter"],
    });
    return false;
  });
  return messages;
};
