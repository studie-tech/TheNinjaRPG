import type { CombatBiome } from "@/drizzle/constants";
import climateFrames from "@/libs/rendering/villageBuildingFrames.json";
import stockBuildingImages from "@/libs/rendering/villageBuildingImages.json";
import { isBunnyCdnUrl, transformImageUrl } from "@/utils/image";

export const WORLD_STRUCTURE_ANCHOR_Y = 0.88;

/** Stock village buildings share roof, stone and lighting treatments while keeping distinct silhouettes. */
export const WOODLAND_STRUCTURES = [
  ["/academy", 24, 69, 296, 273, 98, 263],
  ["/missionhall", 337, 86, 292, 258, 91, 248],
  ["/hospital", 644, 86, 281, 260, 71, 250],
  ["/ramenshop", 949, 86, 285, 262, 87, 253],
  ["/anbu", 17, 354, 279, 317, 90.14, 298.53],
  ["/battlearena", 318, 395, 310, 281, 95, 265],
  ["/itemshop", 643, 423, 297, 249, 88, 235],
  ["/blackmarket", 962, 433, 273, 241, 90, 223],
  ["/science", 19, 686, 290, 272, 70, 257],
  ["/townhall", 324, 690, 301, 269, 147, 265],
  ["/traininggrounds", 647, 732, 295, 240, 87, 230],
  ["/home", 963, 723, 273, 246, 68, 225],
  ["/clanhall", 21, 978, 301, 234, 112, 225],
  ["/bank", 345, 970, 283, 247, 90, 238],
  ["/auctionhouse", 643, 986, 298, 241, 99, 228],
  ["/shrine", 959, 993, 277, 234, 103, 225],
] as const;

/** Civic destinations keep recognizable service silhouettes within the same village material palette. */
export const CIVIC_STRUCTURES = [
  ["/souvenirs", 9, 185, 373, 336, 3.4, 125, 320],
  ["/minigames", 388, 144, 388, 387, 3.6, 120, 368],
  ["/historybuilding", 780, 113, 387, 411, 4, 126, 394],
  ["/globalanbuhq", 1168, 12, 358, 515, 5.7, 114, 501],
  ["/colosseum", 8, 586, 408, 382, 3.6, 125, 366],
  ["/pets", 421, 607, 355, 365, 3.5, 130, 342],
  ["/adminbuilding", 780, 568, 387, 404, 4.2, 106, 386],
] as const;

/** Storeys and door openings set each archetype’s scale relative to a walking character. */
const BUILDING_HEIGHTS: Record<string, number> = {
  "/academy": 4.3,
  "/missionhall": 3.6,
  "/hospital": 3.7,
  "/ramenshop": 3.3,
  "/anbu": 4.5,
  "/battlearena": 3.5,
  "/itemshop": 3.2,
  "/blackmarket": 2.8,
  "/science": 3.3,
  "/townhall": 4.4,
  "/traininggrounds": 3.3,
  "/home": 3.1,
  "/clanhall": 3.5,
  "/bank": 3.5,
  "/auctionhouse": 3.4,
  "/shrine": 3.3,
};

const structuresByImage = new Map<string, StructureArt>([
  ...WOODLAND_STRUCTURES.map(
    ([key, x, y, width, height, stairX, stairY], index) =>
      [
        key as string,
        {
          filepath: "/world-art/village-buildings.webp",
          frame: { x: x - 2, y: y - 2, width: width + 4, height: height + 4 },
          stair: { x: stairX, y: stairY },
          shadow: 0.2,
          height: BUILDING_HEIGHTS[key] ?? 3.5,
          index,
        },
      ] as const,
  ),
  ...CIVIC_STRUCTURES.map(
    ([key, x, y, width, height, scale, stairX, stairY]) =>
      [
        key as string,
        {
          filepath: "/world-art/civic-buildings.webp",
          frame: { x, y, width, height },
          stair: { x: stairX, y: stairY },
          shadow: 0.2,
          height: scale,
          index: -1,
        },
      ] as const,
  ),
]);

/** Recognize bundled images across the supported CDN hostnames; custom building art stays intact. */
export const resolveWorldStructure = (
  image: string,
  route: string,
  biome?: CombatBiome,
  sector?: number,
) => {
  const source = transformImageUrl(image);
  if (!isBunnyCdnUrl(source)) return undefined;
  const filename = new URL(source).pathname
    .split("/")
    .at(-1)
    ?.replace(/\.webp$/i, "");
  const sources = (stockBuildingImages as Record<string, string[]>)[route];
  const art =
    filename && sources?.includes(filename) ? structuresByImage.get(route) : undefined;
  if (!art) return undefined;
  // Horizon's cedar lookout keeps the civic hall's physical height and stair contact.
  if (sector === 301 && route === "/townhall")
    return {
      ...art,
      filepath: "/world-art/horizon-watch-hall.webp",
      frame: { x: 0, y: 0, width: 305, height: 273 },
      stair: { x: 150, y: 266 },
    };
  const climate =
    biome === "ice" || biome === "snow"
      ? "snow"
      : biome === "dessert"
        ? "desert"
        : null;
  const frame = climate ? climateFrames[climate][art.index] : undefined;
  if (!climate || !frame) return art;
  const [x, y, width, height, stairX, stairY] = frame;
  if (
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined ||
    stairX === undefined ||
    stairY === undefined
  )
    return art;
  return {
    ...art,
    filepath: `/world-art/village-buildings-${climate}.webp`,
    frame: { x, y, width, height },
    stair: { x: stairX, y: stairY },
  };
};

/** Frame-local stair contacts keep streets, courts and artwork on the same ground point. */
export const getWorldStructureEntrance = (
  position: { x: number; y: number },
  height: number,
  art?: Pick<StructureArt, "frame" | "stair">,
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
});

/** Court geometry and canopy clearance share the same ground-plane footprint. */
export const getWorldForecourtSize = (hexHeight: number, hasPrecinct = false) => ({
  width: hexHeight * (hasPrecinct ? 7 : 3.5),
  depth: hexHeight * (hasPrecinct ? 3 : 1.8),
  overlap: hexHeight * (hasPrecinct ? 0.6 : 0.45),
});

/** An atlas view with physical height and an optional climate-variant slot. */
type StructureArt = {
  filepath: string;
  frame: { x: number; y: number; width: number; height: number };
  /** Lowest visible stair-front center, in pixels relative to the resolved frame. */
  stair: { x: number; y: number };
  shadow: number;
  height: number;
  index: number;
};
