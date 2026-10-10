
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "bun:test";
import { actionLog, jutsu, jutsuReskin, userData, userJutsu } from "@/drizzle/schema";
import * as actualModerator from "@/libs/moderator";
import { jutsuRouter } from "@/server/api/routers/jutsu";
import type { JutsuReskinUpdateSchema } from "@/validators/jutsu";
import { insertUsers } from "../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

// The update reason is moderated by an LLM; approve it so the suite needs no network.
vi.mock("@/libs/moderator", () => ({
  ...actualModerator,
  validateUserUpdateReason: async () => ({ allowUpdate: true, comment: "" }),
}));

/**
 * Staff repair player-owned jutsu reskins from the reskin editor: they load and save
 * reskins they do not own, move them to another owner or base jutsu, and decide whether
 * the owner's jutsu uses them. Players keep seeing only their own reskins.
 */
const STAFF = "staff-user";
const OWNER = "owner-user";
const OTHER = "other-user";

const caller = (userId: string) => callerFor(jutsuRouter, userId);

const jutsuRow = (id: string) => ({
  id,
  name: `Jutsu ${id}`,
  description: id,
  battleDescription: id,
  effects: [],
  target: "SELF" as const,
  range: 0,
  requiredRank: "GENIN" as const,
  jutsuType: "NORMAL" as const,
  image: `/${id}.png`,
});

const reskinRow = (patch: Partial<typeof jutsuReskin.$inferInsert> = {}) => ({
  id: "reskin-1",
  userId: OWNER,
  jutsuId: "jutsu-a",
  name: "Fancy Fireball",
  description: "Fancy",
  battleDescription: "Fancy",
  image: "/fancy.png",
  ...patch,
});

const updateData = (patch: Partial<JutsuReskinUpdateSchema> = {}) => ({
  name: "Fancy Fireball",
  description: "Fancy",
  battleDescription: "Fancy",
  image: "/fancy.png",
  username: "Owner",
  jutsuId: "jutsu-a",
  attached: true,
  reason: "Restoring the reskin after a support ticket",
  ...patch,
});

const readReskin = async () => {
  const database = await getTestDatabase();
  const [row] = await database
    .select()
    .from(jutsuReskin)
    .where(eq(jutsuReskin.id, "reskin-1"));
  return row;
};

const readUserJutsu = async (id: string) => {
  const database = await getTestDatabase();
  const [row] = await database.select().from(userJutsu).where(eq(userJutsu.id, id));
  return row;
};

describeWithDatabase("jutsu reskin staff editing against a real MySQL", () => {
  beforeEach(async () => {
    await resetTables(actionLog, jutsuReskin, userJutsu, jutsu, userData);
    await insertUsers([
      { userId: STAFF, username: "Staff", role: "CONTENT" },
      { userId: OWNER, username: "Owner" },
      { userId: OTHER, username: "Other" },
    ] as never);
    const database = await getTestDatabase();
    await database.insert(jutsu).values([jutsuRow("jutsu-a"), jutsuRow("jutsu-b")]);
  });

  describe("getReskin", () => {
    it("lets staff load a reskin owned by another user, with its attachment state", async () => {
      const database = await getTestDatabase();
      await database.insert(jutsuReskin).values(reskinRow());
      await database.insert(userJutsu).values({
        id: "uj-owner-a",
        userId: OWNER,
        jutsuId: "jutsu-a",
        reskinId: "reskin-1",
      });
      const result = await (await caller(STAFF)).getReskin({ reskinId: "reskin-1" });
      expect("success" in result).toBe(false);
      if ("success" in result) return;
      expect(result.id).toBe("reskin-1");
      expect(result.user?.username).toBe("Owner");
      expect(result.attached).toBe(true);
    });

    it("keeps reskins hidden from players who do not own them", async () => {
      const database = await getTestDatabase();
      await database.insert(jutsuReskin).values(reskinRow());
      const result = await (await caller(OTHER)).getReskin({ reskinId: "reskin-1" });
      expect(result).toMatchObject({ success: false, message: "Reskin not found" });
      const own = await (await caller(OWNER)).getReskin({ reskinId: "reskin-1" });
      expect("success" in own).toBe(false);
    });
  });

  describe("updateReskin", () => {
    it("lets staff edit a reskin they do not own", async () => {
      const database = await getTestDatabase();
      await database.insert(jutsuReskin).values(reskinRow());
      const result = await (await caller(STAFF)).updateReskin({
        reskinId: "reskin-1",
        data: updateData({ attached: false }),
      });
      expect(result.success).toBe(true);
      const row = await readReskin();
      expect(row?.userId).toBe(OWNER);
    });

    it("reattaches a detached reskin to the owner's jutsu", async () => {
      const database = await getTestDatabase();
      await database.insert(jutsuReskin).values(reskinRow());
      await database
        .insert(userJutsu)
        .values({ id: "uj-owner-a", userId: OWNER, jutsuId: "jutsu-a" });
      const result = await (await caller(STAFF)).updateReskin({
        reskinId: "reskin-1",
        data: updateData(),
      });
      expect(result.success).toBe(true);
      expect((await readUserJutsu("uj-owner-a"))?.reskinId).toBe("reskin-1");
    });

    it("reassigns the reskin to another user and jutsu, moving the attachment", async () => {
      const database = await getTestDatabase();
      await database.insert(jutsuReskin).values(reskinRow({ userId: OTHER }));
      await database.insert(userJutsu).values([
        { id: "uj-other-a", userId: OTHER, jutsuId: "jutsu-a", reskinId: "reskin-1" },
        { id: "uj-owner-b", userId: OWNER, jutsuId: "jutsu-b" },
      ]);
      const result = await (await caller(STAFF)).updateReskin({
        reskinId: "reskin-1",
        data: updateData({ jutsuId: "jutsu-b" }),
      });
      expect(result.success).toBe(true);
      const row = await readReskin();
      expect(row?.userId).toBe(OWNER);
      expect(row?.jutsuId).toBe("jutsu-b");
      expect((await readUserJutsu("uj-owner-b"))?.reskinId).toBe("reskin-1");
      expect((await readUserJutsu("uj-other-a"))?.reskinId).toBeNull();
    });

    it("detaches the reskin from the owner's jutsu when asked", async () => {
      const database = await getTestDatabase();
      await database.insert(jutsuReskin).values(reskinRow());
      await database.insert(userJutsu).values({
        id: "uj-owner-a",
        userId: OWNER,
        jutsuId: "jutsu-a",
        reskinId: "reskin-1",
      });
      const result = await (await caller(STAFF)).updateReskin({
        reskinId: "reskin-1",
        data: updateData({ attached: false }),
      });
      expect(result.success).toBe(true);
      expect((await readUserJutsu("uj-owner-a"))?.reskinId).toBeNull();
    });

    it("refuses to attach to a jutsu the target user does not know", async () => {
      const database = await getTestDatabase();
      await database.insert(jutsuReskin).values(reskinRow());
      const result = await (await caller(STAFF)).updateReskin({
        reskinId: "reskin-1",
        data: updateData({ jutsuId: "jutsu-b" }),
      });
      expect(result.success).toBe(false);
      expect((await readReskin())?.jutsuId).toBe("jutsu-a");
    });

    it("refuses to collide with the target user's existing reskin for that jutsu", async () => {
      const database = await getTestDatabase();
      await database
        .insert(jutsuReskin)
        .values([reskinRow({ userId: OTHER }), reskinRow({ id: "reskin-2" })]);
      await database
        .insert(userJutsu)
        .values({ id: "uj-owner-a", userId: OWNER, jutsuId: "jutsu-a" });
      const result = await (await caller(STAFF)).updateReskin({
        reskinId: "reskin-1",
        data: updateData(),
      });
      expect(result.success).toBe(false);
      expect((await readReskin())?.userId).toBe(OTHER);
      expect((await readUserJutsu("uj-owner-a"))?.reskinId).toBeNull();
    });

    it("refuses an unknown target user", async () => {
      const database = await getTestDatabase();
      await database.insert(jutsuReskin).values(reskinRow());
      const result = await (await caller(STAFF)).updateReskin({
        reskinId: "reskin-1",
        data: updateData({ username: "Nobody", attached: false }),
      });
      expect(result.success).toBe(false);
      expect((await readReskin())?.userId).toBe(OWNER);
    });

    it("keeps players from editing reskins, even their own", async () => {
      const database = await getTestDatabase();
      await database.insert(jutsuReskin).values(reskinRow());
      const result = await (await caller(OWNER)).updateReskin({
        reskinId: "reskin-1",
        data: updateData({ name: "Renamed", attached: false }),
      });
      expect(result).toMatchObject({ success: false, message: "Unauthorized" });
      expect((await readReskin())?.name).toBe("Fancy Fireball");
    });
  });
});
