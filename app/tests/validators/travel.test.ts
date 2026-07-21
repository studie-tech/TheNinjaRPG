import { expect, test } from "vitest";
import { MAP_SECTOR_ID_MAX } from "@/drizzle/constants";
import { sectorIdSchema, startGlobalMoveSchema } from "@/validators/travel";

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

test("startGlobalMoveSchema accepts only current and target sectors", () => {
  expect(startGlobalMoveSchema.parse({ sector: 1649, curSector: 1631 })).toEqual({
    sector: 1649,
    curSector: 1631,
  });
});

test("startGlobalMoveSchema rejects client-supplied landing coordinates", () => {
  const result = startGlobalMoveSchema.safeParse({
    sector: 1649,
    curSector: 1631,
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
