import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { userBlackList, userData } from "@/drizzle/schema";
import { profileRouter } from "@/server/api/routers/profile";
import { insertUsers } from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const entriesOf = async (creatorUserId: string) => {
  const db = await getTestDatabase();
  return db
    .select()
    .from(userBlackList)
    .where(eq(userBlackList.creatorUserId, creatorUserId));
};

describeWithDatabase("blacklist entry state", () => {
  beforeEach(async () => {
    await resetTables(userBlackList, userData);
    await insertUsers([
      { userId: "me", username: "Me" },
      { userId: "rival", username: "Rival" },
    ]);
  });

  it("keeps a player blocked when the add is repeated", async () => {
    const me = await callerFor(profileRouter, "me");
    await me.toggleBlacklistEntry({ userId: "rival", active: true });
    const repeated = await me.toggleBlacklistEntry({ userId: "rival", active: true });

    expect(repeated).toEqual({
      success: true,
      message: "Rival is already on your blacklist",
    });
    expect(await entriesOf("me")).toHaveLength(1);
  });

  it("removes every stored row for the pair and treats a repeated removal as done", async () => {
    const db = await getTestDatabase();
    await db.insert(userBlackList).values([
      { creatorUserId: "me", targetUserId: "rival" },
      { creatorUserId: "me", targetUserId: "rival" },
    ]);
    const me = await callerFor(profileRouter, "me");

    const removed = await me.toggleBlacklistEntry({ userId: "rival", active: false });
    const repeated = await me.toggleBlacklistEntry({ userId: "rival", active: false });

    expect(removed.message).toBe("Removed Rival from blacklist");
    expect(repeated).toEqual({
      success: true,
      message: "Rival is not on your blacklist",
    });
    expect(await entriesOf("me")).toHaveLength(0);
  });
});
