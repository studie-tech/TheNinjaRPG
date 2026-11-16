import type { ReturnedUserState } from "./types";

/**
 * Whether a combatant is still fighting: alive and not fled. Stored current health
 * already includes pool buffs/debuffs. It lives apart from the action rules so code
 * outside combat can ask without loading them.
 */
export const stillInBattle = (
  user: Pick<ReturnedUserState, "curHealth" | "fledBattle">,
) => user.curHealth > 0 && !user.fledBattle;
