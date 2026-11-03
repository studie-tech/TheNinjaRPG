import type { VillageMissionTask } from "@/drizzle/constants";
import type { CombatResult, CompleteBattle } from "@/libs/combat/types";
import { wasDefeated } from "@/libs/combat/util";

/** Reserve shared PvP credit in battle state before its version-guarded settlement. */
export const claimVillageMissionCombatEvents = (
  battle: CompleteBattle,
  userId: string,
  result: CombatResult,
): Partial<Record<VillageMissionTask, number>> => {
  const user = battle.usersState.find((entry) => entry.userId === userId);
  if (
    !user ||
    user.isAi ||
    user.isSummon ||
    !user.villageId ||
    !result.didWin ||
    battle.battleType !== "COMBAT"
  )
    return {};
  // Settlement runs per participant. The persisted marker survives later pool
  // changes, so deferred damage cannot let another winner credit the same kills.
  const hasCreditedWinner = battle.usersState.some(
    (entry) =>
      entry.villageId === user.villageId &&
      entry.direction === user.direction &&
      entry.villageMissionPvpCredited,
  );
  if (hasCreditedWinner) return {};
  const kills = battle.usersState.filter(
    (entry) =>
      entry.direction !== user.direction &&
      !entry.isAi &&
      !entry.isSummon &&
      wasDefeated(entry),
  ).length;
  if (kills === 0) return {};
  user.villageMissionPvpCredited = true;
  return { pvp_kills: kills };
};
