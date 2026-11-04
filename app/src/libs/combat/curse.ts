import { areBattleAllies } from "./participants";
import { getPower } from "./tags";
import type {
  BattleUserState,
  Consequence,
  EnmityDamageKey,
  UserEffect,
} from "./types";
import { canStackEffect, getEffectStackKey, isEffectEnabled } from "./util";

/** Multiply the holder's resolved Curse bonuses using the full context for ground seals. */
export const getCurseDamageMultiplier = (
  effects: UserEffect[],
  userId: string,
  preventionEffects: UserEffect[],
) => {
  let multiplier = 1;
  for (const effect of effects) {
    if (
      effect.type === "curse" &&
      effect.targetId === userId &&
      effect.curseState &&
      !effect.curseState.settled &&
      isEffectEnabled(effect, preventionEffects)
    ) {
      multiplier *= 1 + (effect.damageBonusPercent ?? 0) / 100;
    }
  }
  return multiplier;
};

/** Store each opponent HP loss once for eligible Curse holders on either side. */
export const accumulateCurseDamage = (
  effects: UserEffect[],
  users: BattleUserState[],
  attackerId: string,
  targetId: string,
  healthLost: number,
  round: number,
  creditUserId = attackerId,
) => {
  // Controllers preserve expired summons' allegiance; Curse ownership stays with attackerId.
  const attacker =
    users.find((u) => u.userId === attackerId) ??
    users.find((u) => u.userId === creditUserId);
  const target = users.find((u) => u.userId === targetId);
  if (
    !attacker ||
    !target ||
    healthLost <= 0 ||
    attackerId === targetId ||
    areBattleAllies(attacker, target)
  )
    return;
  const applied = new Set<string>();
  for (const effect of effects) {
    if (
      effect.type !== "curse" ||
      !effect.curseState ||
      effect.curseState.settled ||
      (effect.curseState.activatedRound >= round && !effect.curseState.ready) ||
      (effect.targetId !== attackerId && effect.targetId !== targetId) ||
      !isEffectEnabled(effect, effects) ||
      !canStackEffect(effect, applied)
    )
      continue;
    applied.add(getEffectStackKey(effect));
    effect.curseState.storedHealing +=
      (healthLost * Math.max(0, getPower(effect).power)) / 200;
  }
};

/** Preserve individual attacker ownership and overkill limits across merged damage packets. */
export const accumulateCurseConsequence = (
  consequence: Consequence,
  key: EnmityDamageKey,
  effects: UserEffect[],
  users: BattleUserState[],
  round: number,
) => {
  if (consequence.damageSource === "recoil") return;
  const target = users.find((u) => u.userId === consequence.targetId);
  if (!target) return;
  let remaining = Math.min(
    Math.max(0, target.curHealth),
    Math.max(0, consequence[key] ?? 0),
  );
  for (const source of consequence.enmitySources ?? [consequence]) {
    const healthLost = Math.min(remaining, Math.max(0, source[key] ?? 0));
    remaining -= healthLost;
    accumulateCurseDamage(
      effects,
      users,
      source.userId,
      target.userId,
      healthLost,
      round,
    );
  }
};
