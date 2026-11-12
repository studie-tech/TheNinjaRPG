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

/**
 * Credit human overworld PvP only while its admission window is still active at settlement.
 * Capturing the opening prevents a fight from carrying credit into a later spawn.
 */
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

/** Roll independent chances without normalizing their sum, returning drops and their merged payout. */
export const rollResourceSiloRewards = (
  entries: ResourceSiloEntryType[],
  random = Math.random,
) => {
  const drops = entries.filter((entry) => random() * 100 < entry.chance);
  return { drops, rewards: collapseRewards(drops.map((entry) => entry.rewards)) };
};
