import type { WebGLRenderer } from "pixi.js";
import type { RendererSurface } from "@/libs/rendering/telemetry";

/** How long a released renderer waits for the next scene of its surface. */
const PARKED_RENDERER_MS = 30_000;

let parked: ParkedRenderer | null = null;

/**
 * Keeps a released scene renderer detached from the page for a short while, so the next
 * scene of the same surface (the next battle after a result screen) reuses its WebGL
 * context with its linked shader programs and the uploaded textures that are still cached,
 * instead of creating, compiling and uploading them again. At most one renderer waits; it
 * is destroyed after PARKED_RENDERER_MS, when the page is hidden, when its context is lost
 * and when a scene of another surface or context type starts. `isAlpha` is the context's
 * immutable transparent-backbuffer attribute.
 */
export const parkRenderer = (
  surface: RendererSurface,
  renderer: WebGLRenderer,
  isAlpha: boolean,
) => {
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

/** Hands over the parked renderer when it suits this scene; any other parked renderer goes. */
export const takeParkedRenderer = (surface: RendererSurface, isAlpha: boolean) => {
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
  release(entry);
  return entry.renderer;
};

export const destroyParkedRenderer = () => {
  const entry = parked;
  if (!entry) return;
  release(entry);
  try {
    entry.renderer.destroy({ removeView: true });
  } catch {
    // A renderer whose context is gone can fail teardown; nothing else holds it.
  }
};

const release = (entry: ParkedRenderer) => {
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
