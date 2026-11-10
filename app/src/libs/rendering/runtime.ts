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
import { createFrameLoop } from "@/libs/rendering/frameLoop";
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
  let dirty = true;
  let unsubscribe: (() => void) | null = null;
  let previousTime: number | null = null;
  let update: (frame: GameFrame) => void = () => {};
  let resize: (width: number, height: number) => void = () => {};
  const listeners = new AbortController();
  const cleanups = new Set<() => void>();
  /** Work waiting for the next presented frame; it resumes in a task after that frame. */
  const frameWaiters = new Set<() => void>();

  const tick = (now: number) => {
    if (disposed) return;
    dirty = false;
    const startedAt = performance.now();
    const interval = previousTime === null ? 0 : now - previousTime;
    try {
      const reducedMotion = motion.matches;
      animation.uniforms.uTime =
        reducedMotion || !visualEffects.spriteAnimations ? 0 : now / 1000;
      animation.update();
      update({
        now,
        delta: previousTime === null ? 0 : Math.min(0.1, (now - previousTime) / 1000),
        reducedMotion,
      });
      previousTime = now;
      characterComposites.flush();
      renderer.render({ container: stage });
      if (frameWaiters.size) {
        const waiters = [...frameWaiters];
        frameWaiters.clear();
        setTimeout(() => {
          for (const resume of waiters) resume();
        }, 0);
      }
      // On-demand scenes idle between frames, so their intervals are not frame pacing.
      if (continuous && interval > 0) {
        telemetry.frame(interval, performance.now() - startedAt);
      }
    } catch (error) {
      dispose();
      options.onError(error);
    } finally {
      updateSubscription();
    }
  };
  const updateSubscription = () => {
    const active =
      (continuous || dirty) && visible && !document.hidden && !contextLost && !disposed;
    if (active && !unsubscribe) unsubscribe = frames.subscribe(tick);
    else if (!active && unsubscribe) {
      unsubscribe();
      unsubscribe = null;
      previousTime = null;
    }
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
      contextLost = true;
      telemetry.contextLost();
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
    /** False renders only after invalidation; true keeps visible scenes subscribed. */
    setAnimating: (value: boolean) => {
      if (continuous === value) return;
      continuous = value;
      invalidate();
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
     * Resolves in a task after the next frame this scene presents, so long jobs split across
     * it never run back to back without a frame between them. A scene that is not drawing
     * resumes after a short timeout instead.
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
    setUpdate: (callback: typeof update) => {
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

/** Work waiting for a frame resumes anyway after this long, e.g. while frames are slow. */
const AFTER_FRAME_TIMEOUT_MS = 250;
/**
 * now is frame-clock milliseconds (RAF live, scene time in captures). Live delta
 * is seconds, capped at 0.1 and reset on resume. reducedMotion reflects the OS
 * preference; each scene applies the independent sprite, wind and weather settings.
 */
export type GameFrame = { now: number; delta: number; reducedMotion: boolean };
