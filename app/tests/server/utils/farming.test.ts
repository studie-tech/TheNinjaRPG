import { describe, expect, it, vi } from "vitest";
import type { DrizzleClient } from "@/server/db";
import {
  buildFarmCollectionState,
  recordFirstFarmHarvests,
} from "@/server/utils/farming";

const seed = (
  patch: Partial<Parameters<typeof buildFarmCollectionState>[0][number]> = {},
): Parameters<typeof buildFarmCollectionState>[0][number] => ({
  isFarmSeed: true,
  hidden: false,
  farmYieldItemId: "crop-carrot",
  farmMinLevel: 1,
  farmGrowTimeSeconds: 60,
  ...patch,
});

const crop = (
  id: string,
  name: string,
  hidden = false,
): Parameters<typeof buildFarmCollectionState>[1][number] => ({
  id,
  name,
  image: `/${id}.png`,
  hidden,
});

describe("farm collection catalog", () => {
  it("includes eligible crops once, excludes hidden/invalid entries, and sorts by level then name", () => {
    const harvestedAt = new Date("2026-08-01T12:00:00.000Z");
    const result = buildFarmCollectionState(
      [
        seed({ farmYieldItemId: "crop-carrot", farmMinLevel: 5 }),
        seed({ farmYieldItemId: "crop-carrot", farmMinLevel: 2 }),
        seed({ farmYieldItemId: "crop-apple", farmMinLevel: 2 }),
        seed({ farmYieldItemId: "crop-hidden-seed", hidden: true }),
        seed({ farmYieldItemId: "crop-invalid", farmGrowTimeSeconds: 0 }),
        seed({ farmYieldItemId: "crop-hidden-yield" }),
      ],
      [
        crop("crop-carrot", "Carrot"),
        crop("crop-apple", "Apple"),
        crop("crop-hidden-seed", "Hidden seed crop"),
        crop("crop-invalid", "Invalid crop"),
        crop("crop-hidden-yield", "Hidden yield", true),
        crop("unreferenced", "Unreferenced"),
      ],
      [{ itemId: "crop-carrot", firstHarvestedAt: harvestedAt }],
    );

    expect(result.items.map((entry) => entry.name)).toEqual([
      "Apple",
      "Carrot",
    ]);
    expect(result).toMatchObject({ collected: 1, total: 2 });
    expect(result.items[1]).toMatchObject({
      itemId: "crop-carrot",
      harvested: true,
      firstHarvestedAt: harvestedAt,
    });
  });
});

describe("recordFirstFarmHarvests", () => {
  it("deduplicates bulk crops and never updates the original harvest timestamp", async () => {
    const onDuplicateKeyUpdate = vi
      .fn((_update: { set: Record<string, unknown> }) =>
        Promise.resolve({ rowsAffected: 0 }),
      );
    const values = vi.fn(
      (
        _rows: { itemId: string; firstHarvestedAt: Date }[],
      ): { onDuplicateKeyUpdate: typeof onDuplicateKeyUpdate } => ({
        onDuplicateKeyUpdate,
      }),
    );
    const client = {
      insert: vi.fn(() => ({ values })),
    } as unknown as DrizzleClient;
    const firstHarvestedAt = new Date("2026-08-01T12:00:00.000Z");

    await recordFirstFarmHarvests(
      client,
      "user-1",
      ["crop-a", "crop-a", "crop-b"],
      firstHarvestedAt,
    );

    const inserted = values.mock.calls[0]?.[0];
    if (!inserted) throw new Error("Expected collection rows to be inserted");
    expect(inserted).toHaveLength(2);
    expect(inserted.map((row) => row.itemId)).toEqual(["crop-a", "crop-b"]);
    expect(inserted.every((row) => row.firstHarvestedAt === firstHarvestedAt)).toBe(
      true,
    );
    const duplicateUpdate = onDuplicateKeyUpdate.mock.calls[0]?.[0];
    if (!duplicateUpdate) throw new Error("Expected duplicate-key handling");
    const duplicateSet = duplicateUpdate.set;
    expect(Object.keys(duplicateSet)).toEqual(["id"]);
    expect(duplicateSet).not.toHaveProperty("firstHarvestedAt");
  });
});
