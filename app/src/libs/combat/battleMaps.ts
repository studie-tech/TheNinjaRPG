import type { GroundEffect, ReturnedBattle, UserEffect } from "@/libs/combat/types";
import { isEffectActive } from "@/libs/combat/util";

/**
 * Precomputed maps for efficient combat tile lookups
 */
export interface BattleMaps {
  groundEffectsByTile: Map<string, GroundEffect[]>;
  userEffectsByUserId: Map<string, UserEffect[]>;
  usersByTile: Map<string, string>;
}

const EMPTY_BATTLE_MAPS: BattleMaps = {
  groundEffectsByTile: new Map<string, GroundEffect[]>(),
  userEffectsByUserId: new Map<string, UserEffect[]>(),
  usersByTile: new Map<string, string>(),
};

/**
 * Precompute maps for ground effects, user effects, and user positions.
 * useBattleMaps only recomputes this when battle id or version changes.
 */
export const computeBattleMaps = (battle: ReturnedBattle | null): BattleMaps => {
  if (!battle) return EMPTY_BATTLE_MAPS;

  const groundEffectsByTile = new Map<string, GroundEffect[]>();
  const userEffectsByUserId = new Map<string, UserEffect[]>();
  const usersByTile = new Map<string, string>();

  battle.groundEffects.forEach((effect) => {
    const key = `${effect.longitude},${effect.latitude}`;
    const existing = groundEffectsByTile.get(key) || [];
    existing.push(effect);
    groundEffectsByTile.set(key, existing);
  });

  battle.usersEffects.forEach((effect) => {
    if (!isEffectActive(effect)) return;
    const existing = userEffectsByUserId.get(effect.targetId) || [];
    existing.push(effect);
    userEffectsByUserId.set(effect.targetId, existing);
  });

  battle.usersState.forEach((user) => {
    if (user.curHealth > 0 && !user.fledBattle) {
      usersByTile.set(`${user.longitude},${user.latitude}`, user.userId);
    }
  });

  return { groundEffectsByTile, userEffectsByUserId, usersByTile };
};

/**
 * Post-battle getUser / travel / raid invalidation should run once per ended
 * battle, not on every later props identity change while result stays set.
 */
export const shouldInvalidateEndedBattleCaches = (
  lastInvalidatedBattleId: string | null,
  battleId: string | undefined,
  hasResult: boolean,
): boolean => Boolean(hasResult && battleId && lastInvalidatedBattleId !== battleId);
