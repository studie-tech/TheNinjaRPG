import { COMBAT_ENMITY_PER_DAMAGE } from "@/drizzle/constants";
import { getPower } from "./tags";
import type {
  BattleUserState,
  Consequence,
  EnmityDamageKey,
  UserEffect,
} from "./types";
import {
  canStackEffect,
  getActiveSealEffects,
  getEffectStackKey,
  isEffectActive,
  sealCheck,
} from "./util";

/** Damage threat belongs to the actor, including summons, and excludes friendly fire. */
export const creditDamageEnmity = (
  attacker: BattleUserState,
  target: BattleUserState,
  healthLost: number,
  effects: UserEffect[],
): void => {
  if (
    healthLost <= 0 ||
    attacker.userId === target.userId ||
    attacker.direction === target.direction
  )
    return;
  const base = healthLost * COMBAT_ENMITY_PER_DAMAGE;
  let percentage = 0;
  let flat = 0;
  const applied = new Set<string>();
  const seals = getActiveSealEffects(effects);
  for (const effect of effects) {
    if (
      (effect.type !== "increaseaggro" && effect.type !== "decreaseaggro") ||
      effect.aggroMode !== "GENERATION" ||
      effect.targetId !== attacker.userId ||
      !isEffectActive(effect) ||
      sealCheck(effect, seals) ||
      !canStackEffect(effect, applied)
    )
      continue;
    applied.add(getEffectStackKey(effect));
    const sign = effect.type === "increaseaggro" ? 1 : -1;
    const power = getPower(effect).power * sign;
    if (effect.calculation === "percentage") percentage += power;
    else flat += power;
  }
  attacker.enmity =
    (attacker.enmity ?? 0) +
    Math.max(0, base * Math.max(0, 1 + percentage / 100) + flat);
};

/** Allocate a merged HP loss in packet order, then apply generation once per actor. */
export const creditConsequenceEnmity = (
  consequence: Consequence,
  key: EnmityDamageKey,
  users: BattleUserState[],
  effects: UserEffect[],
): void => {
  if (consequence.damageSource === "recoil") return;
  const target = users.find((u) => u.userId === consequence.targetId);
  if (!target) return;
  let remaining = Math.min(target.curHealth, consequence[key] ?? 0);
  const healthLostByUser = new Map<string, number>();
  for (const source of consequence.enmitySources ?? [consequence]) {
    const healthLost = Math.min(remaining, Math.max(0, source[key] ?? 0));
    if (healthLost <= 0) continue;
    remaining -= healthLost;
    healthLostByUser.set(
      source.userId,
      (healthLostByUser.get(source.userId) ?? 0) + healthLost,
    );
  }
  for (const [userId, healthLost] of healthLostByUser) {
    const attacker = users.find((u) => u.userId === userId);
    if (attacker) creditDamageEnmity(attacker, target, healthLost, effects);
  }
};
