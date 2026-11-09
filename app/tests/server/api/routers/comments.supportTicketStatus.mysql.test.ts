import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import type { SupportTicketStatus } from "@/drizzle/constants";
import {
  conversation,
  conversationComment,
  supportTicket,
  supportTicketActivity,
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

const insertTicket = async (status: SupportTicketStatus) => {
  const db = await getTestDatabase();
  await db.insert(conversation).values({
    id: "ticket-convo",
    title: "Help with my account",
    isPublic: false,
    isStaffAvailable: true,
    createdById: "player",
  });
  await db
    .insert(user2conversation)
    .values({ userId: "player", conversationId: "ticket-convo" });
  await db.insert(supportTicket).values({
    id: "ticket",
    title: "Help with my account",
    description: "I cannot reach my character after the latest update.",
    category: "ACCOUNT_ISSUE",
    status,
    conversationId: "ticket-convo",
    createdByUserId: "player",
  });
};

const reply = async (userId: string) => {
  const api = await callerFor(commentsRouter, userId);
  const result = await api.createConversationComment({
    object_id: "ticket-convo",
    comment: "Any update on this ticket?",
    quoteIds: null,
    senderId: null,
  });
  expect(result.success).toBe(true);
};

const ticketStatus = async () => {
  const db = await getTestDatabase();
  const ticket = await db.query.supportTicket.findFirst({
    where: eq(supportTicket.id, "ticket"),
  });
  return ticket?.status;
};

describeWithDatabase("support ticket status after a comment", () => {
  beforeEach(async () => {
    stubRateLimitTransport();
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await resetTables(
      supportTicketActivity,
      supportTicket,
      conversationComment,
      user2conversation,
      conversation,
      userData,
    );
    await insertUsers([
      { userId: "player", level: 50 },
      { userId: "staff", level: 50, role: "MODERATOR" },
    ]);
  });
  afterEach(() => vi.restoreAllMocks());

  it("keeps an unanswered ticket OPEN when its creator replies", async () => {
    await insertTicket("OPEN");
    await reply("player");
    expect(await ticketStatus()).toBe("OPEN");
    const db = await getTestDatabase();
    expect(await db.query.supportTicketActivity.findMany()).toHaveLength(0);
  });

  it.each(["IN_PROGRESS", "WAITING_FOR_USER"] as const)(
    "hands a %s ticket back to staff when its creator replies",
    async (status) => {
      await insertTicket(status);
      await reply("player");
      expect(await ticketStatus()).toBe("WAITING_FOR_STAFF");
      const db = await getTestDatabase();
      const activities = await db.query.supportTicketActivity.findMany();
      expect(activities).toHaveLength(1);
      expect(activities[0]).toMatchObject({
        ticketId: "ticket",
        authorId: "player",
        action: "STATUS_CHANGED",
        oldValue: status,
        newValue: "WAITING_FOR_STAFF",
      });
    },
  );

  it.each(["OPEN", "WAITING_FOR_STAFF", "WAITING_FOR_USER"] as const)(
    "puts a %s ticket in progress when staff reply",
    async (status) => {
      await insertTicket(status);
      await reply("staff");
      expect(await ticketStatus()).toBe("IN_PROGRESS");
    },
  );

  it("does not reopen a resolved ticket on a reply", async () => {
    await insertTicket("RESOLVED");
    await reply("player");
    await reply("staff");
    expect(await ticketStatus()).toBe("RESOLVED");
  });
});
