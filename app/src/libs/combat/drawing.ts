import {
  BufferGeometry,
  BufferAttribute,
  Color,
  DoubleSide,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LinearFilter,
  Line,
  MeshBasicMaterial,
  Mesh,
  SpriteMaterial,
  Sprite,
} from "three";
import { loadTexture, createTexture } from "@/libs/threejs/util";
import { playPreloadedAudio } from "@/utils/audio";
import { getPossibleActionTiles, findHex, PathCalculator } from "../hexgrid";
import { COMBAT_WIDTH } from "./constants";
import { getAffectedTiles } from "./movement";
import { actionPointsAfterAction } from "./actions";
import { calcActiveUser } from "./actions";
import { stillInBattle } from "./actions";
import { getBattleGrid } from "@/libs/combat/util";
import {
  IMG_SECTOR_USER_MARKER,
  IMG_SECTOR_USER_SPRITE_MASK,
  IMG_SECTOR_SHADOW,
  IMG_BATTLEFIELD_TOMBSTONE,
  IMG_BATTLEFIELD_STAR,
} from "@/drizzle/constants";
import { ID_SFX_MOVE } from "@/drizzle/constants";
import type { GameAsset, UserData } from "@/drizzle/schema";
import type { Grid } from "honeycomb-grid";
import type { Scene, Object3D, Raycaster } from "three";
import type { TerrainHex, HexagonalFaceMesh } from "../hexgrid";
import type { GroundEffect, UserEffect, BarrierTagType } from "./types";
import type { ReturnedUserState, CombatAction } from "./types";
import type { ReturnedBattle } from "./types";
import type { SpriteMixer } from "../threejs/SpriteMixer";

/**
 * Show animation on the hex
 */
export const showAnimation = (
  animation: GameAsset,
  hex: TerrainHex,
  spriteMixer: SpriteMixer,
  playInfinite = false,
) => {
  const { height: h, width: w } = hex;
  const texture = loadTexture(animation.image);
  const actionSprite = spriteMixer.createActionSprite(texture, 1, animation.frames);
  const action = spriteMixer.createAction(
    actionSprite,
    0,
    animation.frames - 1,
    animation.speed,
  );
  if (action) {
    action.hideWhenFinished = true;
    if (playInfinite) {
      action.playLoop();
    } else {
      action.playOnce();
    }
  }
  actionSprite.scale.set(50, 50, 1);
  actionSprite.position.set(w / 2, h / 2, 5);
  return actionSprite;
};

/**
 * Creates heaxognal grid & draw it using js. Return groups of objects drawn
 */
export const drawCombatBackground = (
  width: number,
  height: number,
  scene: Scene,
  background: string,
) => {
  // Set scene background
  const bg_texture = loadTexture(background);
  const bg_material = new SpriteMaterial({ map: bg_texture });
  const bg_sprite = new Sprite(bg_material);
  bg_sprite.scale.set(width, height, 1);
  bg_sprite.position.set(width / 2, height / 2, -10);
  scene.add(bg_sprite);

  // Padding for the tiles [in % of width/height]
  const leftPadding = 0.11 * width;
  const bottomPadding = 0.1 * height;

  // Calculate hex size
  const stackingDisplacement = 1.31;
  const hexsize = (width / COMBAT_WIDTH / 2.6) * stackingDisplacement;

  // Groups for organizing objects
  const group_tiles = new Group();
  const group_edges = new Group();
  const group_names = new Group();

  // Create the grid first
  const honeycombGrid = getBattleGrid(hexsize, {
    x: -hexsize - leftPadding,
    y: -hexsize - bottomPadding,
  });

  // Hex points
  const points = [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5];

  // Line material to use for edges
  const lineMaterial = new LineBasicMaterial({ color: 0x000000 });
  const material = new MeshBasicMaterial({
    color: 0x000000,
    opacity: 0.1,
    transparent: true,
  });
  // Draw the tiles
  honeycombGrid.forEach((tile) => {
    if (tile) {
      // Draw the tile
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

      // Draw the edges
      const edges = new EdgesGeometry(geometry);
      edges.translate(0, 0, 1);
      const edgeMesh = new Line(edges, lineMaterial);
      edgeMesh.matrixAutoUpdate = false;
      group_edges.add(edgeMesh);

      // Draw the name
      // Draw the tile name using a 2D canvas and render as a texture on a sprite
      // Draw the tile name using a 2D canvas and render as a texture on a sprite
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (ctx) {
        // Set font and measure text
        const fontSize = 18;
        const text = tile.name ?? "";
        ctx.font = `${fontSize}px Arial`;
        const textWidth = ctx.measureText(text).width;

        // Set canvas size based on text
        canvas.width = Math.ceil(textWidth + 12);
        canvas.height = Math.ceil(fontSize + 10);

        // Redraw font after resizing
        ctx.font = `${fontSize}px arial narrow`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.globalAlpha = 0.3; // Set alpha to 0.5 for all drawing
        ctx.fillStyle = "white";
        ctx.lineWidth = 4;

        // Draw text with stroke for contrast
        const cx = canvas.width / 2;
        const cy = canvas.height / 2;
        ctx.fillText(text, cx, cy);

        // Create texture and sprite
        const texture = createTexture(canvas);
        texture.needsUpdate = true;
        const spriteMaterial = new SpriteMaterial({ map: texture, transparent: true });
        const sprite = new Sprite(spriteMaterial);

        // Position the sprite at the tile center, slightly above the tile
        // The z-index is set to be above the tile and edge meshes
        sprite.position.set(tile.x, tile.y - (2 * cy) / 3, -8);

        // Scale the sprite to fit the tile size
        // Use hex size to determine a reasonable scale
        const scale = (Math.max(tile.height, tile.width) * 0.2) / fontSize;
        sprite.scale.set(canvas.width * scale, canvas.height * scale, 1);

        // Add to the tiles group
        group_names.add(sprite);
      }

      // Draw any objects on the tiles based on randomness
      // const sprites = getMapSprites(prng, 1, "combat", tile, 0);
      // sprites.map((sprite) => group_assets.add(sprite));
    }
  });

  // Reverse the order of objects in the group_assets
  // group_assets.children.sort((a, b) => b.position.y - a.position.y);

  return { group_tiles, group_edges, group_names, honeycombGrid };
};

/**
 * Draw/update the users on the map. Should be called on every render
 */
export const drawCombatEffects = (info: {
  groupEffects: Group;
  battle: ReturnedBattle;
  grid: Grid<TerrainHex>;
  animationId: number;
  spriteMixer: SpriteMixer;
  gameAssets: GameAsset[];
  sfxEnabled?: boolean;
  sfxVolume?: number;
}) => {
  // Destructure
  const { battle, groupEffects, spriteMixer, animationId, gameAssets } = info;
  const { groundEffects, usersEffects, usersState } = battle;

  // Record of drawn IDs
  const drawnIds = new Set<string>();

  // Draw the ground effects
  groundEffects.forEach((effect) => {
    const hex = findHex(info.grid, {
      x: effect.longitude,
      y: effect.latitude,
    });
    drawCombatEffect({
      groupEffects,
      effect,
      animationId,
      hex,
      spriteMixer,
      drawnIds,
      gameAssets,
      sfxEnabled: info.sfxEnabled,
      sfxVolume: info.sfxVolume,
    });
  });
  // Draw all user effects
  usersEffects.forEach((effect) => {
    const user = usersState.find((u) => u.userId === effect.targetId);
    if (user && stillInBattle(user)) {
      const hex = findHex(info.grid, {
        x: user.longitude,
        y: user.latitude,
      });
      drawCombatEffect({
        groupEffects,
        effect,
        animationId,
        hex,
        spriteMixer,
        drawnIds,
        gameAssets,
        sfxEnabled: info.sfxEnabled,
        sfxVolume: info.sfxVolume,
      });
    }
  });

  // Hide all which are not used anymore
  groupEffects.children.forEach((object) => {
    if (!drawnIds.has(object.name)) {
      object.visible = false;
    }
  });
};

export const drawCombatEffect = (info: {
  groupEffects: Group;
  effect: GroundEffect | UserEffect;
  animationId: number;
  hex?: TerrainHex;
  spriteMixer: SpriteMixer;
  drawnIds: Set<string>;
  gameAssets: GameAsset[];
  sfxEnabled?: boolean;
  sfxVolume?: number;
}) => {
  // Destructure
  const { effect, groupEffects, animationId, hex, drawnIds } = info;
  const { spriteMixer, gameAssets } = info;
  if (hex) {
    if (
      effect.staticAssetPath ||
      effect.staticAnimation ||
      effect.appearAnimation ||
      effect.disappearAnimation ||
      effect.appearSfx ||
      effect.disappearSfx
    ) {
      const { height: h, width: w } = hex;
      let asset = groupEffects.getObjectByName(effect.id) as Group;
      if (!asset) {
        // Group for the asset
        asset = new Group();
        asset.name = effect.id;
        asset.userData.type = effect.type; // e.g. "barrier"
        // Sprite to show
        if (effect.staticAssetPath) {
          const obj = gameAssets.find((a) => a.id === effect.staticAssetPath);
          if (obj) {
            const texture = loadTexture(obj.image);
            const material = new SpriteMaterial({ map: texture });
            const sprite = new Sprite(material);
            sprite.scale.set(w, h, 1);
            sprite.position.set(w / 2, h / 2, 0);
            asset.add(sprite);
          }
        }
        // If there is an appear animation, show it. Mark it for hiding,
        // which we catch and use to remove it
        if (effect.appearAnimation && animationId !== 0) {
          const obj = gameAssets.find((a) => a.id === effect.appearAnimation);
          if (obj) {
            const actionSprite = showAnimation(obj, hex, spriteMixer);
            if (actionSprite) asset.add(actionSprite);
          }
        }
        // If there is an appear SFX, play it once
        if (effect.appearSfx && animationId !== 0 && info.sfxEnabled) {
          try {
            const sfx = gameAssets.find((a) => a.id === effect.appearSfx);
            const url = sfx?.url;
            if (url) {
              void playPreloadedAudio(url, info.sfxVolume);
            }
          } catch {}
        }
        // If there is a static animation, show it.
        if (effect.staticAnimation) {
          const obj = gameAssets.find((a) => a.id === effect.staticAnimation);
          if (obj) {
            const actionSprite = showAnimation(obj, hex, spriteMixer, true);
            if (actionSprite) asset.add(actionSprite);
          }
        }
        // Status bar
        if (effect.type === "barrier") {
          const hp_background = drawStatusBar(w, h, "gray", true, "hp_background", 0);
          const hp_bar = drawStatusBar(w, h, "firebrick", true, "hp_current", 0);
          asset.add(hp_background);
          asset.add(hp_bar);
          hp_bar.position.set(w / 2, h, 0);
          hp_background.position.set(w / 2, h, 0);
          hp_bar.visible = false;
          hp_background.visible = false;
        }
        // Add to group
        groupEffects.add(asset);
      }

      // Set visibility
      if (asset) {
        if (effect.power !== undefined && effect.power <= 0) {
          asset.visible = false;
          // Play disappear SFX when hiding
          if (effect.disappearSfx && info.sfxEnabled && animationId !== 0) {
            try {
              console.log(effect);
              const sfx = gameAssets.find((a) => a.id === effect.disappearSfx);
              const url = sfx?.url;
              if (url) {
                void playPreloadedAudio(url, info.sfxVolume);
              }
            } catch {}
          }
        } else {
          asset.visible = true;
          asset.userData.tile = hex;
          const { x, y } = hex.center;
          asset.position.set(-x, -y, -8);
          drawnIds.add(asset.name);
        }
      }
    }
  }
};

/**
 * Draw a status bar on user
 */
export const drawStatusBar = (
  w: number,
  h: number,
  color: string,
  stroke: boolean,
  name: string,
  yOffset: number,
) => {
  const canvas = document.createElement("canvas");
  const r = 3;
  canvas.width = r * w;
  canvas.height = (r * h) / 10;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = color;
    context.lineWidth = 4;
    context.strokeStyle = "black";
    if (stroke) {
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.strokeRect(0, 0, canvas.width, canvas.height);
    } else {
      context.fillRect(2, 2, canvas.width - 4, canvas.height - 4);
    }
  }
  const texture = createTexture(canvas);
  texture.generateMipmaps = false;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  const bar_material = new SpriteMaterial({ map: texture });
  const bar_sprite = new Sprite(bar_material);
  bar_sprite.position.set(w / 2, h * 1.58 - (yOffset * (canvas.height - 2)) / r, -5);
  bar_sprite.scale.set(canvas.width / r, canvas.height / r, 1);
  bar_sprite.name = name;
  bar_sprite.userData.full_width = w;
  bar_sprite.visible = false;
  return bar_sprite;
};

/**
 * Update status bar of a user sprite
 */
export const updateStatusBar = (name: string, userSpriteGroup: Group, perc: number) => {
  const bar = userSpriteGroup.getObjectByName(name);
  if (bar) {
    const width = bar.userData.full_width as number;
    const newWidth = width * perc;
    const newPosition = width / 2 - (width * (1 - perc)) / 2;
    bar.scale.set(newWidth, bar.scale.y, 1);
    bar.position.set(newPosition, bar.position.y, bar.position.z);
    if (perc === 0) {
      bar.visible = false;
    }
  }
};

/**
 * User sprite, which loads the avatar image and displays the health bar as a js sprite
 */
export const createUserSprite = (
  userData: ReturnedUserState,
  hex: TerrainHex,
  playerId: string | undefined,
) => {
  // If not there, nope
  if (userData.curHealth <= 0 || userData.fledBattle) return undefined;

  // Group is used to group components of the user Marker
  const group = new Group();
  const { height: h, width: w } = hex;

  // Shadow
  const texture = loadTexture(IMG_SECTOR_SHADOW);
  texture.generateMipmaps = false;
  texture.minFilter = LinearFilter;
  const shadow_material = new SpriteMaterial({ map: texture });
  const shadow_sprite = new Sprite(shadow_material);
  shadow_sprite.scale.set(w * 0.7, h * 0.4, 1);
  shadow_sprite.position.set(w / 2, h * 0.3, -6);
  group.add(shadow_sprite);

  // User marker background or raw image
  const noMarker = userData.isAi && userData.isOriginal;
  if (noMarker) {
    const map = loadTexture(userData.avatar ? `${userData.avatar}?1=1` : "");
    map.generateMipmaps = false;
    map.minFilter = LinearFilter;
    if (userData.direction === "right") {
      map.repeat.set(-1, 1);
      map.offset.set(1, 0);
    }
    const material = new SpriteMaterial({ map: map });
    material.side = DoubleSide;
    const sprite = new Sprite(material);
    sprite.scale.set(-1 * h * 0.8, h * 0.8, 1);
    sprite.position.set(w / 2, h * 0.6, -6);
    group.add(sprite);
    // Star on summons
    if (userData.isSummon && userData.controllerId === playerId) {
      const marker = loadTexture(IMG_BATTLEFIELD_STAR);
      const markerMat = new SpriteMaterial({ map: marker });
      const markerSprite = new Sprite(markerMat);
      markerSprite.scale.set(h / 2.5, h / 2.5, 1);
      markerSprite.position.set(w / 2, h * 0.2, -6);
      group.add(markerSprite);
    }
  } else {
    // Highlight background in village color
    const highlightTexture = loadTexture(IMG_SECTOR_USER_MARKER);
    const highlightMaterial = new SpriteMaterial({
      map: highlightTexture,
      alphaMap: highlightTexture,
    });

    // Highlight sprite
    const highlightColor = userData.village
      ? parseInt(userData.village.hexColor.replace("#", ""), 16)
      : 0x000000;
    const highlightSprite = new Sprite(highlightMaterial);
    highlightSprite.userData.type = "marker";
    highlightSprite.scale.set(h, h * 1.2, 1);
    highlightSprite.position.set(w / 2, h * 0.9, -6);
    highlightSprite.userData.type = "userMarker";
    highlightSprite.userData.userId = userData.userId;
    highlightSprite.material.color.setHex(highlightColor);
    group.add(highlightSprite);

    // Marker background in white
    const marker = loadTexture(IMG_SECTOR_USER_MARKER);
    const markerMat = new SpriteMaterial({ map: marker, alphaMap: marker });
    const markerSprite = new Sprite(markerMat);
    markerSprite.userData.type = "marker";
    markerSprite.scale.set(0.9 * h, h * 1.1, 1);
    markerSprite.position.set(w / 2, h * 0.9, -6);
    group.add(markerSprite);

    // Avatar Sprite
    const alphaMap = loadTexture(IMG_SECTOR_USER_SPRITE_MASK);
    const map = loadTexture(userData.avatar ? `${userData.avatar}?1=1` : "");
    map.generateMipmaps = false;
    map.minFilter = LinearFilter;
    const material = new SpriteMaterial({ map: map, alphaMap: alphaMap });
    const sprite = new Sprite(material);
    sprite.scale.set(h * 0.8, h * 0.8, 1);
    sprite.position.set(w / 2, h * 1.0, -6);
    group.add(sprite);

    // Clan if it is there
    if (userData.clan?.image) {
      const clanTexture = loadTexture(userData.clan.image);
      const clanBorderMaterial = new SpriteMaterial({
        map: alphaMap,
        alphaMap: alphaMap,
      });
      const clanBorderSprite = new Sprite(clanBorderMaterial);
      clanBorderSprite.material.color.setHex(parseInt("FFD700", 16));
      clanBorderSprite.scale.set(-1 * h * 0.3 - 2, h * 0.3 + 2, 1);
      clanBorderSprite.position.set(0.9 * w, h * 1.4, -6);
      group.add(clanBorderSprite);
      const clanMaterial = new SpriteMaterial({ map: clanTexture, alphaMap: alphaMap });
      const clanSprite = new Sprite(clanMaterial);
      clanSprite.scale.set(-1 * h * 0.3, h * 0.3, 1);
      clanSprite.position.set(0.9 * w, h * 1.4, -6);
      group.add(clanSprite);
    }
  }

  // If this is the original and our user (we have SP/CP), then show a star
  if ("curStamina" in userData && userData.isOriginal && !userData.isAi) {
    const marker = loadTexture(IMG_BATTLEFIELD_STAR);
    const markerMat = new SpriteMaterial({ map: marker });
    const markerSprite = new Sprite(markerMat);
    markerSprite.scale.set(h / 2.5, h / 2.5, 1);
    markerSprite.position.set(w / 2, h * 0.4, -6);
    group.add(markerSprite);
  }

  // Health bar is shown on all
  const t = noMarker ? h / 8 : 0;
  const hp_background = drawStatusBar(w, h, "gray", true, "hp_background", t);
  const hp_bar = drawStatusBar(w, h, "firebrick", true, "hp_current", t);
  group.add(hp_background);
  group.add(hp_bar);

  // Stamina Bar if available
  if ("curStamina" in userData && "maxStamina" in userData) {
    const sp_background = drawStatusBar(w, h, "gray", true, "sp_background", t + 1);
    const sp_bar = drawStatusBar(w, h, "green", true, "sp_current", t + 1);
    group.add(sp_background);
    group.add(sp_bar);
  }

  // Chakra Bar if available
  if ("curChakra" in userData && "maxChakra" in userData) {
    const cp_background = drawStatusBar(w, h, "gray", true, "cp_background", t + 2);
    const cp_bar = drawStatusBar(w, h, "blue", true, "cp_current", t + 2);
    group.add(cp_background);
    group.add(cp_bar);
  }

  // Create tombstone but hide it for now
  const tomb_texture = loadTexture(IMG_BATTLEFIELD_TOMBSTONE);
  const tomb_material = new SpriteMaterial({ map: tomb_texture });
  const tomb_sprite = new Sprite(tomb_material);
  tomb_sprite.name = "tombstone";
  tomb_sprite.scale.set(h * 0.5, h * 0.5, 1);
  tomb_sprite.position.set(w / 2, h * 0.6, -7);
  tomb_sprite.visible = false;
  group.add(tomb_sprite);

  // Name
  group.name = userData.userId;
  group.userData.type = "user";
  group.userData.userId = userData.userId;
  group.userData.hex = hex;

  return group;
};

/**
 * Sets the opacity of all children of an object
 */
export const setOpacity = (obj: Object3D | Group | Sprite, opacity: number) => {
  obj?.children.forEach((child) => {
    setOpacity(child, opacity);
  });
  if (obj && "material" in obj && obj?.material) {
    obj.material.opacity = opacity;
  }
};

/**
 * Sets the opacity of all children of an object
 */
export const setVisible = (obj: Object3D | Group | Sprite, visible: boolean) => {
  obj?.children.forEach((child) => {
    setVisible(child, visible);
  });
  if ("visible" in obj) {
    obj.visible = visible;
  }
};

// Track current tile (visual) and target tile (logical)
type MovementState = { path?: TerrainHex[]; index: number };
type UserMeshData = {
  hex?: TerrainHex;
  targetHex?: TerrainHex;
  movement?: MovementState;
  initialized?: boolean;
};
type GroupUsersData = { pathFinder?: PathCalculator };

/** Returns a cached PathCalculator on the users group, creating it if missing */
const getOrCreatePathFinder = (
  group_users: Group,
  grid: Grid<TerrainHex>,
): PathCalculator => {
  const data = (group_users.userData as GroupUsersData) ?? {};
  let ensured = data.pathFinder;
  if (!ensured) {
    ensured = new PathCalculator(grid);
    data.pathFinder = ensured;
    (group_users as unknown as { userData: GroupUsersData }).userData = data;
  }
  return ensured;
};

/** Ensures meshData exists and initializes current visual tile/position when first seen */
const getOrInitUserMeshData = (
  userMesh: Group,
  targetTile: TerrainHex,
): UserMeshData => {
  const meshData = (userMesh.userData as UserMeshData) ?? ({} as UserMeshData);
  if (!meshData.initialized) {
    meshData.hex = meshData.hex ?? targetTile;
    const { x, y } = targetTile.center;
    userMesh.position.set(-x, -y, 0);
    meshData.initialized = true;
  }
  meshData.movement = meshData.movement || { path: undefined, index: 0 };
  return meshData;
};

/** Computes a new path if target changed or path exhausted; updates meshData.targetHex */
const computePathIfNeeded = (
  meshData: UserMeshData,
  pathFinder: PathCalculator,
  targetTile: TerrainHex,
) => {
  const prevTarget = meshData.targetHex;
  const targetChanged =
    !prevTarget ||
    prevTarget.col !== targetTile.col ||
    prevTarget.row !== targetTile.row;
  const needNewPath =
    targetChanged ||
    !meshData.movement?.path ||
    (meshData.movement?.index ?? 0) >= (meshData.movement?.path?.length ?? 0);
  if (needNewPath) {
    const start: TerrainHex = meshData.hex ?? targetTile;
    const path = pathFinder.getShortestPath(start, targetTile) || [];
    const trimmed =
      path.length > 0 &&
      path[0] &&
      path[0].col === start.col &&
      path[0].row === start.row
        ? path.slice(1)
        : path;
    meshData.movement = { path: trimmed, index: 0 };
  }
  meshData.targetHex = targetTile;
};

/** Returns the per-frame movement speed for a tile */
const getTileSpeed = (tile: TerrainHex): number => {
  return (tile.width / 50) * 5; // tripled speed
};

/** Steps the mesh along its path or directly to target with clamped constant speed */
const stepAlongPath = (
  userMesh: Group,
  meshData: UserMeshData,
  targetTile: TerrainHex,
  speed: number,
  onTileStep?: () => void,
) => {
  const { x: curX, y: curY } = userMesh.position;
  const moveTowards = (tx: number, ty: number, maxStep: number) => {
    const dx = tx - curX;
    const dy = ty - curY;
    const dist = Math.hypot(dx, dy);
    if (dist <= maxStep || dist === 0) {
      userMesh.position.set(tx, ty, 0);
      return true;
    } else {
      const nx = dx / dist;
      const ny = dy / dist;
      userMesh.position.set(curX + nx * maxStep, curY + ny * maxStep, 0);
      return false;
    }
  };

  // Easing function for speed multiplier: 0 at ends, 1 in middle. Clamp to a minimum to avoid stall
  const easedMultiplier = (progress: number, min = 0.35) => {
    const p = Math.max(0, Math.min(1, progress));
    const s = Math.sin(Math.PI * p);
    return Math.max(min, s);
  };

  const path = meshData.movement?.path;
  let index = meshData.movement?.index ?? 0;
  if (path && index < path.length) {
    const nextTile = path[index]!;
    const { x, y } = nextTile.center;
    // Compute progress along current segment for easing
    const startCenter = meshData.hex?.center ?? nextTile.center;
    const totalDist = Math.hypot((startCenter?.x ?? 0) - x, (startCenter?.y ?? 0) - y);
    const remaining = Math.hypot(-x - curX, -y - curY);
    const progress = totalDist > 0 ? 1 - remaining / totalDist : 1;
    const step = speed * easedMultiplier(progress);
    const reached = moveTowards(-x, -y, step);
    if (reached) {
      meshData.hex = nextTile;
      index += 1;
      meshData.movement = { path, index };
      if (onTileStep) onTileStep();
      if (!path || index >= path.length) {
        const { x: tx, y: ty } = targetTile.center;
        userMesh.position.set(-tx, -ty, 0);
        meshData.hex = targetTile;
        meshData.movement = { path: undefined, index: 0 };
      }
    }
  } else {
    const { x, y } = targetTile.center;
    const startCenter = meshData.hex?.center ?? targetTile.center;
    const totalDist = Math.hypot((startCenter?.x ?? 0) - x, (startCenter?.y ?? 0) - y);
    const remaining = Math.hypot(-x - curX, -y - curY);
    const progress = totalDist > 0 ? 1 - remaining / totalDist : 1;
    const step = speed * easedMultiplier(progress);
    const reached = moveTowards(-x, -y, step);
    if (reached) {
      meshData.hex = targetTile;
    }
  }
};

/**
 * Draw/update the users on the map. Should be called on every render
 */
export const drawCombatUsers = (info: {
  group_users: Group;
  users: ReturnedUserState[];
  grid: Grid<TerrainHex>;
  playerId: string | undefined;
  userData: UserData;
  sfxEnabled?: boolean;
  sfxVolume?: number;
  gameAssets?: GameAsset[];
}) => {
  // Destruct
  const { users, group_users, grid, playerId, userData } = info;
  // Cache or create a pathfinder for this group
  const pathFinder = getOrCreatePathFinder(group_users, grid);
  // Draw the users
  const drawnIds = new Set<string>();
  users.forEach((user) => {
    const hex = findHex(grid, {
      x: user.longitude,
      y: user.latitude,
    });
    if (hex) {
      // Fetch / create the user mesh
      let userMesh = group_users.getObjectByName(user.userId) as Group | undefined;
      if (!userMesh && hex) {
        // Always unhide current user
        if (user.userId === userData.userId) {
          user.avatar = userData.avatar;
          user.avatarLight = userData.avatarLight;
          user.username = userData.username;
        }
        userMesh = createUserSprite(user, hex, playerId);
        if (userMesh) group_users.add(userMesh);
      }
      // Get location
      if (userMesh && grid) {
        userMesh.visible = true;

        const targetTile: TerrainHex = hex;
        const meshData = getOrInitUserMeshData(userMesh, targetTile);
        computePathIfNeeded(meshData, pathFinder, targetTile);
        const speed = getTileSpeed(meshData.hex ?? targetTile);
        const onTileStep = () => {
          if (info.sfxEnabled) {
            try {
              const assets = info.gameAssets ?? [];
              const sfx = assets.find((a) => a.id === ID_SFX_MOVE);
              const url = sfx?.url;
              if (url) void playPreloadedAudio(url, (info.sfxVolume ?? 0.8) * 0.75);
            } catch {}
          }
        };
        stepAlongPath(userMesh, meshData, targetTile, speed, onTileStep);
        userMesh.userData = meshData;
        // Handle remove users from combat.
        if (!stillInBattle(user) && user.hidden === undefined) {
          setVisible(userMesh, false);
          if (user.isOriginal) {
            const tombstone = userMesh.getObjectByName("tombstone") as Sprite;
            tombstone.visible = true;
          }
          user.hidden = true;
        }
        // userMesh.material.color.offsetHSL(0, 0, 0.1);
        updateStatusBar("hp_current", userMesh, user.curHealth / user.maxHealth);
        if (user.curStamina && user.maxStamina) {
          updateStatusBar("sp_current", userMesh, user.curStamina / user.maxStamina);
        }
        if (user.curChakra && user.maxChakra) {
          updateStatusBar("cp_current", userMesh, user.curChakra / user.maxChakra);
        }

        drawnIds.add(userMesh.name);
      }
    }
  });
  group_users.children.sort((a, b) => b.position.y - a.position.y);

  // Hide all user counters which are not used anymore
  group_users.children.forEach((object) => {
    if (!drawnIds.has(object.name)) {
      object.visible = false;
    }
  });
};

/**
 * Highlight possible squares based on action
 */
export const highlightTiles = (info: {
  group_tiles: Group;
  raycaster: Raycaster;
  user: ReturnedUserState;
  timeDiff: number;
  action: CombatAction | undefined;
  battle: ReturnedBattle;
  grid: Grid<TerrainHex>;
  currentHighlights: Set<string>;
  precomputedActions?: CombatAction[];
}) => {
  // Definitions
  const { group_tiles, user, battle, currentHighlights, action, grid, timeDiff } = info;
  const intersects = info.raycaster.intersectObjects(group_tiles.children);
  const hit = intersects.length > 0 && intersects[0];
  const users = battle.usersState;
  const origin = user && grid.getHex({ col: user.longitude, row: user.latitude });

  // Make sure the proper round & activeUser is shown when we draw combat
  const { actor } = calcActiveUser(battle, user.userId, timeDiff, {
    precomputedUserId: user.userId,
    precomputedActions: info.precomputedActions,
  });

  // Check if we have enough action points to perform action
  const { canAct } = actionPointsAfterAction(user, battle, action);
  const canUseTile = actor.userId === user.userId && canAct;

  // Highlight fields on the map where action can be applied
  const newHighlights = new Set<string>();
  const highlights = getPossibleActionTiles(action, origin, grid);

  if (highlights && canUseTile) {
    highlights.forEach((tile) => {
      if (tile) {
        const mesh = group_tiles.getObjectByName(
          `${tile.row},${tile.col}`,
        ) as HexagonalFaceMesh;
        if (mesh.userData.highlight === false) {
          mesh.userData.highlight = true;
          mesh.material.opacity = 0.3;
        }
        newHighlights.add(mesh.name);
      }
    });
  }

  // Check if cooldown for action has expired
  const isAvailable =
    !action?.cooldown ||
    !action?.lastUsedRound ||
    battle.round - action.lastUsedRound >= action.cooldown;

  // Is this a move action (if so, we color the selected green tile blue instead)
  const hasMove = action?.effects?.find((e) => e.type === "move");

  // Highlight intersected tile
  /* ************************** */
  const newSelection = new Set<string>();
  if (action && origin && highlights && hit && canUseTile && isAvailable) {
    const intersected = hit.object as HexagonalFaceMesh;
    const targetTile = intersected.userData.tile;
    // Based on the intersected tile, highlight the tiles which are affected.
    const { green, red } = getAffectedTiles({
      a: origin,
      b: targetTile,
      action,
      grid: grid,
      restrictGrid: highlights,
      ground: battle.groundEffects,
      userId: user.userId,
      users,
    });
    // Is the target in the highlights?
    const isAvailable =
      highlights.filter((h) => h === targetTile).size > 0 && !red.has(targetTile);
    // Highlight the tiles in different colors
    green.forEach((tile) => {
      const name = `${tile.row},${tile.col}`;
      const mesh = group_tiles.getObjectByName(name) as HexagonalFaceMesh;
      mesh.userData.selected = true;
      mesh.userData.canClick = true;
      if (hasMove && tile === targetTile) {
        mesh.material.color = new Color("rgb(0, 0, 255)");
      } else {
        mesh.material.color = new Color("rgb(0, 255, 0)");
      }

      newSelection.add(name);
    });
    red.forEach((tile) => {
      const name = `${tile.row},${tile.col}`;
      const mesh = group_tiles.getObjectByName(name) as HexagonalFaceMesh;
      mesh.userData.selected = true;
      mesh.userData.canClick = false;
      mesh.material.color = new Color("rgb(255, 0, 0)");
      newSelection.add(name);
    });
    // Set cursor type on highlight
    if (
      (document.body.style.cursor === "default" || document.body.style.cursor === "") &&
      green.size > 0 &&
      isAvailable
    ) {
      document.body.style.cursor = "pointer";
    } else if (
      document.body.style.cursor === "pointer" &&
      (green.size === 0 || isAvailable === false)
    ) {
      document.body.style.cursor = "default";
    }
  }

  // Remove highlights from tiles that are no longer in the path
  currentHighlights.forEach((name) => {
    if (!newHighlights.has(name)) {
      const mesh = group_tiles.getObjectByName(name) as HexagonalFaceMesh;
      mesh.userData.highlight = false;
      mesh.material.opacity = 0.1;
    }
    if (!newSelection.has(name)) {
      const mesh = group_tiles.getObjectByName(name) as HexagonalFaceMesh;
      mesh.userData.selected = false;
      mesh.userData.canClick = false;
      mesh.material.color.setHex(mesh.userData.hex);
    }
  });
  return new Set([...newHighlights, ...newSelection]);
};

/**
 * Highlight possible squares based on action
 */
export const highlightUsers = (info: {
  group_tiles: Group;
  group_users: Group;
  raycaster: Raycaster;
  userId: string;
  users: ReturnedUserState[];
  currentHighlights: Set<string>;
}) => {
  // Definitions
  const { group_tiles, group_users, users, userId, currentHighlights } = info;
  const intersects = info.raycaster.intersectObjects(group_tiles.children);
  const hit = intersects.length > 0 && intersects[0];
  const newSelection = new Set<string>();
  if (hit) {
    const intersected = hit.object as HexagonalFaceMesh;
    const targetTile = intersected.userData.tile;
    const target = users.find(
      (u) =>
        u.longitude === targetTile.col &&
        u.latitude === targetTile.row &&
        u.curHealth > 0 &&
        u.fledBattle === false,
    );
    if (target) {
      const userMesh = group_users.getObjectByName(target.userId) as Group;
      if (userMesh) {
        setStatusBarVisibility(userMesh, true);
        newSelection.add(target.userId);
      }
    }
  }
  // The active userId we always show status bars
  const userMesh = group_users.getObjectByName(userId) as Group;
  if (userMesh) {
    setStatusBarVisibility(userMesh, true);
    newSelection.add(userId);
  }
  // Remove highlights from tiles that are no longer in the path
  currentHighlights.forEach((name) => {
    if (!newSelection.has(name)) {
      const userMesh = group_users.getObjectByName(name) as Group;
      if (userMesh) setStatusBarVisibility(userMesh, false);
    }
  });
  return newSelection;
};

export const setStatusBarVisibility = (userMesh: Group, visible: boolean) => {
  const hp_background = userMesh.getObjectByName("hp_background") as Sprite;
  if (hp_background) {
    hp_background.visible = visible;
  }
  const hp_current = userMesh.getObjectByName("hp_current") as Sprite;
  if (hp_current) {
    hp_current.visible = visible;
  }
  const sp_background = userMesh.getObjectByName("sp_background") as Sprite;
  if (sp_background) {
    sp_background.visible = visible;
  }
  const sp_current = userMesh.getObjectByName("sp_current") as Sprite;
  if (sp_current) {
    sp_current.visible = visible;
  }
  const cp_background = userMesh.getObjectByName("cp_background") as Sprite;
  if (cp_background) {
    cp_background.visible = visible;
  }
  const cp_current = userMesh.getObjectByName("cp_current") as Sprite;
  if (cp_current) {
    cp_current.visible = visible;
  }
};

/**
 * Highlight different things in the environment based on raycaster
 */
export const highlightTooltips = (info: {
  group_ground: Group;
  raycaster: Raycaster;
  battle: ReturnedBattle;
  currentTooltips: Set<string>;
}) => {
  // Definitions
  const { group_ground, battle, currentTooltips } = info;
  const intersects = info.raycaster.intersectObjects(group_ground.children);
  const newTooltips = new Set<string>();

  // Barriers
  const barrier = intersects.find((i) => i.object.parent?.userData.type === "barrier")
    ?.object.parent;
  if (barrier) {
    // Get the sprites
    const background = barrier.getObjectByName("hp_background") as Sprite;
    const bar = barrier.getObjectByName("hp_current") as Sprite;
    background.visible = true;
    bar.visible = true;
    // Update HP of barrier
    const effect = battle.groundEffects.find((e) => e.id === barrier.name);
    if (effect) {
      const typedEffect = effect as unknown as BarrierTagType;
      updateStatusBar(
        "hp_current",
        barrier as Group,
        typedEffect.curHealth / typedEffect.maxHealth,
      );
    }
    // Remember that we drew this
    newTooltips.add(barrier.name);
  }

  // Remove highlights from tiles that are no longer in the path
  currentTooltips.forEach((name) => {
    if (!newTooltips.has(name)) {
      const mesh = group_ground.getObjectByName(name) as Group;
      const background = mesh.getObjectByName("hp_background") as Sprite;
      const bar = mesh.getObjectByName("hp_current") as Sprite;
      background.visible = false;
      bar.visible = false;
    }
  });
  return newTooltips;
};
