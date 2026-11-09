import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { contentTag, gameAsset, gameAssetTag } from "@/drizzle/schema";
import { gameAssetRouter } from "@/server/api/routers/asset";
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
    expect([first, second, third].map((page) => page.data[0]?.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(third.nextCursor).toBeNull();
    expect(
      (await caller.getAll({ tags: ["Fire"], limit: 50, sort: "name-asc" })).data.map(
        (asset) => asset.id,
      ),
    ).toEqual(["a", "c"]);
    expect((await caller.getAll({ tags: [], limit: 50 })).data).toEqual([]);
    expect((await caller.getAll({ limit: 50 })).data).toHaveLength(4);
  });
});
