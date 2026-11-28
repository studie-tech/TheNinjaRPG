import {
  COMBAT_BORDER_BOTTOM,
  COMBAT_BORDER_LEFT,
  COMBAT_BORDER_RIGHT,
  COMBAT_BORDER_TOP,
} from "@/libs/combat/constants";
import { areBattleAllies } from "@/libs/combat/participants";
import { oddQHexDistance } from "@/libs/hexgrid";

/** Hex distance the tutorial's opponents start at: one step out of a basic attack's reach. */
export const TUTORIAL_OPPONENT_DISTANCE = 2;

/**
 * Moves the opponents of a tutorial-guided fight to free tiles two hexes from the
 * player, preferring the tiles closest to where each opponent spawned, so the first
 * fights open with a single move before the first strike. Allies of the player, such
 * as a companion, and hidden or template actors keep their spawn. Mutates the given states.
 */
export const placeTutorialOpponentsNearby = (
  usersState: {
    userId: string;
    isAi?: boolean;
    hidden?: boolean;
    isSummonTemplate?: boolean;
    direction: "left" | "right";
    longitude: number;
    latitude: number;
  }[],
  playerIds: readonly string[],
  width: number,
  height: number,
) => {
  const player = usersState.find((u) => playerIds.includes(u.userId));
  if (!player) return;
  const taken = new Set(usersState.map((u) => `${u.longitude},${u.latitude}`));
  for (const opponent of usersState) {
    if (
      !opponent.isAi ||
      opponent.hidden ||
      opponent.isSummonTemplate ||
      areBattleAllies(opponent, player)
    ) {
      continue;
    }
    const candidates: { x: number; y: number; score: number }[] = [];
    for (let x = COMBAT_BORDER_LEFT; x < width - COMBAT_BORDER_RIGHT; x++) {
      for (let y = COMBAT_BORDER_TOP; y < height - COMBAT_BORDER_BOTTOM; y++) {
        if (taken.has(`${x},${y}`)) continue;
        const distance = oddQHexDistance(player.longitude, player.latitude, x, y);
        if (distance !== TUTORIAL_OPPONENT_DISTANCE) continue;
        candidates.push({
          x,
          y,
          score: oddQHexDistance(opponent.longitude, opponent.latitude, x, y),
        });
      }
    }
    const best = candidates.sort((a, b) => a.score - b.score)[0];
    if (!best) continue;
    taken.delete(`${opponent.longitude},${opponent.latitude}`);
    taken.add(`${best.x},${best.y}`);
    opponent.longitude = best.x;
    opponent.latitude = best.y;
  }
};
