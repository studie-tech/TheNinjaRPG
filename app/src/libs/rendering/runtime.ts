import { Container, UniformGroup, WebGLRenderer } from "pixi.js";
import { createSceneAssets } from "@/libs/rendering/assets";
import { premultipliedClearColor } from "@/libs/rendering/color";
import { createFrameLoop } from "@/libs/rendering/frameLoop";

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
  mount: HTMLElement;
  signal: AbortSignal;
  /** Renderer/CSS pixel dimensions at resolution 1; observed mount width is used by default. */
  height: (width: number) => number;
  width?: number;
  /** Logical coordinates stay in CSS pixels; lower resolutions use crisp CSS enlargement. */
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
      resolution: options.resolution ?? 1,
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
    // Initialization may fail before Pixi's systems have been constructed.
    if (renderer.view?.canvas) renderer.destroy({ removeView: true });
    throw error;
  }
  if (signal.aborted) {
    renderer.destroy({ removeView: true });
    throw new DOMException("Scene initialization cancelled", "AbortError");
  }
  const stage = new Container();
  // This group is shared by every animated terrain batch; publish it once per frame.
  const animation = new UniformGroup(
    { uTime: { value: 0, type: "f32" } },
    { isStatic: true },
  );
  stage.eventMode = "none";
  const assets = createSceneAssets();
  const canvas = renderer.canvas as HTMLCanvasElement;
  canvas.style.display = "block";
  canvas.style.width = "100%";
  if (options.resolution !== undefined) canvas.style.imageRendering = "pixelated";
  canvas.style.touchAction = options.touchAction ?? "none";
  mount.appendChild(canvas);
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

  const tick = (now: number) => {
    if (disposed) return;
    dirty = false;
    try {
      animation.uniforms.uTime = motion.matches ? 0 : now / 1000;
      animation.update();
      update({
        now,
        delta: previousTime === null ? 0 : Math.min(0.1, (now - previousTime) / 1000),
        reducedMotion: motion.matches,
      });
      previousTime = now;
      renderer.render({ container: stage });
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
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? true;
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
  motion.addEventListener("change", invalidate, { signal: listeners.signal });
  document.addEventListener("visibilitychange", updateSubscription, {
    signal: listeners.signal,
  });
  canvas.addEventListener(
    "webglcontextlost",
    (event) => {
      event.preventDefault();
      contextLost = true;
      updateSubscription();
    },
    { signal: listeners.signal },
  );
  canvas.addEventListener(
    "webglcontextrestored",
    () => {
      contextLost = false;
      invalidate();
    },
    { signal: listeners.signal },
  );

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    updateSubscription();
    signal.removeEventListener("abort", dispose);
    listeners.abort();
    observer.disconnect();
    resizeObserver.disconnect();
    stage.destroy({ children: true, texture: false, textureSource: false });
    for (const cleanup of cleanups) cleanup();
    cleanups.clear();
    assets.dispose();
    renderer.destroy({ removeView: true });
  };
  signal.addEventListener("abort", dispose, { once: true });
  updateSubscription();
  return {
    stage,
    animation,
    renderer,
    canvas,
    assets,
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
/**
 * now is frame-clock milliseconds (RAF live, scene time in captures). Live delta
 * is seconds, capped at 0.1 and reset on resume.
 */
export type GameFrame = { now: number; delta: number; reducedMotion: boolean };
