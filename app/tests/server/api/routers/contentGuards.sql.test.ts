import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import {
  actionLog,
  badge,
  bloodline,
  gameAsset,
  quest,
  userBadge,
  userData,
} from "@/drizzle/schema";
import { fetchAchievementCatalogue } from "@/queries/profile";
import { gameAssetRouter } from "@/server/api/routers/asset";
import { badgeRouter } from "@/server/api/routers/badge";
import { bloodlineRouter } from "@/server/api/routers/bloodline";
import { questsRouter } from "@/server/api/routers/quests";
import type { DrizzleClient } from "@/server/db";
import { fetchBloodlineCollectionCatalogue } from "@/server/utils/questCollections";
import { deferred } from "../../../setup/deferred";
import { insertQuests, insertUsers } from "../../../setup/factories";
import { aroundStatements } from "../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const staffId = "content-staff";
const bannedId = "content-banned";
const playerId = "content-player";

/** Fail logging after the definition deletion commits, preserving its successful write. */
const failDeletionLog = (db: DrizzleClient, table: typeof bloodline | typeof quest) => {
  const deleted = deferred();
  return aroundStatements(
    aroundStatements(db, table, async (run) => {
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

const badgeData = {
  name: "Guard Badge",
  image: IMG_AVATAR_DEFAULT,
  description: "Guarded",
};
const assetData = {
  name: "Guard Asset",
  image: IMG_AVATAR_DEFAULT,
  frames: 1,
  speed: 1,
  type: "STATIC" as const,
  licenseDetails: "Guarded",
  onInitialBattleField: false,
};

/** Rejected content writes answer with the procedure's message and leave every row alone. */
describeWithDatabase("content procedure guards", () => {
  beforeEach(async () => {
    await resetTables(actionLog, userBadge, badge, gameAsset, bloodline, userData);
    await insertUsers([
      { userId: staffId, username: "ContentStaff", role: "CONTENT-ADMIN" },
      {
        userId: bannedId,
        username: "ContentBanned",
        role: "CONTENT-ADMIN",
        isBanned: true,
      },
      { userId: playerId, username: "ContentPlayer", role: "USER" },
    ]);
    const db = await getTestDatabase();
    await db.insert(badge).values({ id: "badge", ...badgeData });
    await db
      .insert(gameAsset)
      .values({ id: "asset", ...assetData, folder: "", url: IMG_AVATAR_DEFAULT });
  });

  const rows = async () => {
    const db = await getTestDatabase();
    const [badges, assets, bloodlines, logs] = await Promise.all([
      db.select().from(badge),
      db.select().from(gameAsset),
      db.select().from(bloodline),
      db.select().from(actionLog),
    ]);
    return { badges, assets, bloodlines, logs };
  };

  describe("badge", () => {
    it("rejects players on create, update and delete", async () => {
      const before = await rows();
      const caller = await callerFor(badgeRouter, playerId);
      expect(await caller.create()).toEqual({
        success: false,
        message: "Not allowed to create badge",
      });
      expect(
        await caller.update({ id: "badge", data: { ...badgeData, name: "Renamed" } }),
      ).toEqual({
        success: false,
        message: "Not allowed to edit badge",
      });
      expect(await caller.delete({ id: "badge" })).toEqual({
        success: false,
        message: "Not allowed to delete badge",
      });
      expect(await rows()).toEqual(before);
    });

    it("reports a missing badge to staff as not allowed on delete", async () => {
      const caller = await callerFor(badgeRouter, staffId);
      expect(await caller.delete({ id: "missing" })).toEqual({
        success: false,
        message: "Not allowed to delete badge",
      });
    });

    it("lets staff create and delete", async () => {
      const caller = await callerFor(badgeRouter, staffId);
      expect((await caller.create()).success).toBe(true);
      expect(await caller.delete({ id: "badge" })).toMatchObject({
        success: true,
        message: "Badge deleted",
      });
      const db = await getTestDatabase();
      expect(
        await db.query.badge.findFirst({ where: eq(badge.id, "badge") }),
      ).toBeUndefined();
    });
  });

  describe("game asset", () => {
    it("rejects players and banned staff on create, update and delete", async () => {
      const before = await rows();
      for (const userId of [playerId, bannedId]) {
        const caller = await callerFor(gameAssetRouter, userId);
        expect(await caller.create()).toEqual({
          success: false,
          message: "Not allowed to create gameAsset",
        });
        expect(
          await caller.update({ id: "asset", data: { ...assetData, name: "Renamed" } }),
        ).toEqual({
          success: false,
          message: "Not allowed to edit gameAsset",
        });
        expect(await caller.delete({ id: "asset" })).toEqual({
          success: false,
          message: "Not allowed to delete gameAsset",
        });
      }
      expect(await rows()).toEqual(before);
    });

    it("reports a missing asset to staff as not allowed", async () => {
      const caller = await callerFor(gameAssetRouter, staffId);
      expect(await caller.update({ id: "missing", data: assetData })).toEqual({
        success: false,
        message: "Not allowed to edit gameAsset",
      });
      expect(await caller.delete({ id: "missing" })).toEqual({
        success: false,
        message: "Not allowed to delete gameAsset",
      });
    });

    it("lets staff create and delete", async () => {
      const caller = await callerFor(gameAssetRouter, staffId);
      expect((await caller.create()).success).toBe(true);
      expect(await caller.delete({ id: "asset" })).toMatchObject({
        success: true,
        message: "gameAsset deleted",
      });
    });
  });

  describe("bloodline", () => {
    it("rejects players on create and update", async () => {
      const db = await getTestDatabase();
      await db.insert(bloodline).values({
        id: "line",
        name: "Guard Line",
        rank: "D",
        image: IMG_AVATAR_DEFAULT,
        description: "Guarded",
        effects: [],
      });
      const before = await rows();
      const caller = await callerFor(bloodlineRouter, playerId);
      expect(await caller.create()).toEqual({
        success: false,
        message: "Not allowed to create bloodline",
      });
      const entry = (await db.query.bloodline.findFirst({
        where: eq(bloodline.id, "line"),
      }))!;
      expect(
        await caller.update({
          id: "line",
          data: { ...entry, description: "Renamed" } as never,
        }),
      ).toEqual({
        success: false,
        message: "Not allowed to edit bloodline",
      });
      expect(await rows()).toEqual(before);
    });

    it("lets staff create", async () => {
      expect((await (await callerFor(bloodlineRouter, staffId)).create()).success).toBe(
        true,
      );
    });

    it.each([false, true])(
      "drops a deleted bloodline from the catalogue even if logging fails: %s",
      async (failsLogging) => {
        const db = await getTestDatabase();
        await db.insert(bloodline).values({
          id: "line",
          name: "Guard Line",
          rank: "D",
          image: IMG_AVATAR_DEFAULT,
          description: "Guarded",
          effects: [],
        });
        const client = failsLogging ? failDeletionLog(db, bloodline) : db;
        expect(await fetchBloodlineCollectionCatalogue(client)).toEqual([
          { id: "line", rank: "D", hidden: false },
        ]);
        const deletion = callerForDatabase(bloodlineRouter, staffId, client).delete({
          id: "line",
        });
        if (failsLogging) await expect(deletion).rejects.toThrow("Logging unavailable");
        else expect((await deletion).success).toBe(true);
        expect(await fetchBloodlineCollectionCatalogue(client)).toEqual([]);
      },
    );
  });

  describe("quest", () => {
    it.each([false, true])(
      "drops a deleted achievement from the catalogue even if logging fails: %s",
      async (failsLogging) => {
        await resetTables(quest);
        await insertQuests([{ id: "guard-achievement", questType: "achievement" }]);
        const db = await getTestDatabase();
        const client = failsLogging ? failDeletionLog(db, quest) : db;
        const ids = async () =>
          (await fetchAchievementCatalogue(client)).map((entry) => entry.id);
        expect(await ids()).toEqual(["guard-achievement"]);
        const deletion = callerForDatabase(questsRouter, staffId, client).delete({
          id: "guard-achievement",
        });
        if (failsLogging) await expect(deletion).rejects.toThrow("Logging unavailable");
        else expect((await deletion).success).toBe(true);
        expect(await ids()).toEqual([]);
      },
    );
  });
});
