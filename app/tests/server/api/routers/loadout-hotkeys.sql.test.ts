import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { itemLoadout, jutsuLoadout, userData } from "@/drizzle/schema";
import { itemRouter } from "@/server/api/routers/item";
import { jutsuRouter } from "@/server/api/routers/jutsu";
import { insertUsers } from "../../../setup/factories";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

describeWithDatabase("loadout hotkeys", () => {
  beforeEach(async () => {
    const db = await getTestDatabase();
    await resetTables(jutsuLoadout, itemLoadout, userData);
    await insertUsers([{ userId: "owner" }, { userId: "other" }]);
    await db.insert(jutsuLoadout).values({ id: "jl", userId: "owner", jutsuIds: [] });
    await db.insert(itemLoadout).values({ id: "il", userId: "owner", itemData: [] });
  });

  it("saves keys on the owner's jutsu and item loadouts, also when unchanged", async () => {
    const db = await getTestDatabase();
    const jutsu = callerForDatabase(jutsuRouter, "owner", db);
    const item = callerForDatabase(itemRouter, "owner", db);
    const hotkeys = { jutsuA: "q", wait: "" };
    expect((await jutsu.setLoadoutHotkeys({ id: "jl", hotkeys })).success).toBe(true);
    expect((await jutsu.setLoadoutHotkeys({ id: "jl", hotkeys })).success).toBe(true);
    expect((await item.setLoadoutHotkeys({ id: "il", hotkeys: { potion: "1" } })).success).toBe(true);
    const [jl] = await db.select().from(jutsuLoadout).where(eq(jutsuLoadout.id, "jl"));
    const [il] = await db.select().from(itemLoadout).where(eq(itemLoadout.id, "il"));
    expect(jl?.hotkeys).toEqual(hotkeys);
    expect(il?.hotkeys).toEqual({ potion: "1" });
  });

  it("refuses another player's loadout without changing it", async () => {
    const db = await getTestDatabase();
    const other = callerForDatabase(jutsuRouter, "other", db);
    const result = await other.setLoadoutHotkeys({ id: "jl", hotkeys: { x: "q" } });
    expect(result.success).toBe(false);
    const [jl] = await db.select().from(jutsuLoadout).where(eq(jutsuLoadout.id, "jl"));
    expect(jl?.hotkeys).toEqual({});
    const resultItem = await callerForDatabase(itemRouter, "other", db)
      .setLoadoutHotkeys({ id: "il", hotkeys: { potion: "2" } });
    expect(resultItem.success).toBe(false);
    const [il] = await db.select().from(itemLoadout).where(eq(itemLoadout.id, "il"));
    expect(il?.hotkeys).toEqual({});
  });

  it("rejects item keys used by an inactive jutsu loadout or a basic default", async () => {
    const db = await getTestDatabase();
    await db.insert(jutsuLoadout).values({ id: "jl2", userId: "owner", name: "Arena", jutsuIds: [], hotkeys: { jutsuA: "q" } });
    const item = callerForDatabase(itemRouter, "owner", db);
    const conflict = await item.setLoadoutHotkeys({ id: "il", hotkeys: { potion: "q" } });
    expect(conflict.success).toBe(false);
    expect(conflict.message).toContain('jutsu loadout "Arena"');
    expect((await item.setLoadoutHotkeys({ id: "il", hotkeys: { potion: "w" } })).success).toBe(false);
    const [il] = await db.select().from(itemLoadout).where(eq(itemLoadout.id, "il"));
    expect(il?.hotkeys).toEqual({});
  });

  it("rejects jutsu keys and restored defaults used by any item loadout", async () => {
    const db = await getTestDatabase();
    await db.insert(itemLoadout).values({ id: "il2", userId: "owner", name: "Healing", itemData: [], hotkeys: { potion: "q" } });
    const jutsu = callerForDatabase(jutsuRouter, "owner", db);
    const conflict = await jutsu.setLoadoutHotkeys({ id: "jl", hotkeys: { jutsuA: "q" } });
    expect(conflict.success).toBe(false);
    expect(conflict.message).toContain('item loadout "Healing"');
    expect((await jutsu.setLoadoutHotkeys({ id: "jl", hotkeys: { wait: "" } })).success).toBe(true);
    const item = callerForDatabase(itemRouter, "owner", db);
    expect((await item.setLoadoutHotkeys({ id: "il", hotkeys: { potion: "w" } })).success).toBe(true);
    expect((await jutsu.setLoadoutHotkeys({ id: "jl", hotkeys: {} })).success).toBe(false);
    const [jl] = await db.select().from(jutsuLoadout).where(eq(jutsuLoadout.id, "jl"));
    expect(jl?.hotkeys).toEqual({ wait: "" });
  });

  it("ignores another account's keys and allows removing a conflict", async () => {
    const db = await getTestDatabase();
    await db.insert(itemLoadout).values({ id: "other-il", userId: "other", itemData: [], hotkeys: { potion: "q" } });
    const jutsu = callerForDatabase(jutsuRouter, "owner", db);
    expect((await jutsu.setLoadoutHotkeys({ id: "jl", hotkeys: { jutsuA: "q" } })).success).toBe(true);
    await db.update(itemLoadout).set({ hotkeys: { potion: "q" } }).where(eq(itemLoadout.id, "il"));
    expect((await jutsu.setLoadoutHotkeys({ id: "jl", hotkeys: {} })).success).toBe(true);
  });

  it("does not reclaim item keys when creating an additional jutsu loadout", async () => {
    const db = await getTestDatabase();
    await db.update(jutsuLoadout).set({ hotkeys: { wait: "" } }).where(eq(jutsuLoadout.id, "jl"));
    await db.update(itemLoadout).set({ hotkeys: { potion: "w" } }).where(eq(itemLoadout.id, "il"));
    const rows = await callerForDatabase(jutsuRouter, "owner", db).getLoadouts();
    const added = rows.filter((row) => row.id !== "jl");
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((row) => row.hotkeys.wait === "")).toBe(true);
  });
});
