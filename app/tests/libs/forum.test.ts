import { beforeEach, expect, it } from "bun:test";
import { forumBoard, forumPost, forumThread, userData } from "@/drizzle/schema";
import { fetchForumPageData, getInfiniteThreads } from "@/libs/forum";
import { insertUsers } from "../setup/factories";
import { describeWithDatabase, getTestDatabase, recordQueries, resetTables } from "../setup/testDatabase";

describeWithDatabase("forum page snapshots", () => {
  beforeEach(async () => {
    await resetTables(forumPost, forumThread, forumBoard, userData);
    const db = await getTestDatabase();
    await insertUsers([{ userId: "author", username: "Author", role: "CODER", unreadNews: 3 }]);
    await db.insert(forumBoard).values([{ id: "news", name: "News", summary: "", group: "" }, { id: "history", name: "History", summary: "", group: "" }]);
    await db.insert(forumThread).values([
      { id: "old", boardId: "news", title: "Old news", userId: "author", createdAt: new Date(1000) },
      { id: "new", boardId: "news", title: "New news", userId: "author", createdAt: new Date(2000) },
      { id: "history", boardId: "history", title: "History", userId: "author" },
    ]);
  });

  it("retains name/id precedence, pagination, and missing board behavior", async () => {
    const client = await getTestDatabase();
    const first = await getInfiniteThreads({ client, boardName: "News", limit: 1 });
    expect(first.board?.id).toBe("news");
    expect(first.threads.map(({ id }) => id)).toEqual(["new"]);
    expect(first.nextCursor).toBe(1);
    const second = await getInfiniteThreads({ client, boardId: "news", boardName: "History", cursor: 1, limit: 1 });
    expect(second.threads.map(({ id }) => id)).toEqual(["old"]);
    expect(await getInfiniteThreads({ client, boardName: "Absent", limit: 10 })).toEqual({ board: null, threads: [], nextCursor: null, newsReadIds: [] });
  });

  it("loads only page permission and notification fields for signed-in readers", async () => {
    const client = await getTestDatabase();
    const measured = await recordQueries(() => fetchForumPageData(client, "News", "author"));
    expect(measured.result.userData).toEqual({ userId: "author", role: "CODER", unreadNews: 3 });
    expect(measured.result.canPost).toBe(true);
    expect(measured.result.initialThreads.threads.map(({ id }) => id)).toEqual(["new", "old"]);
    expect(measured.statements).toHaveLength(2);
    expect((await fetchForumPageData(client, "News", null)).canPost).toBeNull();
    expect((await fetchForumPageData(client, "News", "unregistered")).userData).toBeNull();
  });
});
