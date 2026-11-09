import { stubRateLimitTransport } from "../../../../setup/rateLimit";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import {
  actionLog,
  item,
  jutsu,
  userData,
  userItem,
  userJutsu,
  village,
} from "@/drizzle/schema";
import * as actualModerator from "@/libs/moderator";
import { profileRouter } from "@/server/api/routers/profile";
import { type UpdateUserInput, updateUserSchema } from "@/validators/user";
import { insertItems, insertUsers, insertJutsus } from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const STAFF = "inventory-editor";
const OWNER = "inventory-owner";
const editData = (patch: Partial<UpdateUserInput> = {}): UpdateUserInput => ({
  username: "InvOwner",
  bloodlineId: null,
  sageModeId: null,
  villageId: "inventory-village",
  role: "USER",
  rank: "GENIN",
  staffAccount: false,
  reason: "Remove staff benefits from this former staff account",
  ...patch,
});

const inventory = async () => {
  const database = await getTestDatabase();
  const [items, jutsus] = await Promise.all([
    database.select().from(userItem).where(eq(userItem.userId, OWNER)),
    database.select().from(userJutsu).where(eq(userJutsu.userId, OWNER)),
  ]);
  return { items, jutsus };
};

describeWithDatabase("profile updates preserve ownership lists", () => {
  beforeEach(async () => {
    // Keep public-profile rate limiting active without an external Redis call.
    stubRateLimitTransport();
    await resetTables(actionLog, userItem, userJutsu, item, jutsu, userData, village);
    const database = await getTestDatabase();
    await database
      .insert(village)
      .values({ id: "inventory-village", name: "InventoryVillage", kageId: STAFF });
    await insertUsers([
      { userId: STAFF, username: "InvEditor", role: "CODING-ADMIN" },
      {
        userId: OWNER,
        username: "InvOwner",
        role: "USER",
        rank: "GENIN",
        villageId: "inventory-village",
        staffAccount: true,
      },
    ]);
    await insertItems([{ id: "inventory-item" }]);
    await insertJutsus([
      { id: "inventory-jutsu", name: "Inventory Jutsu", requiredRank: "GENIN" },
    ]);
    await database.insert(userItem).values({
      id: "owned-item",
      userId: OWNER,
      itemId: "inventory-item",
      quantity: 7,
      level: 12,
      equipped: "ITEM_1",
    });
    await database.insert(userJutsu).values({
      id: "owned-jutsu",
      userId: OWNER,
      jutsuId: "inventory-jutsu",
      level: 9,
      equipped: true,
    });
  });

  it.each(["HEAD_EVENT", "CODING-ADMIN"] as const)(
    "preserves ownership when %s submits a full profile form",
    async (role) => {
      const database = await getTestDatabase();
      await database.update(userData).set({ role }).where(eq(userData.userId, STAFF));
      const before = await inventory();
      const caller = await callerFor(profileRouter, STAFF);
      const profile = (await caller.getPublicUser({ userId: OWNER }))!;
      const result = await caller.updateUser({
        id: OWNER,
        data: updateUserSchema.parse({
          ...profile,
          reason: "Save the approved player profile",
          items: profile.items.map((entry) => entry.itemId),
          jutsus: profile.jutsus.map((entry) => entry.jutsuId),
        }),
      });
      expect(result.success).toBe(true);
      expect(await inventory()).toEqual(before);
      expect(profile.items.map((entry) => entry.itemId)).toEqual(["inventory-item"]);
      expect(profile.jutsus.map((entry) => entry.jutsuId)).toEqual(["inventory-jutsu"]);
      const owner = await database.query.userData.findFirst({
        where: eq(userData.userId, OWNER),
      });
      expect(owner?.activeTitleId).toBeNull();
    },
  );

  it.each(["USER", "EVENT", "CODER"] as const)(
    "hides another user's ownership lists from %s",
    async (role) => {
      const database = await getTestDatabase();
      await database.update(userData).set({ role }).where(eq(userData.userId, STAFF));
      const profile = await (await callerFor(profileRouter, STAFF)).getPublicUser({
        userId: OWNER,
      });
      expect(profile?.items).toEqual([]);
      expect(profile?.jutsus).toEqual([]);
    },
  );

  it("removes only the staff flag when both ownership lists are omitted", async () => {
    const before = await inventory();
    const result = await (await callerFor(profileRouter, STAFF)).updateUser({
      id: OWNER,
      data: editData(),
    });
    expect(result.success).toBe(true);
    expect(await inventory()).toEqual(before);
    const database = await getTestDatabase();
    const [owner] = await database
      .select()
      .from(userData)
      .where(eq(userData.userId, OWNER));
    expect(owner?.staffAccount).toBe(false);
    const logs = await database
      .select()
      .from(actionLog)
      .where(eq(actionLog.relatedId, OWNER));
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs[0]?.changes)).not.toMatch(/items|jutsus/);
  });

  it("clears explicitly supplied items while preserving omitted jutsus", async () => {
    const before = await inventory();
    const result = await (await callerFor(profileRouter, STAFF)).updateUser({
      id: OWNER,
      data: editData({ items: [] }),
    });
    expect(result.success).toBe(true);
    expect(await inventory()).toEqual({ items: [], jutsus: before.jutsus });
  });

  it("clears explicitly supplied jutsus while preserving omitted items", async () => {
    const before = await inventory();
    const result = await (await callerFor(profileRouter, STAFF)).updateUser({
      id: OWNER,
      data: editData({ jutsus: [] }),
    });
    expect(result.success).toBe(true);
    expect(await inventory()).toEqual({ items: before.items, jutsus: [] });
  });

  it("still clears both lists when both are explicitly empty", async () => {
    const result = await (await callerFor(profileRouter, STAFF)).updateUser({
      id: OWNER,
      data: editData({ items: [], jutsus: [] }),
    });
    expect(result.success).toBe(true);
    expect(await inventory()).toEqual({ items: [], jutsus: [] });
  });
});

// Keep staff reason moderation deterministic and restore it for later suites.
beforeEach(() => {
  vi.spyOn(actualModerator, "validateUserUpdateReason").mockResolvedValue({
    allowUpdate: true,
    comment: "",
  });
});
afterEach(() => vi.restoreAllMocks());
