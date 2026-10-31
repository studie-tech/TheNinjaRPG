import { stubRateLimitTransport } from "../../../setup/rateLimit";
import { renameParentalContact } from "@/queries/parentalControls";
import { unflaggedModeration } from "../../../setup/moderation";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import * as next from "next/server";
import { Moderations } from "openai/resources/moderations";
import { conversation, conversationComment, parentalControl, user2conversation, userBlackList, userData } from "@/drizzle/schema";
import { parentalControlsRouter } from "@/server/api/routers/parentalControls";
import { commentsRouter, fetchConversation, fetchUsersToNotify } from "@/server/api/routers/comments";
import { Pusher } from "@/libs/pusher";
import { hashParentalPin, verifyParentalPin } from "@/server/utils/parentalControls";
import { createTRPCRouter } from "@/server/api/trpc";
import { insertUsers } from "../../../setup/factories";
import { callerFor, callerForDatabase, describeWithDatabase, getTestDatabase, recordQueries, resetTables } from "../../../setup/testDatabase";

const settings = { enabled: true, tavernDisabled: true, privateMessages: "APPROVED" as const,
  approvedUserIds: ["friend"], pin: "012345", version: 0 };

describeWithDatabase("parental controls", () => {
  beforeEach(async () => {
    stubRateLimitTransport();
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await resetTables(parentalControl, userBlackList, conversationComment, user2conversation, conversation, userData);
    await insertUsers([{ userId: "child", level: 50 }, { userId: "friend", level: 50 }, { userId: "stranger", level: 50 }]);
  });
  afterEach(() => vi.restoreAllMocks());
  it("loads public history and live messages without a serial policy or reader lookup", async () => {
    const db = await getTestDatabase();
    await db.insert(conversation).values({ id: "public", title: "Global", isPublic: true, createdById: "child" });
    await db.insert(conversationComment).values({ id: "live", conversationId: "public", content: "Hello", userId: "friend", authorId: "friend" });
    const api = (await callerFor(createTRPCRouter({ comments: commentsRouter }), "child")).comments;
    const page = await recordQueries(() => api.getConversationComments({ convo_title: "Global", limit: 10 }));
    expect(page.result.data.map((c) => c.id)).toEqual(["live"]);
    expect(page.statements).toHaveLength(4);
    const live = await recordQueries(() => api.fetchConversationComment({ commentId: "live", conversationId: "public" }));
    expect(live.result?.id).toBe("live");
    expect(live.result).not.toHaveProperty("readerRole");
    expect(live.statements).toHaveLength(3);
    const livePolicies = live.statements.filter((sql) => sql.includes("from `ParentalControl`"));
    expect(livePolicies).toHaveLength(1);
    expect(livePolicies[0]).not.toContain("UsersInConversation");
    expect(live.statements.some((sql) => sql.includes("QuestHistory"))).toBe(false);
    expect(live.statements.some((sql) => sql.includes("pinHash"))).toBe(false);
    expect((await api.fetchConversationComment({ commentId: "live" }))?.id).toBe("live");
  });
  it("requires a live message to belong to the supplied conversation and preserves both blacklist directions", async () => {
    const db = await getTestDatabase();
    await db.insert(conversation).values([
      { id: "public", title: "Global", isPublic: true, createdById: "child" },
      { id: "private", title: "Private", isPublic: false, createdById: "friend" },
    ]);
    await db.insert(conversationComment).values([
      { id: "live", conversationId: "public", content: "Hello", userId: "friend", authorId: "friend" },
      { id: "secret", conversationId: "private", content: "Secret", userId: "friend", authorId: "friend" },
    ]);
    const api = await callerFor(commentsRouter, "child");
    expect(await api.fetchConversationComment({ commentId: "secret", conversationId: "public" })).toBeNull();
    expect(await api.fetchConversationComment({ commentId: "secret", conversationId: "private" })).toBeNull();
    for (const [creatorUserId, targetUserId] of [["friend", "child"], ["child", "friend"]] as const) {
      await db.insert(userBlackList).values({ id: 1, creatorUserId, targetUserId });
      expect(await api.fetchConversationComment({ commentId: "live", conversationId: "public" })).toBeNull();
      await db.delete(userBlackList).where(eq(userBlackList.id, 1));
    }
    expect((await api.fetchConversationComment({ commentId: "live", conversationId: "public" }))?.id).toBe("live");
  });
  it("covers participant policies for ID lookups and private title fallbacks", async () => {
    const db = await getTestDatabase();
    await db.insert(conversation).values({ id: "private", title: "Private fallback", isPublic: false, createdById: "child" });
    await db.insert(user2conversation).values(["child", "friend"].map((userId) => ({ userId, conversationId: "private" })));
    await db.insert(parentalControl).values({ userId: "friend", ...settings, privateMessages: "NONE", pinHash: "unused" });
    for (const lookup of [{ id: "private" }, { title: "Private fallback" }]) {
      const convo = await fetchConversation({ client: db, userId: "child", ...lookup });
      expect(convo?.id).toBe("private");
      expect(convo?.readRestriction).toBeNull();
      expect(convo?.sendRestriction).toContain("disabled");
    }
    const api = await callerFor(commentsRouter, "child");
    const events = vi.spyOn(Pusher.prototype, "trigger");
    events.mockClear();
    expect((await api.sendTypingIndicator({ conversationId: "private" })).success).toBe(false);
    expect(events).not.toHaveBeenCalled();
    await db.insert(conversation).values({ id: "public", title: "Private fallback", isPublic: true, createdById: "child" });
    expect((await fetchConversation({ client: db, userId: "child", title: "Private fallback" }))?.id).toBe("public");
  });
  it("requires the parent PIN, never returns its hash, and rejects stale settings", async () => {
    const api = await callerFor(parentalControlsRouter, "child");
    expect((await api.save(settings)).success).toBe(true);
    const saved = await api.get();
    expect(saved.hasPin).toBe(true);
    expect(saved).not.toHaveProperty("pinHash");
    expect((await api.save({ ...settings, version: 1, enabled: false, pin: "654321" })).success).toBe(false);
    expect((await api.get()).enabled).toBe(true);
    expect((await api.save(settings)).success).toBe(false);
    expect((await api.save({ ...settings, version: 1, enabled: false })).success).toBe(true);
    expect((await api.get()).hasPin).toBe(false);
  });
  it("keeps PIN credentials out of expired-session errors", async () => {
    const api = parentalControlsRouter.createCaller({
      drizzle: await getTestDatabase(), userId: null, userIp: "127.0.0.1",
      userAgent: undefined, abLemuReplacementVariant: undefined, wallpaperVariant: undefined,
    });
    try {
      await api.save({ ...settings, newPin: "654321" });
      throw new Error("Expected an authentication rejection");
    } catch (error) {
      expect(String(error)).toContain("Unauthorized");
      expect(String(error)).not.toContain(settings.pin);
      expect(String(error)).not.toContain("654321");
      expect(JSON.stringify(error)).not.toContain(settings.pin);
      expect(JSON.stringify(error)).not.toContain("654321");
    }
  });
  it("allows exactly one concurrent first-time setup and retains the winning PIN", async () => {
    const api = await callerFor(parentalControlsRouter, "child");
    const results = await Promise.all([api.save(settings), api.save({ ...settings, pin: "654321", tavernDisabled: false })]);
    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect((await api.get()).version).toBe(1);
  });
  it("retries a rolled-back setup deadlock without replacing its PIN or version", async () => {
    const db = await getTestDatabase();
    let attempts = 0;
    const retrying = new Proxy(db, {
      get(target, property, receiver) {
        if (property === "insert") return (table: Parameters<typeof db.insert>[0]) =>
          table === parentalControl
            ? { ignore: () => ({ values: async (values: typeof parentalControl.$inferInsert) => {
                attempts += 1;
                if (attempts === 1) throw new Error("Wrapped query", { cause: new Error("Deadlock found when trying to get lock") });
                return target.insert(parentalControl).ignore().values(values);
              } }) }
            : target.insert(table);
        return Reflect.get(target, property, receiver);
      },
    });
    const api = callerForDatabase(parentalControlsRouter, "child", retrying);
    expect((await api.save(settings)).success).toBe(true);
    expect(attempts).toBe(2);
    const stored = await db.query.parentalControl.findFirst({ where: eq(parentalControl.userId, "child") });
    expect(stored?.version).toBe(1);
    expect(await verifyParentalPin(settings.pin, stored!.pinHash!)).toBe(true);
  });
  it("sanitizes database errors containing PIN-derived credentials", async () => {
    const db = await getTestDatabase();
    const leakedHash = "synthetic-salt:synthetic-pin-hash";
    const failingDb = new Proxy(db, {
      get(target, property, receiver) {
        if (property === "insert") return () => ({
          ignore: () => ({ values: () => Promise.reject(new Error(`Failed query params: ${leakedHash}`)) }),
        });
        return Reflect.get(target, property, receiver);
      },
    });
    const api = callerForDatabase(parentalControlsRouter, "child", failingDb);
    try {
      await api.save(settings);
      throw new Error("Expected a database rejection");
    } catch (error) {
      expect(String(error)).toContain("Could not save parental controls");
      expect(String(error)).not.toContain(leakedHash);
      expect(JSON.stringify(error)).not.toContain(leakedHash);
    }
  });
  it("retains approvals when an administrator moves an identity", async () => {
    const api = await callerFor(parentalControlsRouter, "child");
    await api.save(settings);
    const db = await getTestDatabase();
    await renameParentalContact(db, "friend", "renamed-friend");
    const row = await db.query.parentalControl.findFirst({ where: eq(parentalControl.userId, "child") });
    expect(row?.approvedUserIds).toEqual(["renamed-friend"]);
    expect(row?.version).toBe(2);
  });
  it("limits concurrent PIN guesses and opens a new window after 15 minutes", async () => {
    const api = await callerFor(parentalControlsRouter, "child");
    await api.save(settings);
    const guesses = await Promise.all(Array.from({ length: 8 }, () => api.save({ ...settings, version: 1, pin: "654321", enabled: false })));
    expect(guesses.every((r) => !r.success)).toBe(true);
    const db = await getTestDatabase();
    let row = await db.query.parentalControl.findFirst({ where: eq(parentalControl.userId, "child") });
    expect(row?.failedAttempts).toBe(5);
    expect((await api.save({ ...settings, version: 1 })).success).toBe(false);
    await db.update(parentalControl).set({ attemptWindowStart: new Date(Date.now() - 16 * 60 * 1000) }).where(eq(parentalControl.userId, "child"));
    expect((await api.save({ ...settings, version: 1 })).success).toBe(true);
    row = await db.query.parentalControl.findFirst({ where: eq(parentalControl.userId, "child") });
    expect(row?.failedAttempts).toBe(0);
  });
  it("hides restricted history, blocks direct message IDs, and keeps approved/support conversations", async () => {
    const db = await getTestDatabase();
    await db.insert(parentalControl).values({ userId: "child", ...settings, pinHash: await hashParentalPin(settings.pin) });
    const convos = [
      { id: "tavern", title: "Global", isPublic: true, users: [] },
      { id: "approved", title: "Approved", isPublic: false, users: ["child", "friend"] },
      { id: "old", title: "Old stranger", isPublic: false, users: ["child", "stranger"] },
      { id: "group", title: "Mixed group", isPublic: false, users: ["child", "friend", "stranger"] },
      { id: "support", title: "Help", isPublic: false, isStaffAvailable: true, users: ["child", "stranger"] },
    ];
    for (const convo of convos) {
      const { users, ...values } = convo;
      await db.insert(conversation).values({ ...values, createdById: "child" });
      if (users.length) await db.insert(user2conversation).values(users.map((userId) => ({ userId, conversationId: convo.id })));
      await db.insert(conversationComment).values({ id: `${convo.id}-message`, conversationId: convo.id, content: "Original", userId: convo.id === "support" ? "stranger" : "child", authorId: convo.id === "support" ? "stranger" : "child" });
    }
    const api = await callerFor(commentsRouter, "child");
    expect((await api.getUserConversations({})).map((c) => c.id).sort()).toEqual(["approved", "support"]);
    for (const id of ["tavern", "old", "group"]) {
      const page = await api.getConversationComments({ convo_id: id, limit: 10 });
      expect(page.data).toEqual([]);
      expect(page.restrictionMessage).toBeTruthy();
      expect(await api.fetchConversationComment({ commentId: `${id}-message`, conversationId: id })).toBeNull();
      expect((await api.reactConversationComment({ commentId: `${id}-message`, emoji: "👍" })).success).toBe(false);
    }
    for (const id of ["approved", "support"]) {
      expect((await api.getConversationComments({ convo_id: id, limit: 10 })).data).toHaveLength(1);
      expect(await api.fetchConversationComment({ commentId: `${id}-message`, conversationId: id })).not.toBeNull();
    }
    const outsider = await callerFor(commentsRouter, "stranger");
    expect(await outsider.fetchConversationComment({ commentId: "approved-message", conversationId: "approved" })).toBeNull();
    expect((await outsider.reactConversationComment({ commentId: "approved-message", emoji: "👍" })).success).toBe(false);
    expect((await outsider.exitConversation({ convo_id: "support" })).success).toBe(true);
    await db.update(parentalControl).set({ privateMessages: "NONE" }).where(eq(parentalControl.userId, "child"));
    expect((await api.getConversationComments({ convo_id: "support", limit: 10 })).data).toHaveLength(1);
    expect(await api.fetchConversationComment({ commentId: "support-message", conversationId: "support" })).not.toBeNull();
  });
  for (const mode of ["NONE", "APPROVED"] as const) {
    it(`keeps retained stranger history restricted after leaving (${mode})`, async () => {
      const db = await getTestDatabase();
      const participants = mode === "NONE" ? ["child", "stranger"] : ["child", "friend", "stranger"];
      await db.insert(conversation).values({ id: "retained", title: "Retained history", isPublic: false, createdById: "child" });
      await db.insert(user2conversation).values(participants.map((userId) => ({ userId, conversationId: "retained" })));
      await db.insert(conversationComment).values({ id: "retained-message", conversationId: "retained", content: "Original stranger message", userId: "stranger", authorId: "stranger" });
      const parent = await callerFor(parentalControlsRouter, "child");
      expect((await parent.save({ ...settings, privateMessages: mode })).success).toBe(true);
      const child = await callerFor(commentsRouter, "child");
      expect((await child.getConversationComments({ convo_id: "retained", limit: 10 })).restrictionMessage).toBeTruthy();
      const stranger = await callerFor(commentsRouter, "stranger");
      expect((await stranger.exitConversation({ convo_id: "retained" })).success).toBe(true);
      const page = await child.getConversationComments({ convo_id: "retained", limit: 10 });
      expect(page.data).toEqual([]);
      expect(page.restrictionMessage).toBeTruthy();
      expect(await child.fetchConversationComment({ commentId: "retained-message", conversationId: "retained" })).toBeNull();
      expect(await child.getUserConversations({})).toEqual([]);
      expect((await child.reactConversationComment({ commentId: "retained-message", emoji: "👍" })).success).toBe(false);
      expect((await child.sendTypingIndicator({ conversationId: "retained" })).success).toBe(false);
      const sender = mode === "APPROVED" ? await callerFor(commentsRouter, "friend") : child;
      expect((await sender.createConversationComment({ object_id: "retained", comment: "Additional conversation reply", quoteIds: null, senderId: null })).success).toBe(false);
      expect((await db.query.userData.findFirst({ where: eq(userData.userId, "child") }))?.inboxNews).toBe(0);
      if (mode === "APPROVED") {
        expect((await sender.getConversationComments({ convo_id: "retained", limit: 10 })).data).toHaveLength(1);
      }
      expect((await parent.save({ ...settings, version: 1, privateMessages: mode === "NONE" ? "EVERYONE" : mode, approvedUserIds: ["friend", "stranger"] })).success).toBe(true);
      expect((await child.getConversationComments({ convo_id: "retained", limit: 10 })).data).toHaveLength(1);
      expect(await child.fetchConversationComment({ commentId: "retained-message", conversationId: "retained" })).not.toBeNull();
      expect((await child.getUserConversations({})).map((c) => c.id)).toEqual(["retained"]);
      expect(await stranger.fetchConversationComment({ commentId: "retained-message", conversationId: "retained" })).toBeNull();
      await db.insert(user2conversation).values({ userId: "stranger", conversationId: "retained" });
      expect((await child.getConversationComments({ convo_id: "retained", limit: 10 })).data).toHaveLength(1);
    });
  }
  it("rejects an unapproved AI reply before changing the approved thread or notifying its child", async () => {
    const db = await getTestDatabase();
    await insertUsers([{ userId: "staff", username: "Staff", level: 50, role: "EVENT" }, { userId: "ai", username: "AI", level: 50, isAi: true }]);
    const parent = await callerFor(parentalControlsRouter, "child");
    expect((await parent.save({ ...settings, approvedUserIds: ["staff"] })).success).toBe(true);
    const staff = await callerFor(commentsRouter, "staff");
    const created = await staff.createConversation({ users: ["child"], title: "Approved staff", comment: "Normal approved message", senderId: null });
    const convoId = created.conversationId!;
    expect(created.success).toBe(true);
    const child = await callerFor(commentsRouter, "child");
    const before = await child.getConversationComments({ convo_id: convoId, limit: 10 });
    expect(before.data).toHaveLength(1);
    const childBefore = await db.query.userData.findFirst({ where: eq(userData.userId, "child") });
    const events = vi.spyOn(Pusher.prototype, "trigger");
    events.mockClear();
    const reply = await staff.createConversationComment({ object_id: convoId, comment: "Roleplay from the AI", quoteIds: null, senderId: "ai" });
    expect(reply.success).toBe(false);
    expect(reply.message).toContain("approved");
    expect(await db.query.conversationComment.findMany({ where: eq(conversationComment.conversationId, convoId) })).toHaveLength(1);
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, "child") }))?.inboxNews).toBe(childBefore?.inboxNews);
    expect((await db.query.conversation.findFirst({ where: eq(conversation.id, convoId) }))?.updatedAt).toEqual(before.convo?.updatedAt);
    expect(events).not.toHaveBeenCalled();
    expect((await child.getConversationComments({ convo_id: convoId, limit: 10 })).data).toHaveLength(1);
    expect(await child.fetchConversationComment({ commentId: before.data[0]!.id, conversationId: convoId })).not.toBeNull();
    expect((await child.getUserConversations({})).map((c) => c.id)).toEqual([convoId]);

    expect((await staff.createConversationComment({ object_id: convoId, comment: "Normal approved reply", quoteIds: null, senderId: null })).success).toBe(true);
    // A non-AI override resolves to the real author and must not require another approval.
    expect((await staff.createConversationComment({ object_id: convoId, comment: "Reply with ignored sender", quoteIds: null, senderId: "stranger" })).success).toBe(true);
    expect((await child.getConversationComments({ convo_id: convoId, limit: 10 })).data).toHaveLength(3);
  });
  it("allows an approved AI reply while preserving its real author and membership guards", async () => {
    const db = await getTestDatabase();
    await insertUsers([{ userId: "staff", username: "Staff", level: 50, role: "EVENT" }, { userId: "ai", username: "AI", level: 50, isAi: true }, { userId: "outsider", username: "Outsider", level: 50, role: "EVENT" }]);
    const parent = await callerFor(parentalControlsRouter, "child");
    expect((await parent.save({ ...settings, approvedUserIds: ["staff", "ai"] })).success).toBe(true);
    const staff = await callerFor(commentsRouter, "staff");
    const created = await staff.createConversation({ users: ["child"], title: "Approved AI", comment: "Normal approved message", senderId: null });
    expect(created.success).toBe(true);
    const convoId = created.conversationId!;
    const reply = await staff.createConversationComment({ object_id: convoId, comment: "Roleplay from approved AI", quoteIds: null, senderId: "ai" });
    expect(reply.success).toBe(true);
    const row = await db.query.conversationComment.findFirst({ where: eq(conversationComment.id, reply.commentId!) });
    expect(row?.userId).toBe("ai");
    expect(row?.authorId).toBe("staff");
    const child = await callerFor(commentsRouter, "child");
    expect((await child.getConversationComments({ convo_id: convoId, limit: 10 })).data).toHaveLength(2);
    expect(await child.fetchConversationComment({ commentId: reply.commentId!, conversationId: convoId })).not.toBeNull();
    expect((await child.getUserConversations({})).map((c) => c.id)).toEqual([convoId]);
    const outsider = await callerFor(commentsRouter, "outsider");
    expect((await outsider.createConversationComment({ object_id: convoId, comment: "Nonmember AI reply", quoteIds: null, senderId: "ai" })).success).toBe(false);
    const fallback = await child.createConversationComment({ object_id: convoId, comment: "Ordinary player cannot post as AI", quoteIds: null, senderId: "ai" });
    expect(fallback.success).toBe(true);
    expect((await db.query.conversationComment.findFirst({ where: eq(conversationComment.id, fallback.commentId!) }))?.userId).toBe("child");
  });
  for (const isPublic of [false, true]) {
    it(`preserves Post as AI in ${isPublic ? "public" : "support"} conversations`, async () => {
      const db = await getTestDatabase();
      const deferred: Array<() => unknown> = [];
      if (isPublic) {
        vi.spyOn(next, "after").mockImplementation((callback) => {
          deferred.push(callback as () => unknown);
        });
        vi.spyOn(Moderations.prototype, "create").mockResolvedValue(unflaggedModeration());
      }
      await insertUsers([{ userId: "staff", username: "Staff", level: 50, role: "EVENT" }, { userId: "ai", username: "AI", level: 50, isAi: true }]);
      expect((await (await callerFor(parentalControlsRouter, "child")).save({ ...settings, privateMessages: "NONE" })).success).toBe(true);
      await db.insert(conversation).values({ id: "exempt", title: "Exempt conversation", isPublic, isStaffAvailable: !isPublic, createdById: "child" });
      await db.insert(user2conversation).values({ userId: "child", conversationId: "exempt" });
      const staff = await callerFor(commentsRouter, "staff");
      const reply = await staff.createConversationComment({ object_id: "exempt", comment: "Exempt roleplay reply", quoteIds: null, senderId: "ai" });
      expect(reply.success).toBe(true);
      const row = await db.query.conversationComment.findFirst({ where: eq(conversationComment.id, reply.commentId!) });
      expect(row?.userId).toBe("ai");
      expect(row?.authorId).toBe("staff");
      if (isPublic) {
        expect(deferred).toHaveLength(1);
        await deferred[0]!();
      }
      if (!isPublic) {
        expect((await (await callerFor(commentsRouter, "child")).getConversationComments({ convo_id: "exempt", limit: 10 })).data).toHaveLength(1);
      }
    });
  }
  it("preserves approved/private and support notifications while restricting tavern notifications", async () => {
    const db = await getTestDatabase();
    await db.insert(parentalControl).values({ userId: "child", ...settings, pinHash: await hashParentalPin(settings.pin) });
    const context = { isPublic: false, isStaffAvailable: false };
    const notify = (convo: typeof context) => fetchUsersToNotify(db, "friend", [], ["child"], convo);
    expect(await notify(context)).toEqual([{ userId: "child", type: "quoted" }]);
    expect(await notify({ ...context, isPublic: true })).toEqual([]);
    await db.update(parentalControl).set({ tavernDisabled: false, privateMessages: "NONE" }).where(eq(parentalControl.userId, "child"));
    expect(await notify(context)).toEqual([]);
    expect(await notify({ ...context, isPublic: true })).toHaveLength(1);
    expect(await notify({ ...context, isStaffAvailable: true })).toHaveLength(1);
  });
});
