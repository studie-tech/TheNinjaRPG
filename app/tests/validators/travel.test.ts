import { expect, test } from "vitest";
import { sectorIdSchema } from "@/validators/travel";

test("sectorIdSchema rejects sector 492 (out of bounds)", () => {
  const result = sectorIdSchema.safeParse(492);
  expect(result.success).toBe(false);
});

test("sectorIdSchema accepts sector 491 (last valid index)", () => {
  const result = sectorIdSchema.safeParse(491);
  expect(result.success).toBe(true);
  expect(result.data).toBe(491);
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
