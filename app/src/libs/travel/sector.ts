import { nanoid } from "nanoid";
import {
  Vector3,
  LineBasicMaterial,
  EdgesGeometry,
  Line,
  LinearFilter,
  SpriteMaterial,
  Sprite,
  Group,
  BufferGeometry,
  BufferAttribute,
  Mesh,
  type Raycaster,
} from "three";
import { loadTexture, createTexture } from "@/libs/threejs/util";
import { createNoise2D } from "simplex-noise";
import { Grid, rectangle, Orientation } from "honeycomb-grid";
import { SECTOR_HEIGHT, SECTOR_WIDTH } from "./constants";
import { getTileInfo } from "./biome";
import { calcIsInVillage } from "./controls";
import { wallPlacements } from "./controls";
import { groupBy } from "@/utils/grouping";
import { defineHex, findHex } from "../hexgrid";
import { getActiveObjectives } from "@/libs/quest";
import { findVillageUserRelationship } from "@/utils/alliance";
import {
  IMG_AVATAR_DEFAULT,
  MEDNIN_MIN_RANK,
  RANKS_RESTRICTED_FROM_PVP,
} from "@/drizzle/constants";
import {
  IMG_SECTOR_INFO,
  IMG_SECTOR_ATTACK,
  IMG_SECTOR_USER_MARKER,
  IMG_SECTOR_USER_SPRITE_MASK,
  IMG_SECTOR_SHADOW,
  IMG_SECTOR_USERSPRITE_LEFT,
  IMG_SECTOR_USERSPRITE_RIGHT,
  IMG_SECTOR_VS_ICON,
  IMG_SECTOR_WALL_STONE_TOWER,
  IMG_ICON_HEAL,
} from "@/drizzle/constants";
import { hasRequiredRank } from "@/libs/train";
import type { ComplexObjectiveFields } from "@/validators/objectives";
import type { UserWithRelations } from "@/routers/profile";
import type { TerrainHex, PathCalculator, HexagonalFaceMesh } from "../hexgrid";
import type { SectorUser, GlobalTile } from "./types";
import type { SectorVillage } from "@/routers/travel";
import type { VillageStructure } from "@/drizzle/schema";

export const drawQuest = (info: {
  group_quest: Group;
  grid: Grid<TerrainHex>;
  user: NonNullable<UserWithRelations>;
}) => {
  const { user, grid, group_quest } = info;
  const activeObjectives = getActiveObjectives(user);
  const drawnIds = new Set<string>();
  activeObjectives
    .filter((o) => "sector" in o && Number(o.sector) === user.sector)
    .map((objective) => {
      let mesh = group_quest.getObjectByName(objective.id);
      const { latitude: y, longitude: x } = objective as ComplexObjectiveFields;
      const hex = findHex(grid, { x, y });
      if (!hex) return null;
      if (!mesh) {
        // Check if should be drawn
        if (!("image" in objective) || !objective.image) return null;
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
        Object.assign(markerSprite.position, new Vector3(w / 2, h * 0.9, -6));
        mesh.add(markerSprite);
        // White background for items
        const alphaMap = loadTexture(IMG_SECTOR_USER_SPRITE_MASK);
        const alphaMaterial = new SpriteMaterial({ map: alphaMap, alphaMap: alphaMap });
        const alphaSprite = new Sprite(alphaMaterial);
        alphaSprite.material.color.setHex(0xd3d9ea);
        Object.assign(alphaSprite.scale, new Vector3(h * 0.8, h * 0.8, 1));
        Object.assign(alphaSprite.position, new Vector3(w / 2, h * 1.0, -6));
        mesh.add(alphaSprite);
        // Image Sprite
        const map = loadTexture(objective.image ? `${objective.image}?1=1` : "");
        map.generateMipmaps = false;
        map.minFilter = LinearFilter;
        const material = new SpriteMaterial({ map: map, alphaMap: alphaMap });
        const sprite = new Sprite(material);
        Object.assign(sprite.scale, new Vector3(h * 0.8, h * 0.8, 1));
        Object.assign(sprite.position, new Vector3(w / 2, h * 1.0, -6));
        mesh.add(sprite);
        group_quest.add(mesh);
      }
      mesh.position.set(-hex.center.x, -hex.center.y, 0);
      drawnIds.add(mesh.name);
    });
  // Hide all user counters which are not used anymore
  group_quest.children.forEach((object) => {
    if (!drawnIds.has(object.name)) {
      object.visible = false;
    }
  });
};

/**
 * Creates heaxognal grid & draw it using js. Return groups of objects drawn
 */
export const drawSector = (
  width: number,
  prng: () => number,
  hasVillage: boolean,
  globalTile: GlobalTile,
) => {
  // Calculate hex size
  const stackingDisplacement = 1.31;
  const hexsize = (width / SECTOR_WIDTH / 2) * stackingDisplacement;

  // Used for procedural map generation
  const noiseGen = createNoise2D(prng);

  // Create the grid first
  const Tile = defineHex({
    dimensions: hexsize,
    origin: { x: -hexsize, y: -hexsize },
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
      const nx = tile.col / SECTOR_WIDTH - 0.5;
      const ny = tile.row / SECTOR_HEIGHT - 0.5;
      tile.level = noiseGen(nx, ny) / 2 + 0.5;
      tile.cost = 1;
      return tile;
    });

  // Groups for organizing objects
  const group_tiles = new Group();
  const group_edges = new Group();
  const group_assets = new Group();

  // Hex points
  const points = [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5];

  // Line material to use for edges
  const lineMaterial = new LineBasicMaterial({ color: 0x555555 });

  // Draw the tiles
  grid.forEach((tile) => {
    if (tile) {
      const { material, sprites, asset } = getTileInfo(prng, tile, globalTile);
      tile.asset = asset;
      if (
        prng() < 0.1 ||
        !hasVillage ||
        !calcIsInVillage({ x: tile.col, y: tile.row })
      ) {
        sprites.map((sprite) => group_assets.add(sprite));
      }

      const geometry = new BufferGeometry();
      const corners = tile.corners;
      const vertices = new Float32Array(
        points.map((p) => corners[p]).flatMap((p) => (p ? [p.x, p.y, -10] : [])),
      );
      geometry.setAttribute("position", new BufferAttribute(vertices, 3));
      const mesh = new Mesh(geometry, material?.clone());
      mesh.name = `${tile.row},${tile.col}`;
      mesh.userData.type = "tile";
      mesh.userData.tile = tile;
      mesh.userData.hex = material?.color.getHex();
      mesh.userData.highlight = false;
      mesh.userData.selected = false;
      mesh.userData.canClick = false;
      mesh.matrixAutoUpdate = false;
      group_tiles.add(mesh);

      const edges = new EdgesGeometry(geometry);
      edges.translate(0, 0, 1);
      const edgeMesh = new Line(edges, lineMaterial);
      edgeMesh.matrixAutoUpdate = false;
      group_edges.add(edgeMesh);
    }
  });

  // Reverse the order of objects in the group_assets
  group_assets.children.sort((a, b) => b.position.y - a.position.y);

  return { group_tiles, group_edges, group_assets, honeycombGrid: grid };
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
  highlightSprite.position.set(w / 2, h * 0.9, -6);
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
  Object.assign(markerSprite.position, new Vector3(w / 2, h * 0.9, -6));
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
  Object.assign(sprite.position, new Vector3(w / 2, h * 1.0, -6));
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
    Object.assign(attackSprite.position, new Vector3(w * 0.9, h * 1.4, -5));
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
  Object.assign(healSprite.position, new Vector3(w, h * 0.5, -5));
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
  Object.assign(infoSprite.position, new Vector3(w * 0.1, h * 1.4, -5));
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
  highlightSprite.position.set(w / 2, h * 0.9, -6);
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
  Object.assign(markerSprite.position, new Vector3(w / 2, h * 0.9, -6));
  group.add(markerSprite);

  // User 1: Avatar Sprite
  const alphaMap1 = loadTexture(IMG_SECTOR_USERSPRITE_LEFT);
  const map1 = loadTexture(firstUser.avatar ? `${firstUser.avatar}?1=1` : "");
  map1.generateMipmaps = false;
  map1.minFilter = LinearFilter;
  const material1 = new SpriteMaterial({ map: map1, alphaMap: alphaMap1 });
  const sprite1 = new Sprite(material1);
  Object.assign(sprite1.scale, new Vector3(h * 0.8, h * 0.8, 1));
  Object.assign(sprite1.position, new Vector3(w / 2, h * 1.0, -6));
  group.add(sprite1);

  // User 2: Avatar Sprite
  const alphaMap2 = loadTexture(IMG_SECTOR_USERSPRITE_RIGHT);
  const map2 = loadTexture(secondUser.avatar ? `${secondUser.avatar}?1=1` : "");
  map2.generateMipmaps = false;
  map2.minFilter = LinearFilter;
  const material2 = new SpriteMaterial({ map: map2, alphaMap: alphaMap2 });
  const sprite2 = new Sprite(material2);
  Object.assign(sprite2.scale, new Vector3(h * 0.8, h * 0.8, 1));
  Object.assign(sprite2.position, new Vector3(w / 2, h * 1.0, -6));
  group.add(sprite2);

  const map = loadTexture(IMG_SECTOR_VS_ICON);
  map.generateMipmaps = false;
  map.minFilter = LinearFilter;
  const material = new SpriteMaterial({ map: map });
  const sprite = new Sprite(material);
  Object.assign(sprite.scale, new Vector3(h * 0.6, h * 0.6, 1));
  Object.assign(sprite.position, new Vector3(w / 2, h * 0.5, -6));
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
  sprite.position.set(w * 0.8, h * 1.3, -4);
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
  village: SectorVillage,
  structures: VillageStructure[],
  grid: Grid<TerrainHex>,
) => {
  const group = new Group();
  // Village wall
  if (village?.type === "VILLAGE" || village?.type === "TOWN") {
    const wall_tower_texture = loadTexture(IMG_SECTOR_WALL_STONE_TOWER);
    const wall_tower_material = new SpriteMaterial({ map: wall_tower_texture });
    let prevPos: TerrainHex | null = null;
    wallPlacements.map((wall) => {
      const pos = grid.getHex({ col: wall.x, row: wall.y });
      if (pos) {
        const { height: h, x, y } = pos;
        const sprite = new Sprite(wall_tower_material);
        sprite.scale.set(h * 0.9, h * 1.3, 1);
        sprite.position.set(x, y + h / 3, -7);
        group.add(sprite);
        if (prevPos) {
          const x2 = (prevPos.x * 3 + pos.x) / 4;
          const y2 = (prevPos.y * 3 + pos.y) / 4;
          const sprite2 = new Sprite(wall_tower_material);
          sprite2.scale.set(h * 0.5, h * 0.8, 1);
          sprite2.position.set(x2, y2 + h / 4, -7);
          group.add(sprite2);
          const x3 = (prevPos.x + pos.x * 3) / 4;
          const y3 = (prevPos.y + pos.y * 3) / 4;
          const sprite3 = new Sprite(wall_tower_material);
          sprite3.scale.set(h * 0.5, h * 0.8, 1);
          sprite3.position.set(x3, y3 + h / 4, -7);
          group.add(sprite3);
          const x4 = (prevPos.x * 2 + pos.x * 2) / 4;
          const y4 = (prevPos.y * 2 + pos.y * 2) / 4;
          const sprite4 = new Sprite(wall_tower_material);
          sprite4.scale.set(h * 0.5, h * 0.8, 1);
          sprite4.position.set(x4, y4 + h / 4, -7);
          group.add(sprite4);
        }
        prevPos = pos;
      }
    });
  }
  group.children.sort((a, b) => b.position.y - a.position.y);
  // Village structures
  structures
    .filter((s) => s.hasPage !== 0)
    .map((structure) => {
      const pos = grid.getHex({ col: structure.longitude, row: structure.latitude });
      if (pos) {
        const { height: h, x, y } = pos;
        //  Structure shadow
        const shadow_texture = loadTexture(IMG_SECTOR_SHADOW);
        const shadow_material = new SpriteMaterial({ map: shadow_texture });
        const shadow_sprite = new Sprite(shadow_material);
        shadow_sprite.scale.set(h * 1.6, h * 0.9, 1);
        shadow_sprite.position.set(x, y - h / 5, -7);
        group.add(shadow_sprite);
        // Structure
        const texture = loadTexture(structure.image);
        const material = new SpriteMaterial({ map: texture });
        const sprite = new Sprite(material);
        sprite.scale.set(h * 1.4, h * 1.4, 1);
        sprite.position.set(x, y + h / 10, -7);
        group.add(sprite);
      }
    });
  return group;
};

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
          let userMesh = info.group_users.getObjectByName(user.userId);
          if (!userMesh && hex) {
            userMesh = createUserSprite(user, hex);
            info.group_users.add(userMesh);
          }
          // Get location
          if (userMesh && info.grid) {
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
            drawnIds.add(userMesh.name);
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
            let userMesh = info.group_users.getObjectByName(battleId);
            if (!userMesh && hex) {
              userMesh = createCombatSprite(firstUser, secondUser, battleId, hex);
              info.group_users.add(userMesh);
            }
            if (userMesh && info.grid) {
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
              drawnIds.add(userMesh.name);
            }
          }
        });
        // Add indicator of how many users are there if more than 1
        if (nUsers > 2 && awakeUsers) {
          const indicatorName = `${hex.col}-${hex.row}-${nUsers}`;
          let indicatorMesh = info.group_users.getObjectByName(indicatorName);
          if (!indicatorMesh) {
            indicatorMesh = createMultipleUserSprite(nUsers, "test", hex);
            indicatorMesh.name = indicatorName;
            indicatorMesh.position.set(-hex.center.x, -hex.center.y, 0);
            info.group_users.add(indicatorMesh);
          } else {
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

  return newUserTooltips;
};

export const intersectTiles = (info: {
  group_tiles: Group;
  raycaster: Raycaster;
  pathFinder: PathCalculator;
  origin: TerrainHex;
  currentHighlights: Set<string>;
}) => {
  const { group_tiles, raycaster, origin, pathFinder, currentHighlights } = info;
  const intersects = raycaster.intersectObjects(group_tiles.children);
  const newHighlights = new Set<string>();
  if (intersects.length > 0 && intersects[0]) {
    const intersected = intersects[0].object as HexagonalFaceMesh;
    // Fetch the shortest path on the map using A*
    const target = intersected.userData.tile;
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
  }
  // Remove highlights from tiles that are no longer in the path
  currentHighlights.forEach((name) => {
    if (!newHighlights.has(name)) {
      const mesh = group_tiles.getObjectByName(name) as HexagonalFaceMesh;
      mesh.userData.highlight = false;
      mesh.material.color.setHex(mesh.userData.hex);
    }
  });
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
  };
};
