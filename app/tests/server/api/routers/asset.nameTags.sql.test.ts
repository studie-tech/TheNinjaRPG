import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { gameAsset } from "@/drizzle/schema";
import { gameAssetRouter } from "@/server/api/routers/asset";
import { stubRateLimitTransport } from "../../../setup/rateLimit";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

describeWithDatabase("game asset name tags", () => {
  beforeEach(async () => {
    await resetTables(gameAsset);
    stubRateLimitTransport();
    const db = await getTestDatabase();
    await db.insert(gameAsset).values(
      [
        { id: "bell", name: "Skyglass_bell_01", folder: "SkyglassBossFX" },
        { id: "quench", name: "Skyglass_quench", folder: "SkyglassBossFX" },
        { id: "floods", name: "Isonade_floods_slice_07", folder: "isonadestylec" },
        { id: "zap", name: "zap_B_small_yellow", folder: "" },
      ].map((asset) => ({
        ...asset,
        type: "ANIMATION" as const,
        image: "",
        url: "",
      })),
    );
  });

  afterEach(() => vi.restoreAllMocks());

  it("limits name tags to one folder, with an empty folder selecting Unfiled", async () => {
    const caller = await callerFor(gameAssetRouter, "reader");
    const tagsIn = async (exactFolder?: string) =>
      (await caller.getNameTags({ type: "ANIMATION", exactFolder })).tags;
    expect(await tagsIn("SkyglassBossFX")).toEqual(["bell", "quench", "Skyglass"]);
    expect(await tagsIn("")).toEqual(["small", "yellow", "zap"]);
    expect(await tagsIn()).toHaveLength(9);
    expect(
      (
        await caller.getNameTags({
          type: "ANIMATION",
          exactFolder: "SkyglassBossFX",
          selected: ["bell"],
        })
      ).tags,
    ).toEqual(["bell", "Skyglass"]);
  });
});
