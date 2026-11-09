import {
  BufferImageSource,
  Color,
  Container,
  Geometry,
  Mesh,
  Shader,
  State,
  Texture,
  UniformGroup,
} from "pixi.js";
import { linearRenderColor, worldLighting } from "@/libs/rendering/color";
import type { GameRenderer } from "@/libs/rendering/runtime";
import {
  displayColorShader,
  project2DShader,
  waterUVShader,
} from "@/libs/rendering/shaders";
import {
  emptySegment,
  type HexTerrainData,
  KIND,
  LAND_SEGMENT,
} from "@/libs/rendering/terrainData";

/**
 * Owns meshes/shaders for immutable CPU terrain data. Resolves after texture attempts;
 * missing optional images retain tinted faces, while cancellation rejects.
 * With `deferTextures`, it resolves at once with tinted faces and applies each image
 * as it arrives, so a scene can draw before its terrain artwork downloads.
 * setTints replaces the overlay from original colors without mutating data.
 * Each painter-ordered segment draws as one mesh (split only when it needs more than
 * four images), so terraces, cliffs and seabeds cost a couple of draws per sector.
 * Mesh zIndex keeps every sector's underwater segment below every land segment;
 * setDepthBias orders sectors back to front within each.
 */
export const createHexTerrain = async (
  game: GameRenderer,
  data: HexTerrainData,
  showBoundary = true,
  { deferTextures = false }: { deferTextures?: boolean } = {},
) => {
  const loads = data.textures.map((texture) =>
    game.assets.texture(texture).catch((error: unknown) => {
      if (
        game.signal.aborted ||
        game.isDisposed() ||
        (error instanceof Error && error.name === "AbortError")
      )
        throw error;
      console.warn("Terrain texture unavailable", error);
      return null;
    }),
  );
  const images: (Texture | null)[] = deferTextures
    ? loads.map(() => null)
    : await Promise.all(loads);
  // Deferred loads have no consumer when setup ends early; their later handlers still see them.
  if (deferTextures) for (const load of loads) void load.catch(() => undefined);
  if (game.signal.aborted || game.isDisposed())
    throw new DOMException("Terrain cancelled", "AbortError");
  /** Shader samplers waiting for each deferred image. */
  const samplers = loads.map(() => [] as { shader: Shader; name: ImageUniform }[]);
  const container = new Container();
  const geometries: Geometry[] = [],
    shaders: Shader[] = [];
  const noise = createNoiseTexture();
  const relief = createReliefTexture();
  const origin = new UniformGroup({
    uOrigin: { value: new Float32Array([0, 0]), type: "vec2<f32>" },
  });
  const weather = new UniformGroup({ uRain: { value: 0, type: "f32" } });
  const ambient = new UniformGroup({
    uAmbient: { value: new Float32Array([1, 1, 1]), type: "vec3<f32>" },
  });
  let lastBrightness = 1;
  const recolor: ((tints: ReadonlyMap<string, TerrainTint>) => void)[] = [];
  const meshes: { mesh: Mesh<Geometry, Shader>; order: number }[] = [];
  let disposed = false;
  const own = (geometry: Geometry, shader: Shader, order: number) => {
    geometries.push(geometry);
    shaders.push(shader);
    const mesh = new Mesh({ geometry, shader, state: State.for2d(), zIndex: order });
    meshes.push({ mesh, order });
    container.addChild(mesh);
  };
  // Bridges and roads ride the land segment, which a sector that is all water does not have.
  const landless =
    data.surface.length > 0 &&
    !data.segments.some((segment) => segment.order === LAND_SEGMENT);
  const segments = [
    ...data.segments,
    ...(landless ? [emptySegment(LAND_SEGMENT)] : []),
  ].map((segment) =>
    segment.order === LAND_SEGMENT && data.surface.length
      ? appendSurface(segment, data.surface, data.surfaceColors)
      : segment,
  );
  for (const segment of segments)
    for (const range of textureRanges(segment.slots, MAX_IMAGE_SLOTS)) {
      const slice = (values: Float32Array, size: number) =>
        values.slice(range.start * size, range.end * size);
      const colors = slice(segment.colors, 4),
        original = colors.slice();
      const slots = slice(segment.slots, 1).map((slot) =>
        slot === 0 ? 0 : range.slots.indexOf(slot) + 1,
      );
      const geometry = new Geometry({
        attributes: {
          aPosition: {
            buffer: slice(segment.positions, 2),
            format: "float32x2",
            stride: 8,
          },
          aUV: { buffer: slice(segment.uvs, 2), format: "float32x2", stride: 8 },
          aColor: { buffer: colors, format: "float32x4", stride: 16 },
          aKind: { buffer: slice(segment.kinds, 1), format: "float32", stride: 4 },
          aSlot: { buffer: slots, format: "float32", stride: 4 },
          aWave: { buffer: slice(segment.waves, 1), format: "float32", stride: 4 },
          aRelief: { buffer: slice(segment.relief, 2), format: "float32x2", stride: 8 },
        },
      });
      const imageSource = (index: number) => {
        const slot = range.slots[index];
        return (slot ? images[slot - 1] : null)?.source ?? Texture.WHITE.source;
      };
      const shader = Shader.from({
        gl: { vertex: terrainVertex, fragment: terrainFragment },
        resources: {
          ambient,
          origin,
          weather,
          animation: game.animation,
          uNoise: noise.source,
          uRelief: relief.source,
          uImage1: imageSource(0),
          uImage2: imageSource(1),
          uImage3: imageSource(2),
          uImage4: imageSource(3),
        },
      });
      IMAGE_UNIFORMS.forEach((name, index) => {
        const slot = range.slots[index];
        if (slot) samplers[slot - 1]?.push({ shader, name });
      });
      const tiles = segment.tiles.filter(
        (tile) => tile.start >= range.start && tile.start < range.end,
      );
      recolor.push((tints) => {
        colors.set(original);
        for (const tile of tiles) {
          const tint = tints.get(tile.key);
          if (!tint) continue;
          const color = linearRenderColor(tint.color);
          for (let vertex = tile.start; vertex < tile.start + tile.count; vertex++) {
            const index = (vertex - range.start) * 4;
            colors[index] =
              (original[index] ?? 0) * (1 - tint.strength) + color.r * tint.strength;
            colors[index + 1] =
              (original[index + 1] ?? 0) * (1 - tint.strength) +
              color.g * tint.strength;
            colors[index + 2] =
              (original[index + 2] ?? 0) * (1 - tint.strength) +
              color.b * tint.strength;
          }
        }
        geometry.getBuffer("aColor").update();
      });
      own(geometry, shader, segment.order);
    }
  if (showBoundary && data.boundary.length) {
    const color = linearRenderColor("#b1b785");
    const geometry = new Geometry({
      attributes: {
        aPosition: { buffer: data.boundary, format: "float32x2", stride: 8 },
      },
      topology: "line-list",
    });
    const shader = Shader.from({
      gl: {
        vertex: `precision highp float; attribute vec2 aPosition; ${project2DShader} void main() { gl_Position = project2D(aPosition); }`,
        fragment: `precision mediump float; uniform vec4 uFill; uniform vec3 uAmbient; ${displayColorShader} void main() { gl_FragColor = vec4(displayColor(uFill.rgb) * uAmbient * uFill.a, uFill.a); }`,
      },
      resources: {
        ambient,
        fill: {
          uFill: {
            value: new Float32Array([color.r, color.g, color.b, 0.18]),
            type: "vec4<f32>",
          },
        },
      },
    });
    own(geometry, shader, BOUNDARY_ORDER);
  }
  if (deferTextures)
    loads.forEach((load, index) => {
      void load.then(
        (texture) => {
          if (disposed || !texture) return;
          for (const { shader, name } of samplers[index] ?? [])
            shader.resources[name] = texture.source;
          game.invalidate();
        },
        // Cancellation disposes the terrain with its scene; nothing is waiting on the image.
        () => undefined,
      );
    });
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (!container.destroyed) container.destroy({ children: true });
    for (const geometry of geometries) geometry.destroy(true);
    for (const shader of shaders) shader.destroy();
    noise.destroy(true);
    relief.destroy(true);
  };
  game.own(dispose);
  return {
    container,
    dispose,
    isAnimated: data.animatedTiles > 0,
    setLighting: (brightness: number) => {
      brightness = Math.round(brightness * 256) / 256;
      if (lastBrightness === brightness) return;
      lastBrightness = brightness;
      ambient.uniforms.uAmbient.set(
        new Color(worldLighting(brightness).tint).toArray().slice(0, 3),
      );
      ambient.update();
    },
    setTints: (tints: ReadonlyMap<string, TerrainTint>) => {
      for (const update of recolor) update(tints);
    },
    /** World offset of this terrain's local origin, so relief, seabeds and ice continue across sectors. */
    /** Rain strength in [0, 1] for drop rings on open water; 0 keeps the surface dry. */
    setRain: (strength: number) => {
      const rain = Math.round(Math.max(0, Math.min(1, strength)) * 64) / 64;
      if (weather.uniforms.uRain === rain) return;
      weather.uniforms.uRain = rain;
      weather.update();
    },
    setOrigin: (x: number, y: number) => {
      const value = origin.uniforms.uOrigin;
      if (value[0] === x && value[1] === y) return;
      value[0] = x;
      value[1] = y;
      origin.update();
    },
    /** Orders this terrain among others in the same layer; sectors further back take smaller biases. */
    setDepthBias: (bias: number) => {
      for (const { mesh, order } of meshes) mesh.zIndex = order + bias;
    },
  };
};

const BOUNDARY_ORDER = 6;
const IMAGE_UNIFORMS = ["uImage1", "uImage2", "uImage3", "uImage4"] as const;
const MAX_IMAGE_SLOTS = IMAGE_UNIFORMS.length;

type TerrainSegment = HexTerrainData["segments"][number];
type ImageUniform = (typeof IMAGE_UNIFORMS)[number];

/** Paths, shores and lily pads join the end of the land segment, above every terrace. */
const appendSurface = (
  segment: TerrainSegment,
  positions: Float32Array,
  colors: Float32Array,
): TerrainSegment => {
  const count = positions.length / 2;
  const join = (values: Float32Array, extra: Float32Array) => {
    const joined = new Float32Array(values.length + extra.length);
    joined.set(values);
    joined.set(extra, values.length);
    return joined;
  };
  const rgba = new Float32Array(count * 4);
  for (let index = 0; index < count; index++) {
    rgba[index * 4] = colors[index * 3] ?? 0;
    rgba[index * 4 + 1] = colors[index * 3 + 1] ?? 0;
    rgba[index * 4 + 2] = colors[index * 3 + 2] ?? 0;
    rgba[index * 4 + 3] = 1;
  }
  return {
    ...segment,
    positions: join(segment.positions, positions),
    uvs: join(segment.uvs, new Float32Array(count * 2)),
    colors: join(segment.colors, rgba),
    kinds: join(segment.kinds, new Float32Array(count).fill(KIND.grain)),
    slots: join(segment.slots, new Float32Array(count)),
    waves: join(segment.waves, new Float32Array(count).fill(-1)),
    relief: join(segment.relief, new Float32Array(count * 2)),
  };
};

/** Splits a vertex stream at triangle boundaries whenever it would need more image slots than bound. */
export const textureRanges = (slots: Float32Array, capacity: number) => {
  const ranges: { start: number; end: number; slots: number[] }[] = [];
  let current = { start: 0, end: 0, slots: [] as number[] };
  for (let triangle = 0; triangle * 3 < slots.length; triangle++) {
    const used = new Set<number>();
    for (let vertex = triangle * 3; vertex < triangle * 3 + 3; vertex++) {
      const slot = slots[vertex] ?? 0;
      if (slot) used.add(slot);
    }
    const missing = [...used].filter((slot) => !current.slots.includes(slot));
    if (current.slots.length + missing.length > capacity) {
      ranges.push(current);
      current = { start: triangle * 3, end: triangle * 3, slots: [] };
    }
    for (const slot of used)
      if (!current.slots.includes(slot)) current.slots.push(slot);
    current.end = triangle * 3 + 3;
  }
  if (current.end > current.start) ranges.push(current);
  return ranges;
};

const terrainVertex = `precision highp float;
attribute vec2 aPosition; attribute vec2 aUV; attribute vec4 aColor; attribute float aKind; attribute float aSlot; attribute float aWave; attribute vec2 aRelief;
varying vec2 vUV; varying vec4 vColor; varying float vKind; varying float vSlot; varying float vWave; varying vec2 vRelief; varying vec2 vGround; varying vec2 vLocal;
uniform vec2 uOrigin;
${project2DShader}
void main() {
  vUV = aUV; vColor = aColor; vKind = aKind; vSlot = aSlot; vWave = aWave; vRelief = aRelief;
  vGround = aPosition + uOrigin; vLocal = aPosition;
  gl_Position = project2D(aPosition);
}`;

const glslColor = (hex: string) => {
  const { r, g, b } = linearRenderColor(hex);
  return `vec3(${r.toFixed(5)}, ${g.toFixed(5)}, ${b.toFixed(5)})`;
};

/**
 * Ground-plane effects in world units (Y doubled to undo the hex squash), snapped to the
 * scenery's 1.5-unit pixel grid. The seabed is opaque, depth-tinted on the CPU and lit by
 * shallow caustics; the surface above it is translucent water or, off icy coasts, clear
 * ice whose shore edge packs into snow. Per-tile tints shift the surface color directly.
 */
const terrainReliefShader = `
const vec3 ICE_SNOW = ${glslColor("#e3edef")};
const vec3 ICE_SHORE = ${glslColor("#c9dee3")};
const vec3 ICE_CLEAR = ${glslColor("#a9cad3")};
const vec3 ICE_CRACK = ${glslColor("#6a8f9f")};
const vec3 FOAM = ${glslColor("#dbe8e2")};
vec2 snapGround(vec2 world) { return floor(vec2(world.x, world.y * 2.0) / 1.5) * 1.5; }
float heightField(vec2 ground) {
  return texture2D(uRelief, ground / 1100.0).r * 0.62
    + texture2D(uRelief, ground / 410.0 + vec2(0.37, 0.61)).r * 0.28
    + texture2D(uRelief, ground / 150.0 + vec2(0.13, 0.29)).r * 0.1;
}
vec2 hash2(vec2 p) {
  return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}
/** Distance to the nearest cell border of a jittered grid, for crack networks. */
float cellBorder(vec2 p) {
  vec2 cell = floor(p), local = fract(p);
  float first = 8.0, second = 8.0;
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec2 offset = vec2(float(x), float(y));
      float distance = length(offset + hash2(cell + offset) * 0.8 + 0.1 - local);
      if (distance < first) { second = first; first = distance; }
      else if (distance < second) second = distance;
    }
  return second - first;
}
vec3 seabed(vec2 ground, float depth, float frozen, vec3 tint, float still, float time) {
  vec3 color = tint * (0.93 + still * 0.14);
  vec2 caustic = ground / 30.0;
  float light = sin(caustic.x * 1.7 + time * 0.9 + sin(caustic.y * 1.3 - time * 0.6) * 1.6)
    + sin(caustic.y * 1.9 - time * 0.7 + sin(caustic.x * 1.1 + time * 0.5) * 1.6);
  float shallow = (1.0 - depth) * (1.0 - depth);
  return color + step(1.4, light) * shallow * (1.0 - frozen) * 0.06;
}
vec4 waterSurface(vec2 ground, float shore, float frozen, vec3 tint, float grain, float still, float time, float rain) {
  float edge = frozen + (heightField(ground * 3.1 + 211.0) - 0.5) * 0.9 - 0.5;
  if (edge > 0.0) {
    // Clear ice over deeper water lets the terraced bed show; wind packs snow along the shore.
    vec3 ice = mix(ICE_SHORE, ICE_CLEAR, step(0.35, shore));
    float alpha = mix(0.92, 0.78, step(0.35, shore));
    float drift = heightField(ground * 2.3 + 77.0) + (1.0 - shore) * 0.2;
    float snow = step(0.68, drift);
    ice = mix(ice, ICE_SNOW, snow);
    alpha = mix(alpha, 0.97, snow);
    ice *= 0.97 + still * 0.06;
    float sheen = fract((ground.x + ground.y * 0.6) / 96.0);
    ice *= 1.0 + step(sheen, 0.035) * 0.06;
    float fracture = step(0.5, heightField(ground * 1.4 + 31.0));
    vec2 crackSpace = ground / vec2(70.0, 52.0);
    float crack = step(cellBorder(crackSpace), 0.022) * fracture;
    float lip = step(cellBorder(crackSpace + vec2(0.0, 1.5 / 52.0)), 0.022) * fracture * (1.0 - crack);
    ice = mix(ice, ICE_CRACK, crack * 0.8);
    ice = mix(ice, ICE_SNOW, lip * 0.5);
    alpha = max(alpha, max(crack, lip) * 0.9);
    float rim = step(edge, 0.05);
    return vec4(mix(ice, ICE_SNOW, rim), max(alpha, rim * 0.95));
  }
  vec3 water = tint * (0.93 + grain * 0.14);
  float alpha = 0.32 + shore * 0.14;
  float swash = 0.08 + 0.035 * sin(time * 1.3 + heightField(ground * 2.0) * 12.0);
  float foam = step(shore, swash);
  water = mix(water, FOAM, foam * 0.55);
  alpha = mix(alpha, 0.7, foam);
  // Wave crests: a sparse scatter of one-pixel dashes, each on its own clock, that stretch,
  // drift a pixel or two and fade, so the surface stays lively without pulsing in unison.
  vec2 crestCell = floor(ground / vec2(24.0, 15.0));
  vec2 crestSeed = hash2(crestCell);
  float crestLife = fract(time / (2.6 + crestSeed.y * 3.4) + crestSeed.x);
  float crestRise = sin(crestLife * 3.14159);
  vec2 crestAt = ground - crestCell * vec2(24.0, 15.0) - vec2(3.0 + crestSeed.x * 15.0 + crestLife * 1.5, 3.0 + crestSeed.y * 9.0);
  float crest = step(0.72, hash2(crestCell + 17.0).x) * step(0.0, crestAt.x) * step(crestAt.x, 1.5 + floor(crestRise * 2.0) * 1.5)
    * step(0.0, crestAt.y) * step(crestAt.y, 1.4) * step(0.45, crestRise);
  water = mix(water, FOAM, crest * (0.25 + shore * 0.2));
  alpha = max(alpha, crest * 0.6);
  // Rain lands as sparse rings that open from a splash pixel; uRain scales how many cells catch a drop.
  if (rain > 0.01) {
    vec2 dropCell = floor(ground / 21.0);
    vec2 dropSeed = hash2(dropCell + 31.0);
    float dropRate = 1.0 / (0.8 + dropSeed.y * 0.9);
    float dropClock = time * dropRate + dropSeed.x * 9.0;
    float dropLife = fract(dropClock);
    vec2 spot = (dropCell + 0.3 + 0.4 * hash2(dropCell + floor(dropClock))) * 21.0;
    float reach = length(ground - spot);
    float falling = step(hash2(dropCell + floor(dropClock) + 5.0).x, rain * 0.35);
    float ring = step(abs(reach - 0.75 - dropLife * 4.5), 0.75) * (1.0 - dropLife) * step(0.08, dropLife);
    float splash = step(reach, 0.8) * step(dropLife, 0.1);
    float drop = falling * max(ring * 0.32, splash * 0.5);
    water = mix(water, FOAM, drop);
    alpha = max(alpha, drop);
  }
  // Open water darkens against the floe edge.
  water *= 1.0 - step(-0.12, edge) * step(0.01, frozen) * 0.15;
  return vec4(water, alpha);
}
`;

const terrainFragment = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vUV; varying vec4 vColor; varying float vKind; varying float vSlot; varying float vWave; varying vec2 vRelief; varying vec2 vGround; varying vec2 vLocal;
uniform sampler2D uNoise; uniform sampler2D uRelief; uniform sampler2D uImage1; uniform sampler2D uImage2; uniform sampler2D uImage3; uniform sampler2D uImage4;
uniform float uTime; uniform float uRain; uniform vec3 uAmbient;
${displayColorShader}
${waterUVShader}
${terrainReliefShader}
vec3 image(float slot, vec2 uv) {
  if (slot < 1.5) return texture2D(uImage1, uv).rgb;
  if (slot < 2.5) return texture2D(uImage2, uv).rgb;
  if (slot < 3.5) return texture2D(uImage3, uv).rgb;
  return texture2D(uImage4, uv).rgb;
}
void main() {
  vec2 uv = vWave >= 0.0 ? waterUV(vUV, uTime + vWave) : vUV;
  uv = vec2(fract(uv.x), 1.0 - fract(uv.y));
  vec3 color = vColor.rgb;
  float alpha = vColor.a;
  if (vKind > 5.5) color *= 0.88 + texture2D(uNoise, fract(vLocal / 128.0)).r * 0.24;
  else if (vKind < 4.5) {
    if (vKind > 2.5) {
      vec2 ground = snapGround(vGround);
      float still = texture2D(uNoise, vec2(fract(vUV.x), 1.0 - fract(vUV.y))).r;
      if (vKind > 3.5) color = seabed(ground, vRelief.x, vRelief.y, color, still, uTime);
      else {
        vec4 surface = waterSurface(ground, vRelief.x, vRelief.y, color, texture2D(uNoise, uv).r, still, uTime, uRain);
        color = surface.rgb;
        alpha = surface.a;
      }
    }
    else if (vKind > 1.5) color *= 0.78 + dot(linearColor(image(vSlot, uv)), vec3(0.2126, 0.7152, 0.0722)) * 0.35;
    else if (vKind > 0.5) color *= 0.84 + texture2D(uNoise, uv).r * 0.32;
  }
  gl_FragColor = vec4(displayColor(color) * uAmbient * alpha, alpha);
}`;

/** Smooth tiling value noise for the shared relief field; repeat addressing needs a power-of-two size. */
const createReliefTexture = () => {
  const size = 64;
  let state = 0x5a17c3;
  let values = Array.from({ length: size * size }, () => {
    state = Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) >>> 0;
    state = Math.imul(state ^ (state >>> 12), 0x297a2d39) >>> 0;
    return (state >>> 8) / 0xffffff;
  });
  for (let pass = 0; pass < 3; pass++)
    values = values.map((_, index) => {
      const x = index % size,
        y = Math.floor(index / size);
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          sum +=
            values[((y + dy + size) % size) * size + ((x + dx + size) % size)] ?? 0;
      return sum / 9;
    });
  const min = Math.min(...values),
    max = Math.max(...values);
  const pixels = new Uint8Array(size * size * 4);
  values.forEach((value, index) => {
    const tone = Math.round(((value - min) / (max - min)) * 255);
    pixels.set([tone, tone, tone, 255], index * 4);
  });
  return new Texture({
    source: new BufferImageSource({
      resource: pixels,
      width: size,
      height: size,
      format: "rgba8unorm",
      scaleMode: "linear",
      addressMode: "repeat",
    }),
  });
};

const createNoiseTexture = () => {
  const pixels = new Uint8Array(64 * 64 * 4);
  let state = 0x93a41;
  for (let index = 0; index < pixels.length; index += 4) {
    state = Math.imul(state ^ (state >>> 15), 0x21f0aaad);
    const noise = 96 + (state >>> 27) * 2;
    pixels[index] = pixels[index + 1] = pixels[index + 2] = noise;
    pixels[index + 3] = 255;
  }
  // Connected clusters read as material grain instead of television noise.
  for (let cluster = 0; cluster < 95; cluster++) {
    const x = (cluster * 29 + 7) % 62,
      y = (cluster * 17 + 3) % 62;
    for (const [dx, dy, tone] of [
      [0, 0, 184],
      [1, 0, 168],
      [1, 1, 88],
    ] as const) {
      const index = ((y + dy) * 64 + x + dx) * 4;
      pixels[index] = pixels[index + 1] = pixels[index + 2] = tone;
    }
  }
  return new Texture({
    source: new BufferImageSource({
      resource: pixels,
      width: 64,
      height: 64,
      format: "rgba8unorm",
      scaleMode: "nearest",
    }),
  });
};

/** Linear-color blend toward color; callers supply strength in [0, 1]. */
export type TerrainTint = { color: string; strength: number };
