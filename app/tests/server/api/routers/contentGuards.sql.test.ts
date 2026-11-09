import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import {
  actionLog,
  badge,
  bloodline,
  gameAsset,
  userBadge,
  userData,
} from "@/drizzle/schema";
import { gameAssetRouter } from "@/server/api/routers/asset";
import { badgeRouter } from "@/server/api/routers/badge";
import { bloodlineRouter } from "@/server/api/routers/bloodline";
import { insertUsers } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const staffId = "content-staff";
const bannedId = "content-banned";
const playerId = "content-player";

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
  });
});
