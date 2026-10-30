import { describe, expect, it, vi } from "bun:test";
import { readFileSync } from "node:fs";
import { worldArtDirectory, worldArtFile } from "../../setup/worldArt";
import { BufferImageSource, Rectangle, Texture } from "pixi.js";
import { createCharacterMaterialFrame, worldMaterialFrame, type AuthoredMaterialFrame, type WorldMaterial } from "@/libs/rendering/worldMaterials";
import { lightingFragment, pointLightFragment } from "@/libs/rendering/worldLightingShaders";
import { createWorldOcclusion, MAX_CELL_INSTANCES, type Occluder } from "@/libs/rendering/worldOcclusion";
import { MAX_SMALL_WORLD_WIND, MAX_WORLD_WIND } from "@/libs/rendering/worldWind";

const viewport = { minX: 0, minY: 0, maxX: 128, maxY: 128 };
type Field = ReturnType<typeof createWorldOcclusion>;
type Point = [number, number, number];
type Vertex = [number, number, number, number];
const record = (key: string, points: number[] = [], patch: Partial<Occluder> = {}): Occluder => ({
  key, points: new Float32Array(points), shape: "column", width: 0, height: 0, footX: 0, footY: 0, dynamic: false, ...patch,
});
const volume = (vertices: number[], indices = [0, 1, 2]) => ({ vertices: new Float32Array(vertices), indices: new Uint16Array(indices) });
const box = (x0: number, y0: number, x1: number, y1: number, lower: number, upper: number) => volume([
  x0, y0, lower, upper, x1, y0, lower, upper, x1, y1, lower, upper, x0, y1, lower, upper,
], [0, 1, 2, 0, 2, 3]);
const trackedFrame = (triangles = 1, upper = 0.5) => {
  const source = volume([0, 0, 0.25, upper, 1, 0, 0.25, upper, 0, 1, 0.25, upper]);
  const indices = new Uint16Array(triangles * 3);
  for (let i = 0; i < indices.length; i++) indices[i] = i % 3;
  let reads = 0;
  const vertices = new Proxy(source.vertices, { get(target, key) {
    if (typeof key === "string" && /^\d+$/.test(key)) reads++;
    return Reflect.get(target, key, target);
  } });
  return { volumes: [{ vertices, indices }], source: source.vertices,
    get reads() { return reads; }, reset: () => { reads = 0; } };
};
const normalizedRecord = (key: string, frame: ReturnType<typeof trackedFrame>, x = 40.125) => record(key, [], {
  volumes: frame.volumes, transform: new Float32Array([0.1, 0, 0, -0.1, x, 40.125]), height: 1,
});
const bytes = (texture: Field["texture"]) => (texture.source as BufferImageSource).resource as Uint8Array;
const packedSources = (field: Field) => [field.texture, field.references, field.prisms].map(bytes);
const packedSnapshot = (field: Field) => packedSources(field).map((source) => source.slice());
const matchesSnapshot = (field: Field, snapshot: Uint8Array[]) => packedSources(field)
  .map((source, i) => Buffer.compare(source, snapshot[i]!) === 0);
const uint16 = (data: Uint8Array, offset: number) => (data[offset] ?? 0) * 256 + (data[offset + 1] ?? 0);
const uint24 = (data: Uint8Array, offset: number) => uint16(data, offset) * 256 + (data[offset + 2] ?? 0);
const cell = (field: Field, x: number, y: number) => {
  const col = Math.floor((x - field.bounds.minX) * 512 / (field.bounds.maxX - field.bounds.minX));
  const row = Math.floor((y - field.bounds.minY) * 512 / (field.bounds.maxY - field.bounds.minY));
  if (Math.min(col, row) < 0 || Math.max(col, row) >= 512) return { contact: 0, refs: [] as { id: number; lower: number; upper: number; min: number[]; max: number[] }[] };
  const data = bytes(field.texture), offset = (row * 1024 + col) * 4, metadata = offset + 512 * 4;
  const first = uint24(data, offset), count = (data[offset + 3] ?? 0) + (data[metadata] ?? 0) * 256;
  const references = bytes(field.references);
  const refs = Array.from({ length: count }, (_, i) => {
    const index = (first + i) * 8, min = references[index + 5] ?? 0, max = references[index + 6] ?? 0;
    return { id: uint24(references, index), lower: (references[index + 3] ?? 0) * field.heightRange / 255,
      upper: references[index + 4] === 255 ? Infinity : (references[index + 4] ?? 0) * field.heightRange / 255,
      min: [min % 16 / 15, Math.floor(min / 16) / 15], max: [max % 16 / 15, Math.floor(max / 16) / 15] };
  });
  return { contact: (data[metadata + 2] ?? 0) / 255, refs };
};
const instance = (field: Field, id: number, wind: readonly number[] = []) => {
  const data = bytes(field.prisms), view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const geometry = uint24(data, id * 4);
  const values = Array.from({ length: 5 }, (_, i) => view.getFloat32((geometry + i) * 4));
  const matrix = Array.from({ length: 7 }, (_, i) => view.getFloat32((id + 1 + i) * 4));
  const flags = data[id * 4 + 3] ?? 0, group = (flags >> 1) - 1, dx = wind[group] ?? 0;
  const local = (point: Point): Point => {
    if (!(flags & 1)) return group < 0 ? point : [(point[0] - dx * (matrix[1]! * (point[1] * 0.5 + point[2]) + matrix[2]!)) / (1 + dx * matrix[0]!), point[1], point[2]];
    const [a, b, baseC, d, baseTx, ty, h] = matrix as [number, number, number, number, number, number, number];
    const c = baseC - dx, tx = baseTx + dx;
    const x = point[0] - tx, y = point[1] * 0.5 + point[2] - ty, det = a * d - b * c;
    const u = (d * x - c * y) / det, v = (a * y - b * x) / det, z = point[2] / h;
    return [u, -2 * (v + z), z];
  };
  return { data, values, local, matrix, flags, root: geometry + 5 };
};
const decodedTriangle = (mesh: ReturnType<typeof instance>, address: number): Vertex[] => {
  const [x, y, width, height, range] = mesh.values as [number, number, number, number, number];
  return [0, 1, 2].map((corner) => {
    const i = address * 4 + corner * 8;
    return [x + uint16(mesh.data, i) / 65535 * width, y + uint16(mesh.data, i + 2) / 65535 * height,
      uint16(mesh.data, i + 4) / 65535 * range, uint16(mesh.data, i + 6) / 65535 * range];
  });
};
const triangle = (field: Field, id: number): Vertex[] => {
  const mesh = instance(field, id);
  let node = mesh.root;
  while (mesh.data[node * 4 + 15] === 0) node += 5;
  return decodedTriangle(mesh, uint24(mesh.data, node * 4 + 16));
};
const firstTriangle = (field: Field) => triangle(field, uint24(bytes(field.references), 0));
/** Slab intersection independently validates the integer node bounds and preorder escape links. */
const boundsIntersect = (origin: Point, end: Point, lower: Point, upper: Point) => {
  let start = 0, finish = 1;
  for (const axis of [0, 1, 2] as const) {
    const delta = end[axis] - origin[axis];
    if (Math.abs(delta) < 1e-12) { if (origin[axis] < lower[axis] - 1e-8 || origin[axis] > upper[axis] + 1e-8) return false; }
    else { const a = (lower[axis] - origin[axis]) / delta, b = (upper[axis] - origin[axis]) / delta;
      start = Math.max(start, Math.min(a, b)); finish = Math.min(finish, Math.max(a, b)); }
  }
  return finish >= start - 1e-8;
};
const instanceIntersects = (field: Field, id: number, origin: Point, end: Point, wind: readonly number[] = []) => {
  const mesh = instance(field, id, wind), localOrigin = mesh.local(origin), localEnd = mesh.local(end);
  const [x, y, width, height, range] = mesh.values as [number, number, number, number, number];
  const endNode = uint24(mesh.data, mesh.root * 4 + 12);
  let node = mesh.root, visited = 0;
  while (node < endNode) {
    if (++visited > 8192) throw new Error("Invalid BVH escape graph");
    const i = node * 4, escape = uint24(mesh.data, i + 12), count = mesh.data[i + 15]!;
    if (escape <= node || escape > endNode) throw new Error("Invalid BVH escape address");
    const lower: Point = [x + uint16(mesh.data, i) / 65535 * width, y + uint16(mesh.data, i + 2) / 65535 * height, uint16(mesh.data, i + 8) / 65535 * range];
    const upper: Point = [x + uint16(mesh.data, i + 4) / 65535 * width, y + uint16(mesh.data, i + 6) / 65535 * height, uint16(mesh.data, i + 10) / 65535 * range];
    if (!boundsIntersect(localOrigin, localEnd, lower, upper)) { node = escape; continue; }
    if (count > 0) {
      const first = uint24(mesh.data, i + 16);
      for (let i = 0; i < count; i++) if (prismIntersects(decodedTriangle(mesh, first + i * 6), localOrigin, localEnd)) return true;
      node = escape;
    } else node += 5;
  }
  return false;
};
const subtract = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Point, b: Point): Point => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Independent closed-mesh oracle; it does not reuse the shader's five halfplane constraints. */
const prismIntersects = (prism: Vertex[], origin: Point, end: Point) => {
  const vertices: Point[] = [2, 3].flatMap((h) => prism.map((v): Point => [v[0], v[1], v[h]!]));
  const indices = [0, 1, 2, 3, 5, 4, 0, 3, 4, 0, 4, 1, 1, 4, 5, 1, 5, 2, 2, 5, 3, 2, 3, 0];
  const ray = subtract(end, origin);
  const center = vertices.reduce((sum, point) => sum.map((value, axis) => value + point[axis]! / 6) as Point, [0, 0, 0] as Point);
  const contains = (point: Point) => {
    for (let i = 0; i < indices.length; i += 3) {
      const a = vertices[indices[i]!]!, normal = cross(subtract(vertices[indices[i + 1]!]!, a), subtract(vertices[indices[i + 2]!]!, a));
      const length = Math.hypot(...normal);
      if (length < 1e-12) continue;
      // Signed distances keep the oracle's tolerance independent of a packed triangle's area.
      const inward = dot(normal, subtract(center, a)) / length, distance = dot(normal, subtract(point, a)) / length;
      if (Math.abs(inward) < 1e-10 ? Math.abs(distance) > 1e-8 : Math.sign(inward) * distance < -1e-9) return false;
    }
    return true;
  };
  if (contains(origin) || contains(end)) return true;
  for (let i = 0; i < indices.length; i += 3) {
    const a = vertices[indices[i]!]!, e1 = subtract(vertices[indices[i + 1]!]!, a), e2 = subtract(vertices[indices[i + 2]!]!, a);
    const h = cross(ray, e2), determinant = dot(e1, h);
    if (Math.abs(determinant) < 1e-10) continue;
    const relative = subtract(origin, a), u = dot(relative, h) / determinant;
    if (u < -1e-7 || u > 1 + 1e-7) continue;
    const q = cross(relative, e1), v = dot(ray, q) / determinant, t = dot(e2, q) / determinant;
    if (v >= -1e-7 && u + v <= 1 + 1e-7 && t >= -1e-7 && t <= 1 + 1e-7) return true;
  }
  return false;
};
/** Exact boundary divisions independently exercise packed references, coarse bounds and geometry. */
const blocked = (field: Field, origin: Point, end: Point, coarse = false, wind: readonly number[] = []) => {
  const ray = subtract(end, origin), divisions = [0, 1], size = (field.bounds.maxX - field.bounds.minX) / 512;
  for (const axis of [0, 1] as const) {
    if (Math.abs(ray[axis]) < 1e-10) continue;
    const min = axis === 0 ? field.bounds.minX : field.bounds.minY;
    for (let i = 0; i <= 512; i++) { const t = (min + i * size - origin[axis]) / ray[axis]; if (t > 0 && t < 1) divisions.push(t); }
  }
  divisions.sort((a, b) => a - b);
  const at = (t: number): Point => [origin[0] + ray[0] * t, origin[1] + ray[1] * t, origin[2] + ray[2] * t];
  for (let i = 0; i + 1 < divisions.length; i++) {
    if (divisions[i + 1]! - divisions[i]! < 1e-10) continue;
    const first = at(divisions[i]!), last = at(divisions[i + 1]!), middle = at((divisions[i]! + divisions[i + 1]!) / 2);
    const sample = cell(field, middle[0], middle[1]), lower = Math.min(first[2], last[2]), upper = Math.max(first[2], last[2]);
    const cellOrigin = [field.bounds.minX + Math.floor((middle[0] - field.bounds.minX) / size) * size,
      field.bounds.minY + Math.floor((middle[1] - field.bounds.minY) / size) * size];
    for (const ref of sample.refs) {
      if (ref.lower > upper + 1e-5) break;
      if (ref.upper < lower - 1e-5) continue;
      if (coarse) return true;
      if ([0, 1].some((axis) => Math.max(first[axis]!, last[axis]!) < cellOrigin[axis]! + ref.min[axis]! * size - 1e-7 ||
        Math.min(first[axis]!, last[axis]!) > cellOrigin[axis]! + ref.max[axis]! * size + 1e-7)) continue;
      if (instanceIntersects(field, ref.id, first, last, wind)) return true;
    }
  }
  return false;
};
const waitForRevision = async (field: Field, revision: number) => {
  for (let i = 0; i < 3000 && field.revision < revision; i++) await new Promise((resolve) => setTimeout(resolve, 1));
  expect(field.revision).toBeGreaterThanOrEqual(revision);
};
const shrine = () => record("shrine-pedestal", [], { volumes: [volume([
  366.45551756, 75.58494108, 2.42629515, 10.34140912,
  361.64246691, 79.74019619, 2.42629515, 9.98555249,
  363.89982001, 82.65175037, 2.42629515, 11.44492410,
  367.58778862, 77.05150171, 2.42629515, 11.06750041,
  367.28225516, 84.59997551, 2.42629515, 12.41903667,
].map((value, index) => value + (index % 4 === 0 ? 512 : index % 4 === 1 ? 1024 : 0)), [0, 1, 2, 0, 2, 3, 3, 2, 4])] });

describe("authored foliage under local lights", () => {
  it.skipIf(!worldArtDirectory).each([["woodland-village", 0], ["woodland-village", 1], ["woodland-village", 2], ["biome-scenery", 11], ["biome-scenery", 13]] as const)("retains distinct lit and shaded ground for four nearby lights around %s frame %i", (atlas, index) => {
    const definitions = JSON.parse(readFileSync(worldArtFile(`${atlas}.surfaces.json`), "utf8")) as AuthoredMaterialFrame[];
    const definition = definitions[index]!, [, , w, h] = definition.frame;
    const pixels = new Uint8Array(1024 * 1024 * 4), texture = new Texture({ source: new BufferImageSource({ resource: pixels, width: 1024, height: 1024 }) });
    const source: WorldMaterial = { texture, pixels, width: 1024, height: 1024, shape: "canopy", frames: new Map(), surfaceFrames: definitions };
    const frame = worldMaterialFrame(source, new Rectangle(...definition.frame)), field = createWorldOcclusion();
    try {
      field.update([record("foliage", [], { volumes: frame.volumes, transform: new Float32Array([w, 0, 0, -h, -w / 2, h]), height: h })],
        { minX: -256, minY: -256, maxX: 256, maxY: 256 });
      expect(field.error).toBeNull(); expect(field.instanceCount).toBe(1);
      const lights: Point[] = [[120, 0, 160], [-120, 0, 160], [0, 120, 160], [0, -120, 160]];
      const patterns = new Set<number>();
      const counts = lights.map(() => 0);
      for (let y = -120; y <= 120; y += 20) for (let x = -120; x <= 120; x += 20) {
        let pattern = 0;
        lights.forEach((light, i) => {
          if (blocked(field, [x, y, 0], light)) { pattern |= 1 << i; counts[i] = counts[i]! + 1; }
        });
        patterns.add(pattern);
      }
      for (const count of counts) { expect(count).toBeGreaterThan(0); expect(count).toBeLessThan(169); }
      expect(patterns.size).toBeGreaterThan(3);
    } finally { field.dispose(); texture.destroy(true); }
  });
});

describe("character lighting from local sources", () => {
  it.each([1, -1])("casts solid shadows from four light directions without filling leg gaps or self-shadowing its front (facing %i)", (facing) => {
    const pixels = new Uint8Array(64 * 64 * 4);
    for (let y = 20; y < 60; y++) for (let x = 24; x < 40; x++) {
      if (y >= 55 && x >= 29 && x < 35) continue;
      pixels[(y * 64 + x) * 4 + 3] = 255;
    }
    const texture = new Texture({ source: new BufferImageSource({ resource: pixels, width: 64, height: 64 }), frame: new Rectangle(0, 0, 64, 64) });
    const source: WorldMaterial = { texture, pixels, width: 64, height: 64, shape: "character", frames: new Map(), isBillboard: true };
    const frame = createCharacterMaterialFrame(source, texture), field = createWorldOcclusion();
    try {
      field.update([record("character", [], { volumes: frame.volumes, transform: new Float32Array([64 * facing, 0, 0, -64, facing < 0 ? 64 : 0, 60]), height: 64, dynamic: true })],
        { minX: -128, minY: -128, maxX: 192, maxY: 192 });
      expect(field.error).toBeNull();
      for (const [ground, light] of [
        [[80, -10, 0], [-80, 30, 60]], [[-16, -10, 0], [144, 30, 60]],
        [[32, 40, 0], [32, -80, 60]], [[32, -20, 0], [32, 100, 60]],
      ] as [Point, Point][]) expect(blocked(field, ground, light)).toBe(true);
      expect(blocked(field, [32, 2, 0], [32, 2, 3])).toBe(false);
      expect(blocked(field, [26, 1, 0], [26, 1, 4])).toBe(true);
      expect(blocked(field, [32, -0.02, 20], [32, -80, 60])).toBe(false);
    } finally { field.dispose(); texture.destroy(true); }
  });
});

describe("exact world occlusion prisms", () => {
  it("keeps a thin occluder opaque across boundary-crossing facade rays", () => {
    const field = createWorldOcclusion();
    field.update([record("thin-occluder", [], { volumes: [volume([235.29471516712874,492.0450852638362,25.320698863202868,26.346105134660867,241.83461333699984,496.29865320947414,25.494529640650033,25.49648279545281,236.75002217745725,497.1449128007529,26.88517586022736,26.887129015030137])] })],
      { minX: -87, minY: -384, maxX: 638, maxY: 922 }, 128);
    const rays: [Point, Point][] = [[[242.4473986370649,498.77402513134274,19.32589488451806],[240.0195414425371,494.1511014845145,31.326863395500034]],[[242.68443568116618,498.67953839547175,19.373138252453554],[240.01980617532521,494.1510107852369,31.326885527479796]],[[242.4473986370649,498.7723847445347,19.089678044841047],[240.0194968543478,494.15101314753986,31.326817230494452]],[[242.68443568116618,498.67789800866393,19.136921412776427],[240.01975736798886,494.15092382699885,31.326838573568473]]];
    for (const [origin, end] of rays)
      expect(blocked(field, origin, end)).toBe(true);
    field.dispose();
  });
  it("leaves the recorded shrine lantern ray clear despite occupied cell height bounds", () => {
    const field = createWorldOcclusion();
    field.update([shrine()], { minX: 0, minY: 0, maxX: 1400, maxY: 1400 }, 256);
    const origin: Point = [360.1661662617536 + 512, 82.41838510573854 + 1024, 3.073191810156789];
    const end: Point = [origin[0] + 8.945681161507366, origin[1] + 2.331164646916278, origin[2] + 15.057830865057689];
    expect(cell(field, 362 + 512, 82 + 1024).refs).toHaveLength(1);
    expect(blocked(field, origin, end, true)).toBe(true);
    expect(blocked(field, origin, end)).toBe(false);
    expect(blocked(field, [364 + 512, 80 + 1024, 0], [364 + 512, 80 + 1024, 20])).toBe(true);
    field.dispose();
  });
  it("preserves subcell silhouettes, narrow posts, negative coordinates and diagonal corner crossings", () => {
    const field = createWorldOcclusion();
    field.update([record("post", [], { volumes: [box(-40.35, -40.35, -40.1, -40.1, 0, 20)] })], viewport, 32);
    expect(cell(field, -41, -41).refs.length).toBeGreaterThan(0);
    expect(blocked(field, [-41.5, -41.5, 10], [-40.5, -40.5, 10])).toBe(false);
    expect(blocked(field, [-41, -41, 10], [-39, -39, 10])).toBe(true);
    expect(blocked(field, [-40.2, -42, 10], [-40.2, -39, 10])).toBe(true);
    expect(blocked(field, [-40.5, -42, 10], [-40.5, -39, 10])).toBe(false);
    field.dispose();
  });
  it("keeps an open stage, three rail gaps and the overhead roof exact within a cell", () => {
    const field = createWorldOcclusion(), heights = [[0, 7.6408], [10.5061, 12.7346], [15.5999, 17.8285], [21.9672, 24.1958], [47.2551, 47.8916]];
    field.update([record("arena", [], { volumes: heights.map(([lo, hi]) => box(40.1, 40.1, 41.8, 41.8, lo!, hi!)) })], viewport, 128);
    for (const z of [8, 14, 19, 40]) expect(blocked(field, [39, 41, z], [43, 41, z])).toBe(false);
    for (const z of [5, 11, 16, 23, 47.5]) expect(blocked(field, [39, 41, z], [43, 41, z])).toBe(true);
    expect(blocked(field, [39, 40.01, 23], [43, 40.01, 23])).toBe(false);
    field.dispose();
  });
  it("clips sloped lower and upper planes rather than per-cell extrema", () => {
    const field = createWorldOcclusion();
    field.update([record("slope", [], { volumes: [volume([40, 40, 10, 12, 42, 40, 20, 22, 40, 42, 10, 12])] })], viewport, 64);
    expect(blocked(field, [40.1, 40.1, 18], [40.1, 40.2, 18], true)).toBe(true);
    expect(blocked(field, [40.1, 40.1, 18], [40.1, 40.2, 18])).toBe(false);
    expect(blocked(field, [40.1, 40.1, 11.5], [40.1, 40.2, 11.5])).toBe(true);
    expect(blocked(field, [41.7, 40.1, 20.5], [41.7, 40.2, 20.5])).toBe(true);
    field.dispose();
  });
  it("accepts mirrored winding, preserves explicit open space and ignores degenerate footprints", () => {
    const field = createWorldOcclusion(), shape = volume([40.1, 40.1, 5, 10, 41.8, 40.1, 10, 15, 40.1, 41.8, 5, 10]);
    field.update([record("front", [], { volumes: [shape] })], viewport, 32);
    const first = blocked(field, [39, 40.5, 8], [43, 40.5, 8]);
    field.update([record("mirror", [], { volumes: [{ ...shape, indices: new Uint16Array([2, 1, 0]) }] })], viewport, 32);
    expect(blocked(field, [39, 40.5, 8], [43, 40.5, 8])).toBe(first);
    field.update([record("open", [40, 40, 100, 1], { width: 100, height: 100, shape: "building", volumes: [] }),
      record("line", [], { volumes: [volume([40, 40, 0, 20, 40, 50, 0, 20, 40, 60, 0, 20])] })], viewport);
    expect(field.prismCount).toBe(0); expect(field.referenceCount).toBe(0); expect(cell(field, 40, 40)).toEqual({ contact: 0, refs: [] });
    field.dispose();
  });
  it("publishes solid-instance counts independently of shared frames and contact-only records", () => {
    const field = createWorldOcclusion(), frame = trackedFrame();
    const first = normalizedRecord("first", frame), second = normalizedRecord("second", frame, 70);
    const contact = record("contact-only", [40, 40, 0, 1], { volumes: [] });
    try {
      field.update([first, contact], viewport);
      expect(field.instanceCount).toBe(1);
      field.update([first, second, contact], viewport);
      expect(field.instanceCount).toBe(2);
      field.update([contact], viewport);
      expect(field.instanceCount).toBe(0);
    } finally { field.dispose(); }
  });
  it("retains contact coverage across triangle seams and outward sixteen-bit height bounds", () => {
    const field = createWorldOcclusion();
    field.update([record("body", [], { volumes: [box(40, 40, 60, 60, 0, 20)] })], viewport, 32);
    expect(cell(field, 51, 51).contact).toBe(1); expect(cell(field, 39, 51).contact).toBe(0); expect(cell(field, 61, 51).contact).toBe(0);
    field.update([record("thin", [], { volumes: [box(40.1, 40.1, 41.8, 41.8, 25.3, 25.35)] })], viewport, 64);
    for (const v of firstTriangle(field)) { expect(v[2]).toBeLessThanOrEqual(25.3); expect(v[2]).toBeGreaterThan(25.3 - 64 / 65535);
      expect(v[3]).toBeGreaterThanOrEqual(25.35); expect(v[3]).toBeLessThan(25.35 + 64 / 65535); }
    expect(blocked(field, [39, 41, 25.325], [43, 41, 25.325])).toBe(true); expect(blocked(field, [39, 41, 25.4], [43, 41, 25.4])).toBe(false);
    field.dispose();
  });
  it("keeps packed broad bounds conservative across quantized triangles and edge cells", () => {
    const field = createWorldOcclusion();
    field.update([record("tilted", [], { volumes: [volume([-1.003, -1.007, 2.01, 2.08, 5.003, 1.005, 4.02, 4.09, 0.999, 5.001, 8.03, 8.10])] })], viewport, 16);
    const d = firstTriangle(field);
    for (let i = 0; i < 30; i++) { const u = (i + 0.25) / 32, v = (1 - u) * 0.3;
      const x = d[0]![0] * (1 - u - v) + d[1]![0] * u + d[2]![0] * v, y = d[0]![1] * (1 - u - v) + d[1]![1] * u + d[2]![1] * v;
      expect(blocked(field, [x, y, 0], [x, y, 12])).toBe(true); }
    field.dispose();
  });
});

describe("shared source-frame instances", () => {
  const world = (m: Float32Array, h: number, p: Point): Point => {
    const v = -p[1] / 2 - p[2];
    return [m[0]! * p[0] + m[2]! * v + m[4]!, 2 * (m[1]! * p[0] + m[3]! * v + m[5]! - p[2] * h), p[2] * h];
  };
  it("stores one mesh for hundreds of mirrored, sheared and rotated source transforms", () => {
    const shared = [volume([0, 0, 0.25, 0.5, 1, 0, 0.25, 0.5, 0, 1, 0.25, 0.5])];
    const copies = Array.from({ length: 400 }, (_, i) => {
      const angle = (i % 3 - 1) * 0.12, direction = i % 2 ? -1 : 1, h = 8;
      const m = new Float32Array([Math.cos(angle) * 8 * direction, Math.sin(angle) * 8 * direction,
        Math.sin(angle) * h + (i % 4) * 0.3, -Math.cos(angle) * h, 30 + i % 20 * 40, 40 + Math.floor(i / 20) * 40]);
      return record(`body-${i}`, [], { volumes: shared, transform: m, height: h });
    });
    const field = createWorldOcclusion();
    field.update(copies, { minX: 0, minY: 0, maxX: 900, maxY: 1700 }, 16);
    expect(field.prismCount).toBe(1);
    for (const i of [0, 1, 2, 78, 101, 242, 399]) {
      const body = copies[i]!, m = body.transform!;
      expect(blocked(field, world(m, 8, [0.2, -1.4, 0]), world(m, 8, [0.2, -1.4, 0.7]))).toBe(true);
      expect(blocked(field, world(m, 8, [0.2, -1.4, 0.1]), world(m, 8, [0.2, -1.4, 0.2]))).toBe(false);
      expect(blocked(field, world(m, 8, [0.2, -1.4, 0.6]), world(m, 8, [0.2, -1.4, 0.8]))).toBe(false);
      expect(blocked(field, world(m, 8, [0.9, -2.9, 0]), world(m, 8, [0.9, -2.9, 0.7]))).toBe(false);
    }
    field.dispose();
  });
  it("distinguishes normalized frames from global data sharing the same volume array", () => {
    const shared = [volume([10, 10, 2, 4, 11, 10, 2, 4, 10, 11, 2, 4])];
    const field = createWorldOcclusion();
    field.update([record("local", [], { volumes: shared, transform: new Float32Array([8, 0, 0, -8, 0, 100]), height: 8 }),
      record("world", [], { volumes: shared })], { minX: -200, minY: -200, maxX: 300, maxY: 300 }, 64);
    expect(field.prismCount).toBe(2);
    expect(blocked(field, [10.2, 10.2, 0], [10.2, 10.2, 5])).toBe(true);
    expect(blocked(field, [81.6, -27.2, 0], [81.6, -27.2, 40])).toBe(true);
    field.dispose();
  });
  it("keeps source ground contact under a mirrored instance and leaves elevated overhangs clear", () => {
    const shared = [volume([0, 0, 0, 0.5, 1, 0, 0, 0.5, 0, 1, 0, 0.5])];
    const field = createWorldOcclusion(), m = new Float32Array([-20, 0, 0, -20, 80, 100]);
    field.update([record("ground", [], { volumes: shared, transform: m, height: 20 })], viewport, 32);
    const p = world(m, 20, [0.25, -1.5, 0]);
    expect(cell(field, p[0], p[1]).contact).toBe(1);
    field.update([record("raised", [], { volumes: [volume([0, 0, 0.25, 0.5, 1, 0, 0.25, 0.5, 0, 1, 0.25, 0.5])], transform: m, height: 20 })], viewport, 32);
    expect(cell(field, p[0], p[1]).contact).toBe(0); field.dispose();
  });
  it("rejects singular transforms and oversized hierarchies without discarding the published field", () => {
    const field = createWorldOcclusion(), valid = record("valid", [], { volumes: [box(40, 40, 50, 50, 0, 20)] });
    field.update([valid], viewport, 32); const revision = field.revision;
    expect(() => field.update([record("singular", [], { volumes: valid.volumes, transform: new Float32Array([1, 1, 1, 1, 0, 0]), height: 20 })], viewport, 32)).toThrow("invertible source transform");
    const tooMany = volume([40, 40, 5, 6, 41, 40, 5, 6, 40, 41, 5, 6]);
    tooMany.indices = new Uint16Array(Array.from({ length: 32769 * 3 }, (_, i) => i % 3));
    expect(() => field.update([record("oversized", [], { volumes: [tooMany] })], viewport, 32)).toThrow("BVH nodes");
    expect(field.revision).toBe(revision); expect(blocked(field, [39, 45, 10], [51, 45, 10])).toBe(true);
    field.dispose();
  });
  it("packs wind groups independently of the source-transform flag and preserves fixed instance slots", () => {
    const shared = [box(0, 0, 1, 1, 0.25, 0.5)], field = createWorldOcclusion();
    for (const normalized of [false, true]) for (const group of [undefined, 0, 3, 4, 7]) {
      field.update([record(`flags-${normalized}-${group}`, [], { volumes: shared,
        ...(normalized ? { transform: new Float32Array([8, 0, 0, -8, 40, 40]) } : {}),
        height: 8, footY: 64, wind: group })], viewport, 32);
      const id = uint24(bytes(field.references), 0), mesh = instance(field, id);
      expect(mesh.flags).toBe((normalized ? 1 : 0) | (((group ?? -1) + 1) << 1));
      expect(mesh.matrix).toEqual(normalized ? [8, 0, 0, -8, 40, 40, 8] : group === undefined ? [1, 0, 0, 1, 0, 0, 1] : [0, 0.125, -4, 1, 0, 0, 1]);
    }
    field.dispose();
  });
  it("retains swept coarse references for mirrored and sheared source poses outside their base bounds", () => {
    const shared = [box(0, -0.8, 1, 1.6, 0.4, 0.8)], field = createWorldOcclusion();
    for (const sign of [-1, 1]) for (const group of [0, 7]) {
      const base = new Float32Array([0.15 * sign, 0.1, 0.7, -10, 40.19, 60]);
      field.update([record(`swept-${sign}-${group}`, [], { volumes: shared, transform: base, height: 8, wind: group })], viewport, 32);
      const limit = group < 4 ? MAX_WORLD_WIND : MAX_SMALL_WORLD_WIND;
      for (const dx of [-limit, 0, limit]) {
        const pose = base.slice(); pose[2] = pose[2]! - dx; pose[4] = pose[4]! + dx;
        const wind = Array<number>(8).fill(0); wind[group] = dx;
        for (const v of [-0.79, 0.2, 1.59]) {
          const first = world(pose, 8, [0.5, -2 * (v + 0.8), 0.5]);
          const last = world(pose, 8, [0.5, -2 * (v + 0.8), 0.7]);
          expect(blocked(field, first, last, false, wind)).toBe(true);
        }
      }
    }
    field.dispose();
  });
  it("moves thin source occlusion with the supplied pose while leaving root contacts at the base", () => {
    const field = createWorldOcclusion(), base = new Float32Array([0.1, 0, 0, -10, 40.01, 60]);
    field.update([record("rooted", [], { volumes: [box(0, 0, 1, 1, 0, 0.8)], transform: base, height: 8, wind: 0 })], viewport, 32);
    const pose = base.slice(); pose[2] = pose[2]! - 5; pose[4] = pose[4]! + 5;
    const first = world(pose, 8, [0.5, -2, 0.5]), last = world(pose, 8, [0.5, -2, 0.5125]);
    expect(blocked(field, first, last, false, [5])).toBe(true);
    expect(blocked(field, first, last, false, [0])).toBe(false);
    expect(cell(field, first[0], first[1]).refs).toHaveLength(1);
    expect(cell(field, first[0], first[1]).contact).toBe(0);
    field.dispose();
  });
  it("changes phase groups without re-reading canonical meshes, including in-place descriptor changes", () => {
    const frame = trackedFrame(), caster = { ...normalizedRecord("phase", frame), wind: 0 };
    const field = createWorldOcclusion(); field.update([caster], viewport, 32);
    const initial = field.revision, geometry = field.memoryBytes.cachedGeometry;
    frame.reset(); caster.wind = 7; field.update([caster], viewport, 32);
    expect(field.revision).toBe(initial + 1); expect(frame.reads).toBe(0);
    expect(instance(field, uint24(bytes(field.references), 0)).flags).toBe(17);
    expect(field.memoryBytes.cachedGeometry).toBe(geometry);
    const snapshot = packedSnapshot(field), revision = field.revision;
    const uploads = [field.texture, field.references, field.prisms].map((texture) => vi.spyOn(texture.source, "update"));
    for (let i = 0; i < 8; i++) field.update([caster], viewport, 32);
    expect(field.revision).toBe(revision); expect(matchesSnapshot(field, snapshot)).toEqual([true, true, true]);
    for (const upload of uploads) { expect(upload).not.toHaveBeenCalled(); upload.mockRestore(); }
    field.dispose();
  });
  it("rejects invalid wind poses and transforms singular within the swept interval", () => {
    const field = createWorldOcclusion(), shared = [box(40, 40, 41, 41, 0, 8)];
    field.update([record("safe", [], { volumes: shared })], viewport, 32);
    const revision = field.revision, snapshot = packedSnapshot(field);
    for (const group of [-1, 8, 0.5, Number.NaN])
      expect(() => field.update([record(`invalid-${group}`, [], { volumes: shared, wind: group, height: 8 })], viewport, 32)).toThrow("wind requires a group");
    expect(() => field.update([record("no-height", [], { volumes: shared, wind: 0 })], viewport, 32)).toThrow("wind requires a group");
    expect(() => field.update([record("singular-sway", [], { volumes: shared, wind: 0, height: 8, transform: new Float32Array([1, 1, 0, 1, 40, 40]) })], viewport, 32)).toThrow("invertible source transform");
    expect(field.revision).toBe(revision); expect(matchesSnapshot(field, snapshot)).toEqual([true, true, true]);
    field.dispose();
  });
});

describe("global wind occlusion", () => {
  const pose = (p: Point, dx: number, rootY: number, height: number): Point => [p[0] + dx * (p[1] * 0.5 + p[2] - rootY) / height, p[1], p[2]];
  it("matches a rotated and mirrored source matrix while swept cells retain the entire custom silhouette", () => {
    const field = createWorldOcclusion();
    for (const angle of [-0.8, 0.55]) for (const mirror of [-1, 1]) {
      const m = new Float32Array([20 * mirror * Math.cos(angle), 20 * mirror * Math.sin(angle), 40 * Math.sin(angle), -40 * Math.cos(angle), 0, 0]);
      m[4] = 40.025 - m[0]! * 0.5 - m[2]! * 0.2;
      m[5] = 35.505 - m[1]! * 0.5 - m[3]! * 0.2;
      const footY = 2 * (m[1]! * 0.5 + m[3]! + m[5]!);
      field.update([record(`rotated-${angle}-${mirror}`, [], { volumes: [box(40.005, 59.99, 40.045, 60.03, 5, 6)], wind: 3, windProjection: m, height: 40, footY })], viewport, 32);
      // Recover the base source UV, then apply its independently posed forward screen matrix.
      const forward = (p: Point, dx: number): Point => {
        const x = p[0] - m[4]!, y = p[1] * 0.5 + p[2] - m[5]!, determinant = m[0]! * m[3]! - m[1]! * m[2]!;
        const u = (m[3]! * x - m[2]! * y) / determinant, v = (m[0]! * y - m[1]! * x) / determinant;
        return [m[0]! * u + (m[2]! - dx) * v + m[4]! + dx, p[1], p[2]];
      };
      for (const dx of [-5, 0, 5]) {
        const first = forward([40.025, 60.01, 5.1], dx), last = forward([40.025, 60.01, 5.9], dx), wind = [0, 0, 0, dx];
        expect(cell(field, first[0], first[1]).refs).toHaveLength(1);
        expect(blocked(field, first, last, false, wind)).toBe(true);
        if (dx) expect(blocked(field, first, last)).toBe(false);
        const decoded = instance(field, cell(field, first[0], first[1]).refs[0]!.id, wind).local(first);
        expect(decoded[0]).toBeCloseTo(40.025, 4);
        expect(decoded[1]).toBe(60.01); expect(decoded[2]).toBe(5.1);
      }
    }
    field.dispose();
  });
  it("rejects raw projections that are singular or collapse within a wind pose while retaining valid fields", () => {
    const field = createWorldOcclusion(), volumes = [box(40, 40, 41, 41, 5, 6)];
    field.update([record("valid-raw", [], { volumes })], viewport, 32);
    const revision = field.revision, snapshot = packedSnapshot(field);
    for (const values of [[1, 1, 1, 1, 0, 0], [1, 1, 0, 1, 0, 0], [1, 0, 0, 1, Number.NaN, 0], [1, 0, 0, 1, 0]])
      expect(() => field.update([record(`bad-raw-${values}`, [], { volumes, wind: 0, height: 8, windProjection: new Float32Array(values) })], viewport, 32)).toThrow("wind projection invertible");
    // The packed uniform's upper Float32 neighbor can cross zero even when the decimal cap does not.
    expect(() => field.update([record("small-f32-collapse", [], { volumes, wind: 7, height: 8, windProjection: new Float32Array([1, 5 / 12, 0, 1, 0, 0]) })], viewport, 32)).toThrow("wind projection invertible");
    expect(field.revision).toBe(revision); expect(matchesSnapshot(field, snapshot)).toEqual([true, true, true]);
    field.dispose();
  });
  it("inverts raw custom geometry without interpreting its wind flag as a normalized transform", () => {
    const field = createWorldOcclusion();
    field.update([record("raw", [], { volumes: [box(40.02, 40, 40.08, 40.04, 5, 6)], wind: 7, height: 10, footY: 100 })], viewport, 32);
    const limit = MAX_SMALL_WORLD_WIND;
    for (const dx of [-limit, 0, limit]) {
      const first = pose([40.05, 40.02, 5.2], dx, 50, 10), last = pose([40.05, 40.02, 5.8], dx, 50, 10);
      const wind = [0, 0, 0, 0, 0, 0, 0, dx];
      expect(blocked(field, first, last, false, wind)).toBe(true);
      if (dx) expect(blocked(field, first, last)).toBe(false);
    }
    field.dispose();
  });
  it("sweeps point-rasterized custom foliage without filling its elevated clearance or contact", () => {
    const field = createWorldOcclusion();
    field.update([record("fallback", [40, 40, 8, 2], { wind: 0, height: 10, footY: 80 })], viewport, 32);
    for (const dx of [-5, 0, 5]) {
      const first = pose([41, 41, 7.1], dx, 40, 10), last = pose([41, 41, 7.9], dx, 40, 10);
      expect(blocked(field, first, last, false, [dx])).toBe(true);
      expect(cell(field, first[0], first[1]).contact).toBe(0);
      expect(blocked(field, pose([41, 41, 1], dx, 40, 10), pose([41, 41, 2], dx, 40, 10), false, [dx])).toBe(false);
    }
    field.dispose();
  });
});

describe("custom-art occlusion profiles", () => {
  it("retains solid samples, elevated clearance, building bodies and contact", () => {
    const field = createWorldOcclusion();
    field.update([record("canopy", [40, 40, 100, 2]), record("building", [], { shape: "building", width: 100, height: 100, footX: 100, footY: 100 })], viewport, 128);
    expect(blocked(field, [39, 40.5, 50], [43, 40.5, 50])).toBe(false); expect(blocked(field, [39, 40.5, 80], [43, 40.5, 80])).toBe(true);
    expect(blocked(field, [100, 90, 20], [100, 130, 20])).toBe(true); expect(cell(field, 100, 101).contact).toBeGreaterThan(0);
    field.update([record("tall", [40, 40, 900, 1]), record("far", [-10000, 0, 70, 1])], viewport, 256);
    expect(Math.max(...triangle(field, cell(field, 41, 41).refs[0]!.id).map((v) => v[3]))).toBe(256); expect(cell(field, 0, 0).refs).toEqual([]);
    field.dispose();
  });
});

describe("retained exact occlusion fields", () => {
  it("reuses a returning canonical frame while exact Float32 poses rebuild instance headers and stamps", () => {
    const a = trackedFrame(), b = trackedFrame(1, 0.75), field = createWorldOcclusion();
    try {
      const original = normalizedRecord("a-original", a);
      field.update([original], viewport, 32);
      expect(a.reads).toBeGreaterThan(0);
      const before = packedSnapshot(field), geometryBytes = field.memoryBytes.cachedGeometry;
      a.reset();
      const moved = normalizedRecord("a-moved", a, 40.1875);
      field.update([moved], viewport, 32);
      expect(a.reads).toBe(0);
      const address = uint24(bytes(field.references), 0), table = bytes(field.prisms);
      expect(new DataView(table.buffer, table.byteOffset, table.byteLength).getFloat32((address + 5) * 4))
        .toBe(moved.transform![4]!);
      expect(matchesSnapshot(field, before).slice(1)).toEqual([false, false]);
      field.update([normalizedRecord("b", b)], viewport, 32);
      expect(b.reads).toBeGreaterThan(0);
      expect(field.memoryBytes.cachedGeometry).toBe(geometryBytes * 2);
      field.update([original], viewport, 32);
      expect(a.reads).toBe(0);
      expect(matchesSnapshot(field, before)).toEqual([true, true, true]);
      expect(field.revision).toBe(4);
      field.update([], viewport, 32);
      expect(field.prismCount).toBe(0); expect(field.referenceCount).toBe(0);
      expect(field.memoryBytes.cachedGeometry).toBe(geometryBytes * 2);
      expect(field.memoryBytes.cachedStamps).toBe(0);
    } finally { field.dispose(); }
    expect(field.memoryBytes.cachedGeometry).toBe(0);
    expect(field.memoryBytes.cachedStamps).toBe(0);
  });
  it("keeps active canonical meshes outside the four MiB idle budget and evicts least recently used frames", () => {
    const frames = Array.from({ length: 9 }, () => trackedFrame(16384));
    const casters = frames.map((frame, i) => normalizedRecord(`frame-${i}`, frame));
    const field = createWorldOcclusion(), a = frames[0]!;
    try {
      field.update([casters[0]!], viewport, 32);
      const geometryBytes = field.memoryBytes.cachedGeometry, budget = 4 * 1024 * 1024;
      field.update(casters.slice(0, 8), viewport, 32);
      expect(field.memoryBytes.cachedGeometry).toBe(geometryBytes * 8);
      expect(field.memoryBytes.cachedGeometry).toBeGreaterThan(budget);
      for (const frame of frames) frame.reset();
      field.update([casters[0]!], viewport, 32);
      expect(a.reads).toBe(0);
      expect(field.memoryBytes.cachedGeometry).toBe(geometryBytes * 7);
      expect(field.memoryBytes.cachedGeometry - geometryBytes).toBeLessThanOrEqual(budget);
      field.update([casters[0]!, casters[2]!], viewport, 32);
      expect(frames[2]!.reads).toBe(0);
      field.update([casters[0]!], viewport, 32);
      field.update([casters[0]!, casters[8]!], viewport, 32);
      expect(frames[8]!.reads).toBeGreaterThan(0);
      field.update([casters[0]!], viewport, 32);
      field.update([casters[0]!, casters[2]!], viewport, 32);
      expect(frames[2]!.reads).toBe(0);
      field.update([casters[0]!, casters[1]!], viewport, 32);
      expect(frames[1]!.reads).toBeGreaterThan(0);
      field.update([casters[0]!, casters[3]!], viewport, 32);
      expect(frames[3]!.reads).toBeGreaterThan(0);
      expect(a.reads).toBe(0);
      field.update([], viewport, 32);
      expect(field.memoryBytes.cachedGeometry).toBeLessThanOrEqual(budget);
      expect(field.memoryBytes.cachedStamps).toBe(0);
    } finally { field.dispose(); }
    expect(field.memoryBytes.cachedGeometry).toBe(0);
    field.update(casters, viewport, 32);
    expect(field.memoryBytes.cachedGeometry).toBe(0);
  }, 15000);
  it("prunes unused global volumes and rasterized fallbacks instead of retaining mutable source keys", () => {
    const frame = trackedFrame(), field = createWorldOcclusion();
    try {
      const global = record("global", [], { volumes: frame.volumes });
      field.update([global], viewport, 32);
      expect(frame.reads).toBeGreaterThan(0); frame.reset();
      field.update([], viewport, 32);
      expect(field.memoryBytes.cachedGeometry).toBe(0);
      for (const index of [3, 7, 11]) frame.source[index] = 4;
      field.update([global], viewport, 32);
      expect(frame.reads).toBeGreaterThan(0);
      expect(firstTriangle(field).every((vertex) => vertex[3] === 4)).toBe(true);
      const fallback = record("fallback", [40, 40, 6, 1]);
      field.update([fallback], viewport, 16);
      expect(field.prismCount).toBeGreaterThan(0);
      field.update([], viewport, 16);
      expect(field.memoryBytes.cachedGeometry).toBe(0);
      fallback.points[2] = 3;
      field.update([fallback], viewport, 8);
      expect(blocked(field, [39, 40.5, 2], [43, 40.5, 2])).toBe(true);
      expect(blocked(field, [39, 40.5, 5], [43, 40.5, 5])).toBe(false);
      field.update([], { minX: 0, minY: 0, maxX: 2000, maxY: 2000 }, 8);
      expect(field.memoryBytes.cachedGeometry).toBe(0);
    } finally { field.dispose(); }
  });
  it("retires geometry from rejected work while preserving the last complete publication and reusable frames", () => {
    const a = trackedFrame(), b = trackedFrame(1, 0.75), onError = vi.fn();
    const field = createWorldOcclusion({ onError });
    try {
      const original = normalizedRecord("a", a), next = normalizedRecord("b", b);
      field.update([original], viewport, 32);
      const before = packedSnapshot(field), geometryBytes = field.memoryBytes.cachedGeometry;
      const invalid = normalizedRecord("singular", trackedFrame());
      invalid.transform = new Float32Array([1, 1, 1, 1, 0, 0]);
      field.update([next, record("temporary-global", [], { volumes: [box(40, 40, 50, 50, 2, 4)] }), invalid], viewport, 32);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(field.error?.message).toContain("invertible source transform");
      expect(field.revision).toBe(1);
      expect(matchesSnapshot(field, before)).toEqual([true, true, true]);
      expect(field.memoryBytes.cachedGeometry).toBe(geometryBytes * 2);
      a.reset(); b.reset();
      field.update([next], viewport, 32);
      expect(field.error).toBeNull(); expect(b.reads).toBe(0);
      field.update([original], viewport, 32);
      expect(a.reads).toBe(0);
      expect(matchesSnapshot(field, before)).toEqual([true, true, true]);
    } finally { field.dispose(); }
    expect(field.memoryBytes.cachedGeometry).toBe(0);
  });
  it("retains canonical frames across queued supersession without exposing incomplete buffers", async () => {
    const a = trackedFrame(), b = trackedFrame(1, 0.75), seen: { revision: number; sources: Uint8Array[] }[] = [];
    const field = createWorldOcclusion({ incremental: true, budgetMs: 0.25,
      onUpdate: () => seen.push({ revision: field.revision, sources: packedSnapshot(field) }) });
    let clock = 0;
    const now = vi.spyOn(performance, "now").mockImplementation(() => clock++);
    try {
      const original = normalizedRecord("a", a);
      field.update([original], viewport, 32);
      for (let i = 0; i < 100 && !a.reads; i++) await new Promise((resolve) => setTimeout(resolve, 1));
      expect(a.reads).toBeGreaterThan(0);
      expect(field.revision).toBe(0);
      field.update([normalizedRecord("b", b)], viewport, 32);
      await waitForRevision(field, 2);
      a.reset();
      field.update([original], viewport, 32);
      await waitForRevision(field, 3);
      expect(a.reads).toBe(0);
      expect(seen.map((entry) => entry.revision)).toEqual([1, 2, 3]);
      expect(matchesSnapshot(field, seen[0]!.sources)).toEqual([true, true, true]);
      expect(field.memoryBytes.cachedGeometry).toBeLessThan(4 * 1024 * 1024);
    } finally { now.mockRestore(); field.dispose(); }
    expect(field.memoryBytes.cachedGeometry).toBe(0);
    expect(field.memoryBytes.cachedStamps).toBe(0);
  });
  it("retains all three sources, reuses covered domains and skips unchanged uploads", () => {
    const field = createWorldOcclusion(), sources = [field.texture.source, field.references.source, field.prisms.source], uploads = sources.map((s) => vi.spyOn(s, "update"));
    const caster = record("body", [], { volumes: [box(40, 40, 60, 60, 0, 20)] }); field.update([caster], viewport, 32);
    const revision = field.revision, previous = { ...field.bounds }; uploads.forEach((u) => u.mockClear());
    field.update([caster], { minX: 32, minY: 32, maxX: 160, maxY: 160 }, 32);
    expect(field.revision).toBe(revision); expect(field.bounds).toEqual(previous); expect(uploads.every((u) => u.mock.calls.length === 0)).toBe(true);
    field.update([caster], { minX: 1200, minY: 1200, maxX: 1328, maxY: 1328 }, 32);
    expect([field.texture.source, field.references.source, field.prisms.source]).toEqual(sources); expect(field.prismCount).toBe(0);
    expect(field.memoryBytes.cachedGeometry).toBeGreaterThan(0); expect(field.memoryBytes.cachedStamps).toBeGreaterThanOrEqual(0); field.dispose();
  });
  it("retains local quantization when other geometry expands the scene or its coarse height range changes", () => {
    const original = box(40.01, 40.01, 40.08, 40.08, 5, 6); let reads = 0;
    const vertices = new Proxy(original.vertices, { get(target, key) { if (typeof key === "string" && /^\d+$/.test(key)) reads++; return Reflect.get(target, key, target); } });
    const caster = record("cached", [], { volumes: [{ ...original, vertices }] }), field = createWorldOcclusion(); field.update([caster], viewport, 16);
    expect(reads).toBeGreaterThan(0); reads = 0; const before = firstTriangle(field);
    field.update([caster, record("expand", [], { volumes: [box(1000, 1000, 1020, 1020, 0, 1)] })], viewport, 16);
    expect(reads).toBe(0); expect(field.geometryBounds).toEqual({ minX: 0, minY: 0, maxX: 1, maxY: 1 });
    expect(triangle(field, cell(field, 40.04, 40.04).refs[0]!.id)).toEqual(before);
    expect(blocked(field, [40.04, 40.04, 0], [40.04, 40.04, 10])).toBe(true);
    field.update([caster], viewport, 8); expect(reads).toBe(0); expect(field.heightRange).toBe(8); expect(blocked(field, [40.04, 40.04, 0], [40.04, 40.04, 10])).toBe(true); field.dispose();
  });
  it("publishes every table, domain and decoding range together after asynchronous work", async () => {
    const seen: { range: number; revision: number; blocked: boolean; count: number }[] = [];
    const field = createWorldOcclusion({ incremental: true, onUpdate: () => seen.push({ range: field.heightRange, revision: field.revision,
      blocked: blocked(field, [1245, 1245, 0], [1245, 1245, 200]), count: field.prismCount }) });
    field.update([], viewport, 32); await waitForRevision(field, 1);
    const sources = [field.texture.source, field.references.source, field.prisms.source], old = sources.map((s) => new Uint8Array((s as BufferImageSource).resource as Uint8Array)), previous = { ...field.bounds };
    field.update([record("next", [], { volumes: [box(1240, 1240, 1250, 1250, 80, 100)] })], { minX: 1200, minY: 1200, maxX: 1328, maxY: 1328 }, 128);
    expect(field.heightRange).toBe(32); expect(field.bounds).toEqual(previous); expect(sources.map((s) => (s as BufferImageSource).resource)).toEqual(old);
    const uploads = sources.map((source) => vi.spyOn(source, "update").mockImplementation(() => {
      expect(field.heightRange).toBe(128); expect(field.revision).toBe(2);
      expect(field.references.source.pixelHeight).toBe(16); expect(field.prisms.source.pixelHeight).toBe(16);
      expect(blocked(field, [1245, 1245, 0], [1245, 1245, 200])).toBe(true);
    }));
    await waitForRevision(field, 2); expect([field.texture.source, field.references.source, field.prisms.source]).toEqual(sources);
    expect(uploads.every((upload) => upload.mock.calls.length === 1)).toBe(true);
    expect(seen).toEqual([{ range: 32, revision: 1, blocked: false, count: 0 }, { range: 128, revision: 2, blocked: true, count: 2 }]); field.dispose();
  });
  it("shares dense geometry and supports sixteen-bit instance counts with recoverable overflow", () => {
    const field = createWorldOcclusion(), shared = [volume([40.1, 40.1, 5, 6, 41.8, 40.1, 5, 6, 40.1, 41.8, 5, 6])];
    const copies = (count: number) => Array.from({ length: count }, (_, i) => record(`copy-${i}`, [], { volumes: shared }));
    field.update(copies(300), viewport, 16);
    expect(field.maxCandidates).toBe(300); expect(cell(field, 40.5, 40.5).refs).toHaveLength(300);
    expect(field.prismCount).toBe(1); expect(field.prisms.source.pixelHeight).toBe(16);
    const previous = [field.texture, field.references, field.prisms].map((t) => bytes(t).slice()), revision = field.revision;
    expect(() => field.update(copies(MAX_CELL_INSTANCES + 1), viewport, 16)).toThrow("instances in one cell");
    expect(field.error).toBeInstanceOf(RangeError); expect(field.revision).toBe(revision);
    expect([field.texture, field.references, field.prisms].map(bytes)).toEqual(previous);
    field.update([record("recovered", [], { volumes: shared })], viewport, 16);
    expect(field.error).toBeNull(); expect(field.maxCandidates).toBe(1); field.dispose();
  });
  it("traverses more than a thousand thin layers in one instance without closing their gaps", () => {
    const field = createWorldOcclusion();
    const layers = Array.from({ length: 2049 }, (_, i) => volume([40.1, 40.1, i / 100, i / 100 + 0.001,
      41.8, 40.1, i / 100, i / 100 + 0.001, 40.1, 41.8, i / 100, i / 100 + 0.001]));
    field.update([record("layers", [], { volumes: layers })], viewport, 32);
    expect(field.maxCandidates).toBe(1); expect(field.prismCount).toBe(2049);
    for (const i of [0, 1, 57, 850, 2048]) {
      expect(blocked(field, [39, 40.5, i / 100 + 0.0005], [42, 40.5, i / 100 + 0.0005])).toBe(true);
      expect(blocked(field, [39, 40.5, i / 100 + 0.006], [42, 40.5, i / 100 + 0.006])).toBe(false);
    }
    field.dispose();
  });
  it("reports asynchronous rejection once, retains usable old geometry and recovers", async () => {
    const onError = vi.fn(), field = createWorldOcclusion({ incremental: true, onError });
    field.update([record("valid", [], { volumes: [box(40, 40, 50, 50, 0, 20)] })], viewport, 32); await waitForRevision(field, 1);
    const shared = [box(40, 40, 41, 41, 5, 6)], bad = Array.from({ length: MAX_CELL_INSTANCES + 1 }, (_, i) => record(`invalid-${i}`, [], { volumes: shared }));
    field.update(bad, viewport, 32); for (let i = 0; i < 3000 && !field.error; i++) await new Promise((r) => setTimeout(r, 1));
    expect(onError).toHaveBeenCalledTimes(1); expect(field.revision).toBe(1); expect(blocked(field, [39, 45, 10], [51, 45, 10])).toBe(true);
    field.update(bad, viewport, 32); await new Promise((r) => setTimeout(r, 10)); expect(onError).toHaveBeenCalledTimes(1);
    field.update([], viewport, 32); await waitForRevision(field, 2); expect(field.error).toBeNull(); expect(field.referenceCount).toBe(0); expect(field.prismCount).toBe(0); field.dispose();
  });
  it("finishes queued work before publishing a newer camera and geometry packet", async () => {
    const field = createWorldOcclusion({ incremental: true, budgetMs: 0.25 }); let clock = 0;
    const now = vi.spyOn(performance, "now").mockImplementation(() => clock++);
    try {
      field.update([record("first", [], { volumes: [box(40, 40, 50, 50, 0, 20)] })], viewport, 32); await new Promise((r) => setTimeout(r, 3));
      field.update([record("next", [], { volumes: [box(1240, 1240, 1250, 1250, 90, 100)] })], { minX: 1200, minY: 1200, maxX: 1328, maxY: 1328 }, 128);
      await waitForRevision(field, 2); expect(field.heightRange).toBe(128); expect(field.bounds.minX).toBeLessThanOrEqual(1200);
      expect(blocked(field, [1239, 1245, 95], [1251, 1245, 95])).toBe(true); expect(blocked(field, [1239, 1245, 50], [1251, 1245, 50])).toBe(false);
    } finally { now.mockRestore(); field.dispose(); }
  });
  it("publishes range-only metadata changes even when all packed buffers stay identical", () => {
    const field = createWorldOcclusion(), caster = record("high", [], { volumes: [box(40, 40, 50, 50, 0, 900)] });
    field.update([caster], viewport, 512); const revision = field.revision, uploads = [field.texture, field.references, field.prisms].map((t) => vi.spyOn(t.source, "update"));
    field.update([caster], viewport, 256); expect(field.revision).toBe(revision + 1); expect(field.heightRange).toBe(256); expect(uploads.every((u) => u.mock.calls.length === 0)).toBe(true); field.dispose();
  });
  it("cancels queued work and destroys every retained source exactly once", async () => {
    const onUpdate = vi.fn(), field = createWorldOcclusion({ incremental: true, onUpdate }), textures = [field.texture, field.references, field.prisms], destroy = textures.map((t) => vi.spyOn(t, "destroy"));
    field.update([record("body", [], { volumes: [box(40, 40, 50, 50, 0, 20)] })], viewport, 32); field.dispose(); field.dispose(); await new Promise((r) => setTimeout(r, 10));
    expect(onUpdate).not.toHaveBeenCalled(); expect(field.revision).toBe(0); expect(destroy.every((s) => s.mock.calls.length === 1)).toBe(true); expect(textures.every((t) => t.destroyed)).toBe(true);
  });
});

it("keeps exact point lighting and the final composite within seven samplers each", () => {
  expect(pointLightFragment.match(/uniform sampler2D/g)).toHaveLength(7); expect(lightingFragment.match(/uniform sampler2D/g)).toHaveLength(7);
});

it.each([pointLightFragment, lightingFragment])("declares numeric sample precision before sampler uniforms and helper parameters", (fragment) => {
  const precision = fragment.indexOf("precision highp sampler2D;");
  expect(precision).toBeGreaterThanOrEqual(0);
  expect(Array.from(fragment.matchAll(/precision\s+(\w+)\s+sampler2D\s*;/g), (match) => match[1])).toEqual(["highp"]);
  for (const declaration of fragment.matchAll(/\bsampler2D\s+\w+/g))
    expect(declaration.index).toBeGreaterThan(precision);
});
