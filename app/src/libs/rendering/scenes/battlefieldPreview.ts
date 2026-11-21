import type { Grid } from "honeycomb-grid";
import { type CombatBiome, IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import type { GameAsset } from "@/drizzle/schema";
import { projectileTravelMs } from "@/libs/combat/projectiles";
import { getTargetTiles } from "@/libs/combat/targeting";
import type {
  GroundEffect,
  ReturnedBattle,
  ReturnedUserState,
  UserEffect,
} from "@/libs/combat/types";
import {
  createEmptyExtraState,
  getBattleGrid,
  getDefaultBattleSizes,
} from "@/libs/combat/util";
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
import { hexGridHeightRatio, stackedHexWidths, type TerrainHex } from "@/libs/hexgrid";
import { combatEffectRenditions } from "@/libs/rendering/combatEffectAssets";
import {
  type CombatSceneSnapshot,
  createCombatScene,
} from "@/libs/rendering/scenes/combat";
import { reportRendererFailure } from "@/libs/rendering/telemetry";
import { playPreloadedAudio, preloadAudioBuffers, savedSfxVolume } from "@/utils/audio";
import { isBunnyCdnUrl, textureImageUrl, transformImageUrl } from "@/utils/image";
import { VisualTag } from "@/validators/combat";
import type { BattlefieldSheetsInput } from "@/validators/contentReview";

/**
 * Owns a detached authoring canvas using combat rendering and a reproducible clock.
 * Await whenLoaded before captures; cancellation during initialization returns null.
 */
export const createBattlefieldPreview = async (
  options: BattlefieldPreviewOptions,
): Promise<BattlefieldPreview | null> => {
  const content = options.scene;
  const assets = [
    ...options.assets.map((asset) => {
      const suggested = content.assets.find((entry) => entry.id === asset.id);
      const row = suggested ? { ...asset, ...suggested } : asset;
      return { ...row, image: textureSource(row.image) };
    }),
    ...Object.entries(options.sounds ?? {}).map(
      ([id, url]) => ({ id, name: id, type: "SFX", image: "", url }) as GameAsset,
    ),
  ];
  const drawn = sceneAssetIds(content).flatMap((id) => {
    const asset = assets.find((entry) => entry.id === id);
    return asset ? [asset] : [];
  });
  const hasCoordinates =
    !!content.coordinateTargeting ||
    content.effects.some((effect) => effect.coordinateTargeting || effect.footprint);
  const targeting =
    options.targeting ??
    (hasCoordinates
      ? {
          ...getDefaultBattleSizes("COMBAT", Number.MAX_SAFE_INTEGER),
          caster: { col: 2, row: 5 },
          target: { col: 9, row: 5 },
        }
      : undefined);
  const { width, height } = fieldSize(options.viewport, targeting);
  const id = `battlefield-preview-${++previewCount}`,
    casterId = `${id}-caster`,
    targetId = `${id}-target`;
  const placements = targeting
    ? {
        ...TILES,
        ground: hasCoordinates ? { col: 6, row: 5 } : TILES.ground,
        caster: targeting.caster,
        target: targeting.target,
      }
    : TILES;
  const targetAnchor = placements.target;
  const battle = previewBattle(id, options.background, [
    fighter(casterId, "Caster", placements.caster, null),
    fighter(
      targetId,
      "Target",
      placements.target,
      content.targetAvatar ? textureSource(content.targetAvatar) : null,
    ),
  ]);
  if (targeting) {
    battle.width = targeting.width;
    battle.height = targeting.height;
  }
  const hex = width / stackedHexWidths(battle.width);
  const grid = getBattleGrid(hex, battle, { x: -hex * 0.5, y: -hex * 0.5 });
  if (
    content.coordinateTargeting &&
    content.effects.some((effect) => effect.placement === "target")
  ) {
    const a = grid.getHex(placements.caster);
    const b = grid.getHex(targetAnchor);
    if (a && b) {
      const candidates = getTargetTiles({
        a,
        b,
        grid,
        action: {
          method: "COORDINATES",
          range: 0,
          coordinateTargeting: content.coordinateTargeting,
        },
      });
      const victimTile = candidates
        .filter((tile) => tile !== a && tile.col >= 2 && tile.col < battle.width - 2)
        .sort(
          (left, right) =>
            Math.hypot(left.col - b.col, left.row - b.row) -
            Math.hypot(right.col - b.col, right.row - b.row),
        )[0];
      if (victimTile) {
        placements.target = { col: victimTile.col, row: victimTile.row };
        const victim = battle.usersState[1];
        if (victim) {
          victim.longitude = victimTile.col;
          victim.latitude = victimTile.row;
        }
      }
    }
  }
  const corners = hasCoordinates
    ? grid.toArray().flatMap((tile) => tile.corners)
    : Object.values(placements).flatMap(
        (placement) => grid.getHex(placement)?.corners ?? [],
      );
  const effectTiles = (effect: BattlefieldEffect) => {
    const anchor = placements[effect.placement];
    const a = grid.getHex(placements.caster);
    const b = grid.getHex(targetAnchor);
    if ((!effect.coordinateTargeting && !effect.footprint) || !a || !b) return [anchor];
    const tiles = getTargetTiles({
      a,
      b,
      grid,
      action: effect.footprint ?? {
        method: "COORDINATES",
        range: 0,
        coordinateTargeting: effect.coordinateTargeting,
      },
    });
    // A fixed sample keeps RANDOM patterns reproducible without implying all candidates fire.
    return effect.coordinateTargeting?.selection === "RANDOM"
      ? tiles.slice(0, effect.coordinateTargeting.randomCount)
      : tiles;
  };
  const focus = {
    left: Math.max(0, Math.min(...corners.map((point) => point.x)) - hex * 0.6),
    right: Math.min(width, Math.max(...corners.map((point) => point.x)) + hex * 0.6),
    bottom: Math.max(0, Math.min(...corners.map((point) => point.y)) - hex * 0.5),
    top: Math.min(height, Math.max(...corners.map((point) => point.y)) + hex * 1.1),
  };
  const durationOf = (ids: string[]) =>
    Math.max(
      0,
      ...ids.map((id) => {
        const asset = assets.find((entry) => entry.id === id);
        return asset ? asset.frames * asset.speed : 0;
      }),
    );
  const appearMs = durationOf(content.effects.map((effect) => effect.appearAnimation));
  const disappearMs = durationOf(
    content.effects.map((effect) => effect.disappearAnimation),
  );
  const flightTiles = (effect: BattlefieldEffect) =>
    effect.projectileAnimation && effect.placement !== "caster"
      ? effectTiles(effect).filter(
          (tile) =>
            tile.col !== placements.caster.col || tile.row !== placements.caster.row,
        )
      : [];
  const travelMs = Math.max(
    0,
    ...content.effects.flatMap((effect) =>
      flightTiles(effect).map((tile) =>
        projectileTravelMs(
          { longitude: placements.caster.col, latitude: placements.caster.row },
          { longitude: tile.col, latitude: tile.row },
        ),
      ),
    ),
  );
  const endAt = travelMs + appearMs + (options.holdMs ?? 1800),
    restartAt = endAt + disappearMs + REST_MS;
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  let live = false,
    sound = false,
    disposed = false,
    cycle = 0,
    clockMs = 0,
    ended = false,
    arrived = false,
    revision = 0,
    replayOnPlay = false;
  let selectedTiles: TerrainHex[] | undefined;
  let field: Awaited<ReturnType<typeof createCombatScene>> | null = null;
  const arrive = () => {
    arrived = true;
    revision++;
    const placed = content.effects.flatMap((effect, index) =>
      effectTiles(effect).map((tile, tileIndex) => ({
        effect: visualEffect(
          `${id}-${cycle}-${index}-${tileIndex}`,
          tile,
          effect,
          casterId,
        ),
        placement: effect.placement,
      })),
    );
    battle.groundEffects = placed
      .filter(({ placement }) => placement === "ground")
      .map(({ effect }) => effect);
    battle.usersEffects = placed.flatMap(({ effect, placement }): UserEffect[] => {
      return placement !== "ground"
        ? [{ ...effect, targetId: placement === "caster" ? casterId : targetId }]
        : [];
    });
  };
  const begin = () => {
    cycle++;
    clockMs = 0;
    ended = false;
    arrived = false;
    revision++;
    battle.usersEffects = [];
    battle.groundEffects = content.effects.flatMap((effect, index) =>
      flightTiles(effect).map((tile, tileIndex) => ({
        ...visualEffect(
          `${id}-${cycle}-flight-${index}-${tileIndex}`,
          tile,
          effect,
          casterId,
        ),
        projectileOnly: true,
      })),
    );
    if (!travelMs) arrive();
  };
  const end = () => {
    ended = true;
    revision++;
    battle.usersEffects = [];
    battle.groundEffects = content.effects.flatMap((effect, index) =>
      effect.disappearAnimation || effect.disappearSfx
        ? effectTiles(effect).map((tile, tileIndex) =>
            visualEffect(
              `${id}-${cycle}-end-${index}-${tileIndex}`,
              tile,
              {
                animationScale: effect.animationScale,
                animationOffsetY: effect.animationOffsetY,
                appearAnimation: effect.disappearAnimation,
                appearSfx: effect.disappearSfx,
                appearSfxPrimary: effect.disappearSfxPrimary,
                groundStyle: effect.groundStyle,
                groundOpacity: effect.groundOpacity,
                groundFeather: effect.groundFeather,
              },
              casterId,
              "disappear",
            ),
          )
        : [],
    );
  };
  const advance = (deltaMs: number) => {
    if (!live) return clockMs;
    const nextMs = options.playbackClock?.() ?? clockMs + deltaMs;
    if (nextMs < clockMs) begin();
    clockMs = nextMs;
    if (!arrived && clockMs >= travelMs) arrive();
    if (!ended && clockMs >= endAt) end();
    if (!options.playbackClock && ended && clockMs >= restartAt) begin();
    return clockMs;
  };
  const getSnapshot = (): CombatSceneSnapshot => ({
    battle,
    userId: casterId,
    actions: [],
    timeDiff: 0,
    assets,
    requestedIds,
    active: live,
    sound: live && sound,
    volume,
    showGridNumbers: !!options.targeting,
    inspect: false,
    revision,
    targetTiles: selectedTiles,
  });
  const requestedIds = new Set(assets.map((asset) => asset.id));
  const volume = savedSfxVolume();
  begin();
  try {
    field = await createCombatScene({
      mount: document.createElement("div"),
      signal: controller.signal,
      onError: (error) => {
        console.error("Battlefield preview unavailable", error);
        reportRendererFailure(error, {
          surface: "battlefield-preview",
          phase: "frame",
        });
      },
      interactive: false,
      viewport: { width, magnify: options.magnify ?? 1 },
      getSnapshot,
      onTap: () => {},
      onHover: () => {},
      onZoom: () => {},
      play: (url, volume) => {
        if (live && sound) void (options.onSound ?? playPreloadedAudio)(url, volume);
      },
      initialZoom: options.zoom ?? 1,
      lightLayout: false,
      seed: "battlefield-preview",
      showInitialAppearance: true,
      staticActors: true,
      focus:
        (options.zoom ?? 1) === 1
          ? { x: width / 2, y: height / 2 }
          : { x: (focus.left + focus.right) / 2, y: (focus.bottom + focus.top) / 2 },
      advance,
    });
    if (controller.signal.aborted) {
      field.dispose();
      return null;
    }
    const renderer = field;
    const renderAt = async (timeMs: number) => {
      if (disposed) return;
      if (timeMs < clockMs) {
        begin();
        await renderer.renderAt(0);
      }
      if (!arrived && timeMs >= travelMs) {
        clockMs = travelMs;
        await renderer.renderAt(travelMs);
        arrive();
        await renderer.renderAt(travelMs);
      }
      if (!ended && timeMs >= endAt) {
        clockMs = endAt;
        await renderer.renderAt(endAt);
        end();
        await renderer.renderAt(endAt);
      }
      clockMs = Math.max(0, timeMs);
      await renderer.renderAt(clockMs);
    };
    const replay = () => {
      begin();
      void renderer
        .renderAt(0)
        .catch((error: unknown) => console.error("Battlefield replay failed", error));
    };
    const soundUrls = sceneSoundIds(content).flatMap(
      (id) => assets.find((asset) => asset.id === id)?.url ?? [],
    );
    await renderer.renderAt(0);
    return {
      canvas: renderer.canvas,
      grid: renderer.grid,
      width,
      height,
      durationMs: restartAt,
      timeline: { arrivalMs: travelMs, removalMs: endAt },
      renderAt,
      getPlaybackState: () => ({
        elapsedMs: clockMs,
        cycle,
        phase:
          clockMs < travelMs
            ? "travel"
            : clockMs < travelMs + appearMs
              ? "appearance"
              : clockMs < endAt
                ? "active"
                : clockMs < endAt + disappearMs
                  ? "disappearance"
                  : "rest",
      }),
      play: () => {
        if (live || disposed) return;
        live = true;
        if (replayOnPlay) {
          replayOnPlay = false;
          replay();
        }
        renderer.refresh();
      },
      pause: () => {
        live = false;
        renderer.refresh();
      },
      replay,
      setSound: (value, settings) => {
        sound = value;
        replayOnPlay = false;
        if (value) {
          void preloadAudioBuffers(soundUrls);
          if (settings?.restart !== false) {
            if (live) replay();
            else replayOnPlay = true;
          }
        }
        renderer.refresh();
      },
      setTargeting: (caster, target, tiles) => {
        battle.usersState.forEach((user, index) => {
          const tile = index === 0 ? caster : target;
          user.longitude = tile.col;
          user.latitude = tile.row;
        });
        selectedTiles = tiles;
        revision++;
        renderer.refresh();
      },
      whenLoaded: async (timeoutMs = 6000) => {
        const renditions = drawn.map((asset) => ({
          asset,
          urls: combatEffectRenditions(asset, content.effects).map((width) =>
            textureImageUrl(asset.image, width),
          ),
        }));
        const failed = await preloadImages(
          renditions.flatMap(({ urls }) => urls),
          timeoutMs,
        );
        return renditions
          .filter(({ urls }) => urls.some((url) => failed.has(url)))
          .map(({ asset }) => asset)
          .map((asset) => `${asset.name} (${asset.id})`);
      },
      captureFrames: async () => {
        const wasLive = live;
        live = false;
        begin();
        await renderer.renderAt(0);
        const points = [
          ...(travelMs
            ? [
                { at: travelMs * 0.3, label: "projectile · departing" },
                { at: travelMs * 0.7, label: "projectile · arriving" },
              ]
            : []),
          ...(appearMs > 0
            ? [
                { at: travelMs + appearMs * 0.3, label: "appearing" },
                { at: travelMs + appearMs * 0.7, label: "appearing" },
              ]
            : []),
          {
            at: Math.min(travelMs + appearMs + 350, endAt - FRAME_MS),
            label: "active",
          },
          ...(disappearMs > 0
            ? [{ at: endAt + disappearMs * 0.5, label: "disappearing" }]
            : []),
        ];
        const area = {
          left: focus.left / width,
          right: focus.right / width,
          top: 1 - focus.top / height,
          bottom: 1 - focus.bottom / height,
        };
        const frames: SheetFrame[] = [];
        for (const point of points) {
          await renderAt(point.at);
          frames.push({
            label: point.label,
            canvas: cropCanvas(renderer.canvas, area),
          });
        }
        live = wasLive;
        renderer.refresh();
        return frames;
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        live = false;
        options.signal?.removeEventListener("abort", abort);
        controller.abort();
        renderer.dispose();
      },
    };
  } catch (error) {
    controller.abort();
    field?.dispose();
    options.signal?.removeEventListener("abort", abort);
    if (options.signal?.aborted) return null;
    console.error("Unable to initialize the battlefield preview", error);
    reportRendererFailure(error, { surface: "battlefield-preview", phase: "init" });
    return null;
  }
};

/** Width of one hex on the viewport, as a regular battle lays them out. */
export const previewHexWidth = (viewport: BattlefieldViewport) =>
  BATTLEFIELD_VIEWPORTS[viewport] / stackedHexWidths(GAME_COLUMNS);

/** Captures fixed desktop/phone phases into PNG sheets and disposes each temporary preview. */
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
      const scene = scenes[requestIndex]?.[variantIndex] ?? {
        effects: [],
        targetAvatar: null,
        assets: [],
      };
      const frames: SheetFrame[] = [];
      for (const viewport of ["desktop", "phone"] as const) {
        const preview = await createBattlefieldPreview({
          scene,
          assets,
          viewport,
          background: input.background,
          magnify: 2,
          holdMs: 700,
        });
        if (!preview) throw new Error("WebGL is not available in this browser");
        let captured: SheetFrame[];
        try {
          for (const name of await preview.whenLoaded()) missing.add(name);
          captured = await preview.captureFrames();
        } finally {
          preview.dispose();
        }
        frames.push(
          ...(viewport === "desktop"
            ? captured
            : captured
                .filter((entry) => input.captureAllPhases || entry.label === "active")
                .map((entry) => ({ ...entry, label: `phone · ${entry.label}` }))),
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

/** Size of the field on the viewport in CSS pixels, and its height to width ratio. */
const fieldSize = (
  viewport: BattlefieldViewport,
  targeting?: BattlefieldPreviewOptions["targeting"],
) => {
  const dimensions = targeting ?? FIELD;
  const width = targeting
    ? BATTLEFIELD_VIEWPORTS[viewport]
    : previewHexWidth(viewport) * stackedHexWidths(FIELD.width);
  const ratio = hexGridHeightRatio(dimensions.width, dimensions.height);
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
    extraState: createEmptyExtraState(),
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
  phase: "appear" | "disappear" = "appear",
): GroundEffect => ({
  ...VisualTag.parse({
    type: "visual",
    description: "N/A",
    staticAssetPath: visuals.staticAssetPath ?? "",
    staticAnimation: visuals.staticAnimation ?? "",
    animationScale: visuals.animationScale,
    animationOffsetY: visuals.animationOffsetY,
    projectileAnimation: visuals.projectileAnimation,
    projectileScale: visuals.projectileScale,
    groundStyle: visuals.groundStyle,
    groundOpacity: visuals.groundOpacity,
    groundFeather: visuals.groundFeather,
    appearAnimation: visuals.appearAnimation ?? "",
    disappearAnimation: visuals.disappearAnimation ?? "",
    appearSfx: visuals.appearSfx ?? "",
    appearSfxPrimary: visuals.appearSfxPrimary,
    disappearSfxPrimary: visuals.disappearSfxPrimary,
  }),
  actionId: "battlefield-preview",
  soundOrigin: { actionId: "battlefield-preview", createdRound: 0, phase },
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

const preloadImages = async (urls: string[], timeoutMs: number) => {
  const failed = new Set<string>();
  await Promise.all(
    [...new Set(urls)].map(
      (url) =>
        new Promise<void>((resolve) => {
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
          image.src = url;
        }),
    ),
  );
  return failed;
};

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
/** Distinguishes fighters and effect cycles within independently mounted preview fields. */
let previewCount = 0;

type BattlefieldPreviewOptions = {
  signal?: AbortSignal;
  /** Multiple previews can sample one shared clock and restart together. */
  playbackClock?: () => number;
  /** An embedding surface can own audio nodes to stop them when its audible version changes. */
  onSound?: (url: string, volume: number) => void | Promise<void>;
  scene: BattlefieldScene;
  /** Catalog rows of the assets the scene draws; `scene.assets` replaces matching rows. */
  assets: GameAsset[];
  viewport: BattlefieldViewport;
  background: CombatBiome;
  /** Full-map targeting help; effect previews retain their compact field when omitted. */
  targeting?: {
    width: number;
    height: number;
    caster: { col: number; row: number };
    target: { col: number; row: number };
  };
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
  /** The renderer's own grid keeps targeting overlays aligned with the battlefield. */
  grid: Grid<TerrainHex>;
  /** Move preview fighters and highlight a raw footprint without changing game content. */
  setTargeting: (caster: TerrainHex, target: TerrainHex, tiles: TerrainHex[]) => void;
  /** Size of the field on a player's screen, in CSS pixels. */
  width: number;
  height: number;
  /** Full visual cycle, including its active inspection window and restart pause. */
  durationMs: number;
  /** Sound-aware comparison hosts can keep a shared cycle open until both exits finish. */
  timeline: { arrivalMs: number; removalMs: number };
  /** Loop the effects' cycle on animation frames until paused or disposed. */
  play: () => void;
  pause: () => void;
  /** Start the cycle over, so appear animations play again. */
  replay: () => void;
  /** Play the effects' appear and disappear sounds, as combat does, while animating. */
  setSound: (isOn: boolean, settings?: { restart?: boolean }) => void;
  /** Resolves once the field's textures have loaded, naming assets whose image failed. */
  whenLoaded: (timeoutMs?: number) => Promise<string[]>;
  /**
   * Frames at fixed points of one cycle, stepped off the clock so they never vary, cropped to
   * the caster, the tile and the target. Expects the default zoom.
   */
  captureFrames: () => Promise<SheetFrame[]>;
  /** Samples milliseconds from cycle start; seeking backward restarts the effect lifecycle. */
  renderAt: (timeMs: number) => Promise<void>;
  /** Current visual demonstration phase; elapsed time does not represent combat rounds. */
  getPlaybackState: () => {
    elapsedMs: number;
    cycle: number;
    phase: "travel" | "appearance" | "active" | "disappearance" | "rest";
  };
  /** Stop animating, release the WebGL context and remove the canvas from the page. */
  dispose: () => void;
};

type SheetFrame = { label: string; canvas: HTMLCanvasElement };
type SheetRow = { name: string; frames: SheetFrame[] };
type SheetBlock = { title: string; rows: SheetRow[] };
