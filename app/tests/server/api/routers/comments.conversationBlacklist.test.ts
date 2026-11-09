import { beforeEach, expect, it } from "bun:test";
import {
  conversation,
  user2conversation,
  userBlackList,
  userData,
} from "@/drizzle/schema";
import { commentsRouter } from "@/server/api/routers/comments";
import { insertUsers } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

describeWithDatabase("conversation list blacklist", () => {
  beforeEach(async () => {
    await resetTables(userBlackList, user2conversation, conversation, userData);
    await insertUsers([
      { userId: "me" },
      { userId: "blocked" },
      { userId: "friend" },
      { userId: "mod", role: "MODERATOR" },
    ]);
    const db = await getTestDatabase();
    await db.insert(userBlackList).values([
      { creatorUserId: "me", targetUserId: "blocked" },
      { creatorUserId: "me", targetUserId: "mod" },
    ]);
    const convos = {
      "only-blocked": ["me", "blocked"],
      mixed: ["me", "blocked", "friend"],
      staff: ["me", "mod"],
      solo: ["me"],
    };
    for (const [id, users] of Object.entries(convos)) {
      await db
        .insert(conversation)
        .values({ id, title: id, isPublic: false, createdById: "me" });
      await db
        .insert(user2conversation)
        .values(users.map((userId) => ({ userId, conversationId: id })));
    }
  });

  it("hides conversations whose only other members are blacklisted players", async () => {
    const me = await callerFor(commentsRouter, "me");
    expect((await me.getUserConversations()).map((c) => c.id).sort()).toEqual([
      "mixed",
      "solo",
      "staff",
    ]);
  });
});
