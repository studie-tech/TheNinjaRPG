import { BufferImageSource, Rectangle, Texture } from "pixi.js";
import {
  createSceneAssets,
  readTextureFramePixels,
  readTexturePixels,
} from "@/libs/rendering/assets";
import { createLeaseCache } from "@/libs/rendering/leaseCache";
import {
  hasWorldSurfaceFrames,
  type WorldAssetSource,
  worldAssetSource,
  worldSurfaceFrameUrl,
} from "@/libs/rendering/worldAssetSources";
import { WORLD_DETAIL } from "@/libs/rendering/worldDetail";
import type { WorldShadowShape } from "@/libs/rendering/worldShadows";
import { transformImageUrl } from "@/utils/image";

const loaded = new Map<string, WorldMaterial>();
const materials = createLeaseCache<WorldMaterial>({
  load: async (key) => {
    const {
      image,
      shape,
      rendition = 128,
      source,
    } = JSON.parse(key) as {
      image: string;
      shape: WorldShadowShape;
      rendition?: number;
      source?: Pick<WorldAssetSource, "material" | "surfaces"> & { framed?: true };
    };
    const assets = createSceneAssets();
    try {
      const [albedo, material, surfaces] = await Promise.all([
        assets.texture(image, source ? 0 : rendition, "nearest"),
        source
          ? assets.texture(source.material, 0, "nearest").catch((error: unknown) => {
              console.warn(
                "Authored material unavailable; using a physical fallback",
                error,
              );
              return null;
            })
          : null,
        // Per-frame topology arrives with each caster (acquireWorldSurfaceFrame).
        source?.framed
          ? { frames: [], bytes: 0 }
          : source
            ? readAuthoredSurfaces(source.surfaces)
            : null,
      ]);
      const width = albedo.source.pixelWidth,
        height = albedo.source.pixelHeight;
      const hasAuthoredMaterial =
        material !== null &&
        surfaces !== null &&
        material.source.pixelWidth === width &&
        material.source.pixelHeight === height;
      if (
        material &&
        (material.source.pixelWidth !== width || material.source.pixelHeight !== height)
      )
        console.warn(
          "Authored material dimensions do not match world artwork; using a physical fallback",
        );
      const coverage = readTexturePixels(albedo, width, height);
      const pixels =
        material && hasAuthoredMaterial
          ? readTexturePixels(material, width, height)
          : new Uint8Array(width * height * 4);
      const fallbackNormal = encodeWorldNormal(0, -1, 0);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const index = (y * width + x) * 4;
          if (!hasAuthoredMaterial) {
            // Unknown artwork shares one upright billboard plane; albedo supplies its cutout.
            pixels[index] = (Math.round(fallbackNormal[0] * 31) << 3) | 1;
            pixels[index + 1] = Math.round(fallbackNormal[1] * 255);
            pixels[index + 2] = Math.round((1 - (y + 0.5) / height) * 255);
          }
          pixels[index + 3] = coverage[index + 3] ?? 0;
        }
      const texture = new Texture({
        source: new BufferImageSource({
          resource: pixels,
          width,
          height,
          format: "rgba8unorm",
          alphaMode: "no-premultiply-alpha",
          scaleMode: "nearest",
        }),
      });
      const result = {
        texture,
        pixels,
        width,
        height,
        shape,
        isBillboard: !hasAuthoredMaterial,
        surfaceFrames: hasAuthoredMaterial ? surfaces.frames : undefined,
        surfaceBytes: hasAuthoredMaterial ? surfaces.bytes : 0,
        frames: new Map<string, MaterialFrame>(),
      };
      loaded.set(key, result);
      return result;
    } finally {
      assets.dispose();
    }
  },
  unload: async (key) => {
    loaded.get(key)?.texture.destroy(true);
    loaded.delete(key);
  },
  bytes: ({ width, height, surfaceBytes = 0 }) => width * height * 8 + surfaceBytes,
  idleBudget: 8 * 1024 * 1024,
});

/**
 * Pixel-aligned atlases pack R=(octNormalX5<<3)|surface2|emission4, G=octNormalY8,
 * B=height/frameHeight8. Authored PNGs are opaque; albedo supplies cutout coverage.
 * Surface classes are ground=0 (zero source height), solid=1, canopy=2 and roof=3.
 * Terrain receivers encode their own elevation directly. RGB is never premultiplied.
 */
export const acquireWorldMaterial = (
  image: string,
  shape: WorldShadowShape,
  rendition = 128,
  materialSource?: Pick<WorldAssetSource, "material" | "surfaces">,
) => {
  const published = materialSource ?? worldAssetSource(image);
  const source = published
    ? {
        material: published.material,
        surfaces: published.surfaces,
        // Catalogue atlases resolve per-frame topology by image; persisted sources load whole.
        ...(!materialSource && hasWorldSurfaceFrames(published.surfaces)
          ? { framed: true as const }
          : {}),
      }
    : undefined;
  return materials.acquire(
    JSON.stringify({ image, shape: source ? "column" : shape, rendition, source }),
  );
};

const surfaceFiles = createLeaseCache<AuthoredSurfaces | null>({
  load: (url) => readAuthoredSurfaces(url),
  unload: async () => {},
  bytes: (surfaces) => surfaces?.bytes ?? 0,
  idleBudget: 4 * 1024 * 1024,
});

/**
 * Leases the authored topology of one published atlas frame, which downloads alongside its
 * material; installAuthoredFrames hands it to the material once both arrive. Undefined
 * when the artwork publishes no per-frame topology (its material then loads the whole atlas).
 */
export const acquireWorldSurfaceFrame = (
  image: string,
  frame?: { x: number; y: number; width: number; height: number },
  /** A loaded texture's frame, measured in the atlas pixels its material samples. */
  texture?: Texture,
) => {
  const published = worldAssetSource(image);
  if (!published || !hasWorldSurfaceFrames(published.surfaces)) return undefined;
  const scaleX = texture ? published.width / texture.source.pixelWidth : 1,
    scaleY = texture ? published.height / texture.source.pixelHeight : 1;
  const area = texture?.frame ?? frame;
  const rect = area
    ? [area.x * scaleX, area.y * scaleY, area.width * scaleX, area.height * scaleY]
    : [0, 0, published.width, published.height];
  const url = worldSurfaceFrameUrl(published.surfaces, rect);
  return url ? surfaceFiles.acquire(url) : undefined;
};

/** Adds frame topology to an authored material before any of its frames are built. */
export const installAuthoredFrames = (
  material: WorldMaterial,
  surfaces: AuthoredSurfaces | null,
) => {
  const installed = material.surfaceFrames;
  if (!installed || !surfaces) return;
  for (const frame of surfaces.frames)
    if (
      !installed.some((entry) =>
        entry.frame.every((value, i) => value === frame.frame[i]),
      )
    )
      installed.push(frame);
};

const characterMaterials = new Map<string, WorldMaterial>();
/** Decoded cells prepare synchronously so albedo and lighting use the same pose on its first frame. */
const createCharacterFrameMaterial = (source: Texture): WorldMaterial => {
  // Physical shadows need silhouette coverage, not the full albedo resolution.
  // A 64px cell keeps sub-gameplay detail while bounding dynamic geometry and readback.
  const scale = Math.min(1, 64 / Math.max(source.frame.width, source.frame.height));
  const width = Math.max(1, Math.round(source.frame.width * scale)),
    height = Math.max(1, Math.round(source.frame.height * scale));
  const pixels = readTextureFramePixels(source, 64);
  const normal = encodeWorldNormal(0, -1, 0);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      pixels[offset] = (Math.round(normal[0] * 31) << 3) | 1;
      pixels[offset + 1] = Math.round(normal[1] * 255);
      pixels[offset + 2] = Math.round((1 - (y + 0.5) / height) * 255);
    }
  const material: WorldMaterial = {
    texture: new Texture({
      source: new BufferImageSource({
        resource: pixels,
        width,
        height,
        format: "rgba8unorm",
        alphaMode: "no-premultiply-alpha",
        scaleMode: "nearest",
      }),
    }),
    pixels,
    width,
    height,
    shape: "character",
    isBillboard: true,
    frames: new Map(),
  };
  return material;
};
const characterMaterialCache = createLeaseCache<WorldMaterial>({
  // Acquiring a cell prepares its CPU data before the ownership cache starts loading it.
  load: async (key) => characterMaterials.get(key)!,
  unload: async (key) => {
    characterMaterials.get(key)?.texture.destroy(true);
    characterMaterials.delete(key);
  },
  bytes: ({ width, height }) => width * height * 8,
  idleBudget: 8 * 1024 * 1024,
  idleLimit: 64,
});

/** Live atlas cells cast their own silhouette without another image request or atlas-sized material. */
export const acquireCharacterFrameMaterial = (texture: Texture) => {
  const frame = texture.frame;
  const key = `${texture.source.uid}:${frame.x}:${frame.y}:${frame.width}:${frame.height}`;
  let material = characterMaterials.get(key);
  if (!material) {
    material = createCharacterFrameMaterial(texture);
    characterMaterials.set(key, material);
  }
  return {
    ...characterMaterialCache.acquire(key),
    material,
  };
};

/** Keep a fighter's GPU material binding stable as its cached cell coverage changes. */
export const updateCharacterFrameMaterial = (
  source: WorldMaterial,
  current?: WorldMaterial,
) => {
  if (current && current.width === source.width && current.height === source.height) {
    current.pixels.set(source.pixels);
    current.frames.clear();
    current.texture.source.update();
    return current;
  }
  const pixels = source.pixels.slice();
  return {
    ...source,
    pixels,
    frames: new Map<string, MaterialFrame>(),
    texture: new Texture({
      source: new BufferImageSource({
        resource: pixels,
        width: source.width,
        height: source.height,
        format: "rgba8unorm",
        alphaMode: "no-premultiply-alpha",
        scaleMode: "nearest",
      }),
    }),
  };
};

/** Shared frame samples retain source UVs and authored heights across animation and mirrored poses. */
export const worldMaterialFrame = (
  material: WorldMaterial,
  frame: Texture["frame"],
) => {
  const key = `${frame.x}:${frame.y}:${frame.width}:${frame.height}`;
  const cached = material.frames.get(key);
  if (cached) return cached;
  const points: number[] = [],
    vertices: number[] = [],
    indices: number[] = [];
  const sample = (x: number, y: number) => sampleMaterial(material, frame, x, y);
  const definition = material.surfaceFrames?.find(
    ({ frame: rect }) =>
      rect[0] === frame.x &&
      rect[1] === frame.y &&
      rect[2] === frame.width &&
      rect[3] === frame.height,
  );
  const volumes = definition
    ? appendAuthoredGeometry(
        definition,
        material,
        frame,
        vertices,
        indices,
        definition.thinBacking === true,
      )
    : undefined;
  // Custom artwork and custom atlas crops have no authored topology; a bounded grid preserves their cutout.
  if (!definition) {
    let step = 2;
    while (
      (Math.ceil(frame.width / step) + 1) * (Math.ceil(frame.height / step) + 1) >
      65535
    )
      step++;
    const columns = Math.ceil(frame.width / step),
      rows = Math.ceil(frame.height / step);
    for (let row = 0; row <= rows; row++)
      for (let col = 0; col <= columns; col++) {
        const x = Math.min(frame.width, col * step),
          y = Math.min(frame.height, row * step);
        let value = sample(Math.min(frame.width - 1, x), Math.min(frame.height - 1, y));
        // Extend surface height under the cutout fringe; transparent padding must not pull silhouette vertices down to ground.
        if (!material.isBillboard && value.a < 128) {
          outer: for (let radius = 1; radius <= 3; radius++)
            for (let dy = -radius; dy <= radius; dy++)
              for (let dx = -radius; dx <= radius; dx++) {
                const candidate = sample(
                  Math.max(0, Math.min(frame.width - 1, x + dx)),
                  Math.max(0, Math.min(frame.height - 1, y + dy)),
                );
                if (candidate.a >= 128) {
                  value = { ...candidate, a: 0 };
                  break outer;
                }
              }
        }
        vertices.push(
          x / frame.width,
          y / frame.height,
          material.isBillboard ? 1 - y / frame.height : value.h,
          (frame.x + x) / material.width,
          (frame.y + y) / material.height,
          1,
        );
        if (col < columns && row < rows) {
          const i = row * (columns + 1) + col;
          indices.push(i, i + 1, i + columns + 2, i, i + columns + 2, i + columns + 1);
        }
      }
  }
  // Each source cell retains an actual covered texel, including one-pixel posts between mesh vertices.
  if (!definition)
    for (let y = 0; y < frame.height; y += 2)
      for (let x = 0; x < frame.width; x += 2) {
        let found = false;
        for (let dy = 0; dy < 2 && !found; dy++)
          for (let dx = 0; dx < 2; dx++) {
            const u = Math.min(frame.width - 1, x + dx),
              v = Math.min(frame.height - 1, y + dy),
              value = sample(u, v);
            if (value.a >= 128) {
              const centerX = material.isBillboard
                ? Math.floor(frame.x + u) + 0.5 - frame.x
                : u;
              const centerY = material.isBillboard
                ? Math.floor(frame.y + v) + 0.5 - frame.y
                : v;
              points.push(
                centerX / frame.width,
                centerY / frame.height,
                value.h,
                value.r & 3,
              );
              found = true;
              break;
            }
          }
      }
  const emitters: { x: number; y: number; height: number }[] = [];
  // Bound light count by frame area; choose a luminous texel near each group's center
  // so separated windows cannot place a light on the wall between them.
  const cells = new Map<string, { x: number; y: number; samples: typeof emitters }>();
  for (let y = 0; y < frame.height; y++)
    for (let x = 0; x < frame.width; x++) {
      const value = sample(x, y);
      if (value.a < 128 || !(value.r & 4)) continue;
      const key = `${Math.floor(x / (frame.width / 5))}:${Math.floor(y / (frame.height / 5))}`;
      const cell = cells.get(key) ?? { x: 0, y: 0, samples: [] };
      const u = (Math.floor(frame.x + x) + 0.5 - frame.x) / frame.width;
      const v = (Math.floor(frame.y + y) + 0.5 - frame.y) / frame.height;
      cell.x += u;
      cell.y += v;
      cell.samples.push({ x: u, y: v, height: value.h });
      cells.set(key, cell);
    }
  for (const cell of cells.values()) {
    const count = cell.samples.length;
    let nearest = cell.samples[0];
    if (count < 3 || !nearest) continue;
    let distance = Infinity;
    for (const point of cell.samples) {
      const next = (point.x - cell.x / count) ** 2 + (point.y - cell.y / count) ** 2;
      if (next < distance) {
        nearest = point;
        distance = next;
      }
    }
    emitters.push(nearest);
  }
  const result = {
    vertices: new Float32Array(vertices),
    indices: new Uint16Array(indices),
    points: new Float32Array(points),
    emitters,
    volumes,
  };
  material.frames.set(key, result);
  return result;
};

/** Highest vertex count a frame's 16-bit index buffer can address. */
const MAX_FRAME_VERTICES = 65535;
/** Points on one silhouette span's half-round footprint. */
const CHARACTER_VOLUME_RING = 5;
/** A volume's upper and lower copies of that footprint. */
const CHARACTER_VOLUME_VERTICES = CHARACTER_VOLUME_RING * 2;

/**
 * Characters retain their logical foot row, or the visible footer of a trimmed cutout.
 * Rounded row volumes extend behind the visible card along the camera ray, so side lighting cannot collapse
 * the caster to a line or expand its camera silhouette. Shared frame caches own the mesh.
 */
export const createCharacterMaterialFrame = (
  material: WorldMaterial,
  texture: Texture,
  foot = texture.orig.height / 2 + 28,
) => {
  // Rectangular CDN renditions can round width and height by different factors.
  const ratioX = material.width / texture.source.pixelWidth,
    ratioY = material.height / texture.source.pixelHeight;
  const rect = texture.frame.clone();
  rect.x *= ratioX;
  rect.y *= ratioY;
  rect.width *= ratioX;
  rect.height *= ratioY;
  const source = worldMaterialFrame(material, rect),
    { orig, trim } = texture;
  const vertices = Array.from(source.vertices),
    points = source.points.slice();
  const project = (data: number[] | Float32Array, stride: number) => {
    for (let i = 0; i < data.length; i += stride) {
      data[i] =
        ((data[i] ?? 0) * (trim?.width ?? orig.width) + (trim?.x ?? 0)) / orig.width;
      data[i + 1] =
        ((data[i + 1] ?? 0) * (trim?.height ?? orig.height) + (trim?.y ?? 0)) /
        orig.height;
      data[i + 2] = Math.max(0, foot / orig.height - (data[i + 1] ?? 0));
    }
  };
  project(vertices, 6);
  project(points, 4);
  const indices = Array.from(source.indices);
  const volumes: AuthoredMaterialFrame["volumes"][number][] = [];
  const pixelX = 1 / ratioX,
    pixelY = 1 / ratioY;
  // Each covered run per row, from which sun volumes rebuild the sprite's silhouette.
  const rows = Array.from({ length: Math.ceil(rect.height) }, (_, y) => {
    const spans: { start: number; end: number }[] = [];
    let start = -1;
    for (let x = 0; x <= Math.ceil(rect.width); x++) {
      const covered =
        x < rect.width &&
        (material.pixels[
          (Math.floor(rect.y + y) * material.width + Math.floor(rect.x + x)) * 4 + 3
        ] ?? 0) >= 128;
      if (covered && start < 0) start = x;
      if ((covered || start < 0) && x < Math.ceil(rect.width)) continue;
      if (start >= 0) spans.push({ start, end: Math.min(x, rect.width) });
      start = -1;
    }
    return spans;
  });
  // Indices are 16-bit, so a frilly cutout keeps fewer, taller rows rather than overflowing them.
  const capacity = Math.floor(
    (MAX_FRAME_VERTICES - vertices.length / 6) / CHARACTER_VOLUME_VERTICES,
  );
  let rowStep = Math.max(1, Math.ceil(rows.flat().length / Math.max(1, capacity)));
  // Spans can bunch on the rows a step keeps, so count those rather than assume an even spread.
  while (
    rowStep < rows.length &&
    rows.reduce((kept, spans, y) => kept + (y % rowStep ? 0 : spans.length), 0) >
      capacity
  )
    rowStep += 1;
  for (let y = 0; y < rows.length; y += rowStep) {
    const top = foot - (trim?.y ?? 0) - y * pixelY,
      lower = Math.max(0, top - pixelY * rowStep);
    if (top <= 0) continue;
    for (const { start, end } of rows[y] ?? []) {
      const left = (trim?.x ?? 0) + start * pixelX,
        width = (end - start) * pixelX;
      const depth = Math.min(width * 0.65, lower * 1.8);
      if (depth <= 0) continue;
      const ring = Array.from({ length: CHARACTER_VOLUME_RING }, (_, index) => {
        const angle = Math.PI * (1 - index / (CHARACTER_VOLUME_RING - 1)),
          back = Math.sin(angle) * depth;
        return [
          left + (width * (1 + Math.cos(angle))) / 2,
          foot - top,
          lower - back / 2,
          top - back / 2,
        ] as const;
      });
      volumes.push({ vertices: ring, indices: [0, 1, 2, 0, 2, 3, 0, 3, 4] });
    }
  }
  const closed = appendAuthoredGeometry(
    { frame: [0, 0, orig.width, orig.height], surfaces: [], volumes },
    material,
    new Rectangle(0, 0, orig.width, orig.height),
    vertices,
    indices,
  );
  return {
    ...source,
    vertices: new Float32Array(vertices),
    indices: new Uint16Array(indices),
    points,
    volumes: closed,
  };
};

const canopyFrames = new WeakMap<MaterialFrame, MaterialFrame>();

/** Small elevated leaf volumes share bounded boxes; trunks, receiver surfaces and albedo stay exact. */
export const canopyShadowFrame = (material: WorldMaterial, frame: MaterialFrame) => {
  if (!frame.volumes?.length || WORLD_DETAIL.canopyVolumeSpan <= 0) return frame;
  const cached = canopyFrames.get(frame);
  if (cached) return cached;
  let simplified = false;
  const volumes = frame.volumes.map((volume) => {
    let x0 = Infinity,
      y0 = Infinity,
      z0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity,
      z1 = -Infinity;
    const original: [number, number, number, number][] = [];
    for (let i = 0; i < volume.vertices.length; i += 4) {
      const x = volume.vertices[i] ?? 0,
        y = volume.vertices[i + 1] ?? 0,
        lower = volume.vertices[i + 2] ?? 0,
        upper = volume.vertices[i + 3] ?? 0;
      original.push([x, y, lower, upper]);
      const physicalY = -2 * (y + upper);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, physicalY);
      y1 = Math.max(y1, physicalY);
      z0 = Math.min(z0, lower);
      z1 = Math.max(z1, upper);
    }
    if (z0 < 0.2 || Math.max(x1 - x0, y1 - y0, z1 - z0) > WORLD_DETAIL.canopyVolumeSpan)
      return { vertices: original, indices: Array.from(volume.indices) };
    simplified = true;
    return {
      vertices: [
        [x0, -y0 / 2 - z1, z0, z1],
        [x1, -y0 / 2 - z1, z0, z1],
        [x1, -y1 / 2 - z1, z0, z1],
        [x0, -y1 / 2 - z1, z0, z1],
      ] as [number, number, number, number][],
      indices: [0, 1, 2, 0, 2, 3],
    };
  });
  if (!simplified) {
    canopyFrames.set(frame, frame);
    return frame;
  }
  const vertices: number[] = [],
    indices: number[] = [],
    remap = new Map<number, number>();
  for (let i = 0; i < frame.indices.length; i += 3) {
    const triangle = Array.from(frame.indices.subarray(i, i + 3));
    if (triangle.some((index) => frame.vertices[index * 6 + 5] === 0)) continue;
    for (const index of triangle) {
      if (!remap.has(index)) {
        remap.set(index, vertices.length / 6);
        vertices.push(...frame.vertices.subarray(index * 6, index * 6 + 6));
      }
      indices.push(remap.get(index) ?? 0);
    }
  }
  const closed = appendAuthoredGeometry(
    { frame: [0, 0, 1, 1], surfaces: [], volumes },
    material,
    new Rectangle(0, 0, 1, 1),
    vertices,
    indices,
  );
  const result = {
    ...frame,
    vertices: new Float32Array(vertices),
    indices: new Uint16Array(indices),
    volumes: closed,
  };
  canopyFrames.set(frame, result);
  return result;
};

const appendAuthoredGeometry = (
  definition: AuthoredMaterialFrame,
  material: WorldMaterial,
  frame: Texture["frame"],
  vertices: number[],
  indices: number[],
  finiteBacking = false,
): MaterialVolume[] => {
  const appendVertex = (
    x: number,
    y: number,
    height: number,
    cutout: number,
    reuse?: number,
  ) => {
    const u = x / frame.width,
      v = y / frame.height,
      h = height / frame.height;
    const closedLeaf = finiteBacking && cutout === 0;
    const px = closedLeaf ? Math.fround(u) : u,
      py = closedLeaf ? Math.fround(v) : v,
      pz = closedLeaf ? Math.fround(h) : h,
      atlasU = (frame.x + x) / material.width,
      atlasV = (frame.y + y) / material.height;
    if (
      reuse !== undefined &&
      Object.is(Math.fround(vertices[reuse * 6] ?? 0), Math.fround(px)) &&
      Object.is(Math.fround(vertices[reuse * 6 + 1] ?? 0), Math.fround(py)) &&
      Object.is(Math.fround(vertices[reuse * 6 + 2] ?? 0), Math.fround(pz)) &&
      Object.is(Math.fround(vertices[reuse * 6 + 3] ?? 0), Math.fround(atlasU)) &&
      Object.is(Math.fround(vertices[reuse * 6 + 4] ?? 0), Math.fround(atlasV)) &&
      Object.is(Math.fround(vertices[reuse * 6 + 5] ?? 0), Math.fround(cutout))
    )
      return reuse;
    const index = vertices.length / 6;
    if (index >= MAX_FRAME_VERTICES)
      throw new Error("Authored world surface geometry exceeds WebGL1 vertex limit");
    vertices.push(px, py, pz, atlasU, atlasV, cutout);
    return index;
  };
  const appendTriangle = (a: number, b: number, c: number, closedLeaf = false) => {
    const ax = vertices[a * 6] ?? 0,
      ay = vertices[a * 6 + 1] ?? 0,
      az = vertices[a * 6 + 2] ?? 0;
    const bx = (vertices[b * 6] ?? 0) - ax,
      by = (vertices[b * 6 + 1] ?? 0) - ay,
      bz = (vertices[b * 6 + 2] ?? 0) - az;
    const cx = (vertices[c * 6] ?? 0) - ax,
      cy = (vertices[c * 6 + 1] ?? 0) - ay,
      cz = (vertices[c * 6 + 2] ?? 0) - az;
    // Tapered volume boundaries can meet at a point; omit only their zero-area closure triangles.
    if (
      Math.hypot(by * cz - bz * cy, bz * cx - bx * cz, bx * cy - by * cx) >
      (closedLeaf ? 0 : 1e-10)
    )
      indices.push(a, b, c);
  };
  for (const surface of definition.surfaces) {
    const offset = vertices.length / 6;
    // Ground collars receive light without adding a flattened copy of the sprite to sun depth.
    for (const [x, y, height] of surface.vertices)
      appendVertex(x, y, height, surface.surfaceClass === 0 ? 2 : 1);
    for (let i = 0; i < surface.indices.length; i += 3)
      appendTriangle(
        offset + (surface.indices[i] ?? 0),
        offset + (surface.indices[i + 1] ?? 0),
        offset + (surface.indices[i + 2] ?? 0),
      );
  }
  return definition.volumes.map((volume) => {
    const offset = vertices.length / 6;
    const normalized: number[] = [];
    for (const [x, y, lower, upper] of volume.vertices) {
      appendVertex(x, y, upper, 0);
      normalized.push(
        x / frame.width,
        y / frame.height,
        lower / frame.height,
        upper / frame.height,
      );
    }
    const bottom: number[] = [];
    for (const [index, [x, y, lower, upper]] of volume.vertices.entries())
      bottom.push(
        appendVertex(
          x,
          y + upper - lower,
          lower,
          0,
          lower === upper ? offset + index : undefined,
        ),
      );
    const edges = new Map<string, { a: number; b: number; count: number }>();
    for (let i = 0; i < volume.indices.length; i += 3) {
      const a = volume.indices[i] ?? 0;
      let b = volume.indices[i + 1] ?? 0,
        c = volume.indices[i + 2] ?? 0;
      const av = volume.vertices[a],
        bv = volume.vertices[b],
        cv = volume.vertices[c];
      if (!av || !bv || !cv) throw new Error("Invalid authored world volume triangle");
      // Source Y points down and sprite Y points up. Upper faces wind outward in the unprojected physical footprint.
      if (
        (bv[0] - av[0]) * (cv[1] + cv[3] - av[1] - av[3]) -
          (bv[1] + bv[3] - av[1] - av[3]) * (cv[0] - av[0]) >
        0
      )
        [b, c] = [c, b];
      appendTriangle(offset + a, offset + b, offset + c, finiteBacking);
      appendTriangle(bottom[a] ?? 0, bottom[c] ?? 0, bottom[b] ?? 0, finiteBacking);
      for (const [from, to] of [
        [a, b],
        [b, c],
        [c, a],
      ] as const) {
        const key = `${Math.min(from, to)}:${Math.max(from, to)}`;
        const edge = edges.get(key);
        if (edge) edge.count++;
        else edges.set(key, { a: from, b: to, count: 1 });
      }
    }
    // Only exposed footprint edges receive walls; triangulation diagonals remain inside the closed volume.
    for (const { a, b, count: edgeCount } of edges.values())
      if (edgeCount === 1) {
        appendTriangle(offset + a, bottom[a] ?? 0, bottom[b] ?? 0, finiteBacking);
        appendTriangle(offset + a, bottom[b] ?? 0, offset + b, finiteBacking);
      }
    return {
      vertices: new Float32Array(normalized),
      indices: new Uint16Array(volume.indices),
    };
  });
};

const sampleMaterial = (
  material: WorldMaterial,
  frame: Texture["frame"],
  x: number,
  y: number,
) => {
  // Authored PNGs evaluate serialized surface triangles at global atlas texel centers (px + .5, py + .5).
  // Local centers subtract the fractional frame origin; B = round(sourceHeight / frame.height * 255).
  const px = Math.min(material.width - 1, Math.floor(frame.x + x));
  const py = Math.min(material.height - 1, Math.floor(frame.y + y));
  const offset = (py * material.width + px) * 4;
  return {
    h: material.isBillboard
      ? 1 - (py + 0.5 - frame.y) / frame.height
      : (material.pixels[offset + 2] ?? 0) / 255,
    r: material.pixels[offset] ?? 0,
    a: material.pixels[offset + 3] ?? 0,
  };
};

/** Octahedral normals preserve full world orientation in two channels. */
export const encodeWorldNormal = (x: number, y: number, z: number) => {
  const length = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1;
  x /= length;
  y /= length;
  if (z < 0)
    [x, y] = [
      (1 - Math.abs(y)) * (x < 0 ? -1 : 1),
      (1 - Math.abs(x)) * (y < 0 ? -1 : 1),
    ];
  return [x * 0.5 + 0.5, y * 0.5 + 0.5] as const;
};

/** Atlas geometry loads on demand and shares its material lease and idle-cache lifetime. */
const readAuthoredSurfaces = async (url: string): Promise<AuthoredSurfaces | null> => {
  try {
    const response = await fetch(transformImageUrl(url));
    if (!response.ok)
      throw new Error(`World surface request failed: ${response.status}`);
    const text = await response.text();
    const frames: unknown = JSON.parse(text);
    if (
      !Array.isArray(frames) ||
      !frames.length ||
      !frames.every(
        (frame) =>
          frame &&
          Array.isArray(frame.frame) &&
          frame.frame.length === 4 &&
          frame.frame.every(
            (value: unknown) => typeof value === "number" && Number.isFinite(value),
          ) &&
          Array.isArray(frame.surfaces) &&
          Array.isArray(frame.volumes),
      )
    )
      throw new Error("Invalid authored world surface frames");
    return {
      frames: frames as AuthoredMaterialFrame[],
      // Reserve parsed numbers and lazily compiled geometry in the existing idle-cache budget.
      bytes: text.length * 4,
    };
  } catch (error) {
    console.warn("Authored surfaces unavailable; using a physical fallback", error);
    return null;
  }
};

export type WorldMaterial = {
  texture: Texture;
  pixels: Uint8Array;
  width: number;
  height: number;
  shape: WorldShadowShape;
  /** Generated fallback uses an analytic upright plane local to each atlas frame. */
  isBillboard?: boolean;
  /** Framed sources receive entries as their casters register (installAuthoredFrames). */
  surfaceFrames?: AuthoredMaterialFrame[];
  /** Conservative reservation for parsed metadata and frame buffers compiled during this lease. */
  surfaceBytes?: number;
  frames: Map<string, MaterialFrame>;
};
export type MaterialFrame = {
  /** Frame X/Y/height, atlas U/V and cast mode: 0=closed, 1=albedo cutout, 2=ground receiver only. */
  vertices: Float32Array;
  indices: Uint16Array;
  points: Float32Array;
  emitters: { x: number; y: number; height: number }[];
  /** Undefined custom-art fallback; an empty array explicitly describes surfaces without a closed occluder. */
  volumes?: MaterialVolume[];
};
export type MaterialVolume = {
  /** Normalized source top U/V and lower/upper heights; both height endpoints share the unprojected physical XY. */
  vertices: Float32Array;
  indices: Uint16Array;
};
type AuthoredSurfaces = { frames: AuthoredMaterialFrame[]; bytes: number };
export type AuthoredMaterialFrame = {
  /** Thin leaf backing retains every nonzero Float32 closure face. */
  thinBacking?: true;
  frame: readonly [number, number, number, number];
  surfaces: readonly {
    name?: string;
    /** Only zero is retained in shipped metadata; ground collars never enter sun depth. */
    surfaceClass?: number;
    vertices: readonly (readonly [number, number, number])[];
    indices: readonly number[];
  }[];
  volumes: readonly {
    name?: string;
    surfaceClass?: number;
    vertices: readonly (readonly [number, number, number, number])[];
    indices: readonly number[];
  }[];
};
