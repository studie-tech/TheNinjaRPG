import { Container, Graphics, Sprite, Texture } from "pixi.js";
import type { GameFrame } from "@/libs/rendering/runtime";

/** A retained ground ribbon rounds route corners; pooled motes travel toward its destination. */
export const createTravelPath = () => {
  const container = new Container({ label: "travel-path" });
  const ribbon = new Graphics({ label: "travel-path-ribbon" });
  const destination = new Graphics({ label: "travel-path-destination" });
  const motes = Array.from({ length: 24 }, () => {
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
    previousX = Number.NaN,
    previousY = Number.NaN,
    previousScale = Number.NaN;

  /** Route coordinates include terrain depression and sector placement; the live origin is separate. */
  const set = (points: RoutePoint[], tileWidth: number) => {
    route = points;
    width = tileWidth;
    previousX = Number.NaN;
    const end = route.at(-1);
    destination.clear();
    if (end) {
      const radius = width * 0.09;
      destination
        .ellipse(0, 0, radius, radius * 0.5)
        .stroke({ color: 0x3bdec7, alpha: 0.85, width: width * 0.018 })
        .poly([
          0,
          radius * 0.27,
          radius * 0.27,
          0,
          0,
          -radius * 0.27,
          -radius * 0.27,
          0,
        ])
        .fill(0xddfff0);
      destination.position.copyFrom(end);
    }
    container.visible = false;
  };

  const animate = (frame: GameFrame, origin: RoutePoint | undefined, scale = 1) => {
    if (!origin || !route.length) {
      container.visible = false;
      return;
    }
    const pixel = 1 / scale;
    if (origin.x !== previousX || origin.y !== previousY || scale !== previousScale) {
      previousX = origin.x;
      previousY = origin.y;
      previousScale = scale;
      const points = [origin, ...route].filter((point, index, all) => {
        const before = all[index - 1];
        return !before || Math.hypot(point.x - before.x, point.y - before.y) > 0.001;
      });
      samples = [{ ...origin, distance: 0 }];
      let length = 0;
      const append = (x: number, y: number) => {
        const previous = samples.at(-1);
        if (previous) length += Math.hypot(x - previous.x, y - previous.y);
        samples.push({ x, y, distance: length });
      };
      // Short quadratic turns stay inside the same adjacent hex corridor as navigation.
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
        append(ax, ay);
        for (let step = 1; step <= 5; step++) {
          const t = step / 5,
            a = 1 - t;
          append(
            a * a * ax + 2 * a * t * point.x + t * t * bx,
            a * a * ay + 2 * a * t * point.y + t * t * by,
          );
        }
      }
      ribbon.clear();
      if (length > 0.01) {
        const coordinates = samples.flatMap((point) => [point.x, point.y]);
        ribbon
          .poly(coordinates, false)
          .stroke({
            color: 0x07534e,
            alpha: 0.6,
            width: Math.max(width * 0.045, pixel * 2.5),
            cap: "round",
            join: "round",
          })
          .poly(coordinates, false)
          .stroke({
            color: 0xb4ffe4,
            alpha: 0.85,
            width: Math.max(width * 0.015, pixel * 1.1),
            cap: "round",
            join: "round",
          });
      }
    }
    const length = samples.at(-1)?.distance ?? 0;
    container.visible = length > 0.01;
    if (!container.visible) return;
    const count = Math.min(motes.length, Math.ceil(length / (width * 0.65))),
      spacing = length / count;
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
    // Keep the target readable at overview zoom without covering a whole tile.
    destination.scale.set(Math.max(1, (pixel * 3) / (width * 0.09)));
  };
  return { container, set, animate };
};

type RoutePoint = { x: number; y: number };

type RouteSample = RoutePoint & { distance: number };
