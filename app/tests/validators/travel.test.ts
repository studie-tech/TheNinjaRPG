import { expect, test } from "bun:test";
import { MAP_SECTOR_ID_MAX } from "@/drizzle/constants";
import { sectorIdSchema, startGlobalMoveSchema, travelLocationSchema, travelPinsSchema } from "@/validators/travel";

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

test("startGlobalMoveSchema tolerates and strips a stale current sector", () => {
  expect(
    startGlobalMoveSchema.parse({ sector: 1649, curSector: 1631 }),
  ).toEqual({ sector: 1649 });
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
  expect(travelLocationSchema.parse({ sector: "724", longitude: "0", latitude: "25" })).toEqual({ sector: 724, longitude: 0, latitude: 25 });
});

test("travel locations reject invalid coordinates and sectors", () => {
  for (const location of [
    { sector: -1 },
    { sector: MAP_SECTOR_ID_MAX + 1 },
    { sector: 1, longitude: "undefined", latitude: 0 },
    { sector: 1, longitude: -1, latitude: 0 },
    { sector: 1, longitude: 0.5, latitude: 0 },
  ]) expect(travelLocationSchema.safeParse(location).success).toBe(false);
});

test("saved pins require named coordinates and enforce the storage limit", () => {
  const pin = { label: " Faction ", sector: 724, longitude: 0, latitude: 25 };
  expect(travelPinsSchema.parse([pin])[0]?.label).toBe("Faction");
  expect(travelPinsSchema.safeParse([{ ...pin, label: " " }]).success).toBe(false);
  expect(travelPinsSchema.safeParse([{ label: "Sector", sector: 724 }]).success).toBe(false);
  expect(travelPinsSchema.safeParse(Array.from({ length: 21 }, () => pin)).success).toBe(false);
});
