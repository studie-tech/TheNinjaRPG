import { beforeEach, expect, it } from "bun:test";
import { inArray } from "drizzle-orm";
import { userData } from "@/drizzle/schema";
import { updateUserDataForCreateConversationComment } from "@/queries/comments";
import { insertUsers } from "../setup/factories";
import { describeWithDatabase, getTestDatabase, resetTables } from "../setup/testDatabase";

describeWithDatabase("inbox news for muted chats", () => {
  beforeEach(async () => {
    await resetTables(userData);
    await insertUsers([
      { userId: "listening" },
      { userId: "muted-here", mutedConversationIds: ["convo-1"] },
      { userId: "muted-elsewhere", mutedConversationIds: ["convo-2"] },
      { userId: "muted-all", chatMuted: true },
    ]);
  });

  it("counts a new message only for members who have not muted the conversation", async () => {
    const db = await getTestDatabase();
    const ids = ["listening", "muted-here", "muted-elsewhere", "muted-all"];
    await updateUserDataForCreateConversationComment(db, ids, "convo-1");
    const rows = await db
      .select({ userId: userData.userId, inboxNews: userData.inboxNews })
      .from(userData)
      .where(inArray(userData.userId, ids));
    expect(Object.fromEntries(rows.map((row) => [row.userId, row.inboxNews]))).toEqual({
      listening: 1,
      "muted-here": 0,
      "muted-elsewhere": 1,
      "muted-all": 0,
    });
  });
});
