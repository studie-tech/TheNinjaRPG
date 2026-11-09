import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
  conversation,
  conversationComment,
  supportTicket,
  user2conversation,
  userData,
} from "@/drizzle/schema";
import { commentsRouter } from "@/server/api/routers/comments";
import { insertUsers } from "../../../setup/factories";
import { beforeStatements } from "../../../setup/statements";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

/** A conversation whose only member is `player`, with one comment from them. */
const insertSoloConversation = async (id: string, isStaffAvailable: boolean) => {
  const db = await getTestDatabase();
  await Promise.all([
    db.insert(conversation).values({
      id,
      title: "Help",
      createdById: "player",
      isPublic: false,
      isLocked: false,
      isStaffAvailable,
    }),
    db.insert(user2conversation).values({ conversationId: id, userId: "player" }),
    db.insert(conversationComment).values({
      id: `${id}-comment`,
      content: "Please help",
      userId: "player",
      authorId: "player",
      conversationId: id,
    }),
  ]);
};

describeWithDatabase("comments.exitConversation", () => {
  beforeEach(async () => {
    await resetTables(
      supportTicket,
      conversationComment,
      user2conversation,
      conversation,
      userData,
    );
    await insertUsers([{ userId: "player" }, { userId: "other" }]);
  });

  it("keeps a support ticket's conversation and comments when its creator exits", async () => {
    const db = await getTestDatabase();
    await insertSoloConversation("ticket-convo", true);
    await db.insert(supportTicket).values({
      id: "ticket",
      title: "Help",
      description: "Please help",
      category: "BUG_REPORT",
      conversationId: "ticket-convo",
      createdByUserId: "player",
    });

    const result = await callerForDatabase(
      commentsRouter,
      "player",
      db,
    ).exitConversation({
      convo_id: "ticket-convo",
    });

    expect(result.success).toBe(true);
    expect(await db.query.user2conversation.findMany()).toHaveLength(0);
    expect(
      await db.query.conversation.findFirst({
        where: eq(conversation.id, "ticket-convo"),
      }),
    ).toBeDefined();
    expect(await db.query.conversationComment.findMany()).toHaveLength(1);

    // The creator still reads the thread through the ticket; other players do not.
    const read = (userId: string) =>
      callerForDatabase(commentsRouter, userId, db).getConversationComments({
        convo_id: "ticket-convo",
        limit: 10,
      });
    const creatorView = await read("player");
    expect(creatorView.convo?.id).toBe("ticket-convo");
    expect(creatorView.data.map((comment) => comment.id)).toEqual([
      "ticket-convo-comment",
    ]);
    expect((await read("other")).convo).toBeNull();
  });

  it("deletes an ordinary conversation once its last member exits", async () => {
    const db = await getTestDatabase();
    await insertSoloConversation("plain-convo", false);

    const result = await callerForDatabase(
      commentsRouter,
      "player",
      db,
    ).exitConversation({
      convo_id: "plain-convo",
    });

    expect(result.success).toBe(true);
    expect(await db.query.user2conversation.findMany()).toHaveLength(0);
    expect(await db.query.conversation.findMany()).toHaveLength(0);
    expect(await db.query.conversationComment.findMany()).toHaveLength(0);
  });

  it("keeps a conversation another member joins before the cleanup", async () => {
    const db = await getTestDatabase();
    await insertSoloConversation("plain-convo", false);
    // Both cleanup deletes wait for the same join, whichever starts first.
    let joined: Promise<unknown> | undefined;
    const join = () =>
      (joined ??= db
        .insert(user2conversation)
        .values({ conversationId: "plain-convo", userId: "other" })
        .then(() => undefined));
    const raced = beforeStatements(
      beforeStatements(db, conversation, [join], { operations: ["delete"] }),
      conversationComment,
      [join],
      { operations: ["delete"] },
    );

    const result = await callerForDatabase(
      commentsRouter,
      "player",
      raced,
    ).exitConversation({
      convo_id: "plain-convo",
    });

    expect(result.success).toBe(true);
    expect(await db.query.conversation.findMany()).toHaveLength(1);
    expect(await db.query.conversationComment.findMany()).toHaveLength(1);
  });

  it("searches comment text and author names", async () => {
    const db = await getTestDatabase();
    await insertSoloConversation("plain-convo", false);
    await db
      .update(userData)
      .set({ username: "Searcher" })
      .where(eq(userData.userId, "player"));
    const search = async (searchQuery: string) =>
      (
        await callerForDatabase(commentsRouter, "player", db).getConversationComments({
          convo_id: "plain-convo",
          limit: 10,
          searchQuery,
        })
      ).data.map((comment) => comment.id);
    expect(await search("help")).toEqual(["plain-convo-comment"]);
    expect(await search("searcher")).toEqual(["plain-convo-comment"]);
    expect(await search("nothing")).toEqual([]);
  });
});
