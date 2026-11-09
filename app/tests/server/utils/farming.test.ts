import { reduceActiveFarmPlotTimers } from "@/queries/farming";
import { describe, expect, it, vi } from "bun:test";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { DrizzleClient } from "@/server/db";
import {
  buildFarmCollectionState,
  recordFirstFarmHarvests,
} from "@/server/utils/farming";

const seed = (
  patch: Partial<Parameters<typeof buildFarmCollectionState>[0][number]> = {},
): Parameters<typeof buildFarmCollectionState>[0][number] => ({
  farmYieldItemId: "crop-carrot",
  farmMinLevel: 1,
  ...patch,
});

const crop = (
  id: string,
  name: string,
): Parameters<typeof buildFarmCollectionState>[1][number] => ({
  id,
  name,
  image: `/${id}.png`,
});

describe("farm collection catalog", () => {
  it("includes each crop once, skips yields without a seed, and sorts by level then name", () => {
    const harvestedAt = new Date("2026-08-01T12:00:00.000Z");
    const result = buildFarmCollectionState(
      [
        seed({ farmYieldItemId: "crop-carrot", farmMinLevel: 5 }),
        seed({ farmYieldItemId: "crop-carrot", farmMinLevel: 2 }),
        seed({ farmYieldItemId: "crop-apple", farmMinLevel: 2 }),
      ],
      [
        crop("crop-carrot", "Carrot"),
        crop("crop-apple", "Apple"),
        crop("unreferenced", "Unreferenced"),
      ],
      [{ itemId: "crop-carrot", firstHarvestedAt: harvestedAt }],
    );

    expect(result.items.map((entry) => entry.name)).toEqual(["Apple", "Carrot"]);
    expect(result).toMatchObject({ collected: 1, total: 2 });
    expect(result.items[1]).toEqual(
      expect.objectContaining({
        itemId: "crop-carrot",
        harvested: true,
        firstHarvestedAt: harvestedAt,
      }),
    );
  });
});

describe("recordFirstFarmHarvests", () => {
  it("deduplicates bulk crops and never updates the original harvest timestamp", async () => {
    const onDuplicateKeyUpdate = vi.fn((_update: { set: Record<string, unknown> }) =>
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

/** Flattens a drizzle SQL fragment into text, since the object graph is cyclic. */
describe("reduceActiveFarmPlotTimers", () => {
  it("clamps the new finish time to now and only touches plots still growing", () => {
    const where = vi.fn(() => Promise.resolve({ rowsAffected: 2 }));
    const set = vi.fn((_values: Record<string, unknown>) => ({ where }));
    const client = {
      update: vi.fn(() => ({ set })),
    } as unknown as DrizzleClient;
    const now = new Date("2026-08-30T12:00:00.000Z");

    reduceActiveFarmPlotTimers(client, "user-1", 90, now);

    const applied = set.mock.calls[0]?.[0];
    if (!applied) throw new Error("Expected the plot timers to be updated");
    expect(applied.updatedAt).toBe(now);

    // finishAt must be pulled in by the reduction but never past `now`, so a plot
    // that is nearly ready cannot be pushed into the past by a long win streak.
    const rendered = new MySqlDialect().sqlToQuery(applied.finishAt as SQL);
    expect(rendered.sql).toContain("GREATEST");
    expect(rendered.sql).toContain("TIMESTAMPADD");
    expect(rendered.params).toContain(90);

    // Idle plots, harvest-ready plots and other users' plots must be excluded.
    expect(where).toHaveBeenCalledTimes(1);
  });
});
