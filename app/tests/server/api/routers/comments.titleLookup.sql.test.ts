import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import {
  conversation,
  conversationComment,
  user2conversation,
  userData,
} from "@/drizzle/schema";
import * as pusher from "@/libs/pusher";
import { createConvo, fetchConversation } from "@/server/api/routers/comments";
import * as social from "@/server/utils/push/social";
import { insertUsers } from "../../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const lookup = async (title: string) =>
  fetchConversation({ client: await getTestDatabase(), title, userId: "reader" });

const insertConversations = async (
  ...rows: { id: string; title: string; isPublic: boolean }[]
) =>
  (await getTestDatabase())
    .insert(conversation)
    .values(rows.map((row) => ({ ...row, createdById: "reader" })));

describeWithDatabase("conversation title lookup", () => {
  beforeEach(async () => {
    await resetTables(conversationComment, user2conversation, conversation, userData);
    await insertUsers([
      { userId: "reader", username: "Reader" },
      { userId: "other", username: "Other" },
    ]);
  });

  it("prefers a public conversation over a private one with the same title", async () => {
    await insertConversations(
      { id: "a-private", title: "Shared", isPublic: false },
      { id: "b-public", title: "Shared", isPublic: true },
    );
    expect((await lookup("Shared"))?.id).toBe("b-public");
  });

  it("falls back to the private conversation and loads its members", async () => {
    await insertConversations({ id: "only-private", title: "Secret", isPublic: false });
    await (await getTestDatabase())
      .insert(user2conversation)
      .values({ conversationId: "only-private", userId: "other" });
    const found = await lookup("Secret");
    expect(found?.id).toBe("only-private");
    expect(found?.users.map((member) => member.userId)).toEqual(["other"]);
  });

  it("picks the lowest id among equally public matches", async () => {
    await insertConversations(
      { id: "c-public", title: "Twin", isPublic: true },
      { id: "a-private", title: "Twin", isPublic: false },
      { id: "b-public", title: "Twin", isPublic: true },
    );
    expect((await lookup("Twin"))?.id).toBe("b-public");
  });

  it("returns nothing for an unknown title", async () => {
    expect(await lookup("Missing")).toBeUndefined();
  });
});

describeWithDatabase("conversation creation", () => {
  beforeEach(async () => {
    await resetTables(conversationComment, user2conversation, conversation, userData);
    vi.spyOn(pusher, "getServerPusher").mockReturnValue({
      trigger: async () => undefined,
    } as never);
    vi.spyOn(social, "notifyPrivateConversation").mockImplementation(() => {});
    await insertUsers([
      { userId: "sender" },
      { userId: "author" },
      { userId: "receiver" },
    ]);
  });
  afterEach(() => vi.restoreAllMocks());

  it("adds each distinct participant once", async () => {
    const database = await getTestDatabase();
    await createConvo({
      client: database,
      senderUserId: "sender",
      authorUserId: "author",
      receiverUserIds: ["receiver", "sender", "receiver"],
      title: "Group",
      content: "Hello there",
      convoId: "group",
    });
    const members = await database.select().from(user2conversation);
    expect(members.map((member) => member.userId).sort()).toEqual([
      "author",
      "receiver",
      "sender",
    ]);
    expect(members.every((member) => member.conversationId === "group")).toBe(true);
  });
});
