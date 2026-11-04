import { beforeEach, expect, it } from "bun:test";
import { conversation, parentalControl, userData } from "@/drizzle/schema";
import { commentsRouter } from "@/server/api/routers/comments";
import { insertUsers } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

describeWithDatabase("tavern ids by name", () => {
  beforeEach(async () => {
    await resetTables(conversation, parentalControl, userData);
    await insertUsers([{ userId: "reader" }, { userId: "child" }]);
    const db = await getTestDatabase();
    await db.insert(conversation).values([
      { id: "global", title: "Global", isPublic: true },
      { id: "akikaze", title: "Akikaze", isPublic: true },
      { id: "private-global", title: "Global", isPublic: false },
      { id: "hyorin", title: "Hyorin", isPublic: true },
    ]);
    await db
      .insert(parentalControl)
      .values({ userId: "child", enabled: true, tavernDisabled: true });
  });

  it("returns the public conversations for the named taverns", async () => {
    const caller = await callerFor(commentsRouter, "reader");
    const taverns = await caller.getTavernIds({ titles: ["Global", "Akikaze"] });
    expect(taverns.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: "akikaze", title: "Akikaze" },
      { id: "global", title: "Global" },
    ]);
  });

  it("returns nothing when parental controls turn the tavern off", async () => {
    const caller = await callerFor(commentsRouter, "child");
    expect(await caller.getTavernIds({ titles: ["Global"] })).toEqual([]);
  });
});
