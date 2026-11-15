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
import { premultipliedClearColor } from "@/libs/rendering/color";
import { createFrameLoop, MAX_FRAME_RATE } from "@/libs/rendering/frameLoop";
import { observeRenderer, type RendererSurface } from "@/libs/rendering/telemetry";
import { readVisualEffects, subscribeVisualEffects } from "@/libs/visualEffects";

// Keep sub-texel UV offsets through sprite interpolation; Pixi falls back when highp is unavailable.
GlProgram.defaultOptions.preferredFragmentPrecision = "highp";

const frames = createFrameLoop(
  (callback) => requestAnimationFrame(callback),
  (id) => cancelAnimationFrame(id),
);

/**
 * Owns the renderer, frame subscription, input listeners and texture leases together.
 * Abort or dispose releases them once. Initialization rejects; frame failures dispose
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
  /** Defaults to display density capped at 2×; logical coordinates stay in CSS pixels. */
  resolution?: number;
  background?: number;
  backgroundAlpha?: number;
  touchAction?: "none" | "auto";
  onError: (error: unknown) => void;
}) => {
  const { mount, signal } = options;
  const backgroundAlpha =
    options.backgroundAlpha ?? (options.background === undefined ? 0 : 1);
  const renderer = new WebGLRenderer();
  try {
    const width = Math.max(1, options.width ?? mount.clientWidth);
    await renderer.init({
      width,
      height: options.height(width),
      preferWebGLVersion: 1,
      // Bound color-buffer cost while preserving artwork detail on dense mobile displays.
      resolution: options.resolution ?? Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      antialias: false,
      background: premultipliedClearColor(
        options.background ?? 0x000000,
        backgroundAlpha,
      ),
      backgroundAlpha,
      powerPreference: "low-power",
      preserveDrawingBuffer: false,
    });
  } catch (error) {
    // Teardown throws on a partly built renderer; the initialization error stays the cause.
    try {
      if (renderer.view?.canvas) renderer.destroy({ removeView: true });
    } catch {}
    throw error;
  }
  if (signal.aborted) {
    renderer.destroy({ removeView: true });
    throw new DOMException("Scene initialization cancelled", "AbortError");
  }
  const telemetry = observeRenderer(options.surface, renderer);
  const stage = new Container();
  // This group is shared by every animated terrain batch; publish it once per frame.
  const animation = new UniformGroup(
    { uTime: { value: 0, type: "f32" } },
    { isStatic: true },
  );
  stage.eventMode = "none";
  const assets = createSceneAssets();
  const characterComposites = createCharacterComposites(renderer);
  const canvas = renderer.canvas as HTMLCanvasElement;
  canvas.style.display = "block";
  canvas.style.width = "100%";
  if (options.resolution !== undefined) canvas.style.imageRendering = "pixelated";
  canvas.style.touchAction = options.touchAction ?? "none";
  mount.appendChild(canvas);
  const visualEffects = readVisualEffects();
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let visible = true;
  let contextLost = false;
  let disposed = false;
  let continuous = true;
  let frameRate = MAX_FRAME_RATE;
  let dirty = true;
  let unsubscribe: (() => void) | null = null;
  let previousTime: number | null = null;
  let presentedAt = Number.NEGATIVE_INFINITY;
  /** The previous frame presented at the full rate; frame telemetry measures intervals from it. */
  let measuredAt: number | null = null;
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
    if (disposed) return;
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
        measuredAt = null;
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
    } catch (error) {
      // Losing the context mid-frame surfaces as a GL TypeError (e.g. a null shader).
      if (renderer.context.isLost) {
        dirty = true;
        markContextLost();
      } else {
        dispose();
        options.onError(error);
      }
    } finally {
      updateSubscription();
    }
  };
  const updateSubscription = () => {
    const drawable = visible && !document.hidden && !contextLost && !disposed;
    // Slow continuous scenes sleep between frames instead of checking every refresh.
    const sleeps = continuous && frameRate < TIMED_FRAME_RATE;
    const active = drawable && (dirty || (continuous && !sleeps));
    if (active && !unsubscribe) unsubscribe = frames.subscribe(tick);
    else if (!active && unsubscribe) {
      unsubscribe();
      unsubscribe = null;
      measuredAt = null;
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
  // Previews are incidental to their page, so its decoration keeps running around them.
  const isScene = !options.surface.endsWith("-preview");
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? true;
    if (isScene) setGameSceneVisible(canvas, visible);
    updateSubscription();
  });
  observer.observe(canvas);
  const resizeObserver = new ResizeObserver(() => {
    const width = Math.max(1, options.width ?? mount.clientWidth);
    const height = options.height(width);
    if (width === renderer.width && height === renderer.height) return;
    renderer.resize(width, height);
    resize(width, height);
    invalidate();
  });
  resizeObserver.observe(mount);
  const listen = <K extends keyof HTMLElementEventMap>(
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
  ) =>
    canvas.addEventListener(
      type,
      (event) => {
        listener(event);
        invalidate();
      },
      { signal: listeners.signal },
    );
  const invalidate = () => {
    dirty = true;
    updateSubscription();
  };
  cleanups.add(
    subscribeVisualEffects((effect, enabled) => {
      visualEffects[effect] = enabled;
      invalidate();
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
    renderer.destroy({ removeView: true });
  };
  signal.addEventListener("abort", dispose, { once: true });
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
    setBackground: (color: number) => {
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
    dispose,
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
