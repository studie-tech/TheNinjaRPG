import type { WebGLRenderer } from "pixi.js";
import type { RendererSurface } from "@/libs/rendering/telemetry";

/** How long a released renderer waits for the next scene of its surface. */
const PARKED_RENDERER_MS = 30_000;

let parked: ParkedRenderer | null = null;
/** Scenes between acquiring and releasing a renderer, including those still initializing. */
const activeScenes = new Map<RendererSurface, number>();

/**
 * Starts a scene's hold on a renderer: hands over the parked renderer when it suits this
 * scene, so the next scene of the same surface (the next battle after a result screen)
 * reuses its WebGL context with its linked shader programs and the uploaded textures that
 * are still cached, instead of creating, compiling and uploading them again. Any other
 * parked renderer is destroyed. Every call is paired with one releaseRenderer.
 * `isAlpha` is the context's immutable transparent-backbuffer attribute.
 */
export const takeParkedRenderer = (surface: RendererSurface, isAlpha: boolean) => {
  activeScenes.set(surface, (activeScenes.get(surface) ?? 0) + 1);
  const entry = parked;
  if (!entry) return null;
  if (
    entry.surface !== surface ||
    entry.isAlpha !== isAlpha ||
    entry.renderer.context.isLost
  ) {
    destroyParkedRenderer();
    return null;
  }
  detach(entry);
  return entry.renderer;
};

/**
 * Ends a scene's hold. A reusable renderer waits detached from the page while no other
 * scene of its surface holds one; at most one renderer waits, and it is destroyed after
 * PARKED_RENDERER_MS, when the page is hidden, when its context is lost and when a scene
 * of another surface or context type starts. So a parked renderer never coexists with a
 * renderer of a newer scene.
 */
export const releaseRenderer = (
  surface: RendererSurface,
  renderer: WebGLRenderer,
  isAlpha: boolean,
  isReusable: boolean,
) => {
  const remaining = Math.max(0, (activeScenes.get(surface) ?? 1) - 1);
  if (remaining) activeScenes.set(surface, remaining);
  else activeScenes.delete(surface);
  if (!isReusable || remaining || renderer.context.isLost) {
    renderer.destroy({ removeView: true });
    return;
  }
  destroyParkedRenderer();
  const canvas = renderer.canvas as HTMLCanvasElement;
  canvas.remove();
  const listeners = new AbortController();
  canvas.addEventListener("webglcontextlost", destroyParkedRenderer, {
    signal: listeners.signal,
  });
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) destroyParkedRenderer();
    },
    { signal: listeners.signal },
  );
  parked = {
    surface,
    renderer,
    isAlpha,
    listeners,
    timer: setTimeout(destroyParkedRenderer, PARKED_RENDERER_MS),
  };
};

export const destroyParkedRenderer = () => {
  const entry = parked;
  if (!entry) return;
  detach(entry);
  try {
    entry.renderer.destroy({ removeView: true });
  } catch {
    // A renderer whose context is gone can fail teardown; nothing else holds it.
  }
};

const detach = (entry: ParkedRenderer) => {
  parked = null;
  clearTimeout(entry.timer);
  entry.listeners.abort();
};

type ParkedRenderer = {
  surface: RendererSurface;
  renderer: WebGLRenderer;
  isAlpha: boolean;
  listeners: AbortController;
  timer: ReturnType<typeof setTimeout>;
};
