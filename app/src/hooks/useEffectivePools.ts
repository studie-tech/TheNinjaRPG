import { useMemo } from "react";
import { getEffectiveCurPool, getEffectiveMaxPool } from "@/libs/combat/util";
import type { ReturnedUserState, UserEffect } from "@/libs/combat/types";

interface UserDataPools {
  curHealth?: number;
  maxHealth?: number;
  curChakra?: number;
  maxChakra?: number;
  curStamina?: number;
  maxStamina?: number;
}

interface UseEffectivePoolsParams {
  battleUser?: ReturnedUserState;
  usersEffects?: UserEffect[];
  userData?: UserDataPools | null;
}

interface EffectivePools {
  curHealth: number;
  maxHealth: number;
  curChakra: number;
  maxChakra: number;
  curStamina: number;
  maxStamina: number;
}

/**
 * Hook to calculate effective pool values accounting for battle effects.
 * Returns effective values with proper fallbacks: battleUser (with effects) → userData
 */
export const useEffectivePools = ({
  battleUser,
  usersEffects,
  userData,
}: UseEffectivePoolsParams): EffectivePools => {
  return useMemo(() => {
    // If we have a battleUser, use effective pool calculations (handles undefined effects)
    if (battleUser) {
      return {
        curHealth: getEffectiveCurPool(battleUser, usersEffects, "Health"),
        maxHealth: getEffectiveMaxPool(battleUser, usersEffects, "Health"),
        curChakra: getEffectiveCurPool(battleUser, usersEffects, "Chakra"),
        maxChakra: getEffectiveMaxPool(battleUser, usersEffects, "Chakra"),
        curStamina: getEffectiveCurPool(battleUser, usersEffects, "Stamina"),
        maxStamina: getEffectiveMaxPool(battleUser, usersEffects, "Stamina"),
      };
    }

    // Fall back to userData if no battleUser
    return {
      curHealth: userData?.curHealth ?? 0,
      maxHealth: userData?.maxHealth ?? 1,
      curChakra: userData?.curChakra ?? 0,
      maxChakra: userData?.maxChakra ?? 1,
      curStamina: userData?.curStamina ?? 0,
      maxStamina: userData?.maxStamina ?? 1,
    };
  }, [battleUser, usersEffects, userData]);
};
