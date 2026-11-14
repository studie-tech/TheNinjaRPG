import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { inArray } from "drizzle-orm";
import {
  conversation,
  conversationComment,
  user2conversation,
  userData,
} from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import * as commentsQueries from "@/queries/comments";
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

  it("timestamps counting before a slower write delays delivery", async () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const update = commentsQueries.updateConversationForCreateConversationComment;
    vi.spyOn(
      commentsQueries,
      "updateConversationForCreateConversationComment",
    ).mockImplementation(((...args: Parameters<typeof update>) =>
      update(...args).then((result) => {
        now = 4_000;
        return result;
      })) as never);
    const events = vi.spyOn(Pusher.prototype, "trigger");
    events.mockClear();
    const api = await callerFor(commentsRouter, "sender");
    const result = await api.createConversationComment({
      object_id: "private-convo",
      comment: "Meet at the gate at noon.",
      quoteIds: null,
      senderId: null,
    });
    expect(result.success).toBe(true);
    expect(events).toHaveBeenCalledWith("friend", "event", {
      type: "newInbox",
      conversationId: "private-convo",
      countedAt: 1_000,
    });
  });

  it("counts a message staff send as an AI for neither the staff member nor the AI", async () => {
    await insertUsers([
      { userId: "staff", username: "Staff", level: 50, role: "EVENT" },
      { userId: "ai", username: "AI", level: 50, isAi: true },
    ]);
    await (await getTestDatabase()).insert(user2conversation).values([
      { userId: "staff", conversationId: "private-convo" },
      { userId: "ai", conversationId: "private-convo" },
    ]);
    const events = vi.spyOn(Pusher.prototype, "trigger");
    events.mockClear();
    const api = await callerFor(commentsRouter, "staff");
    const result = await api.createConversationComment({
      object_id: "private-convo",
      comment: "The gate opens at noon.",
      quoteIds: null,
      senderId: "ai",
    });
    expect(result.success).toBe(true);
    const rows = await (await getTestDatabase())
      .select({ userId: userData.userId, inboxNews: userData.inboxNews })
      .from(userData)
      .where(inArray(userData.userId, ["staff", "ai", "sender", "friend"]));
    expect(Object.fromEntries(rows.map((row) => [row.userId, row.inboxNews]))).toEqual({
      staff: 0,
      ai: 0,
      sender: 1,
      friend: 1,
    });
    const inboxEventsFor = events.mock.calls
      .filter(([, , data]) => (data as { type?: string })?.type === "newInbox")
      .map(([channel]) => channel)
      .sort();
    expect(inboxEventsFor).toEqual(["friend", "sender"]);
  });
});
