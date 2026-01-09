import { nanoid } from "nanoid";
import {
  Vector3,
  LineBasicMaterial,
  LinearFilter,
  SpriteMaterial,
  Sprite,
  Group,
  Mesh,
  MeshBasicMaterial,
  Line,
  LineSegments,
  EdgesGeometry,
  type Raycaster,
  type BufferGeometry,
} from "three";
import { loadTexture, createTexture, profiler } from "@/libs/threejs/util";
import { applyBlurShader, applyWaveShader } from "@/libs/threejs/shaders";
import { createNoise2D } from "simplex-noise";
import { Grid, rectangle, Orientation } from "honeycomb-grid";
import { SECTOR_HEIGHT, SECTOR_WIDTH } from "@/drizzle/constants";
import { getTileInfo, generateWallPlacements } from "@/libs/threejs/biome";
import { groupBy } from "@/utils/grouping";
import { defineHex, findHex } from "../hexgrid";
import { getActiveObjectives } from "@/libs/quest";
import { findVillageUserRelationship } from "@/utils/alliance";
import {
  getHexPoints,
  calculateHexUVCoordinates,
  calculateTileOffset,
  createGroundCorners,
  createTileGeometry,
  createGroundGeometry,
  createGroundEdges,
  mergeBufferGeometries,
} from "@/libs/threejs/hexgrid";
import {
  IMG_AVATAR_DEFAULT,
  MEDNIN_MIN_RANK,
  RANKS_RESTRICTED_FROM_PVP,
  HEX_STACKING_DISPLACEMENT,
  HEX_ASPECT_RATIO,
} from "@/drizzle/constants";
import {
  IMG_SECTOR_INFO,
  IMG_SECTOR_ATTACK,
  IMG_SECTOR_USER_MARKER,
  IMG_SECTOR_USER_SPRITE_MASK,
  IMG_SECTOR_USERSPRITE_LEFT,
  IMG_SECTOR_USERSPRITE_RIGHT,
  IMG_SECTOR_VS_ICON,
  IMG_SECTOR_WALL_STONE_TOWER,
  IMG_ICON_HEAL,
  STRUCTURE_ADJACENTS,
  TILES_LAYER,
  USER_LAYER,
  DIRT_LAYER,
  ASSETS_LAYER,
  STATUS_LAYER,
} from "@/drizzle/constants";
import { hasRequiredRank } from "@/libs/train";
import type { ComplexObjectiveFields } from "@/validators/objectives";
import type { UserWithRelations } from "@/routers/profile";
import type { TerrainHex, PathCalculator, HexagonalFaceMesh } from "../hexgrid";
import type { SectorUser, GlobalTile } from "@/libs/threejs/types";
import type { SectorVillage } from "@/routers/travel";
import type { VillageStructure } from "@/drizzle/schema";

// Cache for meshes to avoid getObjectByName every frame
const meshCache = new Map<string, Group>();

export const drawQuest = (info: {
  group_quest: Group;
  grid: Grid<TerrainHex>;
  user: NonNullable<UserWithRelations>;
}) => {
  const endMark = profiler.mark("drawQuest");
  const { user, grid, group_quest } = info;
  const activeObjectives = getActiveObjectives(user);
  const drawnIds = new Set<string>();

  activeObjectives
    .filter((o) => "sector" in o && Number(o.sector) === user.sector)
    .forEach((objective) => {
      let mesh = meshCache.get(objective.id);
      if (mesh && mesh.parent !== group_quest) {
        mesh = undefined; // Force recreate if parent changed
      }

      const { latitude: y, longitude: x } = objective as ComplexObjectiveFields;
      const hex = findHex(grid, { x, y });
      if (!hex) return;

      if (!mesh) {
        // Check if should be drawn
        if (!("image" in objective) || !objective.image) return;
        const { height: h, width: w } = hex;
        mesh = new Group();
        mesh.name = objective.id;
        // Marker
        const marker = loadTexture(IMG_SECTOR_USER_MARKER);
        const markerMat = new SpriteMaterial({ map: marker, alphaMap: marker });
        const markerSprite = new Sprite(markerMat);
        markerSprite.userData.type = "marker";
        if (objective.task === "move_to_location") {
          markerSprite.material.color.setHex(0xf4e365);
        } else if (
          objective.task === "collect_item" ||
          objective.task === "deliver_item"
        ) {
          markerSprite.material.color.setHex(0x6666a3);
        } else if (objective.task === "defeat_opponents") {
          markerSprite.material.color.setHex(0x9c273a);
        } else if (objective.task === "dialog") {
          markerSprite.material.color.setHex(0x6666a3);
        }
        Object.assign(markerSprite.scale, new Vector3(h, h * 1.2, 1));
        Object.assign(markerSprite.position, new Vector3(w / 2, h * 0.9, USER_LAYER));
        mesh.add(markerSprite);
        // White background for items
        const alphaMap = loadTexture(IMG_SECTOR_USER_SPRITE_MASK);
        const alphaMaterial = new SpriteMaterial({ map: alphaMap, alphaMap: alphaMap });
        const alphaSprite = new Sprite(alphaMaterial);
        alphaSprite.material.color.setHex(0xd3d9ea);
        Object.assign(alphaSprite.scale, new Vector3(h * 0.8, h * 0.8, 1));
        Object.assign(alphaSprite.position, new Vector3(w / 2, h * 1.0, USER_LAYER));
        mesh.add(alphaSprite);
        // Image Sprite
        const map = loadTexture(
          objective.image ? `${objective.image}?1=1` : IMG_AVATAR_DEFAULT,
        );
        map.generateMipmaps = false;
        map.minFilter = LinearFilter;
        const material = new SpriteMaterial({ map: map, alphaMap: alphaMap });
        const sprite = new Sprite(material);
        Object.assign(sprite.scale, new Vector3(h * 0.8, h * 0.8, 1));
        Object.assign(sprite.position, new Vector3(w / 2, h * 1.0, USER_LAYER));
        mesh.add(sprite);
        group_quest.add(mesh);
        meshCache.set(objective.id, mesh);
      }
      mesh.visible = true;
      mesh.position.set(-hex.center.x, -hex.center.y, 0);
      drawnIds.add(objective.id);
    });

  // Hide all user counters which are not used anymore
  group_quest.children.forEach((object) => {
    if (!drawnIds.has(object.name)) {
      object.visible = false;
    }
  });
  profiler.reportCount("sector_quests", drawnIds.size);
  endMark();
};

/**
 * Creates heaxognal grid & draw it using js. Return groups of objects drawn
 */
export const drawSector = (
  width: number,
  prng: () => number,
  villageData: SectorVillage | null,
  globalTile: GlobalTile,
  lightLayout = false,
) => {
  const endMark = profiler.mark("drawSector");
  // Calculate hex size
  const hexsize =
    width / (SECTOR_WIDTH - HEX_STACKING_DISPLACEMENT * (SECTOR_WIDTH - 1));

  // Used for procedural map generation
  const noiseGen = createNoise2D(prng);
  const assetsGen = createNoise2D(prng);

  // Generate wall placements dynamically based on sector dimensions (skip in light layout)
  const wallPlacements = lightLayout
    ? []
    : generateWallPlacements(SECTOR_WIDTH, SECTOR_HEIGHT);

  // Create the grid first
  const Tile = defineHex({
    dimensions: { width: hexsize, height: hexsize * HEX_ASPECT_RATIO },
    origin: { x: -hexsize * 0.5, y: -hexsize * 0.5 },
    orientation: Orientation.FLAT,
  });
  const grid = new Grid(Tile, rectangle({ width: SECTOR_WIDTH, height: SECTOR_HEIGHT }))
    .filter((tile) => {
      try {
        return tile.width !== 0;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (e) {
        return false;
      }
    })
    .map((tile) => {
      // Minimum level required if there is a structure on the tile
      const minStructureLevel = globalTile.t === 0 ? 0.9 : 0.5;
      // Set the default level to the noise
      const nx = tile.col / SECTOR_WIDTH - 0.5;
      const ny = tile.row / SECTOR_HEIGHT - 0.5;
      tile.level = noiseGen(nx, ny) / 2 + 0.5;
      tile.assetStrength = assetsGen(nx, ny) / 2 + 0.5;
      tile.cost = 1;

      // If level is below the minimum structure level, check for structures
      // Check village structures first
      const hasStructure = villageData?.structures?.some((s) => {
        if (s.longitude === tile.col && s.latitude === tile.row) return true;
        return STRUCTURE_ADJACENTS.some(
          ({ dCol, dRow }) =>
            s.longitude === tile.col + dCol && s.latitude === tile.row + dRow,
        );
      });
      if (hasStructure) {
        tile.level = minStructureLevel;
        tile.hasStructure = true;
        return tile;
      }
      // Check walls
      const hasWall = wallPlacements.find((w) => w.x === tile.col && w.y === tile.row);
      if (hasWall) {
        tile.level = minStructureLevel;
        tile.hasStructure = true;
        return tile;
      }
      return tile;
    });

  // Groups for organizing objects
  const group_dirt = new Group();
  const group_tiles = new Group();
  const group_edges = new Group();
  const group_assets = new Group();
  const group_interaction = new Group();

  // Get hex points for geometry construction
  const { points, groundPoints, groundEdges } = getHexPoints();

  // Calculate UV coordinates once for ground geometry using first tile's shape
  const firstTile = grid.toArray()[0];
  const { groundUVArray, tileUVArray } = calculateHexUVCoordinates(
    firstTile,
    points,
    groundPoints,
  );

  // Line material to use for edges
  const lineMaterial = new LineBasicMaterial({ color: 0x555555 });

  // Arrays to collect geometries for merging (major performance optimization)
  const groundGeometries: BufferGeometry[] = [];
  const groundEdgeGeometries: BufferGeometry[] = [];
  const tileEdgeGeometries: BufferGeometry[] = [];

  // Track shared materials to reduce draw calls
  const materialGroups = new Map<MeshBasicMaterial, BufferGeometry[]>();

  // Map for ocean materials with different wave offsets (to allow batching while maintaining variety)
  const oceanMaterialPool: MeshBasicMaterial[] = [];
  const numOceanVariants = 8;

  // Track animated materials for efficient uniform updates
  const animatedMaterials = new Set<MeshBasicMaterial>();

  // Draw the tiles
  grid.forEach((tile) => {
    if (tile) {
      const { material, sprites, asset } = getTileInfo(
        prng,
        tile,
        globalTile,
        lightLayout,
      );
      tile.asset = asset;

      if (sprites && sprites.length > 0 && !tile.hasStructure && !lightLayout) {
        sprites.forEach((sprite) => group_assets.add(sprite));
      }

      // Corners of the tile and the below ground
      const corners = tile.corners;

      // Calculate offset for ocean tiles (they are displaced down for depth effect)
      const { length, offsetLength, offsetLayer } = calculateTileOffset(
        corners,
        asset,
        lightLayout,
      );

      // Create the corners of the ground below
      const groundCorners = createGroundCorners(corners, offsetLength, length);

      // Top face of the tile
      const geometry = createTileGeometry({
        corners,
        points,
        tileUVArray,
        offsetLength,
        offsetLayer,
        layer: TILES_LAYER,
      });

      // Assign to material group for merging
      if (material) {
        let materialToUse = material;

        // Special handling for ocean tiles to desynchronize waves while still allowing batching
        if (asset === "ocean" && !lightLayout) {
          const variantIndex = Math.floor(prng() * numOceanVariants);
          if (!oceanMaterialPool[variantIndex]) {
            const variantMaterial = material.clone();
            const randomOffset = (variantIndex / numOceanVariants) * Math.PI * 2;
            applyWaveShader(variantMaterial, randomOffset);
            oceanMaterialPool[variantIndex] = variantMaterial;
            animatedMaterials.add(variantMaterial);
          }
          materialToUse = oceanMaterialPool[variantIndex]!;
        }

        const group = materialGroups.get(materialToUse) || [];
        group.push(geometry);
        materialGroups.set(materialToUse, group);
      }

      // Collect tile edge geometry for merging (performance optimization)
      const edgeGeometry = new EdgesGeometry(geometry);
      tileEdgeGeometries.push(edgeGeometry);

      // Interaction mesh (invisible, for raycasting)
      // PERFORMANCE: This mesh is never rendered, only used for mouse detection
      const interactionGeometry = createTileGeometry({
        corners,
        points,
        tileUVArray: null,
        offsetLength,
        offsetLayer,
        layer: TILES_LAYER,
      });
      const interactionMaterial = new MeshBasicMaterial({ visible: false });
      const interactionMesh = new Mesh(interactionGeometry, interactionMaterial);
      interactionMesh.name = `${tile.row},${tile.col}`;
      interactionMesh.userData.type = "tile";
      interactionMesh.userData.tile = tile;
      interactionMesh.userData.highlight = false;
      // Store original color for highlighting
      const { material: originalMaterial } = getTileInfo(
        prng,
        tile,
        globalTile,
        lightLayout,
      );
      interactionMesh.userData.hex = originalMaterial?.color.getHex() || 0x000000;
      interactionMesh.matrixAutoUpdate = false;
      group_interaction.add(interactionMesh);

      // Ground part of the tile
      if (!lightLayout) {
        const groundGeometry = createGroundGeometry({
          groundCorners,
          groundPoints,
          groundUVArray,
          layer: DIRT_LAYER,
        });

        // Instead of creating individual meshes, collect geometries for merging
        groundGeometries.push(groundGeometry);

        // Collect edge geometries
        const edgeMeshes = createGroundEdges({
          groundCorners,
          groundEdges,
          lineMaterial,
          layer: DIRT_LAYER,
        });
        edgeMeshes.forEach((edgeMesh) => {
          if (edgeMesh.geometry) {
            groundEdgeGeometries.push(edgeMesh.geometry);
          }
        });
      }
    }
  });

  // Create merged meshes for each material group (huge performance gain!)
  materialGroups.forEach((geometries, material) => {
    const mergedGeometry = mergeBufferGeometries(geometries);
    const mesh = new Mesh(mergedGeometry, material);
    mesh.userData.type = "tiles_merged";
    mesh.matrixAutoUpdate = false;
    group_tiles.add(mesh);
  });

  // Merge all ground geometries into a single mesh (huge performance gain)
  if (!lightLayout && groundGeometries.length > 0) {
    const mergedGroundGeometry = mergeBufferGeometries(groundGeometries);
    // Use the first tile's dirt material
    const firstTile = grid.toArray()[0];
    if (firstTile) {
      const { dirt } = getTileInfo(prng, firstTile, globalTile, lightLayout);
      const mergedGroundMesh = new Mesh(mergedGroundGeometry, dirt);
      mergedGroundMesh.userData.type = "ground_merged";
      mergedGroundMesh.matrixAutoUpdate = false;
      group_dirt.add(mergedGroundMesh);
    }

    // Merge all ground edge geometries into a single line mesh
    if (groundEdgeGeometries.length > 0) {
      const mergedEdgeGeometry = mergeBufferGeometries(groundEdgeGeometries);
      const mergedEdgeMesh = new Line(mergedEdgeGeometry, lineMaterial);
      mergedEdgeMesh.matrixAutoUpdate = false;
      group_dirt.add(mergedEdgeMesh);
    }
  }

  // Merge all tile edge geometries into a single mesh (performance optimization)
  if (tileEdgeGeometries.length > 0) {
    const mergedTileEdgeGeometry = mergeBufferGeometries(tileEdgeGeometries);
    const mergedTileEdgeMesh = new LineSegments(mergedTileEdgeGeometry, lineMaterial);
    mergedTileEdgeMesh.matrixAutoUpdate = false;
    group_edges.add(mergedTileEdgeMesh);
  }

  profiler.reportCount("sector_tiles", grid.size);
  profiler.reportCount("sector_draw_calls_tiles", materialGroups.size);
  endMark();
  return {
    group_dirt,
    group_tiles,
    group_edges,
    group_assets,
    group_interaction,
    animatedMaterials: Array.from(animatedMaterials),
    honeycombGrid: grid,
  };
};

/**
 * User sprite, which loads the avatar image and displays the health bar as a js sprite
 */
export const createUserSprite = (userData: SectorUser, hex: TerrainHex) => {
  // Group is used to group components of the user Marker
  const group = new Group();
  const { height: h, width: w } = hex;

  // Highlight sprite
  const highlightTexture = loadTexture(IMG_SECTOR_USER_MARKER);
  const highlightMaterial = new SpriteMaterial({
    map: highlightTexture,
    alphaMap: highlightTexture,
  });
  const highlightColor =
    userData.allianceStatus === "ALLY"
      ? parseInt("008000", 16)
      : userData.allianceStatus === "NEUTRAL"
        ? parseInt("2986CC", 16)
        : parseInt("FF0000", 16);
  const highlightSprite = new Sprite(highlightMaterial);
  highlightSprite.userData.type = "marker";
  highlightSprite.scale.set(h * 1.1, h * 1.3, 1);
  highlightSprite.position.set(w / 2, h * 0.9, USER_LAYER);
  highlightSprite.userData.type = "userMarker";
  highlightSprite.userData.userId = userData.userId;
  highlightSprite.material.color.setHex(highlightColor);
  group.add(highlightSprite);

  // Marker
  const marker = loadTexture(IMG_SECTOR_USER_MARKER);
  const markerMat = new SpriteMaterial({ map: marker, alphaMap: marker });
  const markerSprite = new Sprite(markerMat);
  markerSprite.userData.type = "marker";
  Object.assign(markerSprite.scale, new Vector3(h, h * 1.2, 1));
  Object.assign(markerSprite.position, new Vector3(w / 2, h * 0.9, USER_LAYER));
  group.add(markerSprite);

  // Avatar Sprite
  const alphaMap = loadTexture(IMG_SECTOR_USER_SPRITE_MASK);
  const avatar = userData?.avatarLight || userData?.avatar || IMG_AVATAR_DEFAULT;
  const map = loadTexture(avatar);
  map.generateMipmaps = false;
  map.minFilter = LinearFilter;
  const material = new SpriteMaterial({ map: map, alphaMap: alphaMap });
  const sprite = new Sprite(material);
  Object.assign(sprite.scale, new Vector3(h * 0.8, h * 0.8, 1));
  Object.assign(sprite.position, new Vector3(w / 2, h * 1.0, USER_LAYER));
  group.add(sprite);

  // Attack button
  if (!RANKS_RESTRICTED_FROM_PVP.includes(userData.rank)) {
    const attack = loadTexture(IMG_SECTOR_ATTACK);
    const attackMat = new SpriteMaterial({ map: attack, depthTest: false });
    const attackSprite = new Sprite(attackMat);
    attackSprite.visible = false;
    attackSprite.userData.userId = userData.userId;
    attackSprite.userData.type = "attack";
    Object.assign(attackSprite.scale, new Vector3(h * 0.8, h * 0.8, 1));
    Object.assign(attackSprite.position, new Vector3(w * 0.9, h * 1.4, STATUS_LAYER));
    attackSprite.name = `${userData.userId}-attack`;
    group.add(attackSprite);
  }

  // Heal button
  const heal = loadTexture(IMG_ICON_HEAL);
  const healMat = new SpriteMaterial({ map: heal, depthTest: false });
  const healSprite = new Sprite(healMat);
  healSprite.visible = false;
  healSprite.userData.userId = userData.userId;
  healSprite.userData.type = "heal";
  Object.assign(healSprite.scale, new Vector3(h * 0.7, h * 0.7, 1));
  Object.assign(healSprite.position, new Vector3(w, h * 0.5, STATUS_LAYER));
  healSprite.name = `${userData.userId}-heal`;
  group.add(healSprite);

  // Info button
  const info = loadTexture(IMG_SECTOR_INFO);
  const infoMat = new SpriteMaterial({ map: info, depthTest: false });
  const infoSprite = new Sprite(infoMat);
  infoSprite.visible = false;
  infoSprite.userData.userId = userData.userId;
  infoSprite.userData.type = "info";
  Object.assign(infoSprite.scale, new Vector3(h * 0.7, h * 0.7, 1));
  Object.assign(infoSprite.position, new Vector3(w * 0.1, h * 1.4, STATUS_LAYER));
  infoSprite.name = `${userData.userId}-info`;
  group.add(infoSprite);

  // Name
  group.name = userData.userId;
  group.userData.type = "user";
  group.userData.userId = userData.userId;
  group.userData.hex = hex;

  return group;
};

/**
 * User sprite, which loads the avatar image and displays the health bar as a js sprite
 */
export const createCombatSprite = (
  firstUser: SectorUser,
  secondUser: SectorUser,
  battleId: string,
  hex: TerrainHex,
) => {
  // Group is used to group components of the user Marker
  const group = new Group();
  const { height: h, width: w } = hex;

  // Highlight sprite
  const highlightTexture = loadTexture(IMG_SECTOR_USER_MARKER);
  const highlightMaterial = new SpriteMaterial({
    map: highlightTexture,
    alphaMap: highlightTexture,
  });
  const highlightColor = parseInt("FF0000", 16);
  const highlightSprite = new Sprite(highlightMaterial);
  highlightSprite.userData.type = "marker";
  highlightSprite.scale.set(h * 1.1, h * 1.3, 1);
  highlightSprite.position.set(w / 2, h * 0.9, USER_LAYER);
  highlightSprite.userData.type = "battleMarker";
  highlightSprite.userData.battleId = battleId;
  highlightSprite.material.color.setHex(highlightColor);
  group.add(highlightSprite);

  // Marker
  const marker = loadTexture(IMG_SECTOR_USER_MARKER);
  const markerMat = new SpriteMaterial({ map: marker, alphaMap: marker });
  const markerSprite = new Sprite(markerMat);
  markerSprite.userData.type = "marker";
  Object.assign(markerSprite.scale, new Vector3(h, h * 1.2, 1));
  Object.assign(markerSprite.position, new Vector3(w / 2, h * 0.9, USER_LAYER));
  group.add(markerSprite);

  // User 1: Avatar Sprite
  const alphaMap1 = loadTexture(IMG_SECTOR_USERSPRITE_LEFT);
  const map1 = loadTexture(
    firstUser.avatar ? `${firstUser.avatar}?1=1` : IMG_AVATAR_DEFAULT,
  );
  map1.generateMipmaps = false;
  map1.minFilter = LinearFilter;
  const material1 = new SpriteMaterial({ map: map1, alphaMap: alphaMap1 });
  const sprite1 = new Sprite(material1);
  Object.assign(sprite1.scale, new Vector3(h * 0.8, h * 0.8, 1));
  Object.assign(sprite1.position, new Vector3(w / 2, h * 1.0, USER_LAYER));
  group.add(sprite1);

  // User 2: Avatar Sprite
  const alphaMap2 = loadTexture(IMG_SECTOR_USERSPRITE_RIGHT);
  const map2 = loadTexture(
    secondUser.avatar ? `${secondUser.avatar}?1=1` : IMG_AVATAR_DEFAULT,
  );
  map2.generateMipmaps = false;
  map2.minFilter = LinearFilter;
  const material2 = new SpriteMaterial({ map: map2, alphaMap: alphaMap2 });
  const sprite2 = new Sprite(material2);
  Object.assign(sprite2.scale, new Vector3(h * 0.8, h * 0.8, 1));
  Object.assign(sprite2.position, new Vector3(w / 2, h * 1.0, USER_LAYER));
  group.add(sprite2);

  const map = loadTexture(IMG_SECTOR_VS_ICON);
  map.generateMipmaps = false;
  map.minFilter = LinearFilter;
  const material = new SpriteMaterial({ map: map });
  const sprite = new Sprite(material);
  Object.assign(sprite.scale, new Vector3(h * 0.6, h * 0.6, 1));
  Object.assign(sprite.position, new Vector3(w / 2, h * 0.5, USER_LAYER));
  group.add(sprite);

  // Name
  group.name = battleId;
  group.userData.type = "user";
  group.userData.battleId = battleId;
  group.userData.hex = hex;

  return group;
};

/**
 * User sprite, which loads the avatar image and displays the health bar as a js sprite
 */
export const createMultipleUserSprite = (
  nUsers: number,
  location: string,
  dimensions: { height: number; width: number },
) => {
  // Group is used to group components of the user Marker
  const group = new Group();
  const { height: h, width: w } = dimensions;

  // Avatar Sprite
  const canvas = document.createElement("canvas");
  const r = 3;
  canvas.width = r * h;
  canvas.height = r * h;
  const context = canvas.getContext("2d");
  if (context) {
    context.font = `bold ${(r * h) / 2}px Serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    // NOTE: drawing a circle here there is a bug with alphaMap and userSprite sorting
    //       Therefore doing a square for now
    // const centerX = canvas.width / 2;
    // const centerY = canvas.height / 2;
    // const radius = ((r - 0.1) * h) / 2;
    // context.beginPath();
    // context.arc(centerX, centerY, radius, 0, 2 * Math.PI, false);
    // context.fillStyle = "darkorange";
    // context.fill();
    // context.lineWidth = 1;
    // context.strokeStyle = "#003300";
    // context.stroke();
    context.fillStyle = "firebrick";
    context.fillRect(0, 0, r * h, r * h);
    context.lineWidth = h / 2;
    context.strokeStyle = "maroon";
    context.strokeRect(0, 0, r * h, r * h);
    context.fillStyle = "white";
    context.fillText(`${nUsers}`, (r * h) / 2, (r * h) / 2);
  }
  const texture = createTexture(canvas);
  texture.generateMipmaps = false;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  const material = new SpriteMaterial({ map: texture });
  const sprite = new Sprite(material);
  sprite.position.set(w * 0.8, h * 1.3, STATUS_LAYER);
  sprite.scale.set(h * 0.5, h * 0.5, 0.00000001);
  group.add(sprite);

  // Name
  group.name = location;
  group.userData.type = "users";

  return group;
};

/**
 * Draw village on map
 */
export const drawVillage = (
  group: Group,
  village: SectorVillage,
  structures: VillageStructure[],
  grid: Grid<TerrainHex>,
  lightLayout = false,
) => {
  // Village wall (skip in light layout)
  if (!lightLayout && (village?.type === "VILLAGE" || village?.type === "TOWN")) {
    // Generate wall placements dynamically based on sector dimensions
    const wallPlacements = generateWallPlacements(SECTOR_WIDTH, SECTOR_HEIGHT);
    const wall_tower_texture = loadTexture(IMG_SECTOR_WALL_STONE_TOWER);
    const wall_tower_material = new SpriteMaterial({ map: wall_tower_texture });
    let prevPos: TerrainHex | null = null;
    wallPlacements.map((wall) => {
      const pos = grid.getHex({ col: wall.x, row: wall.y });
      if (pos) {
        const { height: h, x, y } = pos;
        const sprite = new Sprite(wall_tower_material);
        sprite.scale.set(h * 0.9, h * 1.3, 1);
        sprite.position.set(x, y + h / 3, ASSETS_LAYER);
        group.add(sprite);
        if (prevPos) {
          const x2 = (prevPos.x * 3 + pos.x) / 4;
          const y2 = (prevPos.y * 3 + pos.y) / 4;
          const sprite2 = new Sprite(wall_tower_material);
          sprite2.scale.set(h * 0.5, h * 0.8, 1);
          sprite2.position.set(x2, y2 + h / 4, ASSETS_LAYER);
          group.add(sprite2);
          const x3 = (prevPos.x + pos.x * 3) / 4;
          const y3 = (prevPos.y + pos.y * 3) / 4;
          const sprite3 = new Sprite(wall_tower_material);
          sprite3.scale.set(h * 0.5, h * 0.8, 1);
          sprite3.position.set(x3, y3 + h / 4, ASSETS_LAYER);
          group.add(sprite3);
          const x4 = (prevPos.x * 2 + pos.x * 2) / 4;
          const y4 = (prevPos.y * 2 + pos.y * 2) / 4;
          const sprite4 = new Sprite(wall_tower_material);
          sprite4.scale.set(h * 1, h * 1.6, 1);
          sprite4.position.set(x4, y4 + h / 4, ASSETS_LAYER);
          group.add(sprite4);
        }
        prevPos = pos;
      }
    });
  }
  // Village structures
  structures
    .filter((s) => s.hasPage !== 0)
    .map((structure) => {
      const pos = grid.getHex({ col: structure.longitude, row: structure.latitude });
      if (pos) {
        // Add a structure group
        const { height: h, x, y } = pos;
        //  Structure shadow in the top of the structure, with edges from the original structure
        const shadow_texture2 = loadTexture(structure.image, 200);
        const shadow_material2 = new SpriteMaterial({
          map: shadow_texture2,
          color: 0x000000,
          opacity: 0.3,
          depthWrite: false,
          depthTest: false,
        });
        applyBlurShader(shadow_material2, 0.01);
        const shadow_sprite2 = new Sprite(shadow_material2);
        shadow_sprite2.scale.set(h * 3.3, h * 3.3, 1);
        shadow_sprite2.position.set(x - 0.2 * h, y + h / 10 + 0.2 * h, ASSETS_LAYER);
        group.add(shadow_sprite2);
        // Structure
        const texture = loadTexture(structure.image, 200);
        const material = new SpriteMaterial({
          map: texture,
          depthWrite: false,
          depthTest: false,
        });
        const sprite = new Sprite(material);
        sprite.scale.set(h * 3.0, h * 3.0, 1);
        sprite.position.set(x, y + h / 10, ASSETS_LAYER);
        group.add(sprite);
      }
    });
};

// Cache for user/battle meshes to avoid getObjectByName every frame
const userMeshCache = new Map<string, Group>();

/**
 * Draw/update the users on the map. Should be called on every render
 */
export const drawUsers = (info: {
  group_users: Group;
  users: SectorUser[];
  grid: Grid<TerrainHex>;
  lastTime: number;
  angle: number;
  minLevel: number;
}) => {
  const endMark = profiler.mark("drawUsers");
  // Group the users by their location
  const groups = groupBy(
    info.users
      .filter((user) => user.level >= info.minLevel)
      .map((user) => ({
        ...user,
        group: `${user.latitude},${user.longitude}`,
      })),
    "group",
  );

  // Calculate new angle, which is used for rotating users placed on same location
  const dt = Date.now() - info.lastTime;
  const phi = info.angle + (1 * Math.PI) / (5000 / dt);

  // Draw the users
  const drawnIds = new Set<string>();
  groups.forEach((tileUsers) => {
    if (tileUsers[0]) {
      // Determine the location
      const firstUser = tileUsers[0];
      const awakeUsers = tileUsers.filter((u) => u.status === "AWAKE");
      const combatUsers = tileUsers.filter((u) => u.status === "BATTLE");
      const nUsers = awakeUsers.length;
      const hex = findHex(info.grid, {
        x: firstUser.longitude,
        y: firstUser.latitude,
      });
      if (hex) {
        // Loop through the users in the group who are awake
        awakeUsers.forEach((user, i) => {
          let userMesh = userMeshCache.get(user.userId);
          if (userMesh && userMesh.parent !== info.group_users) {
            userMesh = undefined;
          }

          if (!userMesh) {
            userMesh = createUserSprite(user, hex);
            info.group_users.add(userMesh);
            userMeshCache.set(user.userId, userMesh);
          }
          // Get location
          if (userMesh) {
            userMesh.visible = true;
            userMesh.userData.tile = hex;
            let { x, y } = hex.center;
            const spread = 0.1;
            if (nUsers > 1) {
              const angleChange = (i / tileUsers.length) * 2 * Math.PI + phi;
              x += spread * hex.width * Math.sin(angleChange);
              y -= spread * hex.height * Math.cos(angleChange);
            }
            userMesh.position.set(-x, -y, 0);
            drawnIds.add(user.userId);
          }
        });
        // Loop through the users in the group who are awake
        const battleGroups = groupBy(combatUsers, "battleId");
        let i = 0;
        battleGroups.forEach((tileCombatUsers, battleId) => {
          i += 1;
          const firstUser = tileCombatUsers[0];
          const secondUser = tileCombatUsers[1];
          if (firstUser && secondUser && battleId) {
            let userMesh = userMeshCache.get(battleId);
            if (userMesh && userMesh.parent !== info.group_users) {
              userMesh = undefined;
            }

            if (!userMesh) {
              userMesh = createCombatSprite(firstUser, secondUser, battleId, hex);
              info.group_users.add(userMesh);
              userMeshCache.set(battleId, userMesh);
            }
            if (userMesh) {
              userMesh.visible = true;
              userMesh.userData.tile = hex;
              let { x, y } = hex.center;
              const spread = 0.1;
              if (battleGroups.size > 1) {
                const angleChange = (i / tileUsers.length) * 2 * Math.PI + phi;
                x += spread * hex.width * Math.sin(angleChange);
                y -= spread * hex.height * Math.cos(angleChange);
              }
              userMesh.position.set(-x, -y, 0);
              drawnIds.add(battleId);
            }
          }
        });
        // Add indicator of how many users are there if more than 1
        if (nUsers > 2 && awakeUsers) {
          const indicatorName = `${hex.col}-${hex.row}-${nUsers}`;
          let indicatorMesh = userMeshCache.get(indicatorName);
          if (indicatorMesh && indicatorMesh.parent !== info.group_users) {
            indicatorMesh = undefined;
          }

          if (!indicatorMesh) {
            indicatorMesh = createMultipleUserSprite(nUsers, "test", hex);
            indicatorMesh.name = indicatorName;
            indicatorMesh.position.set(-hex.center.x, -hex.center.y, 0);
            info.group_users.add(indicatorMesh);
            userMeshCache.set(indicatorName, indicatorMesh);
          }
          if (indicatorMesh) {
            indicatorMesh.visible = true;
          }
          drawnIds.add(indicatorName);
        }
      }
    }
  });
  info.group_users.children.sort((a, b) => b.position.y - a.position.y);
  // Hide all user counters which are not used anymore
  info.group_users.children.forEach((object) => {
    if (!drawnIds.has(object.name)) {
      object.visible = false;
    }
  });

  profiler.reportCount("sector_users", info.users.length);
  profiler.reportCount("sector_visible_users", drawnIds.size);
  endMark();
  // Return new counters + angle
  return phi;
};

/**
 * Get intersections with user sprites, and show info/attack buttons if needed.
   If more than one user intersected, do not show
 */
export const intersectUsers = (info: {
  group_users: Group;
  raycaster: Raycaster;
  allyAttack: boolean;
  users: SectorUser[];
  userData: NonNullable<UserWithRelations>;
  currentTooltips: Set<string>;
}) => {
  const endMark = profiler.mark("intersectUsers");
  const { group_users, allyAttack, raycaster, users, userData, currentTooltips } = info;
  const intersects = raycaster.intersectObjects(group_users.children);
  const newUserTooltips = new Set<string>();
  const userMesh = intersects.find(
    (i) =>
      i.object.parent?.userData.type === "user" &&
      i.object.parent?.userData.userId !== userData.userId,
  )?.object.parent;
  if (users && userMesh && intersects.length > 0) {
    const userHex = userMesh.userData.tile as TerrainHex;
    const locationUsers = users.filter(
      (g) =>
        g.latitude === userHex.row &&
        g.longitude === userHex.col &&
        g.userId !== userData.userId,
    );
    if (userMesh.userData.battleId) {
      if (document.body.style.cursor !== "wait") {
        document.body.style.cursor = "pointer";
        newUserTooltips.add(userMesh.name);
      }
    }
    if (locationUsers.length === 1 && userMesh) {
      const userId = userMesh.userData.userId as string | undefined;
      if (userId) {
        const user = users.filter(Boolean).find((u) => u.userId === userId);
        if (user) {
          const attack = userMesh?.children[3] as Sprite;
          const heal = userMesh?.children[4] as Sprite;
          const details = userMesh?.children[5] as Sprite;
          const relationship =
            userData.village &&
            findVillageUserRelationship(userData.village, user.villageId);
          const isAlly =
            user.villageId === userData.villageId || relationship?.status === "ALLY";
          const showAttack =
            !RANKS_RESTRICTED_FROM_PVP.includes(user.rank) && (allyAttack || !isAlly);
          const showHeal =
            user.curHealth < user.maxHealth &&
            hasRequiredRank(userData.rank, MEDNIN_MIN_RANK);

          if (attack && userData.userId !== userId && showAttack) {
            attack.visible = true;
          }
          if (heal && userData.userId !== userId && showHeal) {
            heal.visible = true;
          }
          if (details) details.visible = true;
          if (document.body.style.cursor !== "wait") {
            document.body.style.cursor = "pointer";
          }
          newUserTooltips.add(userMesh.name);
        }
      }
    }
  }

  currentTooltips.forEach((userId) => {
    if (!newUserTooltips.has(userId)) {
      const attackSprite = group_users.getObjectByName(`${userId}-attack`);
      if (attackSprite) attackSprite.visible = false;
      const healSprite = group_users.getObjectByName(`${userId}-heal`);
      if (healSprite) healSprite.visible = false;
      const infoSprite = group_users.getObjectByName(`${userId}-info`);
      if (infoSprite) infoSprite.visible = false;
    }
  });

  if (currentTooltips.size === 0 && document.body.style.cursor !== "wait") {
    document.body.style.cursor = "default";
  }

  endMark();
  return newUserTooltips;
};

// Track the last intersected tile to avoid redundant pathfinding
let lastIntersectedTileName: string | null = null;

export const intersectTiles = (info: {
  group_tiles: Group;
  raycaster: Raycaster;
  pathFinder: PathCalculator;
  origin: TerrainHex;
  currentHighlights: Set<string>;
}) => {
  const endMark = profiler.mark("intersectTiles");
  const { group_tiles, raycaster, origin, pathFinder, currentHighlights } = info;
  const intersects = raycaster.intersectObjects(group_tiles.children);
  const newHighlights = new Set<string>();

  if (intersects.length > 0 && intersects[0]) {
    const intersected = intersects[0].object as HexagonalFaceMesh;
    const target = intersected.userData.tile;

    // PERFORMANCE OPTIMIZATION: Only recalculate path if target changed
    if (intersected.name === lastIntersectedTileName) {
      endMark();
      return currentHighlights;
    }
    lastIntersectedTileName = intersected.name;

    // Fetch the shortest path on the map using A*
    const shortestPath = origin && pathFinder.getShortestPath(origin, target);
    // Highlight the path
    void shortestPath?.forEach((tile) => {
      const mesh = group_tiles.getObjectByName(
        `${tile.row},${tile.col}`,
      ) as HexagonalFaceMesh;
      if (mesh.userData.highlight === false) {
        mesh.userData.highlight = true;
        mesh.material.color.offsetHSL(0, 0, 0.1);
      }
      newHighlights.add(mesh.name);
    });
  } else {
    lastIntersectedTileName = null;
  }

  // Remove highlights from tiles that are no longer in the path
  currentHighlights.forEach((name) => {
    if (!newHighlights.has(name)) {
      const mesh = group_tiles.getObjectByName(name) as HexagonalFaceMesh;
      mesh.userData.highlight = false;
      mesh.material.color.setHex(mesh.userData.hex);
    }
  });
  endMark();
  return newHighlights;
};

/**
 * Create a generic structure, useful for e.g. showing structure on the map
 * @param name - The name of the structure
 * @param route - The route of the structure
 * @param image - The image of the structure
 * @param latitude - The latitude of the structure
 * @param longitude - The longitude of the structure
 * @returns The structure
 */
export const createGenericStructure = (info: {
  name: string;
  route: string;
  image: string;
  latitude: number;
  longitude: number;
}): VillageStructure => {
  return {
    id: nanoid(),
    name: info.name,
    route: info.route,
    image: info.image,
    villageId: "unknown",
    longitude: info.longitude,
    latitude: info.latitude,
    hasPage: 1,
    showInVillagePage: false,
    curSp: 100,
    maxSp: 100,
    allyAccess: 1,
    baseCost: 0,
    level: 1,
    maxLevel: 1,
    lastUpgradedAt: new Date(),
    anbuSquadsPerLvl: 0,
    arenaRewardPerLvl: 0,
    bankInterestPerLvl: 0,
    blackDiscountPerLvl: 0,
    clansPerLvl: 0,
    hospitalSpeedupPerLvl: 0,
    itemDiscountPerLvl: 0,
    patrolsPerLvl: 0,
    ramenDiscountPerLvl: 0,
    regenIncreasePerLvl: 0,
    sleepRegenPerLvl: 0,
    structureDiscountPerLvl: 0,
    trainBoostPerLvl: 0,
    villageDefencePerLvl: 0,
    temporaryLevelBonus: 0,
    temporaryLevelBonusExpiresAt: null,
  };
};
