import {
  COMBAT_BORDER_BOTTOM,
  COMBAT_BORDER_LEFT,
  COMBAT_BORDER_RIGHT,
  COMBAT_BORDER_TOP,
} from "@/libs/combat/constants";

/** Enumerate distinct spawn cells on one team's half of the battlefield. */
export const getBattleSpawnLocations = (
  width: number,
  height: number,
  direction: "left" | "right",
) => {
  const halfWidth = Math.floor(width / 2);
  const min = direction === "left" ? 1 : halfWidth + 1;
  const max = direction === "left" ? halfWidth : width - 3;
  const firstX = min + COMBAT_BORDER_LEFT;
  const lastX = max - COMBAT_BORDER_RIGHT;
  // Preserve the small-field columns produced by the existing random bounds.
  const minX = Math.min(firstX, lastX + 1);
  const maxX = Math.max(firstX, lastX);
  const locations: { x: number; y: number }[] = [];
  for (let x = minX; x <= maxX; x++) {
    for (let y = 1 + COMBAT_BORDER_BOTTOM; y <= height - COMBAT_BORDER_TOP - 1; y++) {
      locations.push({ x, y });
    }
  }
  return locations;
};
