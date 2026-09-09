/**
 * Cache key for skipping highlightTiles rebuilds. Hover tile and canUseTile
 * must be included: action/version/position alone would freeze hover selection
 * and leave range highlights up after the local turn expires.
 */
export const getHighlightTilesCacheKey = (info: {
  actionId: string | undefined;
  battleVersion: number;
  userId: string;
  longitude: number;
  latitude: number;
  canUseTile: boolean;
  hoverTileName: string;
}) =>
  [
    info.actionId ?? "",
    info.battleVersion,
    info.userId,
    info.longitude,
    info.latitude,
    info.canUseTile ? "1" : "0",
    info.hoverTileName,
  ].join("|");

export type CombatHoverCursor = "pointer" | "default";

/**
 * Next body cursor after a highlight pass. Never overrides an in-flight "wait"
 * (set while a mutation is pending); restores pointer after settle-to-default.
 */
export const nextCombatHoverCursor = (
  desired: CombatHoverCursor | undefined,
  current: string,
): string => {
  if (current === "wait") return current;
  if (desired === "pointer" && (current === "default" || current === "")) {
    return "pointer";
  }
  if (desired === "default" && current === "pointer") {
    return "default";
  }
  return current;
};
