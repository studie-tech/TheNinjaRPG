import alea from "alea";
import type { Material, Mesh, Scene, Texture } from "three";
import { Box3, Clock, Group, OrthographicCamera } from "three";
import {
  type CombatBiome,
  HEX_STACKING_DISPLACEMENT,
  IMG_AVATAR_DEFAULT,
} from "@/drizzle/constants";
import type { GameAsset, UserData } from "@/drizzle/schema";
import type {
  CachedIntersections,
  GroundEffect,
  ReturnedBattle,
  ReturnedUserState,
  UserEffect,
} from "@/libs/combat/types";
import { getBattlefieldHeightRatio, getDefaultBattleSizes } from "@/libs/combat/util";
import {
  BATTLEFIELD_VIEWPORTS,
  type BattlefieldEffect,
  type BattlefieldPlacement,
  type BattlefieldScene,
  type BattlefieldViewport,
  battlefieldSceneOf,
  sceneAssetIds,
  sceneSoundIds,
} from "@/libs/contentReview/battlefield";
import { getBackgroundColor } from "@/libs/threejs/biome";
import {
  drawCombatBackground,
  drawCombatEffects,
  drawCombatUsers,
  highlightUsers,
} from "@/libs/threejs/combat";
import { ActionSprite, SpriteMixer } from "@/libs/threejs/SpriteMixer";
import { cleanUp, loadTexture, setupScene } from "@/libs/threejs/util";
import { preloadAudioBuffers, savedSfxVolume } from "@/utils/audio";
import { isBunnyCdnUrl, textureImageUrl, transformImageUrl } from "@/utils/image";
import { sleep } from "@/utils/time";
import { VisualTag } from "@/validators/combat";
import type { BattlefieldSheetsInput } from "@/validators/contentReview";

/**
 * A small battlefield drawn by the combat renderer itself, so content staff and the content
 * audit see an effect exactly as a battle shows it. Hexes keep the size a regular battle gives
 * them on the chosen viewport; only the field is cropped to a 3 by 3 patch inside combat's
 * decorated border, with a caster on the left, a target on the right and a tile between them.
 * Returns null when WebGL is unavailable; the caller mounts `canvas` and calls `dispose`.
 */
export const createBattlefieldPreview = (
  options: BattlefieldPreviewOptions,
): BattlefieldPreview | null => {
  const { scene: content, viewport, background } = options;
  const holdMs = options.holdMs ?? 1800;
  const assets = [
    ...options.assets.map((asset) => {
      const suggested = content.assets.find((entry) => entry.id === asset.id);
      const row = suggested ? { ...asset, ...suggested } : asset;
      return { ...row, image: textureSource(row.image) };
    }),
    // Combat looks a sound up by id and reads only its url.
    ...Object.entries(options.sounds ?? {}).map(
      ([id, url]) => ({ id, name: id, type: "SFX", image: "", url }) as GameAsset,
    ),
  ];
  const drawn = sceneAssetIds(content).flatMap((id) => {
    const asset = assets.find((entry) => entry.id === id);
    return asset ? [asset] : [];
  });
  const { width, height, ratio } = fieldSize(viewport);
  const { scene, renderer, handleResize } = setupScene({
    mountRef: { current: null },
    width,
    height,
    sortObjects: false,
    color: getBackgroundColor(background).color,
    colorAlpha: 0.5,
    width2height: ratio,
  });
  // The field keeps the game's hex size, so it never follows the window.
  window.removeEventListener("resize", handleResize);
  if (!renderer) return null;
  const magnify = options.magnify ?? 1;
  renderer.setSize(width * magnify, height * magnify);

  previewCount += 1;
  const id = `battlefield-preview-${previewCount}`;
  const casterId = `${id}-caster`;
  const targetId = `${id}-target`;
  const battle = previewBattle(id, background, [
    fighter(casterId, "Caster", TILES.caster, null),
    fighter(
      targetId,
      "Target",
      TILES.target,
      content.targetAvatar ? textureSource(content.targetAvatar) : null,
    ),
  ]);
  // One seed for every preview, so current and proposed versions share their scenery.
  const field = drawCombatBackground(width, battle, alea("battlefield-preview"), false);
  field.group_names.visible = false;
  const groupUsers = new Group();
  const groupEffects = new Group();
  scene.add(
    field.group_dirt,
    field.group_tiles,
    field.group_edges,
    field.group_highlight_edges,
    field.group_names,
    field.group_assets,
    groupUsers,
    groupEffects,
  );

  // The caster, the tile and the target, with room for a phone's animations, which spill
  // past their hex, and for the fighters' bars above them.
  scene.updateMatrixWorld();
  const tiles = new Box3();
  for (const { col, row } of Object.values(TILES)) {
    const tile = field.group_tiles.getObjectByName(`${row},${col}`);
    if (tile) tiles.expandByObject(tile);
  }
  const hex = previewHexWidth(viewport);
  const focus = {
    left: Math.max(0, tiles.min.x - hex * 0.6),
    right: Math.min(width, tiles.max.x + hex * 0.6),
    bottom: Math.max(0, tiles.min.y - hex * 0.5),
    top: Math.min(height, tiles.max.y + hex * 1.1),
  };
  const camera = new OrthographicCamera(0, width, height, 0, -10, 10);
  const zoom = options.zoom ?? 1;
  if (zoom !== 1) {
    // Zoom as combat's camera does, here around the focus.
    camera.position.x = (focus.left + focus.right - width) / 2;
    camera.position.y = (focus.bottom + focus.top - height) / 2;
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
  }
  const spriteMixer = new SpriteMixer();
  // drawCombatUsers restyles the viewer's own fighter; this viewer has none.
  const viewer = { userId: `${id}-viewer` } as UserData;

  // Sounds play only while the field animates live and the viewer asked for them, never in
  // captures.
  let isLive = false;
  let isSoundOn = false;
  const sfxVolume = savedSfxVolume();
  const soundUrls = sceneSoundIds(content).flatMap(
    (soundId) => assets.find((asset) => asset.id === soundId)?.url ?? [],
  );

  let frame = 0;
  const sync = () => {
    frame += 1;
    drawCombatUsers({
      group_users: groupUsers,
      users: battle.usersState,
      usersEffects: battle.usersEffects,
      grid: field.honeycombGrid,
      playerId: casterId,
      userData: viewer,
      battle,
      group_assets: field.group_assets,
      sfxEnabled: false,
      gameAssets: assets,
    });
    drawCombatEffects({
      groupEffects,
      battle,
      grid: field.honeycombGrid,
      animationId: frame,
      spriteMixer,
      gameAssets: assets,
      sfxEnabled: isLive && isSoundOn,
      sfxVolume,
      isAnyUserMoving: false,
    });
    // Like the player's own fighter in combat, the caster shows its bars; the target would
    // only on hover.
    highlightUsers({
      group_users: groupUsers,
      cachedIntersections: NO_HOVER,
      userId: casterId,
      users: battle.usersState,
      currentHighlights: new Set(),
    });
  };
  const render = () => {
    sync();
    renderer.render(scene, camera);
  };

  // One cycle: effects appear, stay for holdMs after their appear animation, then end and
  // play their disappear animation and sound where they stood, as combat does when an effect
  // expires.
  const durationOf = (ids: string[]) =>
    Math.max(
      0,
      ...ids.map((assetId) => {
        const asset = assets.find((entry) => entry.id === assetId);
        return asset ? asset.frames * asset.speed : 0;
      }),
    );
  const appearMs = durationOf(content.effects.map((effect) => effect.appearAnimation));
  const disappearMs = durationOf(
    content.effects.map((effect) => effect.disappearAnimation),
  );
  const endAt = appearMs + holdMs;
  const restartAt = endAt + disappearMs + REST_MS;
  let cycle = 0;
  let clockMs = 0;
  let hasEnded = false;

  const begin = () => {
    cycle += 1;
    clockMs = 0;
    hasEnded = false;
    const stamp = `${id}-${cycle}`;
    const placed = content.effects.map((effect, index) =>
      visualEffect(`${stamp}-${index}`, TILES[effect.placement], effect, casterId),
    );
    battle.groundEffects = placed.filter(
      (_, index) => content.effects[index]?.placement === "ground",
    );
    battle.usersEffects = placed.flatMap((effect, index): UserEffect[] => {
      const placement = content.effects[index]?.placement;
      if (!placement || placement === "ground") return [];
      return [{ ...effect, targetId: placement === "caster" ? casterId : targetId }];
    });
    sync();
    pruneHidden();
  };
  const end = () => {
    hasEnded = true;
    battle.usersEffects = [];
    battle.groundEffects = content.effects.flatMap((effect, index) =>
      effect.disappearAnimation || effect.disappearSfx
        ? [
            visualEffect(
              `${id}-${cycle}-end-${index}`,
              TILES[effect.placement],
              {
                appearAnimation: effect.disappearAnimation,
                appearSfx: effect.disappearSfx,
              },
              casterId,
            ),
          ]
        : [],
    );
    sync();
  };
  const advance = (ms: number, shouldLoop: boolean) => {
    let remaining = ms;
    while (remaining > 0) {
      const step = Math.min(FRAME_MS, remaining);
      remaining -= step;
      clockMs += step;
      spriteMixer.update(step / 1000);
      if (!hasEnded && clockMs >= endAt) end();
      else if (shouldLoop && hasEnded && clockMs >= restartAt) begin();
    }
  };
  // Effects of an earlier cycle are hidden by the draw after it; drop them for good.
  const pruneHidden = () => {
    for (const child of [...groupEffects.children]) {
      if (child.visible) continue;
      child.traverse((node) => {
        if (node instanceof ActionSprite) {
          spriteMixer.removeActionSprite(node);
          node.material.dispose();
        }
      });
      groupEffects.remove(child);
    }
  };

  let raf = 0;
  const clock = new Clock(false);
  const tick = () => {
    advance(Math.min(clock.getDelta() * 1000, 250), true);
    render();
    raf = requestAnimationFrame(tick);
  };
  begin();

  return {
    canvas: renderer.domElement,
    width,
    height,
    play: () => {
      if (raf) return;
      isLive = true;
      // With sound on, start over so the appear sounds play as the field comes into view.
      if (isSoundOn) begin();
      clock.start();
      tick();
    },
    pause: () => {
      isLive = false;
      cancelAnimationFrame(raf);
      raf = 0;
      clock.stop();
    },
    replay: begin,
    setSound: (isOn) => {
      isSoundOn = isOn;
      if (!isOn) return;
      void preloadAudioBuffers(soundUrls);
      // Start over, so the appear sounds play right away.
      begin();
    },
    whenLoaded: async (timeoutMs = 6000) => {
      const failed = await preloadImages(
        drawn.map((asset) => asset.image),
        timeoutMs,
      );
      const deadline = Date.now() + timeoutMs;
      // A texture whose image failed never loads; stop once only those are left.
      while (pendingTextures(scene) > failed.size && Date.now() < deadline) {
        await sleep(100);
      }
      return drawn
        .filter((asset) => failed.has(asset.image))
        .map((asset) => `${asset.name} (${asset.id})`);
    },
    captureFrames: () => {
      const points = [
        ...(appearMs > 0
          ? [
              { at: appearMs * 0.3, label: "appearing" },
              { at: appearMs * 0.7, label: "appearing" },
            ]
          : []),
        { at: Math.min(appearMs + 350, endAt - FRAME_MS), label: "active" },
        ...(disappearMs > 0
          ? [{ at: endAt + disappearMs * 0.5, label: "disappearing" }]
          : []),
      ];
      begin();
      const area = {
        left: focus.left / width,
        right: focus.right / width,
        top: 1 - focus.top / height,
        bottom: 1 - focus.bottom / height,
      };
      return points.map((point) => {
        advance(point.at - clockMs, false);
        render();
        return { label: point.label, canvas: cropCanvas(renderer.domElement, area) };
      });
    },
    dispose: () => {
      isLive = false;
      cancelAnimationFrame(raf);
      battle.usersState = [];
      battle.usersEffects = [];
      battle.groundEffects = [];
      // An empty draw hides everything, which also drops this field from combat's mesh caches.
      sync();
      cleanUp(scene, renderer);
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
};

/** Width of one hex on the viewport, as a regular battle lays them out. */
export const previewHexWidth = (viewport: BattlefieldViewport) =>
  BATTLEFIELD_VIEWPORTS[viewport] / stacked(GAME_COLUMNS);

/**
 * Draw every requested entity version on the battlefield for the content audit, on labelled
 * PNG sheets of `perSheet` blocks: one row per version with frames from its appear, active and
 * disappear phases on a desktop field, then its active phase on a phone field, all at twice
 * the size a player's screen shows them. Also names the assets whose image failed to load;
 * throws when WebGL is unavailable.
 */
export const captureBattlefieldSheets = async (
  input: BattlefieldSheetsInput,
  loadAssets: (ids: string[]) => Promise<GameAsset[]>,
) => {
  const scenes = input.requests.map((request) =>
    request.variants.map((variant) =>
      battlefieldSceneOf(request.entityType, request.entityId, variant.fields),
    ),
  );
  // Every version's assets in one request.
  const ids = [...new Set(scenes.flat().flatMap((scene) => sceneAssetIds(scene)))];
  const assets = ids.length > 0 ? await loadAssets(ids) : [];
  const missing = new Set<string>();
  const blocks: SheetBlock[] = [];
  for (const [requestIndex, request] of input.requests.entries()) {
    const rows: SheetRow[] = [];
    for (const [variantIndex, variant] of request.variants.entries()) {
      const scene = scenes[requestIndex]?.[variantIndex];
      if (!scene) {
        rows.push({ name: `${variant.name}: draws nothing in battle`, frames: [] });
        continue;
      }
      const frames: SheetFrame[] = [];
      for (const viewport of ["desktop", "phone"] as const) {
        const preview = createBattlefieldPreview({
          scene,
          assets,
          viewport,
          background: input.background,
          magnify: 2,
          holdMs: 700,
        });
        if (!preview) throw new Error("WebGL is not available in this browser");
        for (const name of await preview.whenLoaded()) missing.add(name);
        const captured = preview.captureFrames();
        preview.dispose();
        frames.push(
          ...(viewport === "desktop"
            ? captured
            : captured
                .filter((entry) => entry.label === "active")
                .map((entry) => ({ ...entry, label: "phone · active" }))),
        );
      }
      rows.push({ name: variant.name, frames });
    }
    blocks.push({ title: request.title, rows });
  }
  const sheets = [];
  for (let start = 0; start < blocks.length; start += input.perSheet) {
    const group = blocks.slice(start, start + input.perSheet);
    sheets.push({ png: drawSheet(group), titles: group.map((block) => block.title) });
  }
  return { sheets, missing: [...missing] };
};

/** Hex widths that `columns` columns span, since neighboring columns overlap. */
const stacked = (columns: number) =>
  columns - HEX_STACKING_DISPLACEMENT * (columns - 1);

/** Size of the field on the viewport in CSS pixels, and its height to width ratio. */
const fieldSize = (viewport: BattlefieldViewport) => {
  const width = previewHexWidth(viewport) * stacked(FIELD.width);
  const ratio = getBattlefieldHeightRatio(FIELD.width, FIELD.height);
  return { width, height: width * ratio, ratio };
};

/** A sparring battle on the preview field with the given fighters and no effects yet. */
const previewBattle = (
  id: string,
  background: CombatBiome,
  usersState: ReturnedUserState[],
): ReturnedBattle => {
  const now = new Date();
  return {
    id,
    usersState,
    usersEffects: [],
    groundEffects: [],
    activeUserId: null,
    createdAt: now,
    updatedAt: now,
    roundStartAt: now,
    background,
    width: FIELD.width,
    height: FIELD.height,
    battleType: "SPARRING",
    version: 0,
    round: 1,
    rewardScaling: 1,
    forceKeepPools: false,
    extraState: {
      jutsus: {},
      jutsuReskins: {},
      items: {},
      bloodlines: {},
      sageModes: {},
      villages: {},
      anbuSquads: {},
      keystoneItems: {},
      wars: {},
      aiProfiles: {},
      relations: {},
      clans: {},
      userQuests: {},
      completedQuests: {},
      questData: {},
      bounties: {},
      bountySignups: {},
    },
  };
};

/**
 * An artwork URL with a browser cache entry of its own. The review desk also shows artwork in
 * plain <img> tags, and S3 answers those without CORS headers or `Vary: Origin`, so a texture
 * request (made with `crossOrigin`) for the same URL would reuse that answer and fail. The
 * Bunny CDN always sends CORS headers, and relative paths are same-origin.
 */
const textureSource = (url: string) => {
  if (isBunnyCdnUrl(transformImageUrl(url))) return url;
  try {
    const source = new URL(url);
    source.searchParams.set("texture", "1");
    return source.toString();
  } catch {
    return url;
  }
};

/** A full-health fighter; the renderer reads only its tile, pools and artwork. */
const fighter = (
  userId: string,
  username: string,
  tile: { col: number; row: number },
  aiAvatar: string | null,
) =>
  ({
    userId,
    username,
    avatar: aiAvatar ?? IMG_AVATAR_DEFAULT,
    avatarFacing: "left",
    isAi: !!aiAvatar,
    isOriginal: true,
    isSummon: false,
    controllerId: userId,
    villageId: null,
    clanId: null,
    fledBattle: false,
    curHealth: 100,
    maxHealth: 100,
    curChakra: 100,
    maxChakra: 100,
    curStamina: 100,
    maxStamina: 100,
    longitude: tile.col,
    latitude: tile.row,
  }) as ReturnedUserState;

/** A visual-only effect, built the way combat builds the visuals it leaves behind. */
const visualEffect = (
  id: string,
  tile: { col: number; row: number },
  visuals: Partial<Omit<BattlefieldEffect, "placement">>,
  creatorId: string,
): GroundEffect => ({
  ...VisualTag.parse({
    type: "visual",
    description: "N/A",
    staticAssetPath: visuals.staticAssetPath ?? "",
    staticAnimation: visuals.staticAnimation ?? "",
    appearAnimation: visuals.appearAnimation ?? "",
    disappearAnimation: visuals.disappearAnimation ?? "",
    appearSfx: visuals.appearSfx ?? "",
  }),
  actionId: "battlefield-preview",
  id,
  createdRound: 0,
  creatorId,
  level: 0,
  barrierAbsorb: 0,
  isNew: true,
  castThisRound: true,
  longitude: tile.col,
  latitude: tile.row,
});

/**
 * Fetch images the way the renderer does, reporting the ones that fail to load. An image that
 * gives no answer within `timeoutMs` counts as failed, so a stalled request never holds up a
 * capture.
 */
const preloadImages = async (urls: string[], timeoutMs: number) => {
  const failed = new Set<string>();
  await Promise.all(
    [...new Set(urls)].map(
      (url) =>
        new Promise<void>((resolve) => {
          loadTexture(url);
          const image = new Image();
          const fail = () => {
            failed.add(url);
            resolve();
          };
          const timer = setTimeout(fail, timeoutMs);
          image.crossOrigin = "anonymous";
          image.onload = () => {
            clearTimeout(timer);
            resolve();
          };
          image.onerror = () => {
            clearTimeout(timer);
            fail();
          };
          image.src = textureImageUrl(url, 50);
        }),
    ),
  );
  return failed;
};

/** Number of material maps in the scene whose image has not loaded yet. */
const pendingTextures = (scene: Scene) => {
  let pending = 0;
  scene.traverse((node) => {
    const material = (node as Mesh).material as Material | Material[] | undefined;
    for (const entry of Array.isArray(material)
      ? material
      : material
        ? [material]
        : []) {
      for (const key of ["map", "alphaMap"] as const) {
        const texture = (entry as Material & Record<typeof key, Texture | null>)[key];
        if (texture && !isLoaded(texture)) pending += 1;
      }
    }
  });
  return pending;
};

/** Whether a texture's image has pixels: an <img> once decoded, any other once sized. */
const isLoaded = (texture: Texture) => {
  const image = texture.image as {
    complete?: boolean;
    naturalWidth?: number;
    width?: number;
  } | null;
  if (!image) return false;
  if (typeof image.complete === "boolean") {
    return image.complete && (image.naturalWidth ?? 0) > 0;
  }
  return (image.width ?? 0) > 0;
};

/** A copy of `area` of `source`, with its edges given as fractions of the source's size. */
const cropCanvas = (
  source: HTMLCanvasElement,
  area: { left: number; right: number; top: number; bottom: number },
) => {
  const x = area.left * source.width;
  const y = area.top * source.height;
  const copy = document.createElement("canvas");
  copy.width = Math.round((area.right - area.left) * source.width);
  copy.height = Math.round((area.bottom - area.top) * source.height);
  copy
    .getContext("2d")
    ?.drawImage(source, x, y, copy.width, copy.height, 0, 0, copy.width, copy.height);
  return copy;
};

/** One sheet as a PNG data URL: each block's title over its rows of captioned frames. */
const drawSheet = (blocks: SheetBlock[]) => {
  const tallest = (row: SheetRow) =>
    Math.max(0, ...row.frames.map((f) => f.canvas.height));
  const rowWidth = (row: SheetRow) =>
    row.frames.reduce((sum, entry) => sum + entry.canvas.width + SHEET.gap, SHEET.gap);
  const width = Math.max(640, ...blocks.flatMap((block) => block.rows.map(rowWidth)));
  const height = blocks.reduce(
    (sum, block) =>
      sum +
      SHEET.title +
      block.rows.reduce(
        (rows, row) => rows + SHEET.rowLabel + tallest(row) + SHEET.caption,
        0,
      ) +
      SHEET.gap,
    SHEET.gap,
  );
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas is not available");
  context.fillStyle = SHEET.background;
  context.fillRect(0, 0, width, height);
  let y = SHEET.gap;
  for (const block of blocks) {
    context.fillStyle = SHEET.text;
    context.font = "bold 17px sans-serif";
    context.fillText(block.title, SHEET.gap, y + 19, width - 2 * SHEET.gap);
    y += SHEET.title;
    for (const row of block.rows) {
      context.fillStyle = SHEET.muted;
      context.font = "14px sans-serif";
      context.fillText(row.name, SHEET.gap, y + 16, width - 2 * SHEET.gap);
      y += SHEET.rowLabel;
      let x = SHEET.gap;
      for (const entry of row.frames) {
        context.fillStyle = "#ffffff";
        context.fillRect(x, y, entry.canvas.width, entry.canvas.height);
        context.drawImage(entry.canvas, x, y);
        context.fillStyle = SHEET.muted;
        context.font = "13px sans-serif";
        context.fillText(entry.label, x + 2, y + tallest(row) + 15, entry.canvas.width);
        x += entry.canvas.width + SHEET.gap;
      }
      y += tallest(row) + SHEET.caption;
    }
    y += SHEET.gap;
  }
  return canvas.toDataURL("image/png");
};

/** Columns of a regular battle; the preview keeps the hex size those give. */
const GAME_COLUMNS = getDefaultBattleSizes("COMBAT", 0).width;
/** Playable 3 by 3 patch plus combat's border: two columns each side and two rows on top. */
const FIELD = { width: 7, height: 5 };
/** The middle row of the playable patch: caster, then the ground tile, then target. */
const TILES: Record<BattlefieldPlacement, { col: number; row: number }> = {
  caster: { col: 2, row: 1 },
  ground: { col: 3, row: 1 },
  target: { col: 4, row: 1 },
};
/** Step the animation clock advances by, about one frame at 60 fps. */
const FRAME_MS = 16;
const NO_HOVER: CachedIntersections = { tiles: [], battleTiles: [], ground: [] };
/** Pause after the disappear animations before a looping cycle starts over. */
const REST_MS = 700;
/** Spacing in pixels and colors of a capture sheet. */
const SHEET = {
  gap: 8,
  title: 28,
  rowLabel: 22,
  caption: 20,
  background: "#161616",
  text: "#f4f4f4",
  muted: "#b8b8b8",
};
/** Keeps fighter and effect ids unique per preview, since combat caches meshes by id. */
let previewCount = 0;

type BattlefieldPreviewOptions = {
  scene: BattlefieldScene;
  /** Catalog rows of the assets the scene draws; `scene.assets` replaces matching rows. */
  assets: GameAsset[];
  viewport: BattlefieldViewport;
  background: CombatBiome;
  /** Canvas pixels per battlefield pixel: 2 draws the same field twice as large. */
  magnify?: number;
  /** Camera zoom around the caster, the tile and the target, like combat's zoom. */
  zoom?: number;
  /** How long effects stay after their appear animation before they end. */
  holdMs?: number;
  /** URLs of suggested sounds that are not in the catalog yet, by the id the fields hold. */
  sounds?: Record<string, string>;
};

/** One preview field: its canvas, animation and sound controls, and fixed captures. */
export type BattlefieldPreview = {
  canvas: HTMLCanvasElement;
  /** Size of the field on a player's screen, in CSS pixels. */
  width: number;
  height: number;
  /** Loop the effects' cycle on animation frames until paused or disposed. */
  play: () => void;
  pause: () => void;
  /** Start the cycle over, so appear animations play again. */
  replay: () => void;
  /** Play the effects' appear and disappear sounds, as combat does, while animating. */
  setSound: (isOn: boolean) => void;
  /** Resolves once the field's textures have loaded, naming assets whose image failed. */
  whenLoaded: (timeoutMs?: number) => Promise<string[]>;
  /**
   * Frames at fixed points of one cycle, stepped off the clock so they never vary, cropped to
   * the caster, the tile and the target. Expects the default zoom.
   */
  captureFrames: () => SheetFrame[];
  /** Stop animating, release the WebGL context and remove the canvas from the page. */
  dispose: () => void;
};

type SheetFrame = { label: string; canvas: HTMLCanvasElement };
type SheetRow = { name: string; frames: SheetFrame[] };
type SheetBlock = { title: string; rows: SheetRow[] };
