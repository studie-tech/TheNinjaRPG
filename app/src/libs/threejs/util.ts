import type { RefObject } from "react";
import type {
  BufferGeometry,
  Group,
  Material,
  OrthographicCamera,
  PerspectiveCamera,
  Vector3,
  WebGLInfo,
} from "three";
import {
  LinearFilter,
  Raycaster,
  Scene,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector2,
  WebGLRenderer,
} from "three";

// Simple in-memory cache for textures to avoid re-fetching
let textureLoaderInstance: TextureLoader | null = null;

// Performance optimization: Cache status bar textures to avoid recreating canvases
// Key format: "width-height-color-stroke"
const statusBarTextureCache = new Map<string, Texture>();

/**
 * Transforms image URLs to use the CDN endpoint.
 * Replaces "utfs.io" or "ui0arpl8sm.ufs.sh" with "uploadthing.b-cdn.net"
 */
const transformImageUrl = (url: string, width: number): string => {
  const transformedUrl = url
    .replace(/utfs\.io/g, "uploadthing.b-cdn.net")
    .replace(/ui0arpl8sm\.ufs\.sh/g, "uploadthing.b-cdn.net");
  return `${transformedUrl}?width=${width}`;
};

/**
 * Lazily get a module-scoped TextureLoader instance.
 * Throws on SSR to avoid accessing window during server rendering.
 */
export const getTextureLoader = (): TextureLoader => {
  if (typeof window === "undefined") {
    throw new Error("TextureLoader is only available in the browser runtime");
  }
  if (textureLoaderInstance) return textureLoaderInstance;
  textureLoaderInstance = new TextureLoader();
  return textureLoaderInstance;
};
const textureCache = new Map<string, Texture>();
const materialCache = new Map<string, SpriteMaterial>();
const pendingLoads = new Map<string, Promise<Texture>>();

/**
 * Load texture from file
 */
export const loadTexture = (path: string, width = 50) => {
  // Guard against empty or invalid paths - callers should provide fallback URLs
  if (!path || path.trim() === "") {
    // Return a new empty texture to prevent crashes, but this shouldn't happen
    const fallback = new Texture();
    fallback.colorSpace = SRGBColorSpace;
    return fallback;
  }

  const transformedPath = transformImageUrl(path, width);

  // Return cached texture if available
  const cached = textureCache.get(transformedPath);
  if (cached) return cached;

  // Start load immediately and cache the Texture instance
  const texture = getTextureLoader().load(transformedPath);
  texture.colorSpace = SRGBColorSpace;
  textureCache.set(transformedPath, texture);
  return texture;
};

/**
 * Create a sprite material
 * PERFORMANCE OPTIMIZATION: Caches materials to allow ThreeJS to batch sprites.
 * @param texture - The texture to create a sprite material for
 * @returns The sprite material
 */
export const createSpriteMaterial = (
  map: Texture,
  alphaMap?: Texture,
  options: Partial<SpriteMaterial> = {},
) => {
  // Only cache if no alphaMap is provided for simplicity
  const cacheKey = `${map.uuid}-${alphaMap?.uuid ?? "none"}-${JSON.stringify(options)}`;
  const cached = materialCache.get(cacheKey);
  if (cached) return cached;

  const material = new SpriteMaterial({
    map: map,
    alphaMap: alphaMap ?? null,
    alphaTest: 0.5,
  });
  Object.assign(material, options);

  materialCache.set(cacheKey, material);
  return material;
};

/**
 * Dispose and clear all texture/material caches.
 * Call this when unmounting 3D scenes to prevent memory leaks.
 * IMPORTANT: Only call this when navigating away from the page or when WebGL context is lost.
 */
export const clearTextureCaches = () => {
  // Dispose all cached textures
  textureCache.forEach((texture) => {
    try {
      texture.dispose();
    } catch {
      // Ignore errors if texture already disposed
    }
  });
  textureCache.clear();

  // Dispose all cached materials
  materialCache.forEach((material) => {
    try {
      material.dispose();
    } catch {
      // Ignore errors if material already disposed
    }
  });
  materialCache.clear();

  // Dispose status bar textures
  statusBarTextureCache.forEach((texture) => {
    try {
      texture.dispose();
    } catch {
      // Ignore errors if texture already disposed
    }
  });
  statusBarTextureCache.clear();

  // Dispose shadow textures
  shadowTextureCache.forEach((texture) => {
    try {
      texture.dispose();
    } catch {
      // Ignore errors if texture already disposed
    }
  });
  shadowTextureCache.clear();

  // Dispose border textures
  borderTextureCache.forEach((entry) => {
    try {
      entry.texture.dispose();
    } catch {
      // Ignore errors if texture already disposed
    }
  });
  borderTextureCache.clear();

  // Clear pending loads
  pendingLoads.clear();
};

/**
 * Preload a set of texture URLs into memory so they are instantly available.
 */
export const preloadTextures = async (paths: string[]) => {
  const uniquePaths = [
    ...new Set(
      paths.filter((p) => Boolean(p)).map((path) => transformImageUrl(path, 50)),
    ),
  ];
  const results = await Promise.allSettled(
    uniquePaths.map((path) => {
      // Already cached → nothing to do
      const cached = textureCache.get(path);
      if (cached) return Promise.resolve(cached);
      // Already loading → reuse promise
      const existing = pendingLoads.get(path);
      if (existing) return existing;
      // Begin loading and cache both the Texture and the pending Promise
      const promise = new Promise<Texture>((resolve, reject) => {
        try {
          const tex = getTextureLoader().load(
            path,
            () => resolve(tex),
            undefined,
            () => reject(new Error(`Failed to load texture: ${path}`)),
          );
          tex.colorSpace = SRGBColorSpace;
          textureCache.set(path, tex);
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      })
        .catch((err) => {
          // Normalize to Error type to satisfy linters and callers
          throw err instanceof Error ? err : new Error(String(err));
        })
        .finally(() => pendingLoads.delete(path));

      pendingLoads.set(path, promise);
      return promise;
    }),
  );
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length) {
    // Non-blocking: surface in logs for diagnostics
    console.warn(`preloadTextures: ${failed.length} texture(s) failed`);
  }
};

/**
 * Create texture from canvas
 */
export const createTexture = (canvas: HTMLCanvasElement) => {
  const texture = new Texture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
};

// Performance optimization: Cache shadow textures
const shadowTextureCache = new Map<string, Texture>();

const createRadialGradient = (
  ctx: CanvasRenderingContext2D,
  centerX: number,
  radiusX: number,
  opacity: number,
) => {
  const gradient = ctx.createRadialGradient(
    centerX,
    centerX,
    0,
    centerX,
    centerX,
    radiusX,
  );

  gradient.addColorStop(0, `rgba(0, 0, 0, ${opacity})`);
  gradient.addColorStop(0.5, `rgba(0, 0, 0, ${opacity * 0.6})`);
  gradient.addColorStop(0.8, `rgba(0, 0, 0, ${opacity * 0.2})`);
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");

  return gradient;
};

const applyShadowGradient = (
  ctx: CanvasRenderingContext2D,
  width: number,
  radiusX: number,
  radiusY: number,
  gradient: CanvasGradient,
) => {
  ctx.save();
  ctx.scale(1, radiusY / radiusX);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, width);
  ctx.restore();
};

/**
 * Create a procedural shadow texture - an elongated blurred ellipse
 * PERFORMANCE OPTIMIZATION: Caches textures to avoid canvas redraws and re-uploads.
 * @param width - Canvas width (default 128)
 * @param height - Canvas height (default 64)
 * @param opacity - Maximum opacity at center (default 0.4)
 * @returns A texture with the procedural shadow
 */
export const createShadowTexture = (
  width = 128,
  height = 64,
  opacity = 0.4,
): Texture => {
  const cacheKey = `${width}-${height}-${opacity}`;
  const cached = shadowTextureCache.get(cacheKey);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  if (ctx) {
    const centerX = width / 2;
    const radiusX = width / 2;
    const radiusY = height / 2;

    const gradient = createRadialGradient(ctx, centerX, radiusX, opacity);
    applyShadowGradient(ctx, width, radiusX, radiusY, gradient);
  }

  const texture = new Texture(canvas);
  texture.needsUpdate = true;
  texture.colorSpace = SRGBColorSpace;
  shadowTextureCache.set(cacheKey, texture);
  return texture;
};

// Performance optimization: Cache border textures for avatar sprites
// LRU (Least Recently Used) cache to prevent unbounded memory growth
// Key format: "color-size"
const borderTextureCache = new Map<string, { texture: Texture; lastUsed: number }>();
const MAX_BORDER_CACHE_SIZE = 20; // Prevent unbounded growth

const drawCircularBorder = (borderColor: string, size: number): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");

  if (context) {
    context.clearRect(0, 0, size, size);
    const centerX = size / 2;
    const centerY = size / 2;
    const radius = size / 2 - 2;

    context.beginPath();
    context.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    context.fillStyle = borderColor;
    context.fill();
  }

  return canvas;
};

const createBorderTextureCanvas = (
  borderColor: string,
  size: number,
  cacheKey: string,
): Texture => {
  let texture: Texture;
  try {
    const canvas = drawCircularBorder(borderColor, size);

    texture = new Texture(canvas);
    texture.generateMipmaps = false;
    texture.minFilter = LinearFilter;
    texture.needsUpdate = true;
    texture.colorSpace = SRGBColorSpace;

    borderTextureCache.set(cacheKey, { texture, lastUsed: Date.now() });
  } catch (error) {
    console.warn(
      "Failed to create border texture, falling back to empty texture:",
      error,
    );
    texture = new Texture();
    texture.colorSpace = SRGBColorSpace;
  }

  return texture;
};

/**
 * Create a procedural border texture - a solid circular border.
 * PERFORMANCE OPTIMIZATION: Caches textures to avoid canvas redraws and re-uploads.
 * Uses LRU (Least Recently Used) eviction based on timestamps to prevent disposing
 * recently used textures and to keep cache size bounded.
 * @param borderColor - CSS color string for the border (e.g., "white", "red", "#FF0000")
 * @param size - Canvas size in pixels (default 64)
 * @returns A texture with the procedural border
 */
export const createBorderTexture = (borderColor: string, size = 64): Texture => {
  const cacheKey = `${borderColor}-${size}`;
  const cached = borderTextureCache.get(cacheKey);
  if (cached) {
    // Update last used timestamp for LRU
    cached.lastUsed = Date.now();
    return cached.texture;
  }

  // Implement cache size limit with LRU eviction
  if (borderTextureCache.size >= MAX_BORDER_CACHE_SIZE) {
    // Find the least recently used entry
    let lruKey: string | undefined;
    let lruTimestamp = Infinity;
    for (const [key, value] of borderTextureCache.entries()) {
      if (value.lastUsed < lruTimestamp) {
        lruTimestamp = value.lastUsed;
        lruKey = key;
      }
    }

    if (lruKey) {
      const lruTexture = borderTextureCache.get(lruKey);
      if (lruTexture) {
        try {
          lruTexture.texture.dispose();
        } catch {
          // Ignore disposal errors
        }
      }
      borderTextureCache.delete(lruKey);
    }
  }

  const texture = createBorderTextureCanvas(borderColor, size, cacheKey);
  return texture;
};

const renderStatusBarCanvas = (
  canvasWidth: number,
  canvasHeight: number,
  color: string,
  stroke: boolean,
): Texture => {
  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = color;
    const lineWidth = Math.max(1, Math.min(4, canvasHeight / 6));
    context.lineWidth = lineWidth;
    context.strokeStyle = "black";
    if (stroke) {
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.strokeRect(0, 0, canvas.width, canvas.height);
    } else {
      const padding = lineWidth / 2;
      context.fillRect(
        padding,
        padding,
        canvas.width - 2 * padding,
        canvas.height - 2 * padding,
      );
    }
  }
  const texture = createTexture(canvas);
  texture.generateMipmaps = false;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
};

/**
 * Draw a status bar on user
 * Performance optimization: Uses texture cache to avoid recreating canvases
 */
export const drawStatusBar = (info: {
  width: number;
  height: number;
  yPosition: number;
  color: string;
  stroke: boolean;
  name: string;
  yOffset: number;
  layer: number;
}) => {
  const { width, height, yPosition, color, stroke, name, yOffset, layer } = info;
  const r = 3;
  const L = width / 2;
  const canvasWidth = r * L;
  const canvasHeight = (r * height) / 10;

  const cacheKey = `${canvasWidth}-${canvasHeight}-${color}-${stroke}`;

  let texture = statusBarTextureCache.get(cacheKey);

  if (!texture) {
    texture = renderStatusBarCanvas(canvasWidth, canvasHeight, color, stroke);
    statusBarTextureCache.set(cacheKey, texture);
  }

  const bar_material = createSpriteMaterial(texture);
  const bar_sprite = new Sprite(bar_material);
  bar_sprite.position.set(L, yPosition - (yOffset * (canvasHeight - 2)) / r, layer);
  bar_sprite.scale.set(L, canvasHeight / r, 1);
  bar_sprite.name = name;
  bar_sprite.userData.full_width = L;
  bar_sprite.userData.originalX = L; // Store original local X
  bar_sprite.userData.yPosition = yPosition - (yOffset * (canvasHeight - 2)) / r;
  bar_sprite.userData.scaleY = canvasHeight / r;
  bar_sprite.userData.layer = layer;
  bar_sprite.userData.previousValue = undefined; // Track previous value for change detection
  bar_sprite.visible = false;
  return bar_sprite;
};

/**
 * Update status bar of a user sprite
 * Performance optimization: Only updates if value changed (dirty flag system)
 */
export const updateStatusBar = (name: string, userSpriteGroup: Group, perc: number) => {
  const bar = userSpriteGroup.getObjectByName(name);
  if (bar) {
    // Check if value actually changed (dirty flag optimization)
    const previousValue = bar.userData.previousValue as number | undefined;
    if (previousValue !== undefined && Math.abs(previousValue - perc) < 0.001) {
      // Value hasn't changed significantly, skip update
      return;
    }
    // Store current value for next frame comparison
    bar.userData.previousValue = perc;
    // Perform the actual update
    const width = bar.userData.full_width as number;
    const originalX = bar.userData.originalX as number;
    const newWidth = width * perc;
    const newPosition = originalX - (width * (1 - perc)) / 2;
    bar.scale.set(newWidth, bar.scale.y, 1);
    bar.position.set(newPosition, bar.position.y, bar.position.z);
    if (perc === 0) {
      bar.visible = false;
    }
  }
};

import type { GameAsset } from "@/drizzle/schema";
import type { SpriteMixer } from "@/libs/threejs/SpriteMixer";

/**
 * Show animation on the hex
 */
export const showAnimation = (info: {
  gameAsset: GameAsset;
  spriteMixer: SpriteMixer;
  playInfinite?: boolean;
  scale: number;
  position: { x: number; y: number };
  layer: number;
}) => {
  const { gameAsset, spriteMixer, playInfinite, scale, position, layer } = info;
  const texture = loadTexture(gameAsset.image);
  const actionSprite = spriteMixer.createActionSprite(texture, 1, gameAsset.frames);
  const action = spriteMixer.createAction(
    actionSprite,
    0,
    gameAsset.frames - 1,
    gameAsset.speed,
  );
  if (action) {
    action.hideWhenFinished = true;
    if (playInfinite) {
      action.playLoop();
    } else {
      action.playOnce();
      // Auto-cleanup when finished
      const onFinished = (e: { action: unknown }) => {
        if (e.action === action) {
          spriteMixer.removeEventListener("finished", onFinished);
          if (actionSprite.parent) {
            actionSprite.parent.remove(actionSprite);
          }
          spriteMixer.removeActionSprite(actionSprite);
          // Clean up texture/material
          if (actionSprite.material) {
            if (actionSprite.material.map) actionSprite.material.map.dispose();
            actionSprite.material.dispose();
          }
        }
      };
      spriteMixer.addEventListener("finished", onFinished);
    }
  }
  actionSprite.scale.set(scale, scale, 1);
  actionSprite.position.set(position.x, position.y, layer);
  return actionSprite;
};

/**
 * Cleanup three.js scene and renderer, removing all objects, materials and geometries
 */
export const cleanUp = (scene: Scene, renderer: WebGLRenderer) => {
  scene.traverse((object) => {
    if ("isMesh" in object || "isSprite" in object || "isLine" in object) {
      if ("material" in object) (object.material as Material).dispose();
      if ("geometry" in object) (object.geometry as BufferGeometry).dispose();
    }
  });
  renderer.dispose();
};

/**
 * Scene setup
 */
export const setupScene = (info: {
  mountRef: RefObject<HTMLDivElement | null>;
  width: number;
  height: number;
  sortObjects: boolean;
  color: number;
  colorAlpha: number;
  width2height: number;
}) => {
  const scene = new Scene();
  const raycaster = new Raycaster();
  let renderer: WebGLRenderer | undefined;
  try {
    renderer = new WebGLRenderer();

    // EDGE CASE DEFENSE: Validate the context is actually functional
    // On iOS Safari, the renderer can be created successfully but have an invalid context
    if (!isRendererContextValid(renderer)) {
      console.error("WebGLRenderer created but context is not functional");
      renderer.dispose();
      renderer = undefined;
    }
  } catch (error) {
    console.error("Error creating WebGLRenderer, falling back to WebGL1Renderer");
    console.error(error);
  }

  if (renderer) {
    renderer.setSize(info.width, info.height);
    renderer.setClearColor(info.color, info.colorAlpha);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = false;
    renderer.sortObjects = info.sortObjects;
  }

  // Window size listener
  function handleResize() {
    if (info.mountRef.current) {
      const width = info.mountRef.current.getBoundingClientRect().width;
      const height = width * info.width2height;
      renderer?.setSize(width, height);
    }
  }
  window.addEventListener("resize", handleResize);

  // Return info
  return { scene, renderer, raycaster, handleResize };
};

/**
 *
 * @param raycaster - The raycaster to set the from camera
 * @param sceneRef - The scene reference
 * @param event - The mouse event
 * @param camera - The camera to set the from camera
 */
export const setRaycasterFromMouse = (
  raycaster: Raycaster,
  sceneRef: HTMLDivElement,
  event: MouseEvent,
  camera: OrthographicCamera | PerspectiveCamera,
) => {
  const pointer = new Vector2();
  const width = sceneRef.getBoundingClientRect().width;
  const height = sceneRef.getBoundingClientRect().height;
  pointer.x = (event.offsetX / width) * 2 - 1;
  pointer.y = -(event.offsetY / height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
};

/**
 * Performance profiler for benchmarking code segments.
 * Provides detailed timing, frame budget analysis, and renderer stats.
 * Only active in development mode.
 */
export const profiler = {
  enabled: process.env.NODE_ENV === "development",
  data: new Map<string, { total: number; count: number; max: number; min: number }>(),
  counts: new Map<string, number>(),
  lastLog: typeof performance !== "undefined" ? performance.now() : 0,

  // Frame time tracking
  frameTimes: [] as number[],
  lastFrameTime: typeof performance !== "undefined" ? performance.now() : 0,
  frameCount: 0,

  // Renderer stats (set externally from WebGLRenderer.info)
  rendererInfo: null as WebGLInfo | null,

  mark: function (name: string) {
    if (!this.enabled) return () => {};
    const start = performance.now();
    return () => {
      const duration = performance.now() - start;
      const entry = this.data.get(name) || {
        total: 0,
        count: 0,
        max: 0,
        min: Infinity,
      };
      entry.total += duration;
      entry.count += 1;
      entry.max = Math.max(entry.max, duration);
      entry.min = Math.min(entry.min, duration);
      this.data.set(name, entry);
    };
  },

  /**
   * Track frame time for FPS analysis.
   * Call this at the start of each frame.
   */
  beginFrame: function () {
    if (!this.enabled) return;
    const now = performance.now();
    if (this.lastFrameTime > 0) {
      const frameTime = now - this.lastFrameTime;
      // PERFORMANCE: Ignore massive deltas (tab inactive or initial load) to keep stats accurate
      if (frameTime < 1000) {
        this.frameTimes.push(frameTime);
        // Keep last 120 frames for rolling average
        if (this.frameTimes.length > 120) {
          this.frameTimes.shift();
        }
      }
    }
    this.lastFrameTime = now;
    this.frameCount++;
  },

  /**
   * Set renderer info for GPU stats tracking.
   * Call this with renderer.info after render.
   */
  setRendererInfo: function (info: WebGLInfo) {
    if (!this.enabled) return;
    this.rendererInfo = info;
  },

  /**
   * Report the number of objects/draw calls for a specific category.
   * This is reset every log interval.
   */
  reportCount: function (name: string, count: number) {
    if (!this.enabled) return;
    this.counts.set(name, count);
  },

  log: function (intervalMs = 5000) {
    if (!this.enabled) return;
    const now = performance.now();
    if (now - this.lastLog > intervalMs) {
      if (this.data.size > 0 || this.counts.size > 0 || this.frameTimes.length > 0) {
        console.group(
          `🎮 Performance Profile (last ${(intervalMs / 1000).toFixed(1)}s)`,
        );

        // Frame time analysis
        if (this.frameTimes.length > 0) {
          const avgFrameTime =
            this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
          const maxFrameTime = Math.max(...this.frameTimes);
          const minFrameTime = Math.min(...this.frameTimes);
          const fps = 1000 / avgFrameTime;
          const framesBudgetExceeded = this.frameTimes.filter((t) => t > 16.67).length;
          const percentOverBudget =
            (framesBudgetExceeded / this.frameTimes.length) * 100;

          console.log(
            `📊 FPS: ${fps.toFixed(1)} | Frame Time: ${avgFrameTime.toFixed(2)}ms avg, ${minFrameTime.toFixed(2)}ms min, ${maxFrameTime.toFixed(2)}ms max`,
          );
          console.log(
            `⏱️ Budget (16.67ms): ${percentOverBudget.toFixed(1)}% frames over budget (${framesBudgetExceeded}/${this.frameTimes.length})`,
          );
        }

        // Renderer stats
        if (this.rendererInfo) {
          const { render, memory } = this.rendererInfo;
          console.log(
            `🖼️ Render: ${render.calls} calls, ${render.triangles} tris | Memory: ${memory.geometries} geom, ${memory.textures} tex`,
          );
        }

        // Timing breakdown with percentage of frame budget
        if (this.data.size > 0) {
          const avgFrameTime =
            this.frameTimes.length > 0
              ? this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length
              : 16.67;

          const timings = Array.from(this.data.entries())
            .map(([key, value]) => {
              const avgMs = value.total / value.count;
              const budgetPercent = (avgMs / avgFrameTime) * 100;
              return {
                Name: key,
                "Avg (ms)": avgMs.toFixed(3),
                "Min (ms)": value.min.toFixed(3),
                "Max (ms)": value.max.toFixed(3),
                "% Budget": `${budgetPercent.toFixed(1)}%`,
                Calls: value.count,
              };
            })
            .sort((a, b) => parseFloat(b["Avg (ms)"]) - parseFloat(a["Avg (ms)"]));

          console.log("⏰ Timing Breakdown (sorted by avg time):");
          console.table(timings);
          this.data.clear();
        }

        // Object/draw call counts
        if (this.counts.size > 0) {
          console.log("📦 Object/Draw Call Counts:");
          console.table(
            Array.from(this.counts.entries()).map(([key, value]) => ({
              Metric: key,
              Value: value,
            })),
          );
          this.counts.clear();
        }

        console.groupEnd();
      }
      this.lastLog = now;
      this.frameCount = 0;
    }
  },

  /**
   * Reset all profiler data (call on scene cleanup).
   */
  reset: function () {
    this.data.clear();
    this.counts.clear();
    this.frameTimes = [];
    this.lastFrameTime = 0;
    this.frameCount = 0;
    this.rendererInfo = null;
  },
};

/**
 * Setup WebGL context loss handling for a renderer.
 * Tracks context loss/restore to prevent shader errors on iOS mobile browsers.
 * @param renderer - The WebGLRenderer to setup context handling for
 * @param options - Optional configuration
 * @param options.clearCaches - Whether to clear texture caches when context is lost (default: false)
 * @returns Object with isContextLost getter and cleanup function
 */
export const setupContextLossHandling = (
  renderer: WebGLRenderer,
  options?: { clearCaches?: boolean },
) => {
  let isContextLost = false;

  const handleContextLost = (event: Event) => {
    event.preventDefault();
    isContextLost = true;

    if (options?.clearCaches) {
      clearTextureCaches();
    }
  };

  const handleContextRestored = () => {
    isContextLost = false;
  };

  renderer.domElement.addEventListener("webglcontextlost", handleContextLost);
  renderer.domElement.addEventListener("webglcontextrestored", handleContextRestored);

  return {
    isContextLost: () => isContextLost,
    cleanup: () => {
      try {
        renderer.domElement.removeEventListener("webglcontextlost", handleContextLost);
        renderer.domElement.removeEventListener(
          "webglcontextrestored",
          handleContextRestored,
        );
      } catch {
        // Ignore errors if elements are already removed
      }
    },
  };
};

/**
 * Check if a WebGL rendering context is valid and functional.
 * This goes beyond just checking if the context exists - it validates
 * that the context can actually perform WebGL operations without errors.
 *
 * EDGE CASES COVERED:
 * - Context exists but is in "lost" state (isContextLost() === true)
 * - Context exists but gl methods return null (iOS Safari edge case)
 * - Context exists but shader creation fails (memory pressure)
 * - Canvas element has been detached from DOM
 *
 * @param gl - The WebGL rendering context to validate
 * @returns true if context is valid and functional, false otherwise
 */
export const isWebGLContextValid = (
  gl: WebGLRenderingContext | WebGL2RenderingContext | null,
): boolean => {
  if (!gl) return false;

  // Check if context is marked as lost
  if (gl.isContextLost?.()) {
    return false;
  }

  // Check if the canvas is still connected to the DOM
  // Note: OffscreenCanvas doesn't have isConnected, only HTMLCanvasElement does
  if (!gl.canvas) {
    return false;
  }
  if ("isConnected" in gl.canvas && !gl.canvas.isConnected) {
    return false;
  }

  // Try to create a test shader to verify the context is functional
  // This catches the iOS Safari edge case where context exists but shader creation returns null
  try {
    const testShader = gl.createShader(gl.VERTEX_SHADER);
    if (!testShader) {
      // Context exists but can't create shaders - this is the bug we're fixing!
      return false;
    }
    // Clean up test shader immediately
    gl.deleteShader(testShader);
    return true;
  } catch {
    // Any error during shader creation means context is not functional
    return false;
  }
};

/**
 * Check if a WebGLRenderer has a valid and functional context.
 * Convenience wrapper around isWebGLContextValid for Three.js renderers.
 *
 * @param renderer - The WebGLRenderer to check
 * @returns true if renderer has a valid context, false otherwise
 */
export const isRendererContextValid = (
  renderer: WebGLRenderer | undefined,
): boolean => {
  if (!renderer) return false;
  try {
    const gl = renderer.getContext();
    return isWebGLContextValid(gl);
  } catch {
    // getContext() can throw if renderer is disposed or in invalid state
    return false;
  }
};

/**
 * Safely removes a Three.js renderer's DOM element from the scene container.
 * Defense-in-depth against TOCTOU race condition during React reconciliation
 * when rapid movements trigger multiple cleanup cycles.
 * @param renderer - The WebGLRenderer whose DOM element should be removed
 * @param sceneRef - The parent DOM element containing the renderer
 */
export const safeRemoveRendererElement = (
  renderer: WebGLRenderer,
  sceneRef: HTMLDivElement,
) => {
  try {
    if (
      renderer.domElement &&
      renderer.domElement.parentNode === sceneRef &&
      sceneRef.contains(renderer.domElement)
    ) {
      sceneRef.removeChild(renderer.domElement);
    }
  } catch {
    // Ignore errors if element is already removed by React reconciliation
  }
};

/**
 * Smoothly moves camera to follow a target position using linear interpolation
 * @param params Configuration object for camera following
 * @param params.camera The orthographic camera to move
 * @param params.controls The orbit controls managing the camera
 * @param params.targetPosition The target position to follow (world coordinates)
 * @param params.width Width of the viewport
 * @param params.height Height of the viewport
 * @param params.minZoom Minimum zoom level required for camera following (default: 1.5)
 * @param params.lerpFactor Interpolation factor for smooth following (default: 0.1)
 */
export const smoothCameraFollow = (params: {
  // Camera configuration
  camera: OrthographicCamera;
  controls: { target: Vector3; update: () => void };
  targetPosition: { x: number; y: number } | null;
  // Viewport dimensions
  width: number;
  height: number;
  // Behavior configuration
  minZoom?: number;
  lerpFactor?: number;
}) => {
  const {
    // Camera configuration
    camera,
    controls,
    targetPosition,
    // Viewport dimensions
    width,
    height,
    // Behavior configuration
    minZoom = 1.5,
    lerpFactor = 0.1,
  } = params;

  // Only follow if target position exists and zoom is sufficient
  if (!targetPosition || camera.zoom <= minZoom) {
    return;
  }

  const { x, y } = targetPosition;
  const targetX = -width / 2 - x;
  const targetY = -height / 2 - y;

  // Smooth interpolation (lerp) for smooth camera following
  controls.target.x += (targetX - controls.target.x) * lerpFactor;
  controls.target.y += (targetY - controls.target.y) * lerpFactor;
  camera.position.copy(controls.target);
};
