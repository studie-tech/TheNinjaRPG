import {
  buffPrevent,
  debuffPrevent,
  disarm,
  elementalseal,
  fleePrevent,
  healPrevent,
  immunity,
  movePrevent,
  onehitkillPrevent,
  realizeTag,
  robPrevent,
  seal,
  sealPrevent,
  shield,
  stealth,
  stun,
  stunPrevent,
  summonPrevent,
  weakness,
} from "@/libs/combat/tags";
import type { BattleUserState, UserEffect } from "@/libs/combat/types";
import type { ZodAllTags } from "@/validators/combat";

/**
 * Clone authored tags into player-only battle effects without mutating quest content.
 * Initialize chance/immunity-sensitive statuses before opening-turn actions are calculated;
 * ordinary round processing would also tick, stack and expire effects at this stage.
 * Duration includes the opening round, and ongoing effects use the normal combat lifecycle.
 */
export const addQuestStartingEffects = (
  player: BattleUserState,
  usersEffects: UserEffect[],
  tags: readonly ZodAllTags[],
  actionId: string,
) => {
  const effects = tags.map((raw) => {
    const effect = realizeTag({
      tag: { ...structuredClone(raw), target: "SELF" } as UserEffect,
      user: player,
      level: player.level,
      actionId,
    });
    effect.fromType = "quest";
    effect.targetId = player.userId;
    effect.longitude = player.longitude;
    effect.latitude = player.latitude;
    // Opening round participates in ticking effects and duration expiry.
    effect.createdRound = -1;
    effect.castThisRound = false;
    return effect;
  });
  usersEffects.push(...effects);
  // Immunity resolves before the statuses it can prevent.
  for (const effect of [...effects].sort(
    (a, b) => Number(b.type === "immunity") - Number(a.type === "immunity"),
  )) {
    switch (effect.type) {
      case "shield":
        shield(effect, player);
        break;
      case "immunity":
        immunity(effect, player);
        break;
      case "buffprevent":
        buffPrevent(effect, usersEffects, player);
        break;
      case "debuffprevent":
        debuffPrevent(effect, usersEffects, player);
        break;
      case "fleeprevent":
        fleePrevent(effect, usersEffects, player);
        break;
      case "onehitkillprevent":
        onehitkillPrevent(effect, usersEffects, player);
        break;
      case "robprevent":
        robPrevent(effect, usersEffects, player);
        break;
      case "sealprevent":
        sealPrevent(effect, usersEffects, player);
        break;
      case "stunprevent":
        stunPrevent(effect, usersEffects, player);
        break;
      case "stun":
        stun(effect, usersEffects, player);
        break;
      case "seal":
        seal(effect, usersEffects, player);
        break;
      case "disarm":
        disarm(effect, usersEffects, player);
        break;
      case "moveprevent":
        movePrevent(effect, usersEffects, player);
        break;
      case "healprevent":
        healPrevent(effect, usersEffects, player);
        break;
      case "summonprevent":
        summonPrevent(effect, usersEffects, player);
        break;
      case "stealth":
        stealth(effect, player);
        break;
      case "elementalseal":
        elementalseal(effect, player);
        break;
      case "weakness":
        weakness(effect, player);
        break;
    }
    effect.isNew = false;
  }
};
