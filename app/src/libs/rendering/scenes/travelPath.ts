import {
  Buffer,
  BufferUsage,
  Container,
  Geometry,
  Graphics,
  Mesh,
  Shader,
  Sprite,
  Texture,
  UniformGroup,
} from "pixi.js";
import type { GameFrame } from "@/libs/rendering/runtime";
import { project2DShader } from "@/libs/rendering/shaders";
import { WORLD_DETAIL } from "@/libs/rendering/worldDetail";

/** Retained curve vertices follow live feet through one origin uniform; motes share its sampled path. */
export const createTravelPath = () => {
  const container = new Container({ label: "travel-path", isRenderGroup: true });
  const buffer = new Buffer({
    data: new Float32Array(0),
    usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
  });
  const geometry = new Geometry({
    attributes: {
      aPosition: { buffer, format: "float32x2", stride: 48, offset: 0 },
      aBefore: { buffer, format: "float32x2", stride: 48, offset: 8 },
      aAfter: { buffer, format: "float32x2", stride: 48, offset: 16 },
      aWeights: { buffer, format: "float32x3", stride: 48, offset: 24 },
      aStroke: { buffer, format: "float32x3", stride: 48, offset: 36 },
    },
  });
  const uniforms = new UniformGroup(
    {
      uOrigin: { value: new Float32Array(2), type: "vec2<f32>" },
      uWidths: { value: new Float32Array([1, 0.4]), type: "vec2<f32>" },
    },
    { isStatic: true },
  );
  const shader = Shader.from({
    gl: { vertex, fragment },
    resources: { route: uniforms },
  });
  const ribbon = new Mesh({ geometry, shader, label: "travel-path-ribbon" });
  const destination = new Graphics({ label: "travel-path-destination" })
    .ellipse(0, 0, 1, 0.5)
    .stroke({ color: 0x3bdec7, alpha: 0.85, width: 0.2 })
    .poly([0, 0.27, 0.27, 0, 0, -0.27, -0.27, 0])
    .fill(0xddfff0);
  const motes = Array.from({ length: WORLD_DETAIL.routeMotes }, () => {
    const sprite = new Sprite(Texture.WHITE);
    sprite.anchor.set(0.5);
    sprite.tint = 0xddfff0;
    return sprite;
  });
  container.addChild(ribbon, ...motes, destination);
  container.visible = false;
  let route: RoutePoint[] = [],
    samples: RouteSample[] = [];
  let width = 0,
    dirty = true,
    disposed = false;
  let reference = { x: 0, y: 0 };
  let previousX = Number.NaN,
    previousY = Number.NaN,
    previousScale = Number.NaN;

  const set = (points: RoutePoint[], tileWidth: number) => {
    route = points;
    width = tileWidth;
    dirty = true;
    previousX = Number.NaN;
    const end = route.at(-1);
    if (end) destination.position.copyFrom(end);
    else container.visible = false;
  };
  const animate = (frame: GameFrame, origin: RoutePoint | undefined, scale = 1) => {
    if (disposed || !origin || !route.length) {
      container.visible = false;
      return;
    }
    if (dirty) {
      dirty = false;
      reference = { ...origin };
      samples = routeSamples(origin, route);
      buffer.data = ribbonVertices(samples);
      previousScale = Number.NaN;
    }
    const pixel = 1 / scale;
    if (origin.x !== previousX || origin.y !== previousY || scale !== previousScale) {
      previousX = origin.x;
      previousY = origin.y;
      previousScale = scale;
      const dx = origin.x - reference.x,
        dy = origin.y - reference.y;
      uniforms.uniforms.uOrigin.set([dx, dy]);
      uniforms.uniforms.uWidths.set([
        Math.max(width * 0.045, pixel * 2.5) / 2,
        Math.max(width * 0.015, pixel * 1.1) / 2,
      ]);
      uniforms.update();
      let length = 0;
      for (let index = 0; index < samples.length; index++) {
        const sample = samples[index];
        if (!sample) continue;
        sample.x = sample.baseX + sample.weight * dx;
        sample.y = sample.baseY + sample.weight * dy;
        const before = samples[index - 1];
        if (before) length += Math.hypot(sample.x - before.x, sample.y - before.y);
        sample.distance = length;
      }
    }
    const length = samples.at(-1)?.distance ?? 0;
    container.visible = length > 0.01;
    if (!container.visible) return;
    const count = Math.min(
      motes.length,
      Math.ceil(length / (width * WORLD_DETAIL.routeMoteSpacing)),
    );
    const spacing = length / count;
    const phase = frame.reducedMotion ? 0 : (frame.now * width * 0.0006) % spacing;
    let segment = 1;
    for (let index = 0; index < motes.length; index++) {
      const mote = motes[index],
        distance = index * spacing + phase;
      if (!mote) continue;
      mote.visible = index < count && distance < length;
      if (!mote.visible) continue;
      while (
        segment < samples.length - 1 &&
        (samples[segment]?.distance ?? 0) < distance
      )
        segment++;
      const start = samples[segment - 1],
        end = samples[segment];
      if (!start || !end) continue;
      const span = end.distance - start.distance;
      const t = span > 0 ? (distance - start.distance) / span : 0;
      mote.position.set(
        start.x + (end.x - start.x) * t,
        start.y + (end.y - start.y) * t,
      );
      mote.width = Math.max(width * 0.03, pixel * 1.5);
      mote.height = Math.max(width * 0.018, pixel);
      mote.alpha = 0.8;
    }
    destination.alpha = frame.reducedMotion
      ? 1
      : 0.85 + Math.sin(frame.now / 300) * 0.15;
    destination.scale.set(Math.max(width * 0.09, pixel * 3));
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (!container.destroyed) container.destroy({ children: true });
    geometry.destroy(true);
    shader.destroy();
  };
  return { container, shader, set, animate, dispose };
};

/** The first rounded corner is affine in the origin; later samples stay fixed as feet advance. */
const routeSamples = (origin: RoutePoint, route: RoutePoint[]): RouteSample[] => {
  const points = [origin, ...route].filter((point, index, all) => {
    const before = all[index - 1];
    return !before || Math.hypot(point.x - before.x, point.y - before.y) > 0.001;
  });
  const samples: RouteSample[] = [];
  const append = (x: number, y: number, weight = 0) =>
    samples.push({ x, y, baseX: x, baseY: y, weight, distance: 0 });
  append(origin.x, origin.y, 1);
  for (let index = 1; index < points.length; index++) {
    const before = points[index - 1],
      point = points[index],
      after = points[index + 1];
    if (!before || !point) continue;
    if (!after) {
      append(point.x, point.y);
      continue;
    }
    const ax = point.x + (before.x - point.x) * 0.2;
    const ay = point.y + (before.y - point.y) * 0.2;
    const bx = point.x + (after.x - point.x) * 0.2;
    const by = point.y + (after.y - point.y) * 0.2;
    append(ax, ay, index === 1 ? 0.2 : 0);
    for (let step = 1; step <= WORLD_DETAIL.routeCornerSamples; step++) {
      const t = step / WORLD_DETAIL.routeCornerSamples,
        a = 1 - t;
      append(
        a * a * ax + 2 * a * t * point.x + t * t * bx,
        a * a * ay + 2 * a * t * point.y + t * t * by,
        index === 1 ? 0.2 * a * a : 0,
      );
    }
  }
  return samples;
};

/** Pack neighboring positions and origin weights once; the shader expands the retained ribbon as the viewer moves. */
const ribbonVertices = (samples: RouteSample[]) => {
  if (samples.length < 2) return new Float32Array(0);
  const capSegments = 8;
  const data = new Float32Array(((samples.length - 1) * 6 + capSegments * 6) * 12);
  let offset = 0;
  const vertex = (index: number, x: number, y = 0, cap = 0) => {
    const point = samples[index];
    if (!point) return;
    const before = samples[index - 1] ?? point,
      after = samples[index + 1] ?? point;
    data.set(
      [
        point.baseX,
        point.baseY,
        before.baseX,
        before.baseY,
        after.baseX,
        after.baseY,
        before.weight,
        point.weight,
        after.weight,
        x,
        y,
        cap,
      ],
      offset,
    );
    offset += 12;
  };
  for (let index = 0; index < samples.length - 1; index++) {
    vertex(index, -1);
    vertex(index, 1);
    vertex(index + 1, -1);
    vertex(index + 1, -1);
    vertex(index, 1);
    vertex(index + 1, 1);
  }
  for (const end of [false, true]) {
    const index = end ? samples.length - 1 : 0;
    for (let step = 0; step < capSegments; step++) {
      const a = (end ? 0 : Math.PI) + (step * Math.PI) / capSegments;
      const b = a + Math.PI / capSegments;
      vertex(index, 0, 0, 1);
      vertex(index, Math.cos(a), Math.sin(a), 1);
      vertex(index, Math.cos(b), Math.sin(b), 1);
    }
  }
  return data;
};

const vertex =
  `precision highp float;
` +
  project2DShader +
  `
attribute vec2 aPosition;
attribute vec2 aBefore;
attribute vec2 aAfter;
attribute vec3 aWeights;
attribute vec3 aStroke;
uniform vec2 uOrigin;
uniform vec2 uWidths;
varying vec2 vStroke;
varying float vCap;
void main() {
  vec2 point = aPosition + aWeights.y * uOrigin;
  vec2 incoming = point - (aBefore + aWeights.x * uOrigin);
  vec2 outgoing = aAfter + aWeights.z * uOrigin - point;
  float beforeLength = length(incoming), afterLength = length(outgoing);
  vec2 next = afterLength > 0.0001 ? outgoing / afterLength :
    (beforeLength > 0.0001 ? incoming / beforeLength : vec2(1.0, 0.0));
  vec2 previous = beforeLength > 0.0001 ? incoming / beforeLength : next;
  vec2 normal = vec2(-next.y, next.x);
  if (aStroke.z > 0.5) {
    vec2 tangent = beforeLength < 0.0001 ? next : previous;
    point += (vec2(-tangent.y, tangent.x) * aStroke.x + tangent * aStroke.y) * uWidths.x;
  } else {
    vec2 join = normal + vec2(-previous.y, previous.x);
    float magnitude = length(join);
    join = magnitude > 0.0001 ? join / magnitude : normal;
    float extension = 1.0 / max(0.3333, abs(dot(join, normal)));
    point += join * aStroke.x * uWidths.x * extension;
  }
  vStroke = aStroke.xy;
  vCap = aStroke.z;
  gl_Position = project2D(point);
}`;
const fragment = `precision highp float;
uniform vec2 uWidths;
varying vec2 vStroke;
varying float vCap;
void main() {
  float distance = vCap > 0.5 ? length(vStroke) : abs(vStroke.x);
  float core = 1.0 - step(uWidths.y / max(0.0001, uWidths.x), distance);
  vec4 outline = vec4(vec3(7.0, 83.0, 78.0) / 255.0 * 0.6, 0.6);
  vec4 inside = vec4(vec3(180.0, 255.0, 228.0) / 255.0 * 0.85 + outline.rgb * 0.15, 0.94);
  gl_FragColor = mix(outline, inside, core);
}`;

type RoutePoint = { x: number; y: number };
type RouteSample = RoutePoint & {
  baseX: number;
  baseY: number;
  weight: number;
  distance: number;
};
