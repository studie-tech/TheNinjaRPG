import { Color } from "three";
import { describe, expect, it } from "vitest";
import globe from "@/data/hexasphere.json";
import {
  MAP_NAVIGABLE_LATITUDE_LIMIT,
  MAP_TOTAL_SECTORS,
  MAP_WORLD_COLUMNS,
  MAP_WORLD_ROWS,
} from "@/drizzle/constants";
import { sectorAtGeographic } from "@/libs/sector-map/world-grid";
import { buildGlobeSurface } from "@/libs/threejs/globe";
import type { GlobalMapData, GlobalPoint } from "@/libs/threejs/types";

const hexasphere = globe as unknown as GlobalMapData;

const toGeographic = (point: GlobalPoint) => {
  const x = Number(point.x);
  const y = Number(point.y);
  const z = Number(point.z);
  const length = Math.hypot(x, y, z) || 1;
  return {
    latitude: (Math.asin(y / length) * 180) / Math.PI,
    longitude: (Math.atan2(z, x) * 180) / Math.PI,
  };
};

describe("sectorAtGeographic", () => {
  it("resolves every sector center back to its own id", () => {
    const mismatches: number[] = [];
    for (let sector = 0; sector < hexasphere.tiles.length; sector++) {
      const tile = hexasphere.tiles[sector];
      if (!tile) continue;
      const { latitude, longitude } = toGeographic(tile.c);
      if (sectorAtGeographic(latitude, longitude) !== sector) mismatches.push(sector);
    }
    expect(mismatches).toEqual([]);
  });

  it("resolves points sampled inside every sector quad", () => {
    // Boundaries are shared, so sample strictly inside each tile: getting this
    // wrong by one grid step is exactly how picking lands on a neighbour.
    const mismatches: { sector: number; got: number }[] = [];
    for (let sector = 0; sector < hexasphere.tiles.length; sector++) {
      const tile = hexasphere.tiles[sector];
      if (!tile || tile.b.length !== 4) continue;
      const [nw, ne, , sw] = tile.b.map(toGeographic) as [
        { latitude: number; longitude: number },
        { latitude: number; longitude: number },
        { latitude: number; longitude: number },
        { latitude: number; longitude: number },
      ];
      // The last column wraps across the +/-180 seam; unwrap before blending.
      const west = nw.longitude;
      const east = ne.longitude < west ? ne.longitude + 360 : ne.longitude;
      for (const u of [0.1, 0.5, 0.9]) {
        for (const v of [0.1, 0.5, 0.9]) {
          const blended = ((west + (east - west) * u + 540) % 360) - 180;
          const longitude = (blended + 360) % 360;
          const got = sectorAtGeographic(
            nw.latitude + (sw.latitude - nw.latitude) * v,
            longitude > 180 ? longitude - 360 : longitude,
          );
          if (got !== sector) mismatches.push({ sector, got });
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("rejects the non-navigable polar caps", () => {
    expect(sectorAtGeographic(MAP_NAVIGABLE_LATITUDE_LIMIT + 0.5, 0)).toBe(-1);
    expect(sectorAtGeographic(-MAP_NAVIGABLE_LATITUDE_LIMIT - 0.5, 0)).toBe(-1);
    expect(sectorAtGeographic(90, 0)).toBe(-1);
    expect(sectorAtGeographic(Number.NaN, 0)).toBe(-1);
  });

  it("keeps the latitude limits and the longitude seam inside the grid", () => {
    expect(sectorAtGeographic(MAP_NAVIGABLE_LATITUDE_LIMIT, -180)).toBe(0);
    expect(sectorAtGeographic(-MAP_NAVIGABLE_LATITUDE_LIMIT, -180)).toBe(
      (MAP_WORLD_ROWS - 1) * MAP_WORLD_COLUMNS,
    );
    // +180 and -180 are the same meridian and must not fall off the east edge.
    expect(sectorAtGeographic(0, 180)).toBe(sectorAtGeographic(0, -180));
  });
});

describe("buildGlobeSurface", () => {
  const surface = buildGlobeSurface(hexasphere);
  const positions = surface.geometry.getAttribute("position");
  const colors = surface.geometry.getAttribute("color");

  it("covers every sector with a contiguous, non-overlapping vertex range", () => {
    let expectedStart = 0;
    for (let sector = 0; sector < MAP_TOTAL_SECTORS; sector++) {
      const start = surface.vertexRanges[sector * 2];
      const count = surface.vertexRanges[sector * 2 + 1];
      expect(start).toBe(expectedStart);
      expect(count).toBeGreaterThan(0);
      expectedStart += count as number;
    }
    expect(expectedStart).toBe(positions.count);
    expect(colors.count).toBe(positions.count);
  });

  it("places every vertex on the globe surface", () => {
    const radius = hexasphere.radius / 3;
    let worst = 0;
    for (let i = 0; i < positions.count; i++) {
      const distance = Math.hypot(
        positions.getX(i),
        positions.getY(i),
        positions.getZ(i),
      );
      worst = Math.max(worst, Math.abs(distance - radius));
    }
    expect(worst).toBeLessThan(1e-3);
  });

  it("indexes only vertices belonging to the sector that emitted them", () => {
    const index = surface.geometry.getIndex();
    expect(index).not.toBeNull();
    const owner = new Int32Array(positions.count).fill(-1);
    for (let sector = 0; sector < MAP_TOTAL_SECTORS; sector++) {
      const start = surface.vertexRanges[sector * 2] as number;
      const count = surface.vertexRanges[sector * 2 + 1] as number;
      owner.fill(sector, start, start + count);
    }
    const triangles = (index?.count ?? 0) / 3;
    let straddling = 0;
    for (let triangle = 0; triangle < triangles; triangle++) {
      const a = owner[index?.getX(triangle * 3) ?? 0];
      const b = owner[index?.getX(triangle * 3 + 1) ?? 0];
      const c = owner[index?.getX(triangle * 3 + 2) ?? 0];
      if (a !== b || b !== c) straddling++;
    }
    expect(straddling).toBe(0);
  });

  it("applies an ownership tint to exactly the tinted sector", () => {
    const tinted = 500;
    const plain = buildGlobeSurface(hexasphere);
    const shaded = buildGlobeSurface(hexasphere, (sector) =>
      sector === tinted ? new Color(0.5, 0.25, 0.125) : null,
    );
    const plainColors = plain.geometry.getAttribute("color").array as Float32Array;
    const shadedColors = shaded.geometry.getAttribute("color").array as Float32Array;
    const start = (shaded.vertexRanges[tinted * 2] as number) * 3;
    const count = (shaded.vertexRanges[tinted * 2 + 1] as number) * 3;

    for (let i = 0; i < count; i += 3) {
      expect(shadedColors[start + i]).toBeCloseTo(
        (plainColors[start + i] ?? 0) * 0.5,
        6,
      );
      expect(shadedColors[start + i + 1]).toBeCloseTo(
        (plainColors[start + i + 1] ?? 0) * 0.25,
        6,
      );
    }
    // Neighbouring sectors keep their terrain colors untouched.
    const neighbourStart = (shaded.vertexRanges[(tinted + 1) * 2] as number) * 3;
    expect(shadedColors[neighbourStart]).toBe(plainColors[neighbourStart]);
  });
});
