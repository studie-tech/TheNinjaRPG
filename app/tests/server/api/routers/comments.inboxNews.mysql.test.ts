import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { inArray } from "drizzle-orm";
import {
  conversation,
  conversationComment,
  user2conversation,
  userData,
} from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { commentsRouter } from "@/server/api/routers/comments";
import { insertUsers } from "../../../setup/factories";
import { stubRateLimitTransport } from "../../../setup/rateLimit";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

describeWithDatabase("inbox news for a private message", () => {
  beforeEach(async () => {
    stubRateLimitTransport();
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await resetTables(conversationComment, user2conversation, conversation, userData);
    await insertUsers([
      { userId: "sender", level: 50 },
      { userId: "friend", level: 50 },
    ]);
    const db = await getTestDatabase();
    await db.insert(conversation).values({
      id: "private-convo",
      title: "Mission plans",
      isPublic: false,
      createdById: "sender",
    });
    await db.insert(user2conversation).values([
      { userId: "sender", conversationId: "private-convo" },
      { userId: "friend", conversationId: "private-convo" },
    ]);
  });
  afterEach(() => vi.restoreAllMocks());

  it("counts the message for the other members, not for its sender", async () => {
    const api = await callerFor(commentsRouter, "sender");
    const result = await api.createConversationComment({
      object_id: "private-convo",
      comment: "Meet at the gate at noon.",
      quoteIds: null,
      senderId: null,
    });
    expect(result.success).toBe(true);
    const rows = await (await getTestDatabase())
      .select({ userId: userData.userId, inboxNews: userData.inboxNews })
      .from(userData)
      .where(inArray(userData.userId, ["sender", "friend"]));
    expect(Object.fromEntries(rows.map((row) => [row.userId, row.inboxNews]))).toEqual({
      sender: 0,
      friend: 1,
    });
  });
});
