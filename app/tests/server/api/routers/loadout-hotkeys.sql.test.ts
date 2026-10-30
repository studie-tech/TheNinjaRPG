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
  });
});
