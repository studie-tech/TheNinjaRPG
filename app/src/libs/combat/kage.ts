import { stillInBattle } from "@/libs/combat/actions";
import type { BattleUserState, CompleteBattle } from "@/libs/combat/types";

/** Resolve a Kage challenge from shared battle state, never caller-relative results. */
export const didKageChallengerWin = (
  battle: CompleteBattle,
  challenger: BattleUserState,
  kage: BattleUserState,
) =>
  stillInBattle(challenger, battle.usersEffects) &&
  !stillInBattle(kage, battle.usersEffects);
