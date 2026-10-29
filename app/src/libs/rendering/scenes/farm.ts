import { Container, Graphics, Sprite, Texture } from "pixi.js";
import {
  FARM_GROWTH_STAGES,
  IMG_FARM_BACKGROUND,
  IMG_FARM_PLOT_SOIL,
} from "@/drizzle/constants";
import { canWaterPlot, getPlotGrowthStage, isPlotReady } from "@/libs/farming";
import { createGameRenderer } from "@/libs/rendering/runtime";
import { farmLightingClock, nextFarmVisualAt } from "@/libs/rendering/scenes/farmClock";
import {
  FARM_CANVAS_MIN_HEIGHT,
  FARM_PLOT_SIZE,
  farmPlotAt,
  farmPlotPosition,
  farmViewScale,
} from "@/libs/rendering/scenes/farmLayout";
import type { FarmEffect, FarmPlotState, FarmVisualState } from "@/validators/farming";

/**
 * Owns a demand-rendered farm, waking for visual deadlines/effects. Initialization
 * awaits background/soil; crop art loads independently. updateState replaces visual
 * state, while refresh re-reads clock/lighting preferences; neither mutates gameplay.
 */
export const createFarmScene = async (options: {
  mount: HTMLElement;
  signal: AbortSignal;
  initialState: FarmVisualState;
  /** Local minus server time in milliseconds, subtracted from Date.now(). */
  getTimeDiff: () => number;
  showDayNight: () => boolean;
  onPlotClick: (slot: number, plot: FarmPlotState | undefined) => void;
  onError: (error: unknown) => void;
}) => {
  const game = await createGameRenderer({
    ...options,
    touchAction: "auto",
    background: 0x87ae73,
    height: (width) => Math.max(FARM_CANVAS_MIN_HEIGHT, width * 0.55),
  });
  game.setAnimating(false);
  try {
    const [backgroundTexture, soilTexture] = await Promise.all([
      game.assets.texture(IMG_FARM_BACKGROUND),
      game.assets.texture(IMG_FARM_PLOT_SOIL),
    ]);
    if (options.signal.aborted) throw new DOMException("Scene cancelled", "AbortError");
    const background = new Sprite(backgroundTexture);
    const world = new Container();
    const soilLayer = new Container();
    const ringLayer = new Container();
    const night = new Sprite({ texture: Texture.WHITE, tint: 0x0a1030 });
    const glowLayer = new Container();
    const cropLayer = new Container();
    const statusLayer = new Container();
    const effectLayer = new Container();
    world.addChild(
      soilLayer,
      ringLayer,
      night,
      glowLayer,
      cropLayer,
      statusLayer,
      effectLayer,
    );
    game.stage.addChild(background, world);
    let state = options.initialState;
    let selected = state.selectedPlotIndex ?? null;
    let hovered: number | null = null;
    let reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const entries = new Map<number, PlotEntry>();
    const effects: { sprite: Graphics; age: number }[] = [];
    let wake: ReturnType<typeof setTimeout> | null = null;
    const effectPool: Graphics[] = [];
    const clock = () => new Date(Date.now() - options.getTimeDiff());

    const syncEntry = (entry: PlotEntry, plot: FarmPlotState | undefined) => {
      const visualKey = JSON.stringify([
        state.totalPlots,
        !!plot?.seedItemId,
        plot?.cropImage,
        plot?.growthStage,
        plot?.isReady,
        plot?.canWater,
        plot?.fertilizerApplied,
        entry.slot === hovered,
        entry.slot === selected,
      ]);
      if (visualKey === entry.visualKey) return false;
      entry.visualKey = visualKey;
      const position = farmPlotPosition(entry.slot, state.totalPlots);
      entry.soil.position.set(position.x, position.y);
      entry.crop.position.copyFrom(entry.soil.position);
      entry.glow.position.copyFrom(entry.soil.position);
      entry.water.position.set(position.x - 0.72, position.y - 0.72);
      entry.fertilizer.position.set(position.x + 0.72, position.y - 0.72);
      entry.ring.position.copyFrom(entry.soil.position);
      const active = !!plot?.seedItemId && !!plot.cropImage;
      entry.crop.visible = active;
      entry.water.visible = active && !!plot?.canWater;
      entry.fertilizer.visible = active && !!plot?.fertilizerApplied;
      entry.ready = active && !!plot?.isReady;
      entry.glow.visible = entry.ready;
      const stage = Math.max(1, Math.min(FARM_GROWTH_STAGES, plot?.growthStage ?? 1));
      const previousSize = entry.cropSize;
      entry.cropSize = entry.ready ? 1.1 : 0.45 + (stage / FARM_GROWTH_STAGES) * 0.55;
      if (previousSize !== entry.cropSize)
        entry.crop.width = entry.crop.height = entry.cropSize;
      if (active && plot?.cropImage !== entry.image) {
        const path = plot?.cropImage;
        entry.image = path ?? null;
        entry.crop.texture = entry.glow.texture = Texture.EMPTY;
        if (path)
          void game.assets.texture(path).then(
            (texture) => {
              if (game.isDisposed() || entry.crop.destroyed || entry.image !== path)
                return;
              entry.crop.texture = texture;
              entry.glow.texture = texture;
              entry.crop.width = entry.crop.height = entry.cropSize;
              game.invalidate();
            },
            (error: unknown) => {
              if (
                game.signal.aborted ||
                game.isDisposed() ||
                entry.crop.destroyed ||
                entry.image !== path ||
                (error instanceof Error && error.name === "AbortError")
              )
                return;
              // Soil and plot controls remain usable without the crop/glow artwork.
              console.warn("Farm crop artwork unavailable", error);
            },
          );
      }
      const isHovered = entry.slot === hovered;
      entry.soil.tint = isHovered ? 0xe2f7d3 : 0xffffff;
      const ringColor =
        entry.slot === selected ? 0x4ade80 : isHovered ? 0xf8fafc : null;
      if (ringColor === entry.ringColor) return true;
      entry.ringColor = ringColor;
      entry.ring.clear();
      if (ringColor !== null) {
        const half = FARM_PLOT_SIZE * (entry.slot === selected ? 0.55 : 0.51);
        entry.ring.rect(-half, -half, half * 2, half * 2).stroke({
          color: entry.slot === selected ? 0x4ade80 : 0xf8fafc,
          width: 0.025,
        });
      }
      return true;
    };
    // The view zooms to the plot grid, so it is laid out again when the plot count changes.
    let viewTotal = state.totalPlots;
    const applyView = (width: number, height: number) => {
      viewTotal = state.totalPlots;
      const scale = farmViewScale(width, height, viewTotal);
      background.width = width;
      background.height = height;
      world.position.set(width / 2, height / 2);
      world.scale.set(scale);
      night.position.set(-width / scale / 2, -height / scale / 2);
      night.width = width / scale;
      night.height = height / scale;
    };
    const refresh = () => {
      if (game.isDisposed()) return;
      const now = clock();
      let changed = false;
      if (state.totalPlots !== viewTotal) {
        applyView(game.renderer.width, game.renderer.height);
        changed = true;
      }
      const plots = new Map(
        state.plots.map((plot) => [plot.slotIndex, livePlot(plot, now)]),
      );
      for (let slot = 0; slot < state.totalPlots; slot++) {
        let entry = entries.get(slot);
        if (!entry) {
          const soil = squareSprite(soilTexture, FARM_PLOT_SIZE);
          const crop = squareSprite(Texture.EMPTY, 1);
          const glow = squareSprite(Texture.EMPTY, 1);
          glow.tint = 0xffd700;
          glow.alpha = 0.35;
          const water = squareSprite(Texture.WHITE, 0.28);
          water.tint = 0x38bdf8;
          water.alpha = 0.95;
          const fertilizer = squareSprite(Texture.WHITE, 0.28);
          fertilizer.tint = 0xf59e0b;
          fertilizer.alpha = 0.95;
          const ring = new Graphics();
          entry = {
            slot,
            soil,
            crop,
            glow,
            water,
            fertilizer,
            ring,
            ringColor: null,
            ready: false,
            image: null,
            cropSize: 1,
            expand: 1,
            visualKey: null,
          };
          entries.set(slot, entry);
          soilLayer.addChild(soil);
          cropLayer.addChild(crop);
          glowLayer.addChild(glow);
          statusLayer.addChild(water, fertilizer);
          ringLayer.addChild(ring);
        }
        changed = syncEntry(entry, plots.get(slot)) || changed;
      }
      for (const [slot, entry] of entries) {
        if (slot < state.totalPlots) continue;
        for (const object of [
          entry.soil,
          entry.crop,
          entry.glow,
          entry.water,
          entry.fertilizer,
          entry.ring,
        ])
          object.destroy();
        entries.delete(slot);
        changed = true;
      }
      const lighting = farmLightingClock(now, options.showDayNight());
      changed ||= night.alpha !== lighting.alpha;
      night.alpha = lighting.alpha;
      game.setAnimating(
        lighting.isTransitioning ||
          (!reducedMotion &&
            (effects.length > 0 ||
              [...entries.values()].some((entry) => entry.ready || entry.expand < 1))),
      );
      if (changed) game.invalidate();
      if (wake !== null) clearTimeout(wake);
      const nextAt = nextFarmVisualAt(state.plots, now, options.showDayNight());
      wake =
        nextAt === null
          ? null
          : setTimeout(refresh, Math.max(1, nextAt - now.getTime()));
    };
    refresh();
    game.setResize(applyView);
    const setHovered = (slot: number | null) => {
      if (hovered === slot) return;
      hovered = slot;
      game.canvas.style.cursor = slot === null ? "default" : "pointer";
      refresh();
    };
    const pointerSlot = (event: PointerEvent) => {
      const rect = game.canvas.getBoundingClientRect();
      const x = ((event.clientX - rect.left) * game.renderer.width) / rect.width;
      const y = ((event.clientY - rect.top) * game.renderer.height) / rect.height;
      return farmPlotAt(
        (x - world.x) / world.scale.x,
        (y - world.y) / world.scale.y,
        state.totalPlots,
      );
    };
    game.listen("pointermove", (event) => setHovered(pointerSlot(event)));
    game.listen("pointerleave", () => setHovered(null));
    game.listen("pointerdown", (event) => {
      if (event.button !== 0) return;
      const slot = pointerSlot(event);
      setHovered(slot);
      if (slot === null) return;
      const plot = state.plots.find((candidate) => candidate.slotIndex === slot);
      options.onPlotClick(slot, plot ? livePlot(plot, clock()) : undefined);
    });
    game.setUpdate((frame) => {
      if (reducedMotion !== frame.reducedMotion) {
        reducedMotion = frame.reducedMotion;
        refresh();
      }
      let activeAnimations = effects.length;
      for (const entry of entries.values()) {
        if (entry.ready || entry.expand < 1) activeAnimations++;
        entry.expand = reducedMotion
          ? 1
          : Math.min(1, entry.expand + frame.delta * 2.5);
        entry.soil.width = entry.soil.height = FARM_PLOT_SIZE * entry.expand;
        entry.soil.alpha = entry.expand;
        const pulse = reducedMotion ? 1 : 1 + Math.sin(Date.now() / 250) * 0.08;
        entry.glow.width = entry.glow.height = entry.cropSize * 1.35 * pulse;
      }
      for (let index = effects.length - 1; index >= 0; index--) {
        const effect = effects[index];
        if (!effect) continue;
        effect.age += frame.delta;
        effect.sprite.scale.set(0.2 + effect.age * 1.8);
        effect.sprite.alpha = Math.max(0, 0.8 - effect.age);
        if (effect.age >= 0.8 || reducedMotion) {
          effect.sprite.removeFromParent();
          effectPool.push(effect.sprite);
          effects.splice(index, 1);
        }
      }
      const lighting = farmLightingClock(clock(), options.showDayNight());
      night.alpha = lighting.alpha;
      game.setAnimating(
        lighting.isTransitioning ||
          (!reducedMotion && (activeAnimations > 0 || effects.length > 0)),
      );
    });
    game.own(() => {
      if (wake !== null) clearTimeout(wake);
      for (const effect of effectPool) effect.destroy();
    });
    const onVisibility = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    game.own(() => document.removeEventListener("visibilitychange", onVisibility));
    return {
      dispose: game.dispose,
      refresh,
      updateState: (next: FarmVisualState) => {
        state = next;
        selected = next.selectedPlotIndex ?? null;
        refresh();
      },
      expandGrid: (total: number, slot: number) => {
        if (entries.has(slot)) return;
        state = { ...state, totalPlots: total };
        refresh();
        const entry = entries.get(slot);
        if (entry && !reducedMotion) entry.expand = 0.01;
        refresh();
      },
      playEffect: (slot: number, effect: FarmEffect) => {
        const entry = entries.get(slot);
        if (!entry || reducedMotion) return;
        if (effects.length >= 32) {
          const oldest = effects.shift();
          if (oldest) {
            oldest.sprite.removeFromParent();
            effectPool.push(oldest.sprite);
          }
        }
        const sprite =
          effectPool.pop() ?? new Graphics().circle(0, 0, 0.65).fill(0xffffff);
        sprite.tint = FARM_EFFECT_COLORS[effect];
        sprite.position.copyFrom(entry.soil.position);
        sprite.scale.set(0.2);
        sprite.alpha = 0.8;
        effectLayer.addChild(sprite);
        effects.push({ sprite, age: 0 });
        refresh();
      },
    };
  } catch (error) {
    game.dispose();
    throw error;
  }
};

const squareSprite = (texture: Texture, size: number) => {
  const sprite = new Sprite(texture);
  sprite.anchor.set(0.5);
  sprite.width = sprite.height = size;
  return sprite;
};

const livePlot = (plot: FarmPlotState, now: Date) => {
  const active = !!plot.seedItemId && !!plot.plantedAt && !!plot.finishAt;
  const ready = active && isPlotReady(plot.finishAt, now);
  return {
    ...plot,
    isReady: ready,
    canWater: active && !ready && canWaterPlot(plot.lastWateredAt, now),
    growthStage: active ? getPlotGrowthStage(plot.plantedAt, plot.finishAt, now) : 0,
  };
};

const FARM_EFFECT_COLORS: Record<FarmEffect, number> = {
  plant: 0x4ade80,
  water: 0x38bdf8,
  fertilize: 0xf59e0b,
  harvest: 0xfde047,
  expand: 0xa78bfa,
  level: 0xfbbf24,
};

type PlotEntry = {
  slot: number;
  soil: Sprite;
  crop: Sprite;
  glow: Sprite;
  water: Sprite;
  fertilizer: Sprite;
  ring: Graphics;
  ringColor: number | null;
  ready: boolean;
  image: string | null;
  cropSize: number;
  expand: number;
  visualKey: string | null;
};
