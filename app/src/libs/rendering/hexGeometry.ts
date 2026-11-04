import type { TerrainHex } from "@/libs/hexgrid";

/**
 * Returns the standard hex point indices used for tile face and ground geometry
 */
export const getHexPoints = () => {
  const points = [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5];
  const groundPoints = [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 7, 7, 4, 5, 7, 5, 6];
  const groundEdges = [
    [1, 2],
    [0, 3],
    [7, 4],
    [5, 6],
    [0, 1],
    [0, 7],
    [6, 7],
  ];
  return { points, groundPoints, groundEdges };
};

/**
 * Calculates UV coordinates for tile faces based on the first tile's corners
 */
export const calculateHexUVCoordinates = (
  firstTile: TerrainHex | undefined,
  points: number[],
) => {
  if (!firstTile) return null;

  const corners = firstTile.corners;

  // Tile (top face) UV coordinates
  const canonicalTileCorners = corners.map((c) => ({ x: c.x, y: c.y }));
  const tileMinX = Math.min(...canonicalTileCorners.map((c) => c.x));
  const tileMaxX = Math.max(...canonicalTileCorners.map((c) => c.x));
  const tileMinY = Math.min(...canonicalTileCorners.map((c) => c.y));
  const tileMaxY = Math.max(...canonicalTileCorners.map((c) => c.y));
  const tileUVWidth = tileMaxX - tileMinX;
  const tileUVHeight = tileMaxY - tileMinY;
  const canonicalTileUVs = canonicalTileCorners.map(
    (corner) =>
      [(corner.x - tileMinX) / tileUVWidth, (corner.y - tileMinY) / tileUVHeight] as [
        number,
        number,
      ],
  );
  const tileUVNumbers: number[] = [];
  points.forEach((p) => {
    const uv = canonicalTileUVs[p];
    if (uv) {
      tileUVNumbers.push(uv[0], uv[1]);
    }
  });
  return new Float32Array(tileUVNumbers);
};

/**
 * Calculates the offset values for a tile from its terrain's depression (the
 * fraction of the tile edge the face is sunk below ground level - water 0.5,
 * ice sheets 0.25, solid ground 0), producing the depth effect.
 */
export const calculateTileOffset = (
  corners: Array<{ x: number; y: number }>,
  depression: number,
  lightLayout?: boolean,
) => {
  const length = Math.abs((corners?.[5]?.x || 0) - (corners?.[0]?.x || 0)) / 3;
  let offsetLength = 0;
  let offsetLayer = 0;

  if (!lightLayout && depression > 0) {
    offsetLength = -length * depression;
    // Sort recessed faces above the underlying dirt; the Y offset creates depth.
    offsetLayer = -0.5;
  }

  return {
    length,
    offsetLength,
    offsetLayer,
  };
};

/**
 * Creates the 8 corners for the ground geometry below a tile
 */
export const createGroundCorners = (
  corners: Array<{ x: number; y: number }>,
  offsetLength: number,
  length?: number,
) => {
  const tileLength =
    length ?? Math.abs((corners?.[5]?.x || 0) - (corners?.[0]?.x || 0)) / 3;
  return [
    { x: corners?.[0]?.x ?? 0, y: (corners?.[0]?.y ?? 0) - tileLength },
    { x: corners?.[1]?.x ?? 0, y: (corners?.[1]?.y ?? 0) - tileLength },
    { x: corners?.[1]?.x ?? 0, y: (corners?.[1]?.y ?? 0) + offsetLength },
    { x: corners?.[0]?.x ?? 0, y: (corners?.[0]?.y ?? 0) + offsetLength },
    { x: corners?.[5]?.x ?? 0, y: (corners?.[5]?.y ?? 0) + offsetLength },
    { x: corners?.[4]?.x ?? 0, y: (corners?.[4]?.y ?? 0) + offsetLength },
    { x: corners?.[4]?.x ?? 0, y: (corners?.[4]?.y ?? 0) - tileLength },
    { x: corners?.[5]?.x ?? 0, y: (corners?.[5]?.y ?? 0) - tileLength },
  ] as const;
};
