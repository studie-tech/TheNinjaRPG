import { isHumanOpponent } from "@/libs/combat/participants";
import { wasDefeated } from "@/libs/combat/settlement";
import type { CombatResult, CompleteBattle } from "@/libs/combat/types";

/** Reserve shared PvP kill credit in battle state before its version-guarded settlement. */
export const claimVillageMissionPvpKills = (
  battle: CompleteBattle,
  userId: string,
  result: CombatResult,
): number => {
  const user = battle.usersState.find((entry) => entry.userId === userId);
  if (
    !user ||
    user.isAi ||
    user.isSummon ||
    !user.villageId ||
    !result.didWin ||
    battle.battleType !== "COMBAT"
  )
    return 0;
  // Settlement runs per participant. The persisted marker survives later pool
  // changes, so deferred damage cannot let another winner credit the same kills.
  const hasCreditedWinner = battle.usersState.some(
    (entry) =>
      entry.villageId === user.villageId &&
      entry.direction === user.direction &&
      entry.villageMissionPvpCredited,
  );
  if (hasCreditedWinner) return 0;
  const kills = battle.usersState.filter(
    (entry) => isHumanOpponent(user, entry) && wasDefeated(entry),
  ).length;
  if (kills === 0) return 0;
  user.villageMissionPvpCredited = true;
  return kills;
};
