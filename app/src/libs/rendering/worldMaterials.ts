import { BufferImageSource, Rectangle, Texture } from "pixi.js";
import { createSceneAssets } from "@/libs/rendering/assets";
import { createLeaseCache } from "@/libs/rendering/leaseCache";
import type { WorldShadowShape } from "@/libs/rendering/worldShadows";
import worldSurfaceAtlases from "@/libs/rendering/worldSurfaceAtlases.json";

const authored = new Set(worldSurfaceAtlases);
const loaded = new Map<string, WorldMaterial>();
const materials = createLeaseCache<WorldMaterial>({
  load: async (key) => {
    const {
      image,
      shape,
      rendition = 128,
    } = JSON.parse(key) as {
      image: string;
      shape: WorldShadowShape;
      rendition?: number;
    };
    const assets = createSceneAssets();
    try {
      const [albedo, material, surfaces] = await Promise.all([
        assets.texture(image, rendition, "nearest"),
        authored.has(image)
          ? assets
              .texture(image.replace(/\.webp$/, ".material.png"), 128, "nearest")
              .catch((error: unknown) => {
                console.warn(
                  "Authored material unavailable; using a physical fallback",
                  error,
                );
                return null;
              })
          : null,
        authored.has(image) ? readAuthoredSurfaces(image) : null,
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
      const coverage = readPixels(albedo, width, height);
      const pixels =
        material && hasAuthoredMaterial
          ? readPixels(material, width, height)
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
) =>
  materials.acquire(
    JSON.stringify({ image, shape: authored.has(image) ? "column" : shape, rendition }),
  );

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

/**
 * Packed character frames retain their logical foot row. Rounded row volumes extend
 * behind the visible card along the camera ray, so side lighting cannot collapse
 * the caster to a line or expand its camera silhouette. Shared frame caches own the mesh.
 */
export const createCharacterMaterialFrame = (
  material: WorldMaterial,
  texture: Texture,
) => {
  const ratio = material.width / texture.source.pixelWidth;
  const rect = texture.frame.clone();
  rect.x *= ratio;
  rect.y *= ratio;
  rect.width *= ratio;
  rect.height *= ratio;
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
      data[i + 2] = Math.max(0, 0.5 + 28 / orig.height - (data[i + 1] ?? 0));
    }
  };
  project(vertices, 6);
  project(points, 4);
  const indices = Array.from(source.indices);
  const volumes: AuthoredMaterialFrame["volumes"][number][] = [];
  const pixel = 1 / ratio,
    foot = orig.height / 2 + 28;
  for (let y = 0; y < rect.height; y++) {
    const top = foot - (trim?.y ?? 0) - y * pixel,
      lower = Math.max(0, top - pixel);
    if (top <= 0) continue;
    let start = -1;
    for (let x = 0; x <= rect.width; x++) {
      const covered =
        x < rect.width &&
        (material.pixels[((rect.y + y) * material.width + rect.x + x) * 4 + 3] ?? 0) >=
          128;
      if (covered && start < 0) start = x;
      if ((covered || start < 0) && x < rect.width) continue;
      if (start < 0) continue;
      const left = (trim?.x ?? 0) + start * pixel,
        width = (x - start) * pixel;
      const depth = Math.min(width * 0.65, lower * 1.8);
      if (depth > 0) {
        const ring = Array.from({ length: 5 }, (_, index) => {
          const angle = Math.PI * (1 - index / 4),
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
      start = -1;
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
    if (index >= 65535)
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

const readPixels = (texture: Texture, width: number, height: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Cannot read world material data");
  context.drawImage(texture.source.resource as CanvasImageSource, 0, 0, width, height);
  return new Uint8Array(context.getImageData(0, 0, width, height).data);
};

/** Atlas geometry loads on demand and shares its material lease and idle-cache lifetime. */
const readAuthoredSurfaces = async (image: string) => {
  try {
    const response = await fetch(image.replace(/\.webp$/, ".surfaces.json"));
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
      frames: frames as readonly AuthoredMaterialFrame[],
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
  surfaceFrames?: readonly AuthoredMaterialFrame[];
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
