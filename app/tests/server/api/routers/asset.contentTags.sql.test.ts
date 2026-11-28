import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { contentTag, gameAsset, gameAssetTag } from "@/drizzle/schema";
import { unpackLpcDesigns } from "@/libs/lpc/transport";
import { gameAssetRouter } from "@/server/api/routers/asset";
import { lpcAssets } from "../../../setup/lpc";
import { stubRateLimitTransport } from "../../../setup/rateLimit";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

describeWithDatabase("game asset content tags", () => {
  beforeEach(async () => {
    await resetTables(gameAssetTag, contentTag, gameAsset);
    stubRateLimitTransport();
    const db = await getTestDatabase();
    await db.insert(gameAsset).values(
      ["a", "b", "c", "untagged"].map((id) => ({
        id,
        name: id,
        type: "STATIC" as const,
        image: "",
        url: "",
      })),
    );
    await db.insert(contentTag).values([
      { id: "fire", name: "Fire" },
      { id: "water", name: "Water" },
      { id: "unused", name: "Unused" },
    ]);
    await db.insert(gameAssetTag).values([
      { id: "a-fire", assetId: "a", tagId: "fire" },
      { id: "a-water", assetId: "a", tagId: "water" },
      { id: "b-water", assetId: "b", tagId: "water" },
      { id: "c-fire", assetId: "c", tagId: "fire" },
    ]);
  });

  afterEach(() => vi.restoreAllMocks());

  it("discovers assigned tags and paginates each matching asset once", async () => {
    const caller = await callerFor(gameAssetRouter, "reader");
    expect(
      (await caller.getAllGameAssetContentTagNames()).map((tag) => tag.name).sort(),
    ).toEqual(["Fire", "Water"]);
    const input = { tags: ["Fire", "Water"], sort: "name-asc" as const, limit: 1 };
    const first = await caller.getAll(input);
    const second = await caller.getAll({ ...input, cursor: first.nextCursor });
    const third = await caller.getAll({ ...input, cursor: second.nextCursor });
    expect(
      [first, second, third].map((page) => unpackLpcDesigns(page.data)[0]?.id),
    ).toEqual(["a", "b", "c"]);
    expect(third.nextCursor).toBeNull();
    expect(
      unpackLpcDesigns(
        (await caller.getAll({ tags: ["Fire"], limit: 50, sort: "name-asc" })).data,
      ).map((asset) => asset.id),
    ).toEqual(["a", "c"]);
    expect(
      unpackLpcDesigns((await caller.getAll({ tags: [], limit: 50 })).data),
    ).toEqual([]);
    expect(unpackLpcDesigns((await caller.getAll({ limit: 50 })).data)).toHaveLength(4);
  });

  it("pages complete character definitions in stable order without sorting their JSON", async () => {
    const db = await getTestDatabase();
    const designs = lpcAssets.slice(0, 24);
    await db.insert(gameAsset).values(
      designs.map((asset, index) => ({
        ...asset,
        name: `Design ${String(index).padStart(2, "0")}`,
      })),
    );
    const caller = await callerFor(gameAssetRouter, "reader");
    const input = {
      type: "LPC" as const,
      includeAnimations: true,
      sort: "name-desc" as const,
      limit: 10,
    };
    const pages = [
      await caller.getAll(input),
      await caller.getAll({ ...input, cursor: 1 }),
      await caller.getAll({ ...input, cursor: 2 }),
    ];
    const rows = pages.flatMap((page) => unpackLpcDesigns(page.data));
    expect(rows.map((asset) => asset.id)).toEqual(
      designs.map((asset) => asset.id).reverse(),
    );
    expect(rows[0]!.lpcConfig).toEqual(designs.at(-1)!.lpcConfig);
    expect(pages.map((page) => page.nextCursor)).toEqual([1, 2, null]);
  });
});
