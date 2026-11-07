import { describe, expect, it } from "bun:test";
import { ItemValidator } from "@/validators/combat";
import { validItemInput } from "../setup/items";

const validItem = validItemInput();

describe("farm item validation", () => {
  it("rejects a farm seed with the default zero grow time", () => {
    const result = ItemValidator.safeParse({ ...validItem, isFarmSeed: true });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({ path: ["farmGrowTimeSeconds"] }),
      );
    }
  });

  it("accepts a farm seed with a positive grow time", () => {
    const result = ItemValidator.safeParse({
      ...validItem,
      isFarmSeed: true,
      farmGrowTimeSeconds: 1,
    });

    expect(result.success).toBe(true);
  });

  it("keeps the zero grow-time default valid for non-seed items", () => {
    const result = ItemValidator.safeParse(validItem);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.farmGrowTimeSeconds).toBe(0);
  });
});
