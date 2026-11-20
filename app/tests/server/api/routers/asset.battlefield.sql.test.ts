import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { setImmediate } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import { actionLog, gameAsset, userData } from "@/drizzle/schema";
import * as assetQueries from "@/queries/asset";
import { listBattlefieldAssets } from "@/queries/asset";
import { gameAssetRouter } from "@/server/api/routers/asset";
import type { DrizzleClient } from "@/server/db";
import * as lpcCatalog from "@/server/utils/lpcCatalog";
import { deferred } from "../../../setup/deferred";
import { insertUsers } from "../../../setup/factories";
import { lpcAssets } from "../../../setup/lpc";
import { aroundStatements, beforeStatements } from "../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
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

/** Fail logging after the asset deletion commits, preserving its successful write. */
const failDeletionLog = (db: DrizzleClient) => {
  const deleted = deferred();
  return aroundStatements(
    aroundStatements(db, gameAsset, async (run) => {
      const result = await run();
      deleted.resolve();
      return result;
    }),
    actionLog,
    async () => {
      await deleted.promise;
      throw new Error("Logging unavailable");
    },
    { operations: ["insert"] },
  );
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

  afterEach(() => vi.restoreAllMocks());

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

  it.each(["update", "delete"] as const)(
    "invalidates when a concurrent release follows the %s snapshot",
    async (operation) => {
      const db = await getTestDatabase();
      const caller = await callerFor(gameAssetRouter, staffId);
      const client = beforeStatements(db, gameAsset, [
        async () => {
          await caller.update({ id: "tree", data: { ...assetData, name: "Tree" } });
          expect(await ids()).toEqual(["rock", "tree"]);
        },
      ]);
      const staleCaller = callerForDatabase(gameAssetRouter, staffId, client);
      const result =
        operation === "delete"
          ? await staleCaller.delete({ id: "tree" })
          : await staleCaller.update({
              id: "tree",
              data: { ...assetData, name: "Tree", onInitialBattleField: false },
            });
      expect(result.success).toBe(true);
      expect(await ids()).toEqual(["rock"]);
    },
  );

  it("repairs a missing asset's cached row only for an authorized deletion retry", async () => {
    const db = await getTestDatabase();
    expect(await ids()).toEqual(["rock"]);
    // Model a committed deletion whose invalidation never reached the shared store.
    await db.delete(gameAsset).where(eq(gameAsset.id, "rock"));
    await insertUsers([{ userId: "battlefield-player", username: "AssetPlayer" }]);
    const player = await callerFor(gameAssetRouter, "battlefield-player");
    expect((await player.delete({ id: "rock" })).success).toBe(false);
    expect(await ids()).toEqual(["rock"]);
    const staff = await callerFor(gameAssetRouter, staffId);
    await staff.delete({ id: "rock" });
    expect(await ids()).toEqual([]);
  });

  it("waits for battlefield invalidation before reporting an LPC invalidation failure", async () => {
    const db = await getTestDatabase();
    const lpcConfig = lpcAssets[0]!.lpcConfig;
    await db
      .update(gameAsset)
      .set({ type: "LPC", lpcConfig })
      .where(eq(gameAsset.id, "rock"));
    const battlefield = deferred<void>();
    const started = deferred<void>();
    vi.spyOn(assetQueries, "invalidateBattlefieldAssets").mockImplementation(() => {
      started.resolve();
      return battlefield.promise;
    });
    vi.spyOn(lpcCatalog, "invalidateLpcCatalog").mockRejectedValue(
      new Error("LPC cache unavailable"),
    );
    const caller = await callerFor(gameAssetRouter, staffId);
    const outcome = caller
      .update({ id: "rock", data: { ...assetData, type: "LPC", lpcConfig } })
      .catch((error: unknown) => error);
    await started.promise;
    try {
      expect(await Promise.race([outcome, setImmediate("pending")])).toBe("pending");
    } finally {
      battlefield.resolve();
    }
    expect(await outcome).toMatchObject({ message: "LPC cache unavailable" });
  });

  it.each([false, true])(
    "drops a deleted battlefield asset even if logging fails: %s",
    async (failsLogging) => {
      const db = await getTestDatabase();
      const client = failsLogging ? failDeletionLog(db) : db;
      expect(await ids()).toEqual(["rock"]);
      const deletion = callerForDatabase(gameAssetRouter, staffId, client).delete({
        id: "rock",
      });
      if (failsLogging) await expect(deletion).rejects.toThrow("Logging unavailable");
      else expect((await deletion).success).toBe(true);
      expect(await ids()).toEqual([]);
    },
  );
});
