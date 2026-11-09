import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
  forumSection,
  forumBoard,
  forumGrant,
  forumPost,
  forumRead,
  forumRestriction,
  forumThread,
  userData,
} from "@/drizzle/schema";
import { fetchForumPageData, getForumContext, getInfiniteThreads } from "@/libs/forum";
import { insertUsers } from "../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
} from "../setup/testDatabase";

describeWithDatabase("forum page snapshots", () => {
  beforeEach(async () => {
    await resetTables(
      forumRead,
      forumPost,
      forumThread,
      forumGrant,
      forumRestriction,
      forumBoard,
      forumSection,
      userData,
    );
    const db = await getTestDatabase();
    await insertUsers([
      { userId: "author", username: "Author", role: "CODER", unreadNews: 3 },
    ]);
    await db
      .insert(forumSection)
      .values({ id: "public", name: "Public", summary: "", policy: {} });
    await db.insert(forumBoard).values([
      { id: "news", name: "News", summary: "", sectionId: "public" },
      { id: "history", name: "History", summary: "", sectionId: "public" },
    ]);
    await db.insert(forumThread).values([
      {
        id: "old",
        boardId: "news",
        title: "Old news",
        userId: "author",
        createdAt: new Date(1000),
        updatedAt: new Date(1000),
      },
      {
        id: "new",
        boardId: "news",
        title: "New news",
        userId: "author",
        createdAt: new Date(2000),
        updatedAt: new Date(2000),
      },
      { id: "history", boardId: "history", title: "History", userId: "author" },
    ]);
  });

  it("retains name/id precedence, pagination, and missing board behavior", async () => {
    const client = await getTestDatabase();
    const first = await getInfiniteThreads({ client, boardName: "News", limit: 1 });
    expect(first.board?.id).toBe("news");
    expect(first.threads.map(({ id }) => id)).toEqual(["new"]);
    expect(first.nextCursor).toBe(1);
    const second = await getInfiniteThreads({
      client,
      boardId: "news",
      boardName: "History",
      cursor: 1,
      limit: 1,
    });
    expect(second.threads.map(({ id }) => id)).toEqual(["old"]);
    expect(
      await getInfiniteThreads({ client, boardName: "Absent", limit: 10 }),
    ).toEqual({ board: null, threads: [], nextCursor: null });
  });

  it("loads only page permission and notification fields for signed-in readers", async () => {
    const client = await getTestDatabase();
    const measured = await recordQueries(() =>
      fetchForumPageData(client, "News", "author"),
    );
    expect(measured.result.userData).toEqual({
      userId: "author",
      role: "CODER",
      unreadNews: 3,
    });
    expect(measured.result.canPost).toBe(true);
    expect(measured.result.initialThreads.threads.map(({ id }) => id)).toEqual([
      "new",
      "old",
    ]);
    expect(measured.statements.length).toBeLessThanOrEqual(7);
    expect((await fetchForumPageData(client, "News", null)).canPost).toBeNull();
    expect(
      (await fetchForumPageData(client, "News", "unregistered")).userData,
    ).toBeNull();
  });

  it("seeds the first page in the board's pinned order", async () => {
    const client = await getTestDatabase();
    await client
      .update(forumThread)
      .set({ isPinned: true })
      .where(eq(forumThread.id, "old"));
    const seeded = await fetchForumPageData(client, "News", "author");
    expect(seeded.initialThreads.threads.map(({ id }) => id)).toEqual(["old", "new"]);
  });

  it("seeds member boards with the current reader's access and read positions", async () => {
    const client = await getTestDatabase();
    await insertUsers([{ userId: "member", username: "Member", level: 50 }]);
    await client
      .insert(forumBoard)
      .values({ id: "anbu", name: "ANBU", summary: "", sectionId: "public" });
    await client.insert(forumThread).values({
      id: "anbu",
      boardId: "anbu",
      title: "ANBU discussion",
      userId: "author",
    });
    await client
      .update(forumBoard)
      .set({ policy: { view: "MEMBERS", read: "MEMBERS" } });
    await client.insert(forumRead).values({
      userId: "member",
      threadId: "new",
      readAt: new Date(2000),
      postId: "last-read",
    });
    for (const name of ["News", "History", "ANBU"]) {
      const seeded = await fetchForumPageData(client, name, "member");
      expect(seeded.initialThreads.board?.name).toBe(name);
      expect(seeded.initialThreads.threads.length).toBeGreaterThan(0);
      expect(
        (await fetchForumPageData(client, name, null)).initialThreads.board,
      ).toBeNull();
      expect(
        (await fetchForumPageData(client, name, "unregistered")).initialThreads.board,
      ).toBeNull();
    }
    const news = await fetchForumPageData(client, "News", "member");
    expect(news.initialThreads.threads[0]?.resumePostId).toBe("last-read");
    expect(news.initialThreads.threads[0]?.unread).toBe(false);
    await client
      .update(forumBoard)
      .set({ policy: { view: "STAFF", read: "STAFF" } })
      .where(eq(forumBoard.id, "news"));
    expect(
      (await fetchForumPageData(client, "News", "member")).initialThreads.board,
    ).toBeNull();
  });

  it("loads only the current reader's listed topic positions in one statement", async () => {
    const client = await getTestDatabase();
    await client.insert(forumRead).values([
      { userId: "author", threadId: "new", readAt: new Date(2000), postId: "new-last" },
      {
        userId: "author",
        threadId: "history",
        readAt: new Date(),
        postId: "unrelated-last",
      },
      {
        userId: "another-reader",
        threadId: "old",
        readAt: new Date(),
        postId: "someone-elses-position",
      },
    ]);
    const context = await getForumContext(client, "author");
    const measured = await recordQueries(() =>
      getInfiniteThreads({ client, context, boardId: "news", limit: 1 }),
    );
    expect(measured.statements).toHaveLength(1);
    expect(measured.result.threads[0]?.resumePostId).toBe("new-last");
    expect(measured.result.threads[0]?.unread).toBe(false);
    expect(measured.result.threads[0]).not.toHaveProperty("readPositions");
    const older = await getInfiniteThreads({
      client,
      context,
      boardId: "news",
      cursor: 1,
      limit: 1,
    });
    expect(older.threads[0]?.resumePostId).toBeNull();
    expect(older.threads[0]?.unread).toBe(true);
    const guest = await getInfiniteThreads({ client, boardId: "news", limit: 1 });
    expect(guest.threads[0]?.resumePostId).toBeNull();
  });
});
