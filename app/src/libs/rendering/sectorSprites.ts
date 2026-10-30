import alea from "alea";
import { type Grid, ring } from "honeycomb-grid";
import { IMG_SECTOR_USER_MARKER } from "@/drizzle/constants";
import type { MapAsset, VillageStructure } from "@/drizzle/schema";
import type { TerrainHex } from "@/libs/hexgrid";
import { groupMapLocations } from "@/libs/mapLocations";
import type { AnimationClip } from "@/libs/rendering/animation";
import {
  getVillageRoadLayout,
  isOnVillageRoad,
} from "@/libs/rendering/villageLandscape";
import { boundsOverlap, worldSpriteBounds } from "@/libs/rendering/visibility";
import {
  BIOME_DECORATIONS,
  hasWorldWaterDepth,
  resolveWorldDecoration,
  VILLAGE_ART,
  WOODLAND_DECORATIONS,
  WORLD_UNDERSTORY,
} from "@/libs/rendering/worldArt";
import type { WorldShadowShape } from "@/libs/rendering/worldShadows";
import {
  getWorldForecourtBounds,
  getWorldForecourtSize,
  getWorldStructureEntrance,
  resolveWorldStructure,
  WORLD_STRUCTURE_ANCHOR_Y,
} from "@/libs/rendering/worldStructures";
import {
  DECORATION_ASSETS_BY_KEY,
  type DecorationAsset,
  resolveDecorationAsset,
} from "@/libs/sector-map/decorations";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import {
  getVillageWallSpriteSpec,
  STONE_VILLAGE_WALL_KIT,
} from "@/libs/sector-map/village-wall-assets";
import {
  getVillageWallDecorationClearanceKeys,
  getVillageWallFoundationKeys,
  selectVillageWallTowerVertices,
  type VillageWallPlan,
} from "@/libs/sector-map/village-walls";
import type { MapLocation } from "@/validators/mapLocation";

/** Static scenery is described once, independently of its renderer and texture loading. */
export const sectorSpriteDescriptions = (options: {
  map: NormalizedSectorMap;
  grid: Grid<TerrainHex>;
  decorations: Map<string, DecorationAsset>;
  structures: VillageStructure[];
  wall: VillageWallPlan | null;
  lightLayout: boolean;
  roads?: ReadonlySet<string>;
  locations?: MapLocation[];
  mapAssets?: Pick<MapAsset, "id" | "imageUrl" | "renderScale">[];
}) => {
  const { grid, map, decorations, structures, wall, lightLayout } = options;
  const roadLayout = options.roads ? getVillageRoadLayout(grid, options.roads) : null;
  const sprites: WorldSpriteDescription[] = [];
  const groundDetails: WorldSpriteDescription[] = [];
  const theme = VILLAGE_ART[map.sector];
  const grove = WOODLAND_DECORATIONS.find((asset) => asset.key === theme?.grove);
  const interior = new Set(wall?.interior.map((point) => `${point.x},${point.y}`));
  const placed = (options.locations ?? []).filter(
    (location) =>
      Number.isFinite(location.longitude) && Number.isFinite(location.latitude),
  );
  const occupied = new Set(
    placed.map((location) => `${location.longitude},${location.latitude}`),
  );
  const clearance = wall
    ? getVillageWallDecorationClearanceKeys(wall)
    : new Set<string>();
  // Low cover may sit near masonry; the foundation and full gate approaches stay clear.
  const groundClearance = wall
    ? new Set([
        ...getVillageWallFoundationKeys(wall),
        ...getVillageWallDecorationClearanceKeys({
          edges: wall.edges.filter((edge) => edge.kind === "gate"),
        }),
      ])
    : new Set<string>();
  for (const object of map.objects) {
    if (!object.assetKey) continue;
    const tile = grid.getHex({ col: object.x, row: object.y });
    if (!tile) continue;
    const h = tile.height;
    if (object.type === "decoration") {
      if (
        lightLayout ||
        tile.hasStructure ||
        occupied.has(`${object.x},${object.y}`) ||
        clearance.has(`${object.x},${object.y}`)
      )
        continue;
      const registered = resolveDecorationAsset(object, decorations);
      if (!registered) continue;
      let asset = resolveWorldDecoration(registered, tile.spec?.battleBiome);
      // Grove variants stay inside the enclosure and only replace bundled tree art.
      if (
        grove &&
        asset !== registered &&
        asset.key.startsWith("tree.green.") &&
        interior.has(`${object.x},${object.y}`) &&
        (Math.floor(object.x / 3) * 17 + Math.floor(object.y / 3) * 11) % 3 === 0 &&
        (object.x + object.y) % 3 !== 0
      )
        asset = { ...asset, filepath: grove.filepath, frame: grove.frame };
      const scale = (object.scale ?? asset.renderScale ?? 1) * (asset.heightScale ?? 1);
      const seed = ((object.x * 31 + object.y * 17) % 100) / 100;
      let x = tile.x,
        y = tile.y;
      if (
        asset.frame &&
        tile.spec?.battleBiome === "dessert" &&
        (asset.key.startsWith("cactus.") || asset.key.startsWith("rock."))
      ) {
        // Pull dryland props into small patches, leaving broad gaps between natural clusters.
        const center = grid.getHex({
          col: Math.floor(object.x / 4) * 4 + 2,
          row: Math.floor(object.y / 4) * 4 + 2,
        });
        const target =
          center &&
          grid.pointToHex({
            x: tile.x + (center.x - tile.x) * 0.6,
            y: tile.y + (center.y - tile.y) * 0.6,
          });
        if (
          center &&
          target &&
          !target.spec?.isWater &&
          !target.hasStructure &&
          !options.roads?.has(`${target.col},${target.row}`) &&
          !clearance.has(`${target.col},${target.row}`)
        ) {
          x += (center.x - tile.x) * 0.6;
          y += (center.y - tile.y) * 0.6;
        }
      }
      if (
        roadLayout &&
        isOnVillageRoad(
          {
            x: x + tile.width * (object.offsetX ?? 0),
            y: y + h * (0.1 * scale - 0.5 + (object.offsetY ?? 0)),
          },
          roadLayout,
          scale > 1 ? h * 0.12 : 0,
        )
      )
        continue;
      sprites.push({
        id: object.id,
        kind: "decoration",
        image: asset.filepath,
        frame: asset.frame,
        shadow: asset.shadow,
        shadowCaster:
          asset.shadow || asset.windAffected
            ? decorationShadowShape(asset.key)
            : undefined,
        preserveAspect: !!asset.frame,
        size: h * scale,
        x: x + tile.width * (object.offsetX ?? 0),
        y: y + h * (scale / 2 - 0.5 + 0.1 * scale) + h * (object.offsetY ?? 0),
        groundY: y + h * (0.1 * scale - 0.5 + (object.offsetY ?? 0)),
        small: asset.small === true,
        rendition: asset.small ? 50 : 128,
        nearest: true,
        wind: asset.windAffected ? (Math.floor(seed * 4) * Math.PI) / 2 : null,
        rotation: asset.randomRotation ? seed * Math.PI * 2 : 0,
      });
      const cover = asset.key.startsWith("tree.snow.")
        ? WORLD_UNDERSTORY.snow
        : asset.key.startsWith("cactus.")
          ? WORLD_UNDERSTORY.dessert
          : asset.key.startsWith("tree.green.")
            ? WORLD_UNDERSTORY.ground
            : null;
      const detailSeed = alea(object.x, object.y, map.sector).uint32();
      if (
        asset !== registered &&
        asset.frame &&
        cover &&
        groundDetails.length < 96 &&
        detailSeed % 4 !== 0
      ) {
        groundDetails.push(
          ...groundDetailCluster({
            id: `understory:${object.id}`,
            tile,
            palette: cover,
            seed: detailSeed,
            x: x + tile.width * ((object.offsetX ?? 0) + (detailSeed % 2 ? -0.4 : 0.4)),
            y: y + h * (0.1 * scale - 0.7 + (object.offsetY ?? 0)),
            count: detailSeed % 3 ? 3 : 4,
          }),
        );
      }
    } else {
      const isBuilding = object.type === "structure" || object.type === "landmark";
      const size = h * (isBuilding ? 2.4 : 1.2);
      const y = tile.y + h / 8;
      sprites.push({
        id: object.id,
        kind: object.type,
        image: object.assetKey,
        size,
        x: tile.x,
        y,
        // Depth follows the building base while its image remains centered.
        groundY: y - (isBuilding ? size * (BUILDING_BASE_ANCHOR_Y - 0.5) : 0),
        rendition: 200,
      });
    }
  }
  if (!lightLayout && options.roads) {
    const lantern = WOODLAND_DECORATIONS.find(
      (asset) => asset.key === "woodland.lantern",
    );
    let lights = 0;
    for (const tile of grid) {
      if (
        !lantern ||
        lights >= 6 ||
        tile.spec?.battleBiome !== "ground" ||
        !options.roads.has(`${tile.col},${tile.row}`) ||
        (tile.col * 31 + tile.row * 17) % 3 !== 0
      )
        continue;
      const branches = grid
        .traverse(ring({ radius: 1, center: tile }))
        .toArray()
        .filter((neighbor) =>
          options.roads?.has(`${neighbor.col},${neighbor.row}`),
        ).length;
      if (branches < 3) continue;
      lights++;
      sprites.push({
        id: `lantern:${tile.col},${tile.row}`,
        kind: "street-light",
        image: lantern.filepath,
        frame: lantern.frame,
        size: tile.height * 0.8,
        preserveAspect: true,
        nearest: true,
        anchorY: 1,
        shadow: 0.1,
        shadowCaster: "column",
        light: 1.8,
        x: tile.x + tile.width * 0.35,
        y: tile.y,
        groundY: tile.y,
      });
    }
    groundDetails.push(
      ...groundMarginDescriptions(
        grid,
        groundClearance,
        wall ? getVillageWallFoundationKeys(wall) : new Set(),
        options.roads,
        map.sector,
      ),
    );
  }
  if (wall) sprites.push(...villageWallDescriptions(grid, wall));
  const shelf = theme?.submergedShelf
    ? grid.getHex({ col: theme.submergedShelf[0], row: theme.submergedShelf[1] })
    : undefined;
  if (!lightLayout && shelf && hasWorldWaterDepth(shelf.spec)) {
    // A single broad formation continues the bank beneath the water without changing movement.
    sprites.push({
      id: "submerged-shelf",
      kind: "decoration",
      image: "/world-art/submerged-rock-shelf.webp",
      size: shelf.height * 1.5,
      preserveAspect: true,
      nearest: true,
      opacity: 0.5,
      x: shelf.x,
      y: shelf.y - shelf.height * 0.2,
      groundY: shelf.y,
    });
  }
  const campuses = new Set<string>();
  for (const structure of structures) {
    if (structure.hasPage === 0) continue;
    const tile = grid.getHex({ col: structure.longitude, row: structure.latitude });
    if (!tile) continue;
    const art = resolveWorldStructure(
      structure.image,
      structure.route,
      structure.worldArt,
    );
    // Co-located stock services share one campus; their destination actions remain independent.
    const campus = `${structure.longitude},${structure.latitude}`;
    if (art && campuses.has(campus)) continue;
    if (art) campuses.add(campus);
    const height = tile.height * (art?.height ?? 3);
    sprites.push({
      id: structure.id,
      kind: "structure",
      image: art?.filepath ?? structure.image,
      frame: art?.frame,
      worldMaterial: art
        ? { material: art.material, surfaces: art.surfaces }
        : undefined,
      shadow: art?.shadow,
      shadowCaster: art ? "building" : undefined,
      light: art ? 0.6 : undefined,
      preserveAspect: true,
      nearest: true,
      anchorY: art ? WORLD_STRUCTURE_ANCHOR_Y : undefined,
      entrance: art
        ? {
            ...getWorldStructureEntrance(tile, height, art),
            hasCourt: true,
            hasPrecinct: !!theme?.shrinePrecinct && structure.route === "/shrine",
          }
        : undefined,
      size: height,
      x: tile.x,
      y: art ? tile.y : tile.y + tile.height / 10,
      groundY: art
        ? getWorldStructureEntrance(tile, height, art).y
        : tile.y + tile.height / 10 - height * (BUILDING_BASE_ANCHOR_Y - 0.5),
      rendition: 200,
      structureId: structure.id,
    });
  }
  for (const entries of groupMapLocations(placed)) {
    const location = entries[0];
    if (!location) continue;
    const tile = grid.getHex({ col: location.longitude, row: location.latitude });
    if (!tile) continue;
    const asset = options.mapAssets?.find(
      (candidate) => candidate.id === location.assetId,
    );
    if (asset)
      sprites.push({
        id: `location:${location.id}`,
        kind: "questStructure",
        image: asset.imageUrl,
        size: tile.height * asset.renderScale * location.scale,
        preserveAspect: true,
        x: tile.x,
        y: tile.y + tile.height / 10,
        groundY: tile.y,
        anchorY: BUILDING_BASE_ANCHOR_Y,
        rendition: 512,
        locationId: location.id,
      });
    sprites.push({
      id: `location-pin:${location.id}`,
      kind: "questStructure",
      image: IMG_SECTOR_USER_MARKER,
      mask: IMG_SECTOR_USER_MARKER,
      size: tile.height * 1.05,
      width: tile.height * 0.85,
      x: tile.x + tile.width * 0.45,
      y: tile.y,
      groundY: tile.y,
      locationId: location.id,
      tint: entries.some((entry) => entry.active) ? 0xffdf66 : 0x9acddd,
    });
  }
  if (!lightLayout && theme) {
    const gardens = villageGardenDescriptions(
      grid,
      map.sector,
      structures,
      clearance,
      options.roads ?? new Set(),
      occupied,
      sprites,
    );
    const h = grid.toArray()[0]?.height ?? 0;
    const courts = sprites.flatMap(({ entrance }) => {
      if (!entrance?.hasCourt) return [];
      return [getWorldForecourtBounds(h, entrance)];
    });
    // Clear full canopies from paved approaches; creator-supplied scenery stays authoritative.
    for (let index = sprites.length - 1; index >= 0; index--) {
      const sprite = sprites[index];
      if (
        sprite?.kind === "decoration" &&
        [WOODLAND_DECORATIONS[0]?.filepath, BIOME_DECORATIONS[0]?.filepath].includes(
          sprite.image,
        ) &&
        (gardens.some(
          (garden) =>
            Math.abs(sprite.x - garden.x) < h * 1.4 &&
            Math.abs(sprite.groundY - garden.groundY) < h,
        ) ||
          (sprite.size > h &&
            courts.some((court) =>
              boundsOverlap(
                court,
                worldSpriteBounds({
                  x: sprite.x,
                  y: sprite.y,
                  width: sprite.frame
                    ? (sprite.size * sprite.frame.width) / sprite.frame.height
                    : sprite.size,
                  height: sprite.size,
                  anchorX: sprite.anchorX ?? 0.5,
                  anchorY: sprite.anchorY ?? 0.5,
                  rotation: sprite.rotation ?? 0,
                }),
              ),
            )))
      )
        sprites.splice(index, 1);
    }
    sprites.push(...gardens);
  }
  if (groundDetails.length) {
    const h = grid.toArray()[0]?.height ?? 0;
    const approaches = sprites.flatMap(({ entrance }) => {
      if (!entrance) return [];
      const court = entrance.hasCourt
        ? getWorldForecourtSize(h, entrance.hasPrecinct, entrance.courtScale)
        : { width: entrance.width + h * 0.4, depth: h * 0.9, overlap: h * 0.2 };
      return [
        entrance.hasCourt
          ? getWorldForecourtBounds(h, entrance)
          : {
              minX: entrance.x - court.width / 2,
              maxX: entrance.x + court.width / 2,
              minY: entrance.y - court.depth,
              maxY: entrance.y + court.overlap,
            },
      ];
    });
    const accepted: WorldSpriteDescription[] = [];
    for (const detail of groundDetails) {
      if (accepted.length >= MAX_SECTOR_GROUND_DETAILS) break;
      const width = detail.frame
        ? (detail.size * detail.frame.width) / detail.frame.height
        : detail.size;
      const points = [
        { x: detail.x, y: detail.groundY },
        { x: detail.x - width / 2, y: detail.groundY + detail.size * 0.3 },
        { x: detail.x + width / 2, y: detail.groundY + detail.size * 0.3 },
        { x: detail.x, y: detail.groundY + detail.size * 0.6 },
      ];
      if (
        points.some((point) => {
          const tile = grid.pointToHex(point);
          const key = tile && `${tile.col},${tile.row}`;
          return (
            !tile ||
            !key ||
            !tile.spec ||
            tile.spec?.isWater ||
            tile.hasStructure ||
            tile.authored?.decoration === false ||
            groundClearance.has(key) ||
            options.roads?.has(key) ||
            occupied.has(key) ||
            (roadLayout && isOnVillageRoad(point, roadLayout, detail.size * 0.3)) ||
            approaches.some(
              (bounds) =>
                point.x >= bounds.minX &&
                point.x <= bounds.maxX &&
                point.y >= bounds.minY &&
                point.y <= bounds.maxY,
            )
          );
        }) ||
        accepted.some(
          (other) =>
            Math.abs(other.x - detail.x) < width * 0.65 &&
            Math.abs(other.groundY - detail.groundY) < detail.size * 0.5,
        )
      )
        continue;
      accepted.push(detail);
    }
    sprites.push(...accepted);
  }
  return sprites.sort((a, b) => b.groundY - a.groundY);
};

/** Static atlas sprites share culling/material batches; density stays bounded on large sectors. */
export const MAX_SECTOR_GROUND_DETAILS = 768;

/** Upright custom building artwork meets terrain below its image center. */
const BUILDING_BASE_ANCHOR_Y = 0.85;

/** Small landmark courts share real service approaches and keep routes and custom artwork clear. */
const villageGardenDescriptions = (
  grid: Grid<TerrainHex>,
  sector: number,
  structures: VillageStructure[],
  clearance: ReadonlySet<string>,
  roads: ReadonlySet<string>,
  occupied: ReadonlySet<string>,
  scenery: WorldSpriteDescription[],
) => {
  const theme = VILLAGE_ART[sector];
  if (!theme) return [];
  const sprites: WorldSpriteDescription[] = [];
  const centers = structures
    .filter(
      (structure) =>
        ["/townhall", "/shrine", "/globalanbuhq", "/adminbuilding"].includes(
          structure.route,
        ) &&
        resolveWorldStructure(structure.image, structure.route, structure.worldArt),
    )
    .slice(0, 2);
  for (const structure of centers) {
    const tile = grid.getHex({ col: structure.longitude, row: structure.latitude });
    if (!tile) continue;
    const isPrecinct = !!theme.shrinePrecinct && structure.route === "/shrine";
    const garden = isPrecinct
      ? ["woodland.rocks", "woodland.flower-bush", "woodland.stones"]
      : theme.garden;
    const offsets = isPrecinct
      ? [
          [-2.8, 1.6],
          [-3.2, 1.45],
          [-2.45, 1.8],
          [-3.05, 1.95],
        ]
      : [
          [theme.garden[0] === "woodland.torii" ? -0.2 : -1.15, -1.1],
          [0.9, -0.85],
          [-0.9, -0.8],
          [1.3, -0.35],
        ];
    for (const [index, offset] of offsets.entries()) {
      const key = garden[index ? 1 + ((index - 1) % 2) : 0];
      const candidate = [...WOODLAND_DECORATIONS, ...BIOME_DECORATIONS].find(
        (candidate) => candidate.key === key,
      );
      const asset =
        candidate &&
        resolveWorldDecoration(
          DECORATION_ASSETS_BY_KEY.get(candidate.key) ?? candidate,
          tile.spec?.battleBiome,
        );
      if (!asset || offset[0] === undefined || offset[1] === undefined) continue;
      let x = tile.x + tile.width * offset[0],
        y = tile.y + tile.height * offset[1];
      if (isPrecinct) {
        const art = resolveWorldStructure(
          structure.image,
          structure.route,
          structure.worldArt,
        );
        if (!art) continue;
        const entrance = getWorldStructureEntrance(tile, tile.height * art.height, art);
        x = entrance.x + tile.height * offset[0];
        y = entrance.y - tile.height * offset[1];
      }
      let ground = grid.pointToHex({ x, y });
      if (!ground) continue;
      if (
        !isPrecinct &&
        index === 0 &&
        asset.key !== "woodland.torii" &&
        roads.has(`${ground.col},${ground.row}`)
      ) {
        const alternative = grid
          .traverse(ring({ radius: 1, center: ground }))
          .toArray()
          .filter(
            (hex) =>
              !hex.spec?.isWater &&
              !roads.has(`${hex.col},${hex.row}`) &&
              !clearance.has(`${hex.col},${hex.row}`) &&
              !occupied.has(`${hex.col},${hex.row}`),
          )
          .sort(
            (a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y),
          )[0];
        if (alternative) {
          ground = alternative;
          x = alternative.x;
          y = alternative.y;
        }
      }
      const groundKey = `${ground.col},${ground.row}`;
      if (
        ground.spec?.isWater ||
        clearance.has(groundKey) ||
        occupied.has(groundKey) ||
        (roads.has(groundKey) && asset.key !== "woodland.torii") ||
        scenery.some(
          (prop) =>
            prop.kind === "decoration" &&
            ![
              WOODLAND_DECORATIONS[0]?.filepath,
              BIOME_DECORATIONS[0]?.filepath,
            ].includes(prop.image) &&
            prop.size > tile.height &&
            Math.abs(prop.x - x) < prop.size * 0.35 &&
            Math.abs(prop.groundY - y) < prop.size * 0.35,
        )
      )
        continue;
      sprites.push({
        id: `garden:${structure.id}:${index}`,
        kind: "garden",
        image: asset.filepath,
        frame: asset.frame,
        size:
          tile.height *
          (isPrecinct
            ? index === 0
              ? 0.5
              : 0.28
            : index === 0 && asset.key === "woodland.rocks"
              ? 1.2
              : (GARDEN_HEIGHTS[asset.key] ?? 0.4)),
        preserveAspect: true,
        nearest: true,
        anchorY: 1,
        shadow: (asset.shadow ?? 0) * 0.4,
        shadowCaster:
          asset.shadow || asset.windAffected
            ? decorationShadowShape(asset.key)
            : undefined,
        light: asset.key === "woodland.lantern" ? 1.8 : undefined,
        wind: asset.windAffected ? ((index % 4) * Math.PI) / 2 : null,
        x,
        y,
        groundY: y,
      });
    }
  }
  return sprites;
};

const GARDEN_HEIGHTS: Record<string, number> = {
  "woodland.tea-house": 2.8,
  "woodland.torii": 2.5,
  "woodland.bamboo": 2.3,
  "woodland.golden-tree": 2.4,
  "woodland.lantern": 0.85,
  "woodland.fence": 0.55,
  "woodland.flower-bush": 0.45,
  "woodland.rocks": 0.5,
  "tree.snow.pine": 1.6,
  "ice.floe": 0.25,
  "cactus.saguaro": 1.25,
  "cactus.cluster": 0.6,
  "cactus.barrel": 0.4,
  "world.reeds": 0.5,
  "rock.slate": 0.6,
};

/** Seeded low cover fills open ground; denser margin patches meet shores, walls and foundations. */
const groundMarginDescriptions = (
  grid: Grid<TerrainHex>,
  clearance: ReadonlySet<string>,
  foundations: ReadonlySet<string>,
  roads: ReadonlySet<string>,
  sector: number,
) => {
  const clusters: (Parameters<typeof groundDetailCluster>[0] & { rank: number })[] = [];
  for (const tile of grid) {
    const key = `${tile.col},${tile.row}`;
    if (
      tile.spec?.isWater ||
      tile.hasStructure ||
      tile.authored?.decoration === false ||
      roads.has(key) ||
      clearance.has(key)
    )
      continue;
    const palette =
      tile.spec?.battleBiome === "snow" || tile.spec?.battleBiome === "ice"
        ? WORLD_UNDERSTORY.snow
        : tile.spec?.battleBiome === "dessert"
          ? WORLD_UNDERSTORY.dessert
          : tile.spec?.battleBiome === "ground"
            ? WORLD_UNDERSTORY.ground
            : null;
    if (!palette) continue;
    const seed = alea(tile.col, tile.row, sector + 37).uint32();
    const neighbors = grid.traverse(ring({ radius: 1, center: tile })).toArray();
    const water = neighbors.find((neighbor) => neighbor.spec?.isWater);
    const wall = neighbors.find((neighbor) =>
      foundations.has(`${neighbor.col},${neighbor.row}`),
    );
    const building = neighbors.find((neighbor) => neighbor.hasStructure);
    const patch = alea(
      Math.floor(tile.col / 4),
      Math.floor(tile.row / 4),
      sector + 79,
    ).uint32();
    const contact = water ?? wall ?? building;
    if (seed % 5 === 0 || (!contact && patch % 5 === 0 && seed % 3 !== 0)) continue;
    const groundPalette =
      palette === WORLD_UNDERSTORY.ground
        ? (water
            ? [1, 2, 5, 0]
            : wall || building
              ? [0, 2, 4, 5]
              : [0, 0, 0, 1, 2, 3, 4, 5, 5, 6]
          ).flatMap((index) => {
            const asset = palette[index];
            return asset ? [asset] : [];
          })
        : palette;
    clusters.push({
      id: `${water ? "shore" : wall ? "wall-margin" : building ? "foundation-margin" : "patch"}:${key}`,
      tile,
      palette: groundPalette,
      seed,
      x: contact
        ? tile.x + (contact.x - tile.x) * 0.3
        : tile.x + tile.width * (((seed >>> 8) % 7) / 12 - 0.25),
      y: contact
        ? tile.y + (contact.y - tile.y) * 0.3 - tile.height * 0.1
        : tile.y + tile.height * (((seed >>> 16) % 9) / 16 - 0.25),
      count: contact ? 3 + (seed % 2) : 2 + (seed % 2),
      rank: seed / 0xffffffff - (contact ? 0.05 : 0),
    });
  }
  // Rank whole patches across the sector before the budget, so grid iteration cannot strip the far margin bare.
  clusters.sort((a, b) => a.rank - b.rank);
  const sprites: WorldSpriteDescription[] = [];
  for (const cluster of clusters) {
    sprites.push(...groundDetailCluster(cluster));
    if (sprites.length >= MAX_SECTOR_GROUND_DETAILS * 2) break;
  }
  return sprites;
};

/** Unequal low-cover sprites form small ground patches around a shared map-stable heading. */
const groundDetailCluster = (options: {
  id: string;
  tile: TerrainHex;
  palette: DecorationAsset[];
  seed: number;
  x: number;
  y: number;
  count: number;
}): WorldSpriteDescription[] => {
  const { id, tile, palette, seed, x, y, count } = options;
  const foliage = palette.filter((asset) =>
    ["grass", "fern", "flowers", "sprig", "juniper"].some((key) =>
      asset.key.endsWith(key),
    ),
  );
  const ground = palette.filter((asset) => !foliage.includes(asset));
  const heading = ((seed % 360) * Math.PI) / 180;
  return Array.from({ length: count }, (_, index) => {
    const value = alea(seed, index, 113).uint32();
    const choices =
      index % 3 < 2
        ? foliage.length
          ? foliage
          : palette
        : ground.length
          ? ground
          : palette;
    const asset = choices[value % choices.length];
    if (!asset) throw new Error("Ground detail clusters require an atlas palette");
    const along = index
      ? (index % 2 ? 1 : -1) * (0.12 + Math.floor(index / 2) * 0.12)
      : 0;
    const across = index ? (((value >>> 8) % 7) - 3) * 0.02 : 0;
    const dx = tile.width * (Math.cos(heading) * along - Math.sin(heading) * across);
    const dy =
      tile.width * (Math.sin(heading) * along + Math.cos(heading) * across) * 0.5;
    const groundY = y + dy;
    const scale = index ? Math.max(0.48, 0.92 - index * 0.1) : 1;
    return {
      id: `ground:${id}:${index}`,
      kind: "decoration",
      image: asset.filepath,
      frame: asset.frame,
      size:
        tile.height * (asset.renderScale ?? 0.28) * scale * (0.9 + (value % 5) * 0.05),
      preserveAspect: true,
      nearest: true,
      anchorY: 1,
      small: true,
      rendition: 50,
      shadowCaster: asset.windAffected ? "canopy" : undefined,
      wind: asset.windAffected ? ((value % 4) * Math.PI) / 2 : null,
      x: x + dx,
      y: groundY,
      groundY,
    };
  });
};

const villageWallDescriptions = (grid: Grid<TerrainHex>, plan: VillageWallPlan) => {
  const sprites: WorldSpriteDescription[] = [];
  const vertices = new Map<string, { x: number; y: number; height: number }>();
  const endOn = new Set(
    plan.vertices
      .filter((vertex) =>
        vertex.edges.every((index) => {
          const edge = plan.edges[index];
          return edge && edge.axis !== "horizontal";
        }),
      )
      .map((vertex) => vertex.id),
  );
  const steepEdges = new Set(
    plan.edges.flatMap((edge, index) =>
      edge.vertices.some((vertex) => endOn.has(vertex)) ? [index] : [],
    ),
  );
  const openEdges = new Set<number>();
  const gateSpans = new Map<number, readonly [string, string]>();
  const verticesById = new Map(plan.vertices.map((vertex) => [vertex.id, vertex]));
  for (const edge of plan.edges) {
    const tile = grid.getHex({ col: edge.tile.x, row: edge.tile.y });
    const corners = WALL_CORNERS[edge.direction];
    if (!tile || !corners) continue;
    for (const [index, corner] of corners.entries()) {
      const point = tile.corners[corner];
      const id = edge.vertices[index];
      if (point && id) vertices.set(id, { ...point, height: tile.height });
    }
  }
  for (const [index, edge] of plan.edges.entries()) {
    if (edge.kind !== "gate") continue;
    const steep = steepEdges.has(index);
    openEdges.add(index);
    // Roofed gates span adjacent panels; depth-facing openings leave room for upright posts and a walker.
    const extend = (endpoint: string) => {
      let previous = index,
        vertex = endpoint;
      for (let step = 0; step < (steep ? 2 : 1); step++) {
        const next = verticesById
          .get(vertex)
          ?.edges.find(
            (other) =>
              other !== previous &&
              !openEdges.has(other) &&
              plan.edges[other]?.kind === "wall" &&
              (!steep || steepEdges.has(other)),
          );
        const neighbor = next === undefined ? undefined : plan.edges[next];
        if (!neighbor || next === undefined) break;
        openEdges.add(next);
        vertex =
          neighbor.vertices[0] === vertex ? neighbor.vertices[1] : neighbor.vertices[0];
        previous = next;
      }
      return vertex;
    };
    gateSpans.set(index, [extend(edge.vertices[0]), extend(edge.vertices[1])]);
  }
  const gateVertices = new Set<string>();
  const jambs = new Map<string, { x: number; y: number }>();
  for (const [edgeIndex, edge] of plan.edges.entries()) {
    const tile = grid.getHex({ col: edge.tile.x, row: edge.tile.y });
    const corners = WALL_CORNERS[edge.direction];
    if (!tile || !corners) continue;
    const span = gateSpans.get(edgeIndex);
    const roofedGate = !!span && !steepEdges.has(edgeIndex);
    const first = span ? vertices.get(span[0]) : tile.corners[corners[0]],
      second = span ? vertices.get(span[1]) : tile.corners[corners[1]];
    if (!first || !second) continue;
    if (openEdges.has(edgeIndex)) {
      for (const vertex of edge.vertices) gateVertices.add(vertex);
      if (!roofedGate) {
        if (span)
          for (const id of span) {
            const point = vertices.get(id);
            if (point) jambs.set(id, point);
          }
        continue;
      }
    }
    const left = first.x < second.x ? first : second,
      right = first.x < second.x ? second : first;
    const spec = getVillageWallSpriteSpec(
      STONE_VILLAGE_WALL_KIT,
      edge.kind,
      edge.axis,
      roofedGate ? (right.y - left.y) / (right.x - left.x) : undefined,
    );
    const [a, b] = spec.connectors;
    const dx = b.x - a.x;
    const width = (right.x - left.x) / dx;
    const height =
      roofedGate && spec.frame
        ? (width * spec.frame.height) / spec.frame.width
        : tile.height * spec.height;
    sprites.push({
      id: `wall:${edge.vertices.join(":")}`,
      kind: "village_wall_panel",
      shadowCaster: "wall",
      image: spec.url,
      frame: spec.frame,
      size: height,
      width,
      shearY: (right.y - left.y + (b.y - a.y) * height) / (right.x - left.x),
      anchorX: (a.x + b.x) / 2,
      anchorY: (a.y + b.y) / 2,
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2,
      groundY: (first.y + second.y) / 2,
      nearest: true,
      rendition: 256,
    });
  }
  const towerVertices = new Set(
    plan.contours.flatMap((contour) =>
      selectVillageWallTowerVertices(
        contour,
        gateVertices,
        STONE_VILLAGE_WALL_KIT.maxTowers,
      ),
    ),
  );
  for (const vertex of plan.vertices) {
    const point = vertices.get(vertex.id);
    if (!point) continue;
    const tower = towerVertices.has(vertex.id) && !gateVertices.has(vertex.id);
    const jamb = jambs.get(vertex.id);
    const seam =
      vertex.edges.some((edge) => steepEdges.has(edge)) &&
      vertex.edges.some((edge) => !steepEdges.has(edge));
    if (!tower && !jamb && (!seam || gateVertices.has(vertex.id))) continue;
    const spec = tower ? STONE_VILLAGE_WALL_KIT.tower : STONE_VILLAGE_WALL_KIT.pier;
    sprites.push({
      id: `wall-vertex:${vertex.id}`,
      kind: tower ? "village_wall_tower" : "village_wall_pier",
      shadowCaster: "column",
      image: spec.url,
      frame: spec.frame,
      size: point.height * spec.scale,
      x: jamb?.x ?? point.x,
      y: jamb?.y ?? point.y,
      groundY: point.y,
      anchorY: spec.anchorY,
      nearest: true,
      preserveAspect: true,
      rendition: 256,
    });
  }
  return sprites;
};

/** Bundled scenery supplies a physical caster independently of its painted silhouette. */
export const decorationShadowShape = (key: string): WorldShadowShape =>
  /cedar|pine|\.tall$/.test(key)
    ? "conifer"
    : /tree|oak|bamboo|grass|fern|bush|reeds|juniper|sprig/.test(key)
      ? "canopy"
      : /dojo|house|shrine|market/.test(key)
        ? "building"
        : "column";

const WALL_CORNERS = [
  [2, 3],
  [5, 0],
  [3, 4],
  [1, 2],
  [4, 5],
  [0, 1],
] as const;

/**
 * Placement/dimensions use Y-up world units; size is height and groundY orders depth.
 * Anchors are image fractions; rotation/wind phase are radians. rendition is a CDN pixel width.
 */
export type WorldSpriteDescription = {
  /** Optional layered art; image remains the portrait fallback if its atlases fail to load. */
  character?: import("@/validators/lpc").SpriteAppearance;
  /** Sector actors use movement-only atlases; combat needs the full authored poses. */
  characterMode?: "all" | "travel";
  id: string;
  kind: string;
  image: string;
  /** Persisted numerical maps can accompany custom or catalogue structure artwork. */
  worldMaterial?: { material: string; surfaces: string };
  /** Pixel rectangle in a shared atlas; the scene owns only the texture view. */
  frame?: { x: number; y: number; width: number; height: number };
  /** Movement-only artwork shares the scene clock and returns to the original texture when stopped. */
  motion?: {
    clip: AnimationClip;
    frameOffsets: Record<WorldMotionDirection, number>;
    size: number;
  };
  /** Contact-shadow depth in sprite-height units; absent for artwork with baked grounding. */
  shadow?: number;
  /** Opt-in shadow casting/occlusion profile; unmasked artwork receives light independently. */
  shadowCaster?: WorldShadowShape;
  /** Ground light-pool diameter in sprite-height units; strength follows the world cycle. */
  light?: number;
  /** Known stair contact for a short decorative approach; never changes navigation. */
  entrance?: {
    x: number;
    y: number;
    width: number;
    hasCourt?: boolean;
    hasPrecinct?: boolean;
    courtSlope?: number;
    courtScale?: number;
  };
  x: number;
  y: number;
  size: number;
  groundY: number;
  width?: number;
  anchorX?: number;
  anchorY?: number;
  preserveAspect?: boolean;
  rendition?: number;
  nearest?: boolean;
  mask?: string;
  /** UI artwork bypasses physical lighting and material registration; masks always do so. */
  unlit?: boolean;
  tint?: number;
  /** Partial coverage lets the animated water remain visible over submerged scenery. */
  opacity?: number;
  small?: boolean;
  wind?: number | null;
  /** Camera-plane rotation is reserved for flat, non-casting decorations. */
  rotation?: number;
  /** Ground-plane Y shear aligns wall contacts while keeping vertical posts upright. */
  shearY?: number;
  structureId?: string;
  locationId?: string;
};

export type WorldMotionDirection = "horizontal" | "north" | "south";
