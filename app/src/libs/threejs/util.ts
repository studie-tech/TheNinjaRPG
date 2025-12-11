import {
  TextureLoader,
  Texture,
  SRGBColorSpace,
  Scene,
  WebGLRenderer,
  Raycaster,
  Vector2,
  SpriteMaterial,
} from "three";
import type { RefObject } from "react";
import type {
  Vector3,
  OrthographicCamera,
  PerspectiveCamera,
  Material,
  BufferGeometry,
} from "three";

// Simple in-memory cache for textures to avoid re-fetching
let textureLoaderInstance: TextureLoader | null = null;

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
const pendingLoads = new Map<string, Promise<Texture>>();

/**
 * Load texture from file
 */
export const loadTexture = (path: string) => {
  // Return cached texture if available
  const cached = textureCache.get(path);
  if (cached) return cached;

  // Start load immediately and cache the Texture instance
  const texture = getTextureLoader().load(path);
  texture.colorSpace = SRGBColorSpace;
  textureCache.set(path, texture);
  return texture;
};

/**
 * Create a sprite material
 * @param texture - The texture to create a sprite material for
 * @returns The sprite material
 */
export const createSpriteMaterial = (map: Texture, alphaMap?: Texture) => {
  return new SpriteMaterial({
    map: map,
    alphaMap: alphaMap,
    alphaTest: 0.5,
  });
};

/**
 * Wraps a sprite material factory with a runtime fallback that instantiates a
 * `SpriteMaterial` directly when the provided factory is unavailable (e.g.
 * undefined import because of Turbopack module resolution issues).
 */
export const withSpriteMaterialFallback = (
  factory: ((map: Texture, alphaMap?: Texture) => SpriteMaterial) | undefined,
) => {
  let hasWarned = false;

  return (map: Texture, alphaMap?: Texture) => {
    if (typeof factory === "function") {
      return factory(map, alphaMap);
    }

    if (!hasWarned) {
      console.warn(
        "[threejs/util] createSpriteMaterial unavailable, using direct SpriteMaterial fallback",
      );
      hasWarned = true;
    }

    return new SpriteMaterial({
      map,
      alphaMap,
      alphaTest: 0.5,
    });
  };
};

/**
 * Preload a set of texture URLs into memory so they are instantly available.
 */
export const preloadTextures = async (paths: string[]) => {
  const uniquePaths = [...new Set(paths.filter((p) => Boolean(p)))];
  const results = await Promise.allSettled(
    uniquePaths.map((path) => {
      // Already cached → nothing to do
      if (textureCache.has(path)) return Promise.resolve(textureCache.get(path)!);
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

/**
 * Cleanup three.js scene and renderer, removing all objects, materials and geometries
 */
export const cleanUp = (scene: Scene, renderer: WebGLRenderer) => {
  scene.traverse(function (object) {
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
  camera: OrthographicCamera;
  controls: { target: Vector3; update: () => void };
  targetPosition: { x: number; y: number } | null;
  width: number;
  height: number;
  minZoom?: number;
  lerpFactor?: number;
}) => {
  const {
    camera,
    controls,
    targetPosition,
    width,
    height,
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
