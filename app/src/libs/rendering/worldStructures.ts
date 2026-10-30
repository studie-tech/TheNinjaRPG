import published from "@/libs/rendering/worldStructures.json";
import { transformImageUrl } from "@/utils/image";

export const WORLD_STRUCTURE_ANCHOR_Y = 0.88;

/** Settlement kits retain distinct architecture while sharing physical material and camera contracts. */
export const WORLD_STRUCTURE_ART = published as Record<
  string,
  StructureArt & { village: string; sector: number }
>;

const byImage = new Map(
  Object.values(WORLD_STRUCTURE_ART).map((art) => [
    `${art.route}:${transformImageUrl(art.sourceImage)}`,
    art,
  ]),
);

/** Changing a structure's image or service invalidates metadata belonging to another piece of artwork. */
export const resolveWorldStructure = (
  image: string,
  route: string,
  configured?: StructureArt | null,
) => {
  const key = transformImageUrl(image).split(/[?#]/)[0] ?? image;
  if (
    configured &&
    configured.route === route &&
    transformImageUrl(configured.sourceImage) === key
  )
    return configured;
  return byImage.get(`${route}:${key}`);
};

/** Frame-local stair contacts align navigation, paving and artwork at the published entrance. */
export const getWorldStructureEntrance = (
  position: { x: number; y: number },
  height: number,
  art?: Pick<StructureArt, "frame" | "stair"> &
    Partial<Pick<StructureArt, "courtSlope" | "route">>,
) => ({
  x:
    position.x +
    (art ? (art.stair.x - art.frame.width * 0.5) / art.frame.height : -0.1) * height,
  y:
    position.y +
    (art
      ? WORLD_STRUCTURE_ANCHOR_Y - art.stair.y / art.frame.height
      : -(1 - WORLD_STRUCTURE_ANCHOR_Y)) *
      height,
  width: height * 0.26,
  courtSlope: art?.courtSlope ?? 0.18,
  courtScale:
    art?.route &&
    [
      "/townhall",
      "/shrine",
      "/globalanbuhq",
      "/adminbuilding",
      "/colosseum",
      "/historybuilding",
    ].includes(art.route)
      ? 1
      : 0.55,
});

/** Civic courts are broader than ordinary doorsteps; rear courses overlap the foundation. */
export const getWorldForecourtSize = (
  hexHeight: number,
  hasPrecinct = false,
  scale = 1,
) => ({
  width: hexHeight * (hasPrecinct ? 7 : 3.5 * scale),
  depth: hexHeight * (hasPrecinct ? 3 : 1.8 * scale),
  overlap: hexHeight * (hasPrecinct ? 0.6 : 0.45 * scale),
});

/** Front stone courses and their receding edges use the building's ground-plane axes. */
export const getWorldForecourtPoint = (
  entrance: StructureEntrance,
  x: number,
  y: number,
): [number, number] => [
  entrance.x + x - y * 0.75,
  entrance.y - x * (entrance.courtSlope ?? 0.18) - y * 0.45,
];

/** Vegetation clearance encloses the same angled footprint used to draw the paving. */
export const getWorldForecourtBounds = (
  hexHeight: number,
  entrance: StructureEntrance,
) => {
  const { width, depth, overlap } = getWorldForecourtSize(
    hexHeight,
    entrance.hasPrecinct,
    entrance.courtScale,
  );
  const points = [-width / 2, width / 2].flatMap((x) =>
    [-overlap, depth].map((y) => getWorldForecourtPoint(entrance, x, y)),
  );
  return {
    minX: Math.min(...points.map(([x]) => x)),
    maxX: Math.max(...points.map(([x]) => x)),
    minY: Math.min(...points.map(([, y]) => y)),
    maxY: Math.max(...points.map(([, y]) => y)),
  };
};

/** Published albedo, packed normal/height pixels and closed source-space geometry form one immutable asset. */
export type StructureArt = {
  route: string;
  sourceImage: string;
  filepath: string;
  material: string;
  surfaces: string;
  frame: { x: number; y: number; width: number; height: number };
  /** Lowest stair-front centre, measured in pixels relative to the atlas frame. */
  stair: { x: number; y: number };
  shadow: number;
  height: number;
  courtSlope: number;
};

type StructureEntrance = {
  x: number;
  y: number;
  courtSlope?: number;
  courtScale?: number;
  hasPrecinct?: boolean;
};
