import {
  BufferGeometry,
  BufferAttribute,
  Mesh,
  Line,
  type LineBasicMaterial,
  type Material,
} from "three";
import { HEX_ASPECT_RATIO, HEX_STACKING_DISPLACEMENT } from "@/drizzle/constants";
import type { TerrainHex } from "../hexgrid";

/**
 * Calculates the width to height ratio for a hex grid based on its dimensions.
 * Used for maintaining proper aspect ratio in orthographic views.
 */
export const calculateWidth2Height = (width: number, height: number): number => {
  return (
    (height * HEX_ASPECT_RATIO) / (width - HEX_STACKING_DISPLACEMENT * (width - 1))
  );
};

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
 * Calculates UV coordinates for tile and ground geometries based on the first tile's corners
 */
export const calculateHexUVCoordinates = (
  firstTile: TerrainHex | undefined,
  points: number[],
  groundPoints: number[],
) => {
  let groundUVArray: Float32Array | null = null;
  let tileUVArray: Float32Array | null = null;

  if (!firstTile) {
    return { groundUVArray, tileUVArray };
  }

  const corners = firstTile.corners;
  const length = Math.abs((corners?.[5]?.x || 0) - (corners?.[0]?.x || 0)) / 3;

  // Ground UV coordinates
  const canonicalGroundCorners = [
    { x: corners?.[0]?.x!, y: corners?.[0]?.y! - length },
    { x: corners?.[1]?.x!, y: corners?.[1]?.y! - length },
    { x: corners?.[1]?.x!, y: corners?.[1]?.y! },
    { x: corners?.[0]?.x!, y: corners?.[0]?.y! },
    { x: corners?.[5]?.x!, y: corners?.[5]?.y! },
    { x: corners?.[4]?.x!, y: corners?.[4]?.y! },
    { x: corners?.[4]?.x!, y: corners?.[4]?.y! - length },
    { x: corners?.[5]?.x!, y: corners?.[5]?.y! - length },
  ];
  const minX = Math.min(...canonicalGroundCorners.map((c) => c.x));
  const maxX = Math.max(...canonicalGroundCorners.map((c) => c.x));
  const minY = Math.min(...canonicalGroundCorners.map((c) => c.y));
  const maxY = Math.max(...canonicalGroundCorners.map((c) => c.y));
  const uvWidth = maxX - minX;
  const uvHeight = maxY - minY;
  const canonicalGroundUVs = canonicalGroundCorners.map(
    (corner) =>
      [(corner.x - minX) / uvWidth, (corner.y - minY) / uvHeight] as [number, number],
  );
  const uvNumbers: number[] = [];
  groundPoints.forEach((p) => {
    const uv = canonicalGroundUVs[p];
    if (uv) {
      uvNumbers.push(uv[0], uv[1]);
    }
  });
  groundUVArray = new Float32Array(uvNumbers);

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
  tileUVArray = new Float32Array(tileUVNumbers);

  return { groundUVArray, tileUVArray };
};

/**
 * Calculates the offset values for tiles based on asset type
 * Ocean tiles are displaced downward for depth effect
 */
export const calculateTileOffset = (
  corners: Array<{ x: number; y: number }>,
  asset: string,
  lightLayout?: boolean,
) => {
  const length = Math.abs((corners?.[5]?.x || 0) - (corners?.[0]?.x || 0)) / 3;
  let offsetLength = 0;
  let offsetLayer = 0;

  if (!lightLayout) {
    if (asset === "ocean") {
      offsetLength = -length / 2;
      offsetLayer = -1;
    } else if (asset === "ice") {
      offsetLength = -length / 4;
      offsetLayer = -0.5;
    }
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
    { x: corners?.[0]?.x!, y: corners?.[0]?.y! - tileLength },
    { x: corners?.[1]?.x!, y: corners?.[1]?.y! - tileLength },
    { x: corners?.[1]?.x!, y: corners?.[1]?.y! + offsetLength },
    { x: corners?.[0]?.x!, y: corners?.[0]?.y! + offsetLength },
    { x: corners?.[5]?.x!, y: corners?.[5]?.y! + offsetLength },
    { x: corners?.[4]?.x!, y: corners?.[4]?.y! + offsetLength },
    { x: corners?.[4]?.x!, y: corners?.[4]?.y! - tileLength },
    { x: corners?.[5]?.x!, y: corners?.[5]?.y! - tileLength },
  ] as const;
};

/**
 * Creates the top face geometry for a hex tile
 */
export const createTileGeometry = (info: {
  corners: Array<{ x: number; y: number }> | ReadonlyArray<{ x: number; y: number }>;
  points: number[];
  tileUVArray: Float32Array | null;
  offsetLength: number;
  offsetLayer: number;
  layer: number;
}) => {
  const { corners, points, tileUVArray, offsetLength, offsetLayer, layer } = info;
  const geometry = new BufferGeometry();

  // Safety: ensure corners exist and points are valid
  if (!corners || corners.length === 0) {
    return geometry;
  }

  const vertices: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const pIdx = points[i];
    const p = pIdx !== undefined ? corners[pIdx] : undefined;
    if (p) {
      vertices.push(p.x, p.y + offsetLength, layer + offsetLayer);
    }
  }

  geometry.setAttribute("position", new BufferAttribute(new Float32Array(vertices), 3));
  if (tileUVArray) {
    geometry.setAttribute("uv", new BufferAttribute(tileUVArray, 2));
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
};

/**
 * Creates the ground (dirt) geometry below a hex tile
 */
export const createGroundGeometry = (info: {
  groundCorners: ReadonlyArray<{ x: number; y: number }>;
  groundPoints: number[];
  groundUVArray: Float32Array | null;
  layer: number;
}) => {
  const { groundCorners, groundPoints, groundUVArray, layer } = info;
  const groundGeometry = new BufferGeometry();
  const groundVertices = new Float32Array(
    groundPoints
      .map((p) => groundCorners[p])
      .flatMap((p) => (p ? [p.x, p.y, layer] : [])),
  );
  groundGeometry.setAttribute("position", new BufferAttribute(groundVertices, 3));
  if (groundUVArray) {
    groundGeometry.setAttribute("uv", new BufferAttribute(groundUVArray, 2));
  }
  return groundGeometry;
};

/**
 * Creates vertical edge lines for the ground geometry
 */
export const createGroundEdges = (info: {
  groundCorners: ReadonlyArray<{ x: number; y: number }>;
  groundEdges: number[][];
  lineMaterial: LineBasicMaterial;
  layer: number;
}) => {
  const { groundCorners, groundEdges, lineMaterial, layer } = info;
  const edgeMeshes: Line[] = [];

  groundEdges.forEach((edge) => {
    const edgeGeometry = new BufferGeometry();
    const edgeVertices = new Float32Array(
      edge.map((p) => groundCorners[p]).flatMap((p) => (p ? [p.x, p.y, layer] : [])),
    );
    edgeGeometry.setAttribute("position", new BufferAttribute(edgeVertices, 3));
    const edgeMesh = new Line(edgeGeometry, lineMaterial);
    edgeMeshes.push(edgeMesh);
  });

  return edgeMeshes;
};

/**
 * Creates a complete tile mesh with geometry and material
 */
export const createTileMesh = (info: {
  tile: TerrainHex;
  geometry: BufferGeometry;
  material: Material | undefined;
  originalColor?: number;
}) => {
  const { tile, geometry, material, originalColor } = info;
  const mesh = new Mesh(geometry, material);
  mesh.name = `${tile.row},${tile.col}`;
  mesh.userData.type = "tile";
  mesh.userData.tile = tile;
  if (originalColor !== undefined) {
    mesh.userData.hex = originalColor;
  }
  mesh.userData.highlight = false;
  mesh.userData.selected = false;
  mesh.userData.canClick = false;
  mesh.matrixAutoUpdate = false;
  return mesh;
};

/**
 * Creates a ground mesh
 */
export const createGroundMesh = (info: {
  tile: TerrainHex;
  geometry: BufferGeometry;
  material: Material | undefined;
}) => {
  const { tile, geometry, material } = info;
  const groundMesh = new Mesh(geometry, material);
  groundMesh.userData.type = "tile";
  groundMesh.userData.tile = tile;
  groundMesh.userData.highlight = false;
  groundMesh.userData.selected = false;
  groundMesh.userData.canClick = false;
  return groundMesh;
};

/**
 * Merges multiple BufferGeometries into a single geometry for performance
 * This dramatically reduces draw calls by combining many meshes into one
 */
export const mergeBufferGeometries = (geometries: BufferGeometry[]): BufferGeometry => {
  if (geometries.length === 0) {
    return new BufferGeometry();
  }

  // Calculate total vertices count
  let totalVertices = 0;
  let totalUVs = 0;
  const hasUV = geometries[0]?.attributes.uv !== undefined;

  geometries.forEach((geometry) => {
    const positions = geometry.attributes.position;
    if (positions) {
      totalVertices += positions.count * 3;
      if (hasUV && geometry.attributes.uv) {
        totalUVs += geometry.attributes.uv.count * 2;
      }
    }
  });

  // Create merged arrays
  const mergedPositions = new Float32Array(totalVertices);
  const mergedUVs = hasUV ? new Float32Array(totalUVs) : null;

  let positionOffset = 0;
  let uvOffset = 0;

  // Copy all geometry data into merged arrays
  geometries.forEach((geometry) => {
    const positions = geometry.attributes.position;
    if (positions) {
      mergedPositions.set(positions.array as Float32Array, positionOffset);
      positionOffset += positions.count * 3;

      if (hasUV && geometry.attributes.uv && mergedUVs) {
        const uvs = geometry.attributes.uv;
        mergedUVs.set(uvs.array as Float32Array, uvOffset);
        uvOffset += uvs.count * 2;
      }
    }
  });

  // Create merged geometry
  const mergedGeometry = new BufferGeometry();
  mergedGeometry.setAttribute("position", new BufferAttribute(mergedPositions, 3));
  if (hasUV && mergedUVs) {
    mergedGeometry.setAttribute("uv", new BufferAttribute(mergedUVs, 2));
  }

  return mergedGeometry;
};
