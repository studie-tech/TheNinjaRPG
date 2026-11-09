import { expect, test } from "bun:test";
import { MAP_SECTOR_ID_MAX, MAX_TRAVEL_PINS } from "@/drizzle/constants";
import {
  parseTravelPins,
  sectorIdSchema,
  startGlobalMoveSchema,
  travelLocationSchema,
  travelPinSchema,
} from "@/validators/travel";

test("sectorIdSchema rejects out-of-bounds sector", () => {
  const result = sectorIdSchema.safeParse(MAP_SECTOR_ID_MAX + 1);
  expect(result.success).toBe(false);
});

test("sectorIdSchema accepts the last valid sector index", () => {
  const result = sectorIdSchema.safeParse(MAP_SECTOR_ID_MAX);
  expect(result.success).toBe(true);
  expect(result.data).toBe(MAP_SECTOR_ID_MAX);
});

test("sectorIdSchema accepts sector 0 (first valid index)", () => {
  const result = sectorIdSchema.safeParse(0);
  expect(result.success).toBe(true);
  expect(result.data).toBe(0);
});

test("sectorIdSchema rejects negative sectors", () => {
  const result = sectorIdSchema.safeParse(-1);
  expect(result.success).toBe(false);
});

test("sectorIdSchema coerces string numbers", () => {
  const result = sectorIdSchema.safeParse("200");
  expect(result.success).toBe(true);
  expect(result.data).toBe(200);
});

test("startGlobalMoveSchema accepts only the target sector", () => {
  expect(startGlobalMoveSchema.parse({ sector: 1649 })).toEqual({ sector: 1649 });
});

test("startGlobalMoveSchema accepts and discards the client departure hint", () => {
  expect(startGlobalMoveSchema.parse({ sector: 1649, curSector: 200 })).toEqual({
    sector: 1649,
  });
});

test("startGlobalMoveSchema rejects client-supplied landing coordinates", () => {
  const result = startGlobalMoveSchema.safeParse({
    sector: 1649,
    longitude: 0,
    latitude: 0,
  });

  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        code: "unrecognized_keys",
        keys: expect.arrayContaining(["longitude", "latitude"]),
      }),
    );
  }
});

test("travel locations accept sector-only raids and full quest coordinates", () => {
  expect(travelLocationSchema.parse({ sector: "724" })).toEqual({ sector: 724 });
  expect(
    travelLocationSchema.parse({ sector: "724", longitude: "0", latitude: "25" }),
  ).toEqual({ sector: 724, longitude: 0, latitude: 25 });
});

test("travel locations reject invalid coordinates and sectors", () => {
  for (const location of [
    { sector: -1 },
    { sector: MAP_SECTOR_ID_MAX + 1 },
    { sector: 1, longitude: "undefined", latitude: 0 },
    { sector: 1, longitude: -1, latitude: 0 },
    { sector: 1, longitude: 0.5, latitude: 0 },
  ])
    expect(travelLocationSchema.safeParse(location).success).toBe(false);
});

test("stored pins keep valid entries when another pin is invalid", () => {
  const pin = { label: "Faction", sector: 724, longitude: 0, latitude: 25 };
  const other = { label: "Home", sector: 1, longitude: 3, latitude: 4 };
  expect(
    parseTravelPins([
      pin,
      { ...pin, label: " " },
      { label: "Sector", sector: 724 },
      null,
      other,
    ]),
  ).toEqual([pin, other]);
  expect(travelPinSchema.parse({ ...pin, label: " Faction " }).label).toBe("Faction");
  expect(
    parseTravelPins(Array.from({ length: MAX_TRAVEL_PINS + 1 }, () => pin)),
  ).toHaveLength(MAX_TRAVEL_PINS);
  expect(parseTravelPins(undefined)).toEqual([]);
  expect(parseTravelPins({ pin })).toEqual([]);
  expect(travelPinSchema.safeParse({ ...pin, label: "x".repeat(40) }).success).toBe(
    true,
  );
  expect(travelPinSchema.safeParse({ ...pin, label: "x".repeat(41) }).success).toBe(
    false,
  );
});
