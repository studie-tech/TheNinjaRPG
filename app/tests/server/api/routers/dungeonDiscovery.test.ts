import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { dungeon, dungeonMember, dungeonRun, questHistory, userData, userItem } from "@/drizzle/schema";
import { dungeonRouter } from "@/server/api/routers/dungeon";
import { dungeonContent } from "../../../setup/dungeon";
import { insertUsers } from "../../../setup/factories";
import { callerFor, describeWithDatabase, getTestDatabase, resetTables } from "../../../setup/testDatabase";

describeWithDatabase("Dungeon discovery visibility", () => {
  beforeEach(async () => {
    await resetTables(dungeon, dungeonMember, dungeonRun, questHistory, userData, userItem);
    await insertUsers([{ userId: "explorer", sector: 1, level: 1 }]);
  });

  it("keeps published entrance visibility independent of personal admission", async () => {
    const db = await getTestDatabase();
    const content = dungeonContent();
    content.requirements.requiredLevel = 2;
    await db.insert(dungeon).values({ id: "entrance", content, updatedAt: new Date() });
    const caller = await callerFor(dungeonRouter, "explorer");
    expect(await caller.getAvailable({ sector: 1 })).toMatchObject([
      { id: "entrance", admission: { error: "Requires level 2." } },
    ]);
    await db.update(userData).set({ level: 2 }).where(eq(userData.userId, "explorer"));
    expect(await caller.getAvailable({ sector: 1 })).toMatchObject([
      { id: "entrance", admission: { error: null } },
    ]);
  });

  it("withholds hidden, expired and other-sector definitions and checks the player's current sector", async () => {
    const db = await getTestDatabase();
    await db.insert(dungeon).values([
      { id: "visible", content: dungeonContent() },
      { id: "hidden", content: { ...dungeonContent(), hidden: true } },
      { id: "expired", content: { ...dungeonContent(), expiresAt: new Date(0) } },
      { id: "elsewhere", content: { ...dungeonContent(), sector: 2 } },
    ].map((definition) => ({ ...definition, updatedAt: new Date() })));
    const caller = await callerFor(dungeonRouter, "explorer");
    expect((await caller.getAvailable({ sector: 1 })).map(({ id }) => id)).toEqual(["visible"]);
    expect(await caller.getAvailable({ sector: 2 })).toEqual([]);
    await db.update(userData).set({ sector: 2 }).where(eq(userData.userId, "explorer"));
    expect(await caller.getAvailable({ sector: 1 })).toEqual([]);
    expect((await caller.getAvailable({ sector: 2 })).map(({ id }) => id)).toEqual(["elsewhere"]);
  });
});
