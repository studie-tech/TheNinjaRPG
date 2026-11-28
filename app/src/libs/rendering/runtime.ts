import {
  Container,
  GlProgram,
  type Shader,
  UniformGroup,
  WebGLRenderer,
} from "pixi.js";
import { setGameSceneVisible } from "@/libs/gameSceneVisibility";
import type { LpcCatalog } from "@/libs/lpc/catalog";
import { createSceneAssets } from "@/libs/rendering/assets";
import { createCharacterComposites } from "@/libs/rendering/characterComposites";
import {
  CHARACTER_COMPOSITE_CELL,
  CHARACTER_COMPOSITE_PAGE_SIZE,
  CHARACTER_PIXELS_PER_UNIT,
} from "@/libs/rendering/characterFrame";
import { premultipliedClearColor } from "@/libs/rendering/color";
import { createFrameLoop, MAX_FRAME_RATE } from "@/libs/rendering/frameLoop";
import { releaseRenderer, takeParkedRenderer } from "@/libs/rendering/rendererPool";
import {
  baseRenderResolution,
  createRenderQualityGovernor,
  INITIAL_HEALTHY_WINDOWS,
  initialRenderQualityLevel,
  matchingQualityLevel,
  publishRenderQualityStatus,
  type QualityLevel,
  renderQualityLevels,
  sessionRenderQuality,
} from "@/libs/rendering/renderQuality";
import { observeRenderer, type RendererSurface } from "@/libs/rendering/telemetry";
import {
  readChosenVisualEffects,
  readRenderQuality,
  readVisualEffects,
  readVisualSettingsKey,
  subscribeChosenVisualEffects,
  subscribeRenderQuality,
  subscribeVisualEffects,
  type VisualEffect,
  visualSettingsKey,
} from "@/libs/visualEffects";

// Keep sub-texel UV offsets through sprite interpolation; Pixi falls back when highp is unavailable.
GlProgram.defaultOptions.preferredFragmentPrecision = "highp";

const frames = createFrameLoop(
  (callback) => requestAnimationFrame(callback),
  (id) => cancelAnimationFrame(id),
);

/**
 * Owns the renderer, frame subscription, input listeners and texture leases together.
 * Abort or dispose releases them once; a healthy scene renderer is parked for its surface's
 * next scene (see releaseRenderer). Initialization rejects; frame failures dispose
 * the scene and call onError. Hidden/offscreen canvases suspend their frame subscription.
 * Scenes request at most MAX_FRAME_RATE; whole-refresh pacing can present above that target.
 */
export const createGameRenderer = async (options: {
  lpcCatalog?: LpcCatalog;
  /** Labels this renderer in failure reports and frame metrics. */
  surface: RendererSurface;
  mount: HTMLElement;
  signal: AbortSignal;
  /** Renderer/CSS pixel dimensions at resolution 1; observed mount width is used by default. */
  height: (width: number) => number;
  width?: number;
  /**
   * Fixes the density and disables automatic quality. Scenes otherwise follow the quality
   * preference (display density capped at 2×, within a pixel budget in auto) and previews
   * keep display density; logical coordinates stay in CSS pixels.
   */
  resolution?: number;
  background?: number;
  backgroundAlpha?: number;
  touchAction?: "none" | "auto";
  onError: (error: unknown) => void;
}) => {
  const { mount, signal } = options;
  const backgroundAlpha =
    options.backgroundAlpha ?? (options.background === undefined ? 0 : 1);
  // Previews are incidental to their page, so its decoration keeps running around them.
  const isScene = !options.surface.endsWith("-preview");
  const isTouch = matchMedia("(pointer: coarse)").matches;
  let quality = readRenderQuality();
  /** Scenes follow the quality preference; previews and explicit resolutions keep their density. */
  const baseResolution = (width: number, height: number) =>
    options.resolution ??
    baseRenderResolution({
      quality: isScene ? quality : "high",
      width,
      height,
      devicePixelRatio: window.devicePixelRatio || 1,
      isTouch,
    });
  // The context's backbuffer is transparent exactly when the background is.
  const isAlpha = backgroundAlpha < 1;
  const parked = isScene ? takeParkedRenderer(options.surface, isAlpha) : null;
  const renderer = parked ?? new WebGLRenderer();
  /** Parks a healthy scene renderer for its surface's next scene; previews' callers restyle their canvas. */
  const release = (isReusable: boolean) => {
    if (isScene) releaseRenderer(options.surface, renderer, isAlpha, isReusable);
    else renderer.destroy({ removeView: true });
  };
  try {
    const width = Math.max(1, options.width ?? mount.clientWidth);
    const height = options.height(width);
    const settings = {
      width,
      height,
      preferWebGLVersion: 1,
      // Bound color-buffer cost while preserving artwork detail on dense mobile displays.
      resolution: baseResolution(width, height),
      autoDensity: true,
      antialias: false,
      background: premultipliedClearColor(
        options.background ?? 0x000000,
        backgroundAlpha,
      ),
      backgroundAlpha,
      powerPreference: "low-power",
      preserveDrawingBuffer: false,
    } as const;
    if (parked) {
      parked.resize(settings.width, settings.height, settings.resolution);
      parked.background.color = settings.background;
      parked.background.alpha = backgroundAlpha;
    } else await renderer.init(settings);
  } catch (error) {
    // Teardown throws on a partly built renderer; the initialization error stays the cause.
    try {
      release(false);
    } catch {}
    throw error;
  }
  if (signal.aborted) {
    release(true);
    throw new DOMException("Scene initialization cancelled", "AbortError");
  }
  // Initialization can await GPU setup while another tab changes the preference.
  quality = readRenderQuality();
  const telemetry = observeRenderer(options.surface, renderer);
  const stage = new Container();
  // This group is shared by every animated terrain batch; publish it once per frame.
  const animation = new UniformGroup(
    { uTime: { value: 0, type: "f32" } },
    { isStatic: true },
  );
  stage.eventMode = "none";
  const assets = createSceneAssets();
  const characterComposites = createCharacterComposites(renderer, {
    cellSize: CHARACTER_COMPOSITE_CELL,
    pixelsPerUnit: CHARACTER_PIXELS_PER_UNIT,
    pageSize: CHARACTER_COMPOSITE_PAGE_SIZE,
  });
  const canvas = renderer.canvas as HTMLCanvasElement;
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.imageRendering = options.resolution !== undefined ? "pixelated" : "";
  canvas.style.touchAction = options.touchAction ?? "none";
  mount.appendChild(canvas);
  const storedEffects = readVisualEffects();
  /** Stored preferences less the effects automatic quality has switched off. */
  const visualEffects = { ...storedEffects };
  let chosenEffects = readChosenVisualEffects();
  const adapts = () =>
    isScene && options.resolution === undefined && quality === "auto";
  const remembered = sessionRenderQuality.get(options.surface);
  /**
   * Reductions shown to buy no speed on this surface (a slow display, scene work on the CPU):
   * the lowest density worth using and effects to keep. Later renderers of the surface reuse
   * them for the session unless the device settings have changed since, so they do not try
   * the same steps again.
   */
  const rejections =
    remembered?.settings === readVisualSettingsKey() ? remembered : null;
  let resolutionFloor = rejections?.resolutionFloor ?? 1;
  const ineffectiveEffects = new Set<VisualEffect>(rejections?.ineffectiveEffects);
  const buildLadder = (base: number) =>
    renderQualityLevels(
      base,
      storedEffects,
      new Set([...chosenEffects, ...ineffectiveEffects]),
      resolutionFloor,
    );
  let ladder = adapts()
    ? buildLadder(baseResolution(renderer.width, renderer.height))
    : [];
  const governor = createRenderQualityGovernor({
    level: remembered
      ? matchingQualityLevel(ladder, remembered.level)
      : initialRenderQualityLevel(ladder, {
          software: telemetry.isSoftware,
          memory: (navigator as { deviceMemory?: number }).deviceMemory,
          cores: navigator.hardwareConcurrency,
        }),
    patience: remembered?.patience ?? INITIAL_HEALTHY_WINDOWS,
  });
  const qualityOwner = {};
  /** Removes the step the governor just undid from this surface's ladder. */
  const keepRejectedStep = () => {
    const kept = ladder[governor.level],
      undone = ladder[governor.level + 1];
    if (!kept || !undone) return;
    if (undone.resolution < kept.resolution) resolutionFloor = kept.resolution;
    for (const effect of undone.disabled)
      if (!kept.disabled.includes(effect)) ineffectiveEffects.add(effect);
  };
  /** A settings change is a new scene to measure. */
  const forgetRejectedSteps = () => {
    resolutionFloor = 1;
    ineffectiveEffects.clear();
  };
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let visible = true;
  let paused = false;
  let contextLost = false;
  let disposed = false;
  /** A renderer whose frame failed while its context was live is not handed to another scene. */
  let isReusable = true;
  let continuous = true;
  let frameRate = MAX_FRAME_RATE;
  let dirty = true;
  let unsubscribe: (() => void) | null = null;
  let previousTime: number | null = null;
  let presentedAt = Number.NEGATIVE_INFINITY;
  /** The previous frame presented at the full rate; frame telemetry measures intervals from it. */
  let measuredAt: number | null = null;
  /** The previous continuous frame and its requested rate, for automatic quality. */
  let pacedAt: number | null = null;
  let pacedRate = frameRate;
  let wake: ReturnType<typeof setTimeout> | null = null;
  let update: FrameUpdate = () => {};
  let resize: (width: number, height: number) => void = () => {};
  const listeners = new AbortController();
  const cleanups = new Set<() => void>();
  /** Work waiting for this scene's next display refresh; it resumes in a task after it. */
  const frameWaiters = new Set<() => void>();

  const markContextLost = () => {
    if (contextLost) return;
    contextLost = true;
    telemetry.contextLost();
  };
  const tick = (now: number) => {
    if (disposed || paused) return;
    // A frame can run after the context is gone but before its loss event arrives (iOS
    // Safari after a long background); GL calls then fail, so wait for restoration instead.
    if (renderer.context.isLost) {
      markContextLost();
      updateSubscription();
      return;
    }
    // Skipped refreshes keep the subscription; changes made since wait for the next due frame.
    if (
      now - presentedAt <
      frames.minimumInterval(dirty ? MAX_FRAME_RATE : frameRate)
    ) {
      resumeWaiters();
      return;
    }
    const forced = dirty;
    dirty = false;
    const startedAt = performance.now();
    try {
      const reducedMotion = motion.matches;
      animation.uniforms.uTime =
        reducedMotion || !visualEffects.spriteAnimations ? 0 : now / 1000;
      animation.update();
      const changed = update({
        now,
        delta: previousTime === null ? 0 : Math.min(0.1, (now - previousTime) / 1000),
        reducedMotion,
      });
      previousTime = now;
      resumeWaiters();
      // A scene reporting an unchanged picture keeps its previous frame on screen.
      if (changed === false && !forced) {
        measuredAt = pacedAt = null;
        return;
      }
      characterComposites.flush();
      renderer.render({ container: stage });
      presentedAt = now;
      // Slower and on-demand frames follow their own cadence; only full-rate intervals are pacing.
      const isMeasured = continuous && frameRate >= MAX_FRAME_RATE;
      if (isMeasured && measuredAt !== null)
        telemetry.frame(now - measuredAt, performance.now() - startedAt);
      measuredAt = isMeasured ? now : null;
      // Quality compares each continuous interval with its requested rate.
      const isPaced = continuous && frameRate >= TIMED_FRAME_RATE;
      if (isPaced && pacedAt !== null && pacedRate === frameRate && adapts()) {
        const step = governor.sample(
          now - pacedAt,
          1000 / frameRate,
          frameRate >= MAX_FRAME_RATE,
        );
        if (step === "rejected") keepRejectedStep();
        if (step) updateQuality(false);
      }
      pacedAt = isPaced ? now : null;
      pacedRate = frameRate;
    } catch (error) {
      // Losing the context mid-frame surfaces as a GL TypeError (e.g. a null shader).
      if (renderer.context.isLost) {
        dirty = true;
        markContextLost();
      } else {
        isReusable = false;
        dispose();
        options.onError(error);
      }
    } finally {
      updateSubscription();
    }
  };
  const updateSubscription = () => {
    const drawable =
      visible && !paused && !document.hidden && !contextLost && !disposed;
    // Slow continuous scenes sleep between frames instead of checking every refresh.
    const sleeps = continuous && frameRate < TIMED_FRAME_RATE;
    const active = drawable && (dirty || (continuous && !sleeps));
    if (active && !unsubscribe) unsubscribe = frames.subscribe(tick);
    else if (!active && unsubscribe) {
      unsubscribe();
      unsubscribe = null;
      measuredAt = pacedAt = null;
      // A sleeping scene's next delta spans its sleep; resumed and on-demand scenes restart at 0.
      if (!sleeps || !drawable) previousTime = null;
    }
    if (drawable && sleeps && !dirty) {
      wake ??= setTimeout(
        () => {
          wake = null;
          invalidate();
        },
        Math.max(0, presentedAt + 1000 / frameRate - performance.now()),
      );
    } else if (wake !== null) {
      clearTimeout(wake);
      wake = null;
    }
  };
  const resumeWaiters = () => {
    if (!frameWaiters.size) return;
    const waiters = [...frameWaiters];
    frameWaiters.clear();
    setTimeout(() => {
      for (const resume of waiters) resume();
    }, 0);
  };
  /**
   * Applies the quality level for this size and preference. A changed ladder (a resize, a
   * new preference or a settings change) keeps the most reduced level that is no lower
   * than the current one, so a player's own change never removes another effect.
   */
  const updateQuality = (
    // A resize or settings change interrupts the measurement window; a step already restarted it.
    isInterrupted = true,
    width = renderer.width,
    height = renderer.height,
  ) => {
    if (disposed || paused) return;
    const base = baseResolution(width, height);
    let level: QualityLevel = { resolution: base, disabled: [] };
    if (adapts()) {
      const previous = ladder[governor.level];
      ladder = buildLadder(base);
      governor.setLevel(
        previous ? matchingQualityLevel(ladder, previous) : governor.level,
        ladder.length - 1,
        isInterrupted,
      );
      level = ladder[governor.level] ?? level;
      sessionRenderQuality.set(options.surface, {
        level,
        patience: governor.patience,
        resolutionFloor,
        ineffectiveEffects: [...ineffectiveEffects],
        // The settings this renderer measured under, even if storage has changed since.
        settings: visualSettingsKey(quality, storedEffects, chosenEffects),
      });
    }
    for (const effect of Object.keys(storedEffects) as VisualEffect[])
      visualEffects[effect] = storedEffects[effect] && !level.disabled.includes(effect);
    if (
      width !== renderer.width ||
      height !== renderer.height ||
      level.resolution !== renderer.resolution
    ) {
      renderer.resize(width, height, level.resolution);
      resize(width, height);
    }
    telemetry.quality({
      quality,
      quality_level: adapts() ? governor.level : 0,
      quality_effects: level.disabled.join(",") || "none",
    });
    if (isScene)
      publishRenderQualityStatus(
        qualityOwner,
        visible && !disposed
          ? { isResolutionReduced: level.resolution < base, disabled: level.disabled }
          : null,
      );
    invalidate();
  };
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? true;
    if (isScene) setGameSceneVisible(canvas, visible);
    // Settings describe the reductions on scenes the player can see.
    updateQuality();
    updateSubscription();
  });
  observer.observe(canvas);
  const resizeObserver = new ResizeObserver(() => {
    const width = Math.max(1, options.width ?? mount.clientWidth);
    const height = options.height(width);
    if (width === renderer.width && height === renderer.height) return;
    updateQuality(true, width, height);
  });
  resizeObserver.observe(mount);
  /**
   * Input redraws the scene after its listener runs. A listener that invalidates only when
   * its own state changes passes `invalidate: false`, so input over an on-demand scene
   * leaves an unchanged picture on screen.
   */
  const listen = <K extends keyof HTMLElementEventMap>(
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
    { invalidate: redraws = true }: { invalidate?: boolean } = {},
  ) =>
    canvas.addEventListener(
      type,
      (event) => {
        listener(event);
        if (redraws) invalidate();
      },
      { signal: listeners.signal },
    );
  const invalidate = () => {
    dirty = true;
    updateSubscription();
  };
  cleanups.add(
    subscribeVisualEffects((effect, enabled, isChoice) => {
      storedEffects[effect] = enabled;
      // Local choices must also win when the browser cannot persist their marker.
      if (isChoice) chosenEffects.add(effect);
      forgetRejectedSteps();
      updateQuality();
    }),
  );
  cleanups.add(
    subscribeChosenVisualEffects(() => {
      chosenEffects = readChosenVisualEffects();
      forgetRejectedSteps();
      updateQuality();
    }),
  );
  cleanups.add(
    subscribeRenderQuality((next) => {
      if (next === quality) return;
      quality = next;
      forgetRejectedSteps();
      updateQuality();
    }),
  );
  motion.addEventListener("change", invalidate, { signal: listeners.signal });
  document.addEventListener("visibilitychange", updateSubscription, {
    signal: listeners.signal,
  });
  canvas.addEventListener(
    "webglcontextlost",
    (event) => {
      event.preventDefault();
      markContextLost();
      updateSubscription();
    },
    { signal: listeners.signal },
  );
  canvas.addEventListener(
    "webglcontextrestored",
    () => {
      contextLost = false;
      characterComposites.reset();
      telemetry.contextRestored();
      invalidate();
    },
    { signal: listeners.signal },
  );

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    setGameSceneVisible(canvas, false);
    publishRenderQualityStatus(qualityOwner, null);
    telemetry.dispose();
    updateSubscription();
    signal.removeEventListener("abort", dispose);
    listeners.abort();
    observer.disconnect();
    resizeObserver.disconnect();
    stage.destroy({ children: true, texture: false, textureSource: false });
    for (const cleanup of cleanups) cleanup();
    cleanups.clear();
    for (const resume of frameWaiters) resume();
    frameWaiters.clear();
    assets.dispose();
    characterComposites.destroy();
    release(isReusable && !contextLost);
  };
  signal.addEventListener("abort", dispose, { once: true });
  updateQuality();
  updateSubscription();
  return {
    lpcCatalog: options.lpcCatalog,
    stage,
    animation,
    visualEffects,
    renderer,
    canvas,
    assets,
    /** Travel characters share composited frames; the runtime draws new ones before each render. */
    characterComposites,
    signal,
    listen,
    invalidate,
    /** Async scene work may resume after disposal, when another scene owns this renderer. */
    setBackground: (color: number) => {
      if (disposed) return;
      renderer.background.color = premultipliedClearColor(color, backgroundAlpha);
      renderer.background.alpha = backgroundAlpha;
      invalidate();
    },
    /**
     * False renders only after invalidation; true keeps visible scenes presenting at
     * the requested target rate, which slows ambient-only motion. Invalidations still present promptly.
     */
    setAnimating: (value: boolean, rate = MAX_FRAME_RATE) => {
      const nextRate = Math.min(MAX_FRAME_RATE, rate);
      if (continuous === value && frameRate === nextRate) return;
      const resumed = continuous !== value;
      continuous = value;
      frameRate = nextRate;
      if (resumed) invalidate();
      else updateSubscription();
    },
    /** Retain the last frame while a host owns interaction; resume pending changes without rebuilding. */
    setPaused: (value: boolean) => {
      if (disposed || paused === value) return;
      paused = value;
      if (!paused) {
        // Resizing clears the retained buffer, so re-measure only when its host resumes.
        const width = Math.max(1, options.width ?? mount.clientWidth);
        updateQuality(true, width, options.height(width));
      }
      invalidate();
    },
    dispose,
    /**
     * Re-measures the mount after it moves into a layout whose height rule differs; observing
     * it again delivers a fresh notification even when its box kept its size.
     */
    fit: () => {
      if (disposed) return;
      resizeObserver.unobserve(mount);
      resizeObserver.observe(mount);
    },
    /** Registers resource cleanup; registering after disposal runs it immediately. */
    own: (cleanup: () => void) => {
      if (disposed) cleanup();
      else cleanups.add(cleanup);
    },
    disown: (cleanup: () => void) => {
      cleanups.delete(cleanup);
    },
    isDisposed: () => disposed,
    /**
     * Resolves in a task after the scene's next display refresh, whether or not it presents
     * on it, so long jobs split across it never run back to back without a frame between
     * them. A scene that is not drawing resumes after a short timeout instead.
     */
    afterFrame: () =>
      new Promise<void>((resolve) => {
        if (disposed || !unsubscribe) {
          setTimeout(resolve, 0);
          return;
        }
        let done = false;
        const resume = () => {
          if (done) return;
          done = true;
          frameWaiters.delete(resume);
          resolve();
        };
        frameWaiters.add(resume);
        setTimeout(resume, AFTER_FRAME_TIMEOUT_MS);
      }),
    /** Links shaders' programs now, so the frame that first draws them does not stall on it. */
    compileShaders: (...shaders: Shader[]) => {
      for (const shader of shaders) renderer.shader.bind(shader, true);
    },
    /** A callback returning false reports an unchanged picture, which skips the render. */
    setUpdate: (callback: FrameUpdate) => {
      update = callback;
    },
    /** Invokes the callback immediately, then on subsequent renderer resizes. */
    setResize: (callback: typeof resize) => {
      resize = callback;
      resize(renderer.width, renderer.height);
    },
  };
};

export type GameRenderer = Awaited<ReturnType<typeof createGameRenderer>>;

/** Below this rate a continuous scene waits on a timer between frames, not on every refresh. */
const TIMED_FRAME_RATE = 10;
/** Work waiting for a frame resumes anyway after this long, e.g. while frames are slow. */
const AFTER_FRAME_TIMEOUT_MS = 250;
/**
 * now is frame-clock milliseconds (RAF live, scene time in captures). Live delta
 * is seconds, capped at 0.1 and reset on resume. reducedMotion reflects the OS
 * preference; each scene applies the independent sprite, wind and weather settings.
 */
export type GameFrame = { now: number; delta: number; reducedMotion: boolean };
type FrameUpdate = (frame: GameFrame) => boolean | void;
