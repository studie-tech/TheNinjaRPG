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
