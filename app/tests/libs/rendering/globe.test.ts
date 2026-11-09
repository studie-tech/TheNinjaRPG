import { describe, expect, it } from "bun:test";
import globe from "@/data/hexasphere.json";
import {
  type GlobeCamera,
  globeCameraBasis,
  globeDistanceLimits,
  globeProject,
  globeRay,
  globeRayHit,
  globeSectorAt,
} from "@/libs/rendering/scenes/globeProjection";
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
