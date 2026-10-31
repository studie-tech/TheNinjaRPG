import { BufferImageSource, Texture } from "pixi.js";
import type { WorldBounds } from "@/libs/rendering/visibility";
import type { WorldShadowShape } from "@/libs/rendering/worldShadows";
import { MAX_SMALL_WORLD_WIND, MAX_WORLD_WIND } from "@/libs/rendering/worldWind";

const FIELD_SIZE = 512;
const TABLE_WIDTH = 2048;
const DEFAULT_HEIGHT_RANGE = 512;
const MAX_TEXELS = TABLE_WIDTH * TABLE_WIDTH;
const MAX_REFERENCES = MAX_TEXELS / 2;
const LEAF_SIZE = 8;
const normalizedVolumeKeys = new WeakMap<NonNullable<Occluder["volumes"]>, object>();
export const MAX_CELL_INSTANCES = 1024;
export const MAX_BVH_NODES = 8192;

/**
 * Cells reference instances, while identical frames share one exact local mesh and stackless BVH.
 * Header tiles store offset24/countLow8 and countHigh8/0/contact8/0. Each reference contains
 * instanceTexel24/lowerZ8, then upperZ8/minXY4/maxXY4/0. The geometry table retains IEEE Float32
 * transforms and sixteen-bit closed prisms, so baseline RGBA8 textures preserve every air gap.
 * Instance alpha stores the normalized-transform bit and a one-based wind code in the upper bits.
 */
export const createWorldOcclusion = (
  options: {
    incremental?: boolean;
    onUpdate?: () => void;
    onError?: (error: Error) => void;
    budgetMs?: number;
  } = {},
) => {
  const header = createFieldBuffer(FIELD_SIZE * 2, FIELD_SIZE, !options.incremental),
    references = createFieldBuffer(TABLE_WIDTH, 1),
    prisms = createFieldBuffer(TABLE_WIDTH, 1);
  const buffers = [header, references, prisms];
  const bounds: WorldBounds = { minX: 0, minY: 0, maxX: 1024, maxY: 1024 };
  // Geometry positions are local. This fixed origin lets shaders undo the scene's floating origin.
  const geometryBounds: WorldBounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  const geometries = new Map<GeometryKey, CasterGeometry>();
  const idleGeometries = new Map<GeometryKey, CasterGeometry>();
  const idleBudget = 4 * 1024 * 1024;
  let idleBytes = 0;
  const stamps = new Map<string, InstanceStamp>();
  let published: FieldRequest | null = null,
    requested: FieldRequest | null = null,
    rejected: FieldRequest | null = null,
    active: FieldRequest | null = null,
    job: Generator<void, FieldResult> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false,
    revision = 0,
    maxCandidates = 0,
    prismCount = 0,
    referenceCount = 0,
    instanceCount = 0,
    precision = 0;
  let error: Error | null = null;

  const retainGeometries = (wanted: ReadonlySet<GeometryKey>) => {
    for (const [key, geometry] of geometries) {
      if (wanted.has(key)) {
        if (idleGeometries.delete(key)) idleBytes -= geometryBytes(geometry);
      } else if (typeof key === "object" && !Array.isArray(key)) {
        // Only immutable normalized frames have opaque keys; global arrays and fallback strings remain request-scoped.
        if (!idleGeometries.has(key)) {
          idleGeometries.set(key, geometry);
          idleBytes += geometryBytes(geometry);
        }
      } else geometries.delete(key);
    }
    // Reclaim every wanted frame before trimming so swaps between actors retain shared geometry.
    for (const [key, geometry] of idleGeometries) {
      if (idleBytes <= idleBudget) break;
      idleGeometries.delete(key);
      geometries.delete(key);
      idleBytes -= geometryBytes(geometry);
    }
  };

  function* build(request: FieldRequest): Generator<void, FieldResult> {
    const { records, cell, domain, heightRange } = request;
    if (!(heightRange > 0 && Number.isFinite(heightRange)))
      throw new RangeError("World occlusion height range must be positive and finite");
    const keys = records.map((record) => geometryKey(record, cell, heightRange));
    retainGeometries(new Set(keys));
    const stampPrefix = `${cell}:${heightRange}:`;
    const wantedStamps = new Set(
      records.map((record) => stampPrefix + stampKey(record)),
    );
    for (const key of stamps.keys()) if (!wantedStamps.has(key)) stamps.delete(key);
    const entries: {
      record: Occluder;
      geometry: CasterGeometry;
      stamp: InstanceStamp;
      address: number;
    }[] = [];
    const geometryAddresses = new Map<CasterGeometry, number>();
    let texels = 0,
      totalPrisms = 0,
      worldPrecision = 0;
    for (let index = 0; index < records.length; index++) {
      const record = records[index],
        key = keys[index];
      if (!record || key === undefined) continue;
      validateTransform(record);
      let geometry = geometries.get(key);
      if (!geometry) {
        geometry = yield* casterGeometry(record, cell, heightRange);
        geometries.set(key, geometry);
      }
      const keyForStamp = stampPrefix + stampKey(record);
      let stamp = stamps.get(keyForStamp);
      if (!stamp) {
        stamp = yield* instanceStamp(record, geometry, cell);
        stamps.set(keyForStamp, stamp);
      }
      if (!overlaps(stamp.bounds, domain) && !stamp.contacts.length) continue;
      if (
        geometry.order.length &&
        overlaps(stamp.bounds, domain) &&
        !geometryAddresses.has(geometry)
      ) {
        geometryAddresses.set(geometry, texels);
        texels += 5 + (geometry.nodes.length / 9) * 5 + geometry.order.length * 6;
        totalPrisms += geometry.order.length;
      }
      entries.push({ record, geometry, stamp, address: -1 });
      worldPrecision = Math.max(worldPrecision, stamp.precision);
      yield;
    }
    for (const entry of entries)
      if (entry.geometry.order.length && overlaps(entry.stamp.bounds, domain)) {
        entry.address = texels;
        texels += 8;
      }
    if (texels > MAX_TEXELS)
      throw new RangeError(`World occlusion geometry exceeds ${MAX_TEXELS} texels`);
    const cells = new Map<
      number,
      { contact: number; refs: { id: number; meta: number }[] }
    >();
    const originX = Math.round(domain.minX / cell),
      originY = Math.round(domain.minY / cell);
    const getCell = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= FIELD_SIZE || y >= FIELD_SIZE) return;
      const id = y * FIELD_SIZE + x;
      let value = cells.get(id);
      if (!value) {
        value = { contact: 0, refs: [] };
        cells.set(id, value);
      }
      return value;
    };
    let totalReferences = 0,
      required = 0,
      work = 0;
    for (const entry of entries) {
      const b = entry.stamp.bounds;
      if (entry.address >= 0) {
        const left = Math.max(0, Math.floor(b.minX / cell) - originX),
          right = Math.min(FIELD_SIZE, Math.ceil(b.maxX / cell) - originX),
          bottom = Math.max(0, Math.floor(b.minY / cell) - originY),
          top = Math.min(FIELD_SIZE, Math.ceil(b.maxY / cell) - originY);
        const lower = Math.max(
            0,
            Math.min(255, Math.floor((entry.stamp.minZ * 255) / heightRange)),
          ),
          upper = Math.max(
            0,
            Math.min(255, Math.ceil((entry.stamp.maxZ * 255) / heightRange)),
          );
        for (let y = bottom; y < top; y++)
          for (let x = left; x < right; x++) {
            const minX = Math.max(0, Math.floor((b.minX / cell - x - originX) * 15)),
              minY = Math.max(0, Math.floor((b.minY / cell - y - originY) * 15)),
              maxX = Math.min(15, Math.ceil((b.maxX / cell - x - originX) * 15)),
              maxY = Math.min(15, Math.ceil((b.maxY / cell - y - originY) * 15));
            const target = getCell(x, y);
            if (target) {
              const meta =
                (lower * 16777216 +
                  upper * 65536 +
                  (maxX + maxY * 16) * 256 +
                  minX +
                  minY * 16) >>>
                0;
              target.refs.push({ id: entry.address, meta });
              totalReferences++;
              required = Math.max(required, target.refs.length);
              if (required > MAX_CELL_INSTANCES)
                throw new RangeError(
                  `World occlusion needs ${required} instances in one cell; supports ${MAX_CELL_INSTANCES}`,
                );
              if (totalReferences > MAX_REFERENCES)
                throw new RangeError(
                  `World occlusion references exceed ${MAX_REFERENCES}`,
                );
            }
            if (++work % 128 === 0) yield;
          }
      }
      for (let index = 0; index < entry.stamp.contacts.length; index += 3) {
        const target = getCell(
          (entry.stamp.contacts[index] ?? 0) - originX,
          (entry.stamp.contacts[index + 1] ?? 0) - originY,
        );
        if (target)
          target.contact = Math.max(
            target.contact,
            entry.stamp.contacts[index + 2] ?? 0,
          );
        if (++work % 128 === 0) yield;
      }
    }
    const plans = [
      yield* prepareBuffer(header, FIELD_SIZE),
      yield* prepareBuffer(
        references,
        tableHeight(totalReferences * 2, references.source.pixelHeight),
      ),
      yield* prepareBuffer(prisms, tableHeight(texels, prisms.source.pixelHeight)),
    ];
    let reference = 0;
    for (const [texel, value] of cells) {
      const x = texel % FIELD_SIZE,
        y = Math.floor(texel / FIELD_SIZE),
        index = (y * FIELD_SIZE * 2 + x) * 4;
      header.occupied?.scratch.add(index / 4).add(index / 4 + FIELD_SIZE);
      write24(header.scratch, index, reference);
      header.scratch[index + 3] = value.refs.length & 255;
      header.scratch[index + FIELD_SIZE * 4] = value.refs.length >>> 8;
      header.scratch[index + FIELD_SIZE * 4 + 2] = value.contact;
      value.refs.sort((a, b) => a.meta - b.meta || a.id - b.id);
      for (const { id, meta } of value.refs) {
        const offset = reference++ * 8;
        write24(references.scratch, offset, id);
        references.scratch[offset + 3] = meta >>> 24;
        references.scratch[offset + 4] = (meta >>> 16) & 255;
        references.scratch[offset + 5] = meta & 255;
        references.scratch[offset + 6] = (meta >>> 8) & 255;
        if (++work % 128 === 0) yield;
      }
    }
    const floats = new DataView(prisms.scratch.buffer);
    for (const [geometry, start] of geometryAddresses) {
      for (let i = 0; i < 5; i++)
        floats.setFloat32((start + i) * 4, geometry.header[i] ?? 0);
      const nodeStart = start + 5,
        nodeCount = geometry.nodes.length / 9,
        prismStart = nodeStart + nodeCount * 5;
      for (let n = 0; n < nodeCount; n++) {
        const from = n * 9,
          offset = (nodeStart + n * 5) * 4;
        for (let k = 0; k < 6; k++)
          write16(prisms.scratch, offset + k * 2, geometry.nodes[from + k] ?? 0);
        write24(
          prisms.scratch,
          offset + 12,
          nodeStart + (geometry.nodes[from + 6] ?? 0) * 5,
        );
        prisms.scratch[offset + 15] = geometry.nodes[from + 7] ?? 0;
        write24(
          prisms.scratch,
          offset + 16,
          prismStart + (geometry.nodes[from + 8] ?? 0) * 6,
        );
        if (++work % 128 === 0) yield;
      }
      for (let n = 0; n < geometry.order.length; n++) {
        const triangle = geometry.order[n] ?? 0;
        for (let k = 0; k < 12; k++)
          write16(
            prisms.scratch,
            prismStart * 4 + n * 24 + k * 2,
            geometry.coordinates[triangle * 12 + k] ?? 0,
          );
        if (++work % 128 === 0) yield;
      }
    }
    for (const entry of entries)
      if (entry.address >= 0) {
        const offset = entry.address * 4,
          transform = entry.record.transform;
        write24(prisms.scratch, offset, geometryAddresses.get(entry.geometry) ?? 0);
        prisms.scratch[offset + 3] =
          (transform ? 1 : 0) | (((entry.record.wind ?? -1) + 1) << 1);
        // Raw geometry stores the affine source-height weight in the existing identity slots.
        const parameters = transform
          ? [...transform, entry.record.height]
          : entry.record.wind !== undefined
            ? [...rawWindCoefficients(entry.record), 1, 0, 0, 1]
            : [1, 0, 0, 1, 0, 0, 1];
        for (let i = 0; i < 7; i++)
          floats.setFloat32(offset + 4 + i * 4, parameters[i] ?? 0);
        if (++work % 128 === 0) yield;
      }
    for (const plan of plans) yield* compareBuffer(plan);
    return {
      plans,
      maxCandidates: required,
      prismCount: totalPrisms,
      referenceCount: totalReferences,
      instanceCount: entries.filter((entry) => entry.address >= 0).length,
      precision: worldPrecision,
    };
  }
  const publish = (request: FieldRequest, result: FieldResult) => {
    for (const { buffer } of result.plans)
      if (buffer.occupied) buffer.occupied.pixels = new Set(buffer.occupied.scratch);
    const changed =
      result.plans.some((plan) => plan.end > plan.start || plan.resized) ||
      !sameDomain(published?.domain, request.domain) ||
      published?.heightRange !== request.heightRange ||
      precision !== result.precision;
    if (!changed) {
      published = request;
      error = null;
      rejected = null;
      return;
    }
    // Install all resources and decoding metadata before any source upload can observe this revision.
    for (const plan of result.plans) {
      const { buffer } = plan;
      if (plan.resized) buffer.pixels = new Uint8Array(buffer.scratch.length);
      if (plan.end > plan.start)
        buffer.pixels.set(
          buffer.scratch.subarray(plan.start * 4, plan.end * 4),
          plan.start * 4,
        );
      buffer.source.resource = buffer.pixels;
    }
    Object.assign(bounds, request.domain);
    published = request;
    maxCandidates = result.maxCandidates;
    prismCount = result.prismCount;
    referenceCount = result.referenceCount;
    instanceCount = result.instanceCount;
    precision = result.precision;
    error = null;
    rejected = null;
    revision++;
    for (const plan of result.plans)
      if (plan.resized)
        plan.buffer.source.resize(plan.buffer.source.pixelWidth, plan.height);
    for (const plan of result.plans)
      if (plan.end > plan.start) plan.buffer.source.update(plan.start, plan.end);
    options.onUpdate?.();
  };
  const reject = (request: FieldRequest, caught: unknown) => {
    error = caught instanceof Error ? caught : new Error(String(caught));
    rejected = request;
    const retained = published;
    retainGeometries(
      new Set(
        retained?.records.map((record) =>
          geometryKey(record, retained.cell, retained.heightRange),
        ) ?? [],
      ),
    );
    options.onError?.(error);
  };
  const pump = () => {
    timer = null;
    if (disposed) return;
    const startedAt = performance.now(),
      budget = Math.max(0.25, options.budgetMs ?? 2);
    do {
      if (!job) {
        if (
          !requested ||
          sameRequest(published, requested) ||
          sameRequest(rejected, requested)
        )
          return;
        active = requested;
        job = build(active);
      }
      let next: IteratorResult<void, FieldResult>;
      try {
        next = job.next();
      } catch (caught) {
        if (active) reject(active, caught);
        if (!options.onError) console.warn("World occlusion field rejected", error);
        job = null;
        active = null;
        continue;
      }
      if (next.done && active) {
        publish(active, next.value);
        job = null;
        active = null;
      }
    } while (!disposed && performance.now() - startedAt < budget);
    if (
      !disposed &&
      (job || (!sameRequest(published, requested) && !sameRequest(rejected, requested)))
    )
      timer = setTimeout(pump, 0);
  };
  return {
    texture: header.texture,
    references: references.texture,
    prisms: prisms.texture,
    bounds,
    geometryBounds,
    get revision() {
      return revision;
    },
    get heightRange() {
      return published?.heightRange ?? DEFAULT_HEIGHT_RANGE;
    },
    /** Maximum spatial error of packed prism vertices; independent of broad-phase cell size. */
    get precision() {
      return precision;
    },
    get maxCandidates() {
      return maxCandidates;
    },
    get prismCount() {
      return prismCount;
    },
    get referenceCount() {
      return referenceCount;
    },
    /** Published instances with geometry, excluding ground-contact-only stamps. */
    get instanceCount() {
      return instanceCount;
    },
    get error() {
      return error;
    },
    get memoryBytes() {
      let cachedStamps = 0,
        cachedGeometry = 0;
      for (const stamp of stamps.values()) cachedStamps += stamp.contacts.byteLength;
      for (const geometry of geometries.values())
        cachedGeometry += geometryBytes(geometry);
      return {
        pixels: buffers.reduce((sum, buffer) => sum + buffer.pixels.byteLength, 0),
        scratch: buffers.reduce((sum, buffer) => sum + buffer.scratch.byteLength, 0),
        cachedStamps,
        cachedGeometry,
      };
    },
    /** Global spare coverage and immutable geometry stamps retain complete, coherent publications. */
    update: (
      records: readonly Occluder[],
      viewport: WorldBounds,
      heightRange = DEFAULT_HEIGHT_RANGE,
    ) => {
      if (disposed) return;
      const cell =
        Math.ceil(
          Math.max(
            2,
            (viewport.maxX - viewport.minX) / (FIELD_SIZE - 16),
            (viewport.maxY - viewport.minY) / (FIELD_SIZE - 16),
          ) *
            2 -
            1e-8,
        ) / 2;
      const retained = [published, requested, active].find(
        (entry) => entry?.cell === cell && contains(entry.domain, viewport),
      );
      const domain = retained?.domain ?? fieldDomain(viewport, cell);
      const request = {
        records: [...records],
        wind: records.map((record) => record.wind),
        domain,
        cell,
        heightRange,
      };
      if (sameRequest(requested, request)) return;
      requested = request;
      if (sameRequest(published, requested)) return;
      if (options.incremental) {
        if (timer === null) timer = setTimeout(pump, 0);
      } else {
        try {
          if (!(heightRange > 0 && Number.isFinite(heightRange)))
            throw new RangeError(
              "World occlusion height range must be positive and finite",
            );
          const iterator = build(request);
          let next = iterator.next();
          while (!next.done) next = iterator.next();
          publish(request, next.value);
        } catch (caught) {
          reject(request, caught);
          if (!options.onError) throw error;
        }
      }
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      job = null;
      active = requested = published = rejected = null;
      stamps.clear();
      geometries.clear();
      idleGeometries.clear();
      idleBytes = 0;
      for (const buffer of buffers) buffer.texture.destroy(true);
    },
  };
};

const geometryBytes = (geometry: CasterGeometry) =>
  geometry.coordinates.byteLength +
  geometry.groups.byteLength +
  geometry.contacts.byteLength +
  geometry.nodes.byteLength +
  geometry.order.byteLength +
  geometry.header.byteLength;

/** A normalized source frame is cached independently from its instances and broad-phase cell size. */
const geometryKey = (
  record: Occluder,
  cell: number,
  heightRange: number,
): GeometryKey => {
  if (!record.volumes) return `${cell}:${heightRange}:${record.key}`;
  if (!record.transform) return record.volumes;
  let key = normalizedVolumeKeys.get(record.volumes);
  if (!key) {
    key = {};
    normalizedVolumeKeys.set(record.volumes, key);
  }
  return key;
};
const overlaps = (a: WorldBounds, b: WorldBounds) =>
  a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
const maxWind = (record: Occluder) =>
  record.wind === undefined
    ? 0
    : record.wind < 4
      ? MAX_WORLD_WIND
      : MAX_SMALL_WORLD_WIND;
const stampKey = (record: Occluder) =>
  record.wind === undefined
    ? record.key
    : `${record.key}:wind:${record.wind}:${record.height}:${record.footY}`;
/** Express 1−sourceV as cx*worldX + cy*projectedY + c0, including rotated custom artwork. */
const rawWindCoefficients = (record: Occluder): [number, number, number] => {
  const m = record.windProjection;
  if (!m)
    return [
      0,
      Math.fround(1 / record.height),
      Math.fround((-record.footY * 0.5) / record.height),
    ];
  const a = m[0] ?? 0,
    b = m[1] ?? 0,
    c = m[2] ?? 0,
    d = m[3] ?? 0,
    tx = m[4] ?? 0,
    ty = m[5] ?? 0,
    determinant = a * d - b * c;
  return [
    Math.fround(b / determinant),
    Math.fround(-a / determinant),
    Math.fround(1 + (a * ty - b * tx) / determinant),
  ];
};
/** Ray inversion requires an invertible source plane and a finite physical height scale. */
const validateTransform = (record: Occluder) => {
  if (
    record.wind !== undefined &&
    (!Number.isInteger(record.wind) ||
      record.wind < 0 ||
      record.wind > 7 ||
      !Number.isFinite(record.height) ||
      record.height <= 0 ||
      !Number.isFinite(record.footY))
  )
    throw new RangeError(
      "World occlusion wind requires a group from zero to seven and finite positive height/root",
    );
  const m = record.transform;
  if (!m) {
    if (record.wind === undefined) return;
    const p = record.windProjection,
      coefficients = rawWindCoefficients(record);
    if (
      (p && (p.length !== 6 || ![...p].every(Number.isFinite))) ||
      !coefficients.every(Number.isFinite) ||
      1 - maxWind(record) * Math.abs(coefficients[0]) <= 0
    )
      throw new RangeError(
        "World occlusion requires a finite wind projection invertible across its swept interval",
      );
    return;
  }
  const a = m[0] ?? 0,
    b = m[1] ?? 0,
    c = m[2] ?? 0,
    d = m[3] ?? 0;
  if (
    record.volumes === undefined ||
    m.length !== 6 ||
    ![...m, record.height].every(Number.isFinite) ||
    record.height <= 0 ||
    (a * d - b * (c - maxWind(record))) * (a * d - b * (c + maxWind(record))) <= 0
  )
    throw new RangeError(
      "World occlusion requires a finite, invertible source transform and positive height",
    );
};

/** Quantize local geometry before constructing bounds, so the hierarchy encloses GPU-decoded prisms. */
function* casterGeometry(
  record: Occluder,
  cell: number,
  heightRange: number,
): Generator<void, CasterGeometry> {
  const vertices: number[] = [],
    groups: number[] = [],
    contacts: number[] = [];
  let work = 0;
  if (record.volumes !== undefined) {
    for (let group = 0; group < record.volumes.length; group++) {
      const volume = record.volumes[group];
      if (!volume) continue;
      for (let index = 0; index + 2 < volume.indices.length; index += 3) {
        const triangle: VolumeVertex[] = [];
        for (let corner = 0; corner < 3; corner++) {
          const id = volume.indices[index + corner] ?? 0,
            offset = id * 4;
          if (offset + 3 >= volume.vertices.length)
            throw new RangeError("Invalid world occlusion volume index");
          const x = volume.vertices[offset] ?? 0,
            y = volume.vertices[offset + 1] ?? 0,
            lower = volume.vertices[offset + 2] ?? 0,
            upper = volume.vertices[offset + 3] ?? 0;
          if (
            ![x, y, lower, upper].every(Number.isFinite) ||
            lower < 0 ||
            upper < lower
          )
            throw new RangeError(
              "World occlusion volume vertices must be finite with ordered nonnegative heights",
            );
          triangle.push(
            record.transform
              ? [x, -2 * (y + upper), lower, upper]
              : [x, y, lower, upper],
          );
        }
        if (polygonArea(triangle) > 1e-14) {
          for (const point of triangle) vertices.push(...point);
          groups.push(group);
        }
        if (++work % 128 === 0) yield;
      }
    }
  } else {
    const stamp = yield* rasterizeFallback(record, cell, heightRange);
    for (let index = 0; index < stamp.length; ) {
      const x = (stamp[index] ?? 0) * cell,
        y = (stamp[index + 1] ?? 0) * cell,
        count = stamp[index + 4] ?? 0,
        solid = ((stamp[index + 2] ?? 0) * heightRange) / 65535;
      if (stamp[index + 3]) contacts.push(x / cell, y / cell, stamp[index + 3] ?? 0);
      const box = (lower: number, upper: number) => {
        vertices.push(
          x,
          y,
          lower,
          upper,
          x + cell,
          y,
          lower,
          upper,
          x + cell,
          y + cell,
          lower,
          upper,
          x,
          y,
          lower,
          upper,
          x + cell,
          y + cell,
          lower,
          upper,
          x,
          y + cell,
          lower,
          upper,
        );
        groups.push(-1, -1);
      };
      if (solid) box(0, solid);
      for (let i = 0; i < count; i++)
        box(
          ((stamp[index + 5 + i * 2] ?? 0) * heightRange) / 65535,
          ((stamp[index + 6 + i * 2] ?? 0) * heightRange) / 65535,
        );
      index += 5 + count * 2;
      yield;
    }
  }
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxHeight = 0;
  for (let i = 0; i < vertices.length; i += 4) {
    minX = Math.min(minX, vertices[i] ?? 0);
    maxX = Math.max(maxX, vertices[i] ?? 0);
    minY = Math.min(minY, vertices[i + 1] ?? 0);
    maxY = Math.max(maxY, vertices[i + 1] ?? 0);
    maxHeight = Math.max(maxHeight, vertices[i + 3] ?? 0);
    if (++work % 128 === 0) yield;
  }
  if (!vertices.length)
    return {
      header: new Float32Array([0, 0, 1, 1, 1]),
      coordinates: new Uint16Array(),
      groups: new Int32Array(),
      contacts: new Int32Array(contacts),
      nodes: new Uint32Array(),
      order: new Uint32Array(),
    };
  const header = new Float32Array([
    minX,
    minY,
    Math.max(1e-6, maxX - Math.fround(minX)),
    Math.max(1e-6, maxY - Math.fround(minY)),
    Math.max(1e-6, maxHeight),
  ]);
  const coordinates = new Uint16Array(vertices.length),
    prismBounds = new Uint16Array(vertices.length / 2);
  for (let i = 0; i < vertices.length; i += 12) {
    let loX = 65535,
      loY = 65535,
      loZ = 65535,
      hiX = 0,
      hiY = 0,
      hiZ = 0;
    for (let corner = 0; corner < 3; corner++) {
      const offset = i + corner * 4;
      const x = encodeCoordinate(
          vertices[offset] ?? 0,
          header[0] ?? 0,
          (header[0] ?? 0) + (header[2] ?? 1),
        ),
        y = encodeCoordinate(
          vertices[offset + 1] ?? 0,
          header[1] ?? 0,
          (header[1] ?? 0) + (header[3] ?? 1),
        ),
        lower = encodeLowerHeight(vertices[offset + 2] ?? 0, header[4] ?? 1),
        upper = encodeHeight(vertices[offset + 3] ?? 0, header[4] ?? 1);
      coordinates.set([x, y, lower, upper], offset);
      loX = Math.min(loX, x);
      loY = Math.min(loY, y);
      loZ = Math.min(loZ, lower);
      hiX = Math.max(hiX, x);
      hiY = Math.max(hiY, y);
      hiZ = Math.max(hiZ, upper);
    }
    prismBounds.set([loX, loY, hiX, hiY, loZ, hiZ], i / 2);
    if (++work % 128 === 0) yield;
  }
  const nodes: number[] = [],
    order: number[] = [];
  function* branch(ids: number[]): Generator<void, void> {
    const node = nodes.length / 9;
    if (node >= MAX_BVH_NODES)
      throw new RangeError(`World occlusion mesh exceeds ${MAX_BVH_NODES} BVH nodes`);
    let loX = 65535,
      loY = 65535,
      loZ = 65535,
      hiX = 0,
      hiY = 0,
      hiZ = 0;
    let minCX = Infinity,
      minCY = Infinity,
      minCZ = Infinity,
      maxCX = -Infinity,
      maxCY = -Infinity,
      maxCZ = -Infinity;
    for (const id of ids) {
      const offset = id * 6;
      loX = Math.min(loX, prismBounds[offset] ?? 0);
      loY = Math.min(loY, prismBounds[offset + 1] ?? 0);
      hiX = Math.max(hiX, prismBounds[offset + 2] ?? 0);
      hiY = Math.max(hiY, prismBounds[offset + 3] ?? 0);
      loZ = Math.min(loZ, prismBounds[offset + 4] ?? 0);
      hiZ = Math.max(hiZ, prismBounds[offset + 5] ?? 0);
      const cx = (prismBounds[offset] ?? 0) + (prismBounds[offset + 2] ?? 0),
        cy = (prismBounds[offset + 1] ?? 0) + (prismBounds[offset + 3] ?? 0),
        cz = (prismBounds[offset + 4] ?? 0) + (prismBounds[offset + 5] ?? 0);
      minCX = Math.min(minCX, cx);
      maxCX = Math.max(maxCX, cx);
      minCY = Math.min(minCY, cy);
      maxCY = Math.max(maxCY, cy);
      minCZ = Math.min(minCZ, cz);
      maxCZ = Math.max(maxCZ, cz);
      if (++work % 128 === 0) yield;
    }
    nodes.push(loX, loY, hiX, hiY, loZ, hiZ, 0, 0, 0);
    if (ids.length <= LEAF_SIZE) {
      nodes[node * 9 + 7] = ids.length;
      nodes[node * 9 + 8] = order.length;
      order.push(...ids);
    } else {
      const dx = (maxCX - minCX) * (header[2] ?? 1),
        dy = (maxCY - minCY) * (header[3] ?? 1),
        dz = (maxCZ - minCZ) * (header[4] ?? 1);
      const axis = dx >= dy && dx >= dz ? 0 : dy >= dz ? 1 : 4;
      const high = axis === 4 ? 5 : axis + 2;
      ids.sort(
        (a, b) =>
          (prismBounds[a * 6 + axis] ?? 0) +
            (prismBounds[a * 6 + high] ?? 0) -
            ((prismBounds[b * 6 + axis] ?? 0) + (prismBounds[b * 6 + high] ?? 0)) ||
          a - b,
      );
      yield;
      const middle = Math.floor(ids.length / 2);
      yield* branch(ids.slice(0, middle));
      yield* branch(ids.slice(middle));
    }
    nodes[node * 9 + 6] = nodes.length / 9;
  }
  yield* branch(Array.from({ length: groups.length }, (_, i) => i));
  return {
    header,
    coordinates,
    groups: new Int32Array(groups),
    contacts: new Int32Array(contacts),
    nodes: new Uint32Array(nodes),
    order: new Uint32Array(order),
  };
}

/** Bounds use the same quantized coordinates decoded by the GPU, including both height endpoints. */
const localVertex = (geometry: CasterGeometry, offset: number): VolumeVertex => {
  const h = geometry.header,
    v = geometry.coordinates;
  return [
    (h[0] ?? 0) + ((v[offset] ?? 0) / 65535) * (h[2] ?? 1),
    (h[1] ?? 0) + ((v[offset + 1] ?? 0) / 65535) * (h[3] ?? 1),
    ((v[offset + 2] ?? 0) / 65535) * (h[4] ?? 1),
    ((v[offset + 3] ?? 0) / 65535) * (h[4] ?? 1),
  ];
};
/** Undo the canonical Y=-2(V+Z) projection before applying the instance's source-to-world transform. */
const worldPoint = (
  record: Occluder,
  x: number,
  y: number,
  z: number,
): [number, number, number] => {
  const m = record.transform;
  if (!m) return [x, y, z];
  const v = -y * 0.5 - z,
    height = z * record.height;
  return [
    (m[0] ?? 0) * x + (m[2] ?? 0) * v + (m[4] ?? 0),
    2 * ((m[1] ?? 0) * x + (m[3] ?? 0) * v + (m[5] ?? 0) - height),
    height,
  ];
};

/** Broad-phase bounds and contact coverage are per instance; elevated triangles never enter the contact raster. */
function* instanceStamp(
  record: Occluder,
  geometry: CasterGeometry,
  cell: number,
): Generator<void, InstanceStamp> {
  const h = geometry.header,
    n = geometry.nodes,
    sway = maxWind(record),
    rawWind = sway && !record.transform ? rawWindCoefficients(record) : null;
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  if (n.length)
    for (const x of [n[0] ?? 0, n[2] ?? 0])
      for (const y of [n[1] ?? 0, n[3] ?? 0])
        for (const z of [n[4] ?? 0, n[5] ?? 0]) {
          const localX = (h[0] ?? 0) + (x / 65535) * (h[2] ?? 1),
            localY = (h[1] ?? 0) + (y / 65535) * (h[3] ?? 1),
            localZ = (z / 65535) * (h[4] ?? 1),
            p = worldPoint(record, localX, localY, localZ);
          // The fixed swept envelope covers every pose without changing geometry or root contacts.
          const offset = sway
            ? sway *
              Math.abs(
                record.transform
                  ? 1 + localY * 0.5 + localZ
                  : (rawWind?.[0] ?? 0) * p[0] +
                      (rawWind?.[1] ?? 0) * (p[1] * 0.5 + p[2]) +
                      (rawWind?.[2] ?? 0),
              )
            : 0;
          minX = Math.min(minX, p[0] - offset);
          minY = Math.min(minY, p[1]);
          minZ = Math.min(minZ, p[2]);
          maxX = Math.max(maxX, p[0] + offset);
          maxY = Math.max(maxY, p[1]);
          maxZ = Math.max(maxZ, p[2]);
        }
  const eX = (h[2] ?? 1) / 131070,
    eY = (h[3] ?? 1) / 131070,
    eZ = (h[4] ?? 1) / 65535;
  const m = record.transform;
  let quantization = Math.hypot(eX, eY, eZ),
    condition = 1;
  if (m) {
    const a = m[0] ?? 0,
      b = m[1] ?? 0,
      c = m[2] ?? 0,
      d = m[3] ?? 0,
      H = record.height;
    quantization = Math.hypot(
      Math.abs(a) * eX + (Math.abs(c) + sway) * (eY * 0.5 + eZ),
      2 * Math.abs(b) * eX + Math.abs(d) * eY + 2 * Math.abs(d + H) * eZ,
      H * eZ,
    );
    condition =
      (Math.max(Math.abs(a) + Math.abs(c) + sway, Math.abs(b) + Math.abs(d)) *
        Math.max(Math.abs(d) + Math.abs(c) + sway, Math.abs(b) + Math.abs(a))) /
      Math.min(Math.abs(a * d - b * (c - sway)), Math.abs(a * d - b * (c + sway)));
  } else if (sway) {
    const shear = sway * Math.abs(rawWind?.[1] ?? 0),
      stretch = sway * Math.abs(rawWind?.[0] ?? 0);
    quantization = Math.hypot((1 + stretch) * eX + shear * (eY * 0.5 + eZ), eY, eZ);
    condition =
      Math.max(1, 1 + stretch + shear * 1.5) *
      Math.max(1, (1 + shear * 1.5) / (1 - stretch));
  }
  // The inverse matrix and projection use highp Float32 operations. Include their scale/conditioning
  // error in the numerical ray guard, rather than expanding source geometry by a visual bias.
  const magnitude = n.length
    ? Math.max(1, Math.abs(minX), Math.abs(minY), Math.abs(maxX), Math.abs(maxY), maxZ)
    : 0;
  const arithmetic = magnitude * 2 ** -20 * condition;
  const precision = quantization + arithmetic;
  if (n.length) {
    minX -= arithmetic;
    minY -= arithmetic;
    maxX += arithmetic;
    maxY += arithmetic;
    minZ = Math.max(0, minZ - arithmetic);
    maxZ += arithmetic;
  }
  const coverage = new Map<string, { x: number; y: number; value: number }>();
  const accumulated = new Map<string, { x: number; y: number; area: number }>();
  const flush = () => {
    for (const [key, { x, y, area }] of accumulated) {
      const value = Math.min(255, Math.round((area / (cell * cell)) * 255));
      const previous = coverage.get(key);
      if (!previous || previous.value < value) coverage.set(key, { x, y, value });
    }
    accumulated.clear();
  };
  let group = -1,
    work = 0;
  for (let triangle = 0; triangle < geometry.groups.length; triangle++) {
    const nextGroup = geometry.groups[triangle] ?? -1;
    if (nextGroup !== group) {
      flush();
      group = nextGroup;
    }
    if (group < 0) continue;
    const local = [0, 1, 2].map((corner) =>
      localVertex(geometry, triangle * 12 + corner * 4),
    );
    if (Math.min(...local.map((v) => v[2])) > 1e-6 / (m ? record.height : 1)) continue;
    const contact = clipVolumePolygon(
      local,
      2,
      1e-6 / (m ? record.height : 1),
      false,
    ).map((v): VolumeVertex => {
      const p = worldPoint(record, v[0], v[1], v[2]);
      return [p[0], p[1], 0, 0];
    });
    if (polygonArea(contact) <= 1e-10) continue;
    const left = Math.floor(Math.min(...contact.map((v) => v[0])) / cell),
      right = Math.ceil(Math.max(...contact.map((v) => v[0])) / cell),
      bottom = Math.floor(Math.min(...contact.map((v) => v[1])) / cell),
      top = Math.ceil(Math.max(...contact.map((v) => v[1])) / cell);
    if ((right - left) * (top - bottom) > MAX_REFERENCES)
      throw new RangeError(
        "World occlusion contact coverage exceeds its spatial capacity",
      );
    for (let y = bottom; y < top; y++)
      for (let x = left; x < right; x++) {
        let polygon = clipVolumePolygon(contact, 0, x * cell, true);
        polygon = clipVolumePolygon(polygon, 0, (x + 1) * cell, false);
        polygon = clipVolumePolygon(polygon, 1, y * cell, true);
        polygon = clipVolumePolygon(polygon, 1, (y + 1) * cell, false);
        const area = polygonArea(polygon);
        if (area > 1e-10) {
          const key = `${x}:${y}`,
            value = accumulated.get(key);
          if (value) value.area += area;
          else accumulated.set(key, { x, y, area });
        }
        if (++work % 64 === 0) yield;
      }
  }
  flush();
  for (let index = 0; index < geometry.contacts.length; index += 3) {
    const x = geometry.contacts[index] ?? 0,
      y = geometry.contacts[index + 1] ?? 0,
      value = geometry.contacts[index + 2] ?? 0,
      key = `${x}:${y}`;
    if ((coverage.get(key)?.value ?? 0) < value) coverage.set(key, { x, y, value });
  }
  const contacts = new Int32Array(coverage.size * 3);
  let index = 0;
  for (const { x, y, value } of coverage.values()) {
    contacts.set([x, y, value], index);
    index += 3;
    if (++work % 128 === 0) yield;
  }
  return { bounds: { minX, minY, maxX, maxY }, minZ, maxZ, contacts, precision };
}

/** Numeric RGBA8 tables retain a staging copy so incomplete updates cannot reach the shader. */
const createFieldBuffer = (
  width: number,
  height: number,
  sparse = false,
): FieldBuffer => {
  const pixels = new Uint8Array(width * height * 4);
  const source = new BufferImageSource({
    resource: pixels,
    width,
    height,
    format: "rgba8unorm",
    alphaMode: "no-premultiply-alpha",
    scaleMode: "nearest",
  });
  return {
    occupied: sparse
      ? { scratch: new Set<number>(), pixels: new Set<number>() }
      : undefined,
    pixels,
    scratch: new Uint8Array(pixels.length),
    source,
    texture: new Texture({ source }),
  };
};
/** Clear staging data cooperatively while the published field remains available. */
function* prepareBuffer(
  buffer: FieldBuffer,
  height: number,
): Generator<void, BufferPlan> {
  const resized = height !== buffer.source.pixelHeight;
  if (buffer.scratch.length !== buffer.source.pixelWidth * height * 4)
    buffer.scratch = new Uint8Array(buffer.source.pixelWidth * height * 4);
  if (buffer.occupied) {
    // Actor fields keep the full-resolution contact grid, but only populated
    // cells need clearing. Include abandoned staging writes after a rejected build.
    const words = new Uint32Array(buffer.scratch.buffer);
    for (const index of buffer.occupied.scratch) words[index] = 0;
    buffer.occupied.scratch = new Set<number>();
  } else {
    for (let offset = 0; offset < buffer.scratch.length; offset += 16384) {
      buffer.scratch.fill(0, offset, offset + 16384);
      yield;
    }
  }
  return { buffer, height, resized, start: buffer.scratch.length / 4, end: 0 };
}
/** Locate changed texels without blocking a frame, allowing bounded partial texture uploads. */
function* compareBuffer(plan: BufferPlan): Generator<void, void> {
  if (plan.resized) {
    plan.start = 0;
    plan.end = plan.buffer.scratch.length / 4;
    return;
  }
  const previous = new Uint32Array(plan.buffer.pixels.buffer),
    next = new Uint32Array(plan.buffer.scratch.buffer);
  const occupied = plan.buffer.occupied;
  const indices = occupied
    ? new Set([...occupied.pixels, ...occupied.scratch])
    : next.keys();
  let compared = 0;
  for (const i of indices) {
    if (previous[i] !== next[i]) {
      plan.start = Math.min(plan.start, i);
      plan.end = Math.max(plan.end, i + 1);
    }
    if (++compared % 2048 === 0) yield;
  }
}
const tableHeight = (texels: number, retained: number) =>
  Math.max(retained, Math.ceil(texels / TABLE_WIDTH / 16) * 16);
/** Big-endian integer words match the shader's normalized-byte decoding. */
const write16 = (buffer: Uint8Array, index: number, value: number) => {
  buffer[index] = value >>> 8;
  buffer[index + 1] = value & 255;
};
const write24 = (buffer: Uint8Array, index: number, value: number) => {
  buffer[index] = value >>> 16;
  buffer[index + 1] = (value >>> 8) & 255;
  buffer[index + 2] = value & 255;
};
const encodeCoordinate = (value: number, min: number, max: number) =>
  Math.max(0, Math.min(65535, Math.round(((value - min) * 65535) / (max - min))));

/** Custom-art body and surface samples retain their established bounded fallback profile. */
function* rasterizeFallback(
  record: Occluder,
  cell: number,
  heightRange: number,
): Generator<void, Int32Array> {
  const rows = new Map<number, Map<number, IntervalCell>>();
  let work = 0;
  const write = (
    x: number,
    y: number,
    top: number,
    lower: number | null,
    contact = 0,
  ) => {
    const high = encodeHeight(top, heightRange);
    if (!high && !contact) return;
    let row = rows.get(y);
    if (!row) {
      row = new Map();
      rows.set(y, row);
    }
    let value = row.get(x);
    if (!value) {
      value = { solid: 0, contact: 0, intervals: [] };
      row.set(x, value);
    }
    if (contact) value.contact = Math.max(value.contact, contact);
    else if (lower === null) value.solid = Math.max(value.solid, high);
    else unionInterval(value.intervals, encodeLowerHeight(lower, heightRange), high);
  };
  const radiusX = record.width * (record.shape === "building" ? 0.32 : 0.2),
    radiusY = Math.max(2, record.width * 0.08);
  if (radiusX > 0) {
    for (
      let y = Math.floor((record.footY - radiusY) / cell);
      y <= Math.ceil((record.footY + radiusY) / cell);
      y++
    )
      for (
        let x = Math.floor((record.footX - radiusX) / cell);
        x <= Math.ceil((record.footX + radiusX) / cell);
        x++
      ) {
        const distance = Math.hypot(
          ((x + 0.5) * cell - record.footX) / Math.max(1, radiusX),
          ((y + 0.5) * cell - record.footY) / radiusY,
        );
        if (distance < 1) write(x, y, 0, null, Math.round((1 - distance) * 255));
        if (++work % 128 === 0) yield;
      }
  }
  let body: {
    x: number;
    y: number;
    radiusX: number;
    radiusY: number;
    top: number;
    ellipse: boolean;
  } | null = null;
  if (record.shape === "building")
    body = {
      x: record.footX,
      y: record.footY + record.height * 0.125,
      radiusX: record.width * 0.275,
      radiusY: record.height * 0.125,
      top: record.height * 0.4,
      ellipse: false,
    };
  else if (record.shape === "canopy" || record.shape === "conifer")
    body = {
      x: record.footX,
      y: record.footY,
      radiusX: record.width * 0.045,
      radiusY: record.width * 0.06,
      top: record.height * 0.6,
      ellipse: true,
    };
  else if (record.shape === "character")
    body = {
      x: record.footX,
      y: record.footY,
      radiusX: record.width * 0.18,
      radiusY: record.width * 0.12,
      top: record.height * 0.55,
      ellipse: true,
    };
  if (body && body.radiusX > 0 && body.radiusY > 0 && body.top > 0) {
    for (
      let y = Math.floor((body.y - body.radiusY) / cell);
      y <= Math.floor((body.y + body.radiusY) / cell);
      y++
    )
      for (
        let x = Math.floor((body.x - body.radiusX) / cell);
        x <= Math.floor((body.x + body.radiusX) / cell);
        x++
      ) {
        const dx = ((x + 0.5) * cell - body.x) / (body.radiusX + cell * 0.5),
          dy = ((y + 0.5) * cell - body.y) / (body.radiusY + cell * 0.5);
        if (!body.ellipse || dx * dx + dy * dy <= 1) write(x, y, body.top, null);
        if (++work % 128 === 0) yield;
      }
  }
  const points = record.points;
  for (let index = 0; index + 3 < points.length; index += 4) {
    const x = points[index] ?? 0,
      y = points[index + 1] ?? 0,
      z = points[index + 2] ?? 0,
      kind = points[index + 3] ?? 0;
    if (kind !== 0) {
      const lower =
        kind === 2
          ? z * 0.6
          : kind === 3
            ? Math.max(0, z - record.height * 0.06)
            : null;
      // Solid facades keep their exact surface cell; elevated silhouettes retain fringe coverage.
      const fringe = kind === 2 || kind === 3 ? 1 : 0;
      const left = Math.floor(x / cell - fringe * 0.5),
        bottom = Math.floor(y / cell - fringe * 0.5);
      for (let row = bottom; row <= bottom + fringe; row++)
        for (let col = left; col <= left + fringe; col++) write(col, row, z, lower);
    }
    if (++work % 64 === 0) yield;
  }
  let size = 0;
  for (const row of rows.values())
    for (const value of row.values()) {
      collapseSolid(value);
      size += 5 + value.intervals.length * 2;
      if (++work % 128 === 0) yield;
    }
  const result = new Int32Array(size);
  let index = 0;
  for (const [y, row] of rows)
    for (const [x, value] of row) {
      result[index++] = x;
      result[index++] = y;
      result[index++] = value.solid;
      result[index++] = value.contact;
      result[index++] = value.intervals.length;
      for (const [lower, upper] of value.intervals) {
        result[index++] = lower;
        result[index++] = upper;
      }
      if (++work % 128 === 0) yield;
    }
  return result;
}

/** Clipping interpolates the same lower/upper planes used by the authored volume mesh. */
const clipVolumePolygon = (
  polygon: VolumeVertex[],
  axis: 0 | 1 | 2,
  boundary: number,
  greater: boolean,
): VolumeVertex[] => {
  const result: VolumeVertex[] = [];
  let previous = polygon.at(-1);
  if (!previous) return result;
  let previousInside = greater
    ? previous[axis] >= boundary
    : previous[axis] <= boundary;
  for (const current of polygon) {
    const inside = greater ? current[axis] >= boundary : current[axis] <= boundary;
    if (inside !== previousInside) {
      const t = (boundary - previous[axis]) / (current[axis] - previous[axis]);
      result.push([
        previous[0] + (current[0] - previous[0]) * t,
        previous[1] + (current[1] - previous[1]) * t,
        previous[2] + (current[2] - previous[2]) * t,
        previous[3] + (current[3] - previous[3]) * t,
      ]);
    }
    if (inside) result.push(current);
    previous = current;
    previousInside = inside;
  }
  return result;
};

const polygonArea = (polygon: VolumeVertex[]) => {
  const origin = polygon[0];
  if (!origin) return 0;
  let area = 0;
  for (let i = 1; i + 1 < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[i + 1];
    if (a && b)
      area +=
        (a[0] - origin[0]) * (b[1] - origin[1]) -
        (b[0] - origin[0]) * (a[1] - origin[1]);
  }
  return Math.abs(area) * 0.5;
};

/** Keep spare coverage on both sides so camera subcell movement retains the published domain. */
const fieldDomain = (requested: WorldBounds, cell: number): WorldBounds => {
  const size = FIELD_SIZE * cell,
    block = 16 * cell;
  const axis = (min: number, max: number) => {
    const snapped = Math.floor((min - (size - (max - min)) * 0.5) / block) * block;
    return snapped + size < max ? snapped + block : snapped;
  };
  const minX = axis(requested.minX, requested.maxX),
    minY = axis(requested.minY, requested.maxY);
  return { minX, minY, maxX: minX + size, maxY: minY + size };
};
const contains = (outer: WorldBounds, inner: WorldBounds) =>
  outer.minX <= inner.minX &&
  outer.minY <= inner.minY &&
  outer.maxX >= inner.maxX &&
  outer.maxY >= inner.maxY;
const sameDomain = (a: WorldBounds | null | undefined, b: WorldBounds) =>
  !!a &&
  a.minX === b.minX &&
  a.minY === b.minY &&
  a.maxX === b.maxX &&
  a.maxY === b.maxY;
const sameRecords = (a: readonly Occluder[] | undefined, b: readonly Occluder[]) =>
  a?.length === b.length && a.every((record, index) => record.key === b[index]?.key);
const sameRequest = (a: FieldRequest | null, b: FieldRequest | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.heightRange === b.heightRange &&
    sameDomain(a.domain, b.domain) &&
    a.wind.every((group, index) => group === b.wind[index]) &&
    sameRecords(a.records, b.records));
/** Sorted unions retain every air gap, independently of caster and triangle order. */
const unionInterval = (intervals: HeightInterval[], lower: number, upper: number) => {
  let start = 0;
  while (start < intervals.length && (intervals[start]?.[1] ?? 0) < lower) start++;
  let end = start;
  while (end < intervals.length && (intervals[end]?.[0] ?? Infinity) <= upper) {
    lower = Math.min(lower, intervals[end]?.[0] ?? lower);
    upper = Math.max(upper, intervals[end]?.[1] ?? upper);
    end++;
  }
  intervals.splice(start, end - start, [lower, upper]);
};
/** Only ground-connected fallback intervals join the solid column; suspended spans keep their air gaps. */
const collapseSolid = (cell: IntervalCell) => {
  let count = 0;
  while (
    count < cell.intervals.length &&
    (cell.intervals[count]?.[0] ?? Infinity) <= cell.solid
  ) {
    cell.solid = Math.max(cell.solid, cell.intervals[count]?.[1] ?? 0);
    count++;
  }
  if (count) cell.intervals.splice(0, count);
};
/** Unsigned normalized height, rounded upward so thin physical occluders retain coverage. */
const encodeHeight = (height: number, heightRange: number) =>
  Math.max(0, Math.min(65535, Math.ceil((height * 65535) / heightRange)));
/** Round prism bottoms down so quantization cannot invent clearance below an occluder. */
const encodeLowerHeight = (height: number, heightRange: number) =>
  Math.max(0, Math.min(65535, Math.floor((height * 65535) / heightRange)));

type GeometryKey = string | object;
type FieldRequest = {
  records: readonly Occluder[];
  /** Primitive snapshots detect phase changes even when a caller reuses its descriptor. */
  wind: readonly (number | undefined)[];
  domain: WorldBounds;
  cell: number;
  heightRange: number;
};
type FieldResult = {
  plans: BufferPlan[];
  maxCandidates: number;
  prismCount: number;
  referenceCount: number;
  instanceCount: number;
  precision: number;
};
type FieldBuffer = {
  /** Sparse headers retain both staging and published support so departed cells are cleared. */
  occupied?: { scratch: Set<number>; pixels: Set<number> };
  pixels: Uint8Array;
  scratch: Uint8Array;
  source: BufferImageSource;
  texture: Texture;
};
type BufferPlan = {
  buffer: FieldBuffer;
  height: number;
  resized: boolean;
  start: number;
  end: number;
};
type CasterGeometry = {
  header: Float32Array;
  coordinates: Uint16Array;
  groups: Int32Array;
  contacts: Int32Array;
  nodes: Uint32Array;
  order: Uint32Array;
};
type InstanceStamp = {
  bounds: WorldBounds;
  minZ: number;
  maxZ: number;
  contacts: Int32Array;
  precision: number;
};
type HeightInterval = [number, number];
type IntervalCell = { solid: number; contact: number; intervals: HeightInterval[] };
type VolumeVertex = [number, number, number, number];
/** Physical custom volumes or a shared authored frame with its source-to-world transform. */
export type Occluder = {
  /** Geometry and base matrices remain immutable for a key; pose changes require a new key. */
  key: string;
  /** Repeated [worldX, physicalWorldY, height, semanticClass] fallback samples. */
  points: Float32Array;
  /** Vertices are global [X,Y,lo,hi], or normalized [u,v,lo/H,hi/H] when transform is present. */
  volumes?: readonly { vertices: Float32Array; indices: Uint16Array | Uint32Array }[];
  /** Source-camera affine matrix [a,b,c,d,tx,ty]; identical frames share their volume arrays. */
  transform?: Float32Array;
  /** Immutable normalized source-to-global screen matrix for raw/custom geometry's wind pose. */
  windProjection?: Float32Array;
  /** Shared wind group: 0–3 trees/bushes, 4–7 small foliage; base geometry stays immutable. */
  wind?: number;
  shape: WorldShadowShape;
  width: number;
  height: number;
  footX: number;
  footY: number;
  dynamic: boolean;
};
