import { beforeEach, expect, it } from "bun:test";
import { IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import { actionLog, gameAsset, userData } from "@/drizzle/schema";
import { listBattlefieldAssets } from "@/queries/asset";
import { gameAssetRouter } from "@/server/api/routers/asset";
import { insertUsers } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const staffId = "battlefield-staff";
const assetData = {
  name: "Rock",
  image: IMG_AVATAR_DEFAULT,
  frames: 1,
  speed: 1,
  type: "STATIC" as const,
  licenseDetails: "Test",
  onInitialBattleField: true,
  hidden: false,
};

/** The battlefield asset set follows every staff save and deletion that changes it. */
describeWithDatabase("battlefield assets", () => {
  beforeEach(async () => {
    await resetTables(actionLog, gameAsset, userData);
    await insertUsers([
      { userId: staffId, username: "AssetStaff", role: "CONTENT-ADMIN" },
    ]);
    const db = await getTestDatabase();
    await db.insert(gameAsset).values([
      { id: "rock", ...assetData, url: IMG_AVATAR_DEFAULT, folder: "" },
      {
        id: "tree",
        ...assetData,
        name: "Tree",
        onInitialBattleField: false,
        url: IMG_AVATAR_DEFAULT,
        folder: "",
      },
      {
        id: "hidden-rock",
        ...assetData,
        hidden: true,
        url: IMG_AVATAR_DEFAULT,
        folder: "",
      },
    ]);
  });

  const ids = async () => {
    const db = await getTestDatabase();
    return (await listBattlefieldAssets(db)).map((asset) => asset.id).sort();
  };

  it("lists released battlefield assets and serves later reads from the cache", async () => {
    const db = await getTestDatabase();
    expect(await listBattlefieldAssets(db)).toEqual([{ id: "rock", type: "STATIC" }]);
    // A row written outside the asset editor stays out until the cache is invalidated.
    await db
      .insert(gameAsset)
      .values({ id: "boulder", ...assetData, url: IMG_AVATAR_DEFAULT, folder: "" });
    expect(await listBattlefieldAssets(db)).toEqual([{ id: "rock", type: "STATIC" }]);
  });

  it("follows saves that add, hide and restore battlefield assets", async () => {
    const caller = await callerFor(gameAssetRouter, staffId);
    expect(await ids()).toEqual(["rock"]);
    await caller.update({ id: "tree", data: { ...assetData, name: "Tree" } });
    expect(await ids()).toEqual(["rock", "tree"]);
    await caller.update({ id: "rock", data: { ...assetData, hidden: true } });
    expect(await ids()).toEqual(["tree"]);
    await caller.update({ id: "hidden-rock", data: { ...assetData, hidden: false } });
    expect(await ids()).toEqual(["hidden-rock", "tree"]);
    await caller.update({
      id: "tree",
      data: { ...assetData, name: "Tree", onInitialBattleField: false },
    });
    expect(await ids()).toEqual(["hidden-rock"]);
  });

  it("drops a deleted battlefield asset", async () => {
    const caller = await callerFor(gameAssetRouter, staffId);
    expect(await ids()).toEqual(["rock"]);
    expect((await caller.delete({ id: "rock" })).success).toBe(true);
    expect(await ids()).toEqual([]);
  });
});
