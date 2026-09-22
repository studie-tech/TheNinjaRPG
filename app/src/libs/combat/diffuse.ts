import { DIFFUSE_MAX_PERCENTAGE } from "@/drizzle/constants";
import { getPower } from "./tags";
import type { ActionEffect, BattleUserState, UserEffect } from "./types";
import { creditDamageDealt, resolveDamageCreditUser } from "./util";

export type DiffusePacket = {
  targetId: string;
  attackerId: string;
  damage: number;
  creditDamage: boolean;
  applyRemaining: (fraction: number) => void;
};

/** Split the whole incoming hit before defenses, so multiple packets cannot hide a lethal hit. */
export const deferDiffuseDamage = (
  packets: DiffusePacket[],
  effects: UserEffect[],
  users: BattleUserState[],
  round: number,
  messages: ActionEffect[],
) => {
  const incoming = new Map<string, number>();
  for (const packet of packets) {
    incoming.set(packet.targetId, (incoming.get(packet.targetId) ?? 0) + packet.damage);
  }
  for (const target of users) {
    const total = incoming.get(target.userId) ?? 0;
    if (total <= 0 || total >= target.curHealth) continue;
    // Overlapping Diffuse effects use the strongest percentage, never an additive 100% deferral.
    const effect = effects
      .filter((e) => e.type === "diffuse" && e.targetId === target.userId)
      .sort(
        (a, b) => getPower(b).power - getPower(a).power || a.id.localeCompare(b.id),
      )[0];
    if (effect?.type !== "diffuse") continue;
    const fraction =
      Math.min(DIFFUSE_MAX_PERCENTAGE, Math.max(0, getPower(effect).power)) / 100;
    if (fraction <= 0) continue;
    target.diffuseDamage ??= [];
    const debts = target.diffuseDamage;
    for (const packet of packets) {
      if (packet.targetId !== target.userId || packet.damage <= 0) continue;
      const attacker = users.find((u) => u.userId === packet.attackerId);
      const attackerId = attacker
        ? resolveDamageCreditUser(users, attacker).userId
        : packet.attackerId;
      const damage = packet.damage * fraction;
      const existing = debts.find(
        (debt) =>
          debt.attackerId === attackerId &&
          debt.remainingTurns === effect.delayRounds &&
          debt.lastAppliedRound === round &&
          debt.creditDamage === packet.creditDamage,
      );
      if (existing) existing.remainingDamage += damage;
      else
        debts.push({
          attackerId,
          remainingDamage: damage,
          remainingTurns: effect.delayRounds,
          lastAppliedRound: round,
          creditDamage: packet.creditDamage,
        });
      packet.applyRemaining(1 - fraction);
    }
    messages.push({
      txt: `${target.username} diffuses ${(total * fraction).toFixed(2)} damage over ${effect.delayRounds} turns`,
      color: "blue",
      types: ["diffuse"],
    });
  }
};

/** Debt ticks once per target round, independently of tag expiry and all tag defenses. */
export const repayDiffuseDamage = (
  users: BattleUserState[],
  actorId: string,
  round: number,
  messages: ActionEffect[],
) => {
  const target = users.find((u) => u.userId === actorId);
  if (!target?.diffuseDamage?.length || target.curHealth <= 0) return;
  for (const debt of target.diffuseDamage) {
    if (debt.lastAppliedRound >= round || debt.remainingTurns <= 0) continue;
    const damage = debt.remainingDamage / debt.remainingTurns;
    debt.remainingDamage -= damage;
    debt.remainingTurns -= 1;
    debt.lastAppliedRound = round;
    target.curHealth = Math.max(0, target.curHealth - damage);
    const attacker = users.find((u) => u.userId === debt.attackerId);
    if (attacker && debt.creditDamage) creditDamageDealt(attacker, target, damage);
    messages.push({
      txt: `${target.username} takes ${damage.toFixed(2)} diffuse damage`,
      color: "red",
      types: ["diffuse"],
    });
  }
  target.diffuseDamage = target.diffuseDamage.filter((debt) => debt.remainingTurns > 0);
};
