import { describe, expect, it } from "bun:test";
import globe from "@/data/hexasphere.json";
import { globeMarkerAnchor } from "@/libs/rendering/scenes/globeMarkers";
import {
  type GlobeCamera,
  globeCameraBasis,
  globeDistanceLimits,
  globeProject,
  globeRay,
  globeRayHit,
  globeSectorAt,
} from "@/libs/rendering/scenes/globeProjection";
import {
  createGlobeArc,
  globeJourneyProgress,
  greatCircleBasis,
} from "@/libs/rendering/scenes/globeRoute";
import type { GlobalMapData } from "@/libs/sector-map/world-types";

const map = globe as unknown as GlobalMapData;
const radius = map.radius / 3;
const limits = globeDistanceLimits(radius);

describe("globe projection and picking", () => {
  it("picks the same real sector at every world center and both zoom limits", () => {
    for (let sector = 0; sector < map.tiles.length; sector++) {
      const point = map.tiles[sector]?.c;
      if (!point) continue;
      for (const distance of [limits.min, limits.max]) {
        const camera: GlobeCamera = {
          longitude: Math.atan2(point.z, point.x),
          latitude: Math.asin(point.y / map.radius),
          distance,
          width: 390,
          height: 390,
        };
        expect(globeSectorAt(195, 195, camera, radius)).toBe(sector);
      }
    }
  });
  it("inverts the projection across aspect ratios and upright camera tilts", () => {
    for (const [width, height] of [
      [390, 390],
      [800, 450],
      [450, 800],
    ]) {
      for (const latitude of [-1.1, 0, 1.1]) {
        const camera: GlobeCamera = {
          longitude: 2.9,
          latitude,
          distance: limits.max,
          width: width ?? 1,
          height: height ?? 1,
        };
        for (const [dx, dy] of [
          [0, 0],
          [50, 50],
          [-50, 70],
        ]) {
          const x = camera.width / 2 + (dx ?? 0),
            y = camera.height / 2 + (dy ?? 0);
          const hit = globeRayHit(globeRay(x, y, camera), radius);
          expect(hit).not.toBeNull();
          if (!hit) continue;
          const projected = globeProject(hit.point, camera);
          expect(projected.x).toBeCloseTo(x, 7);
          expect(projected.y).toBeCloseTo(y, 7);
        }
      }
    }
  });
  it("rejects the sky and polar caps and keeps the camera basis orthonormal", () => {
    const camera: GlobeCamera = {
      longitude: 0,
      latitude: Math.PI / 2,
      distance: limits.max,
      width: 390,
      height: 390,
    };
    expect(globeSectorAt(195, 195, camera, radius)).toBeNull();
    expect(globeSectorAt(-1000, -1000, camera, radius)).toBeNull();
    for (const latitude of [-1.1, 0, 1.1]) {
      camera.latitude = latitude;
      const { right, up, forward } = globeCameraBasis(camera);
      expect(right.x * up.x + right.y * up.y + right.z * up.z).toBeCloseTo(0);
      expect(forward.x * up.x + forward.y * up.y + forward.z * up.z).toBeCloseTo(0);
      expect(Math.hypot(forward.x, forward.y, forward.z)).toBeCloseTo(1);
    }
  });
  it("preserves the established projected zoom range", () => {
    for (const [before, after] of [
      [16, limits.min],
      [22, limits.max],
    ]) {
      const oldRadius =
        Math.tan(Math.asin(radius / (before ?? 1))) / Math.tan((75 * Math.PI) / 360);
      const nextRadius =
        Math.tan(Math.asin(radius / (after ?? 1))) / Math.tan((50 * Math.PI) / 360);
      expect(nextRadius).toBeCloseTo(oldRadius, 10);
    }
  });
});

describe("globe marker anchors", () => {
  const camera: GlobeCamera = {
    longitude: 0,
    latitude: 0,
    distance: limits.max,
    width: 390,
    height: 390,
  };
  const facing = { x: radius, y: 0, z: 0 };
  const behind = { x: -radius, y: 0.5, z: 0.5 };

  it("keeps a facing marker on its own surface point", () => {
    expect(globeMarkerAnchor(facing, camera, radius, true)).toEqual({
      point: facing,
      isVisible: true,
      isClamped: false,
    });
  });

  it("hides far-side markers unless they wait on the rim toward their sector", () => {
    expect(globeMarkerAnchor(behind, camera, radius, false).isVisible).toBe(false);
    const rim = globeMarkerAnchor(behind, camera, radius, true);
    expect(rim.isClamped).toBe(true);
    const length = Math.hypot(rim.point.x, rim.point.y, rim.point.z);
    // On the visible horizon: the direction makes cos = radius / distance with the camera.
    expect(rim.point.x / length).toBeCloseTo(radius / camera.distance, 6);
    expect(Math.sign(rim.point.y)).toBe(1);
    expect(Math.sign(rim.point.z)).toBe(1);
  });
});

describe("globe route arcs", () => {
  it("places a traveler on the ribbon from departure through its midpoint to arrival", () => {
    const arc = createGlobeArc({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 10);
    expect(arc.at(0)).toEqual({ x: 10.06, y: 0, z: 0 });
    expect(arc.at(1).x).toBeCloseTo(0);
    expect(arc.at(1).z).toBeCloseTo(10.06);
    const midway = arc.at(0.5);
    expect(midway.x).toBeCloseTo(midway.z);
    expect(Math.hypot(midway.x, midway.y, midway.z)).toBeGreaterThan(10.06);
    expect(arc.at(-1)).toEqual(arc.at(0));
    expect(arc.at(2)).toEqual(arc.at(1));
    for (const to of [
      { x: -1, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ]) {
      const edge = createGlobeArc({ x: 1, y: 0, z: 0 }, to, 10);
      for (const t of [0, 0.25, 0.5, 0.75, 1])
        expect(Object.values(edge.at(t)).every(Number.isFinite)).toBe(true);
      expect(edge.at(1).x).toBeCloseTo(to.x * 10.06);
    }
  });

  it("synchronizes progress to the server deadline across reloads, clock offsets and instant trips", () => {
    const journey = {
      userId: "hero",
      fromSector: 724,
      toSector: 177,
      finishAt: 20_000,
      durationMs: 10_000,
    };
    expect(globeJourneyProgress(journey, 9_000)).toBe(0);
    expect(globeJourneyProgress(journey, 10_000)).toBe(0);
    expect(globeJourneyProgress(journey, 15_000)).toBe(0.5);
    const clientNow = 18_000,
      timeDiff = 3_000;
    expect(globeJourneyProgress(journey, clientNow - timeDiff)).toBe(0.5);
    expect(
      globeJourneyProgress(JSON.parse(JSON.stringify(journey)), 18_000),
    ).toBeCloseTo(0.8);
    expect(globeJourneyProgress(journey, 20_000)).toBe(1);
    expect(globeJourneyProgress(journey, 25_000)).toBe(1);
    expect(globeJourneyProgress({ ...journey, durationMs: 0 }, 10_000)).toBe(1);
  });

  it("ends every route on its target, including each sector's exact antipode", () => {
    const unit = (point: { x: number; y: number; z: number }) => {
      const length = Math.hypot(point.x, point.y, point.z);
      return { x: point.x / length, y: point.y / length, z: point.z / length };
    };
    const centers = map.tiles.map((tile) => unit(tile.c));
    const dot = (a: (typeof centers)[number], b: (typeof centers)[number]) =>
      a.x * b.x + a.y * b.y + a.z * b.z;
    for (const [index, from] of centers.entries()) {
      const targets = [centers[(index + 1) % centers.length]];
      let antipode = from;
      for (const center of centers)
        if (dot(from, center) < dot(from, antipode)) antipode = center;
      expect(dot(from, antipode)).toBeLessThan(-0.999999);
      targets.push(antipode);
      for (const to of targets) {
        if (!to) continue;
        const { start, toward, across } = greatCircleBasis(from, to);
        const angle = Math.acos(Math.max(-1, Math.min(1, dot(from, to))));
        for (const axis of [toward, across]) {
          expect(Math.hypot(axis.x, axis.y, axis.z)).toBeCloseTo(1, 9);
          expect(dot(start, axis)).toBeCloseTo(0, 9);
        }
        expect(dot(toward, across)).toBeCloseTo(0, 9);
        const end = {
          x: start.x * Math.cos(angle) + toward.x * Math.sin(angle),
          y: start.y * Math.cos(angle) + toward.y * Math.sin(angle),
          z: start.z * Math.cos(angle) + toward.z * Math.sin(angle),
        };
        expect(dot(end, to)).toBeCloseTo(1, 6);
      }
    }
  });
});
