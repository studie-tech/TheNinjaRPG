import {
  MAP_WAR_TORN_BATTLEGROUND_SECTOR,
  RESOURCE_SILO_LOSS_POINTS,
  RESOURCE_SILO_WIN_POINTS,
} from "@/drizzle/constants";
import { hasHumanOpponent } from "@/libs/combat/participants";
import type { CombatResult, CompleteBattle } from "@/libs/combat/types";
import { collapseRewards } from "@/libs/rewards";
import { getResourceSiloWindow } from "@/utils/time";
import type { ResourceSiloEntryType } from "@/validators/resourceSilos";

/** Credit real overworld PvP outcomes within the window captured at battle admission. */
export const resourceSiloBattlePoints = (
  battle: CompleteBattle,
  userId: string,
  result: Pick<CombatResult, "outcome">,
  now: Date,
) => {
  const user = battle.usersState.find((u) => u.userId === userId && !u.isSummon);
  const window = getResourceSiloWindow(now);
  if (
    !user ||
    user.isAi ||
    user.sector !== MAP_WAR_TORN_BATTLEGROUND_SECTOR ||
    battle.battleType !== "COMBAT" ||
    battle.extraState.tournamentGameId ||
    !hasHumanOpponent(battle.usersState, user) ||
    !window.active ||
    window.id !== battle.extraState.resourceSiloWindowId
  )
    return 0;
  return result.outcome === "Won"
    ? RESOURCE_SILO_WIN_POINTS
    : result.outcome === "Lost" || result.outcome === "Fled"
      ? RESOURCE_SILO_LOSS_POINTS
      : 0;
};

/** Roll each entry independently; a claim can grant several rewards or none. */
export const rollResourceSiloRewards = (
  entries: ResourceSiloEntryType[],
  random = Math.random,
) => {
  const drops = entries.filter((entry) => random() * 100 < entry.chance);
  return { drops, rewards: collapseRewards(drops.map((entry) => entry.rewards)) };
};
