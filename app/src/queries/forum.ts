/**
 * Composable forum statements: return query builders without eager execution.
 * Callers own authorization, transaction boundaries and external side effects;
 * unfiltered lookups also serve staff recovery and must not be exposed directly.
 */

import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  ne,
  notExists,
  notInArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  forumAlert,
  forumAudit,
  forumBoard,
  forumGrant,
  forumPost,
  forumReaction,
  forumRead,
  forumRestriction,
  forumRevision,
  forumSection,
  forumThread,
  forumWatch,
  userBlackList,
  userData,
  userDevice,
  userUpload,
} from "@/drizzle/schema";
import { userCardColumns } from "@/queries/userColumns";
import type { DrizzleClient } from "@/server/db";

type Client = Pick<
  DrizzleClient,
  "query" | "select" | "insert" | "update" | "delete" | "execute"
>;
/** Load hierarchy and section defaults together so callers can derive inherited permissions in memory. */
export const listForumBoards = (db: Client) =>
  db.query.forumBoard.findMany({
    with: { section: true },
    orderBy: [asc(forumBoard.position), asc(forumBoard.name)],
  });
/** Load sections in display order, including archived structure needed by staff recovery. */
export const listForumSections = (db: Client) =>
  db.query.forumSection.findMany({
    orderBy: [asc(forumSection.position), asc(forumSection.name)],
  });
/** Load only the account attributes required for forum authorization and staff identity. */
export const findForumActor = (db: Client, id: string) =>
  db.query.userData.findFirst({
    where: eq(userData.userId, id),
    columns: {
      userId: true,
      role: true,
      isBanned: true,
      isSilenced: true,
      level: true,
      username: true,
    },
  });
/** Load scoped capability grants/denies for one account, or all assignments for administration. */
export const listForumGrants = (db: Client, userId?: string) =>
  db.query.forumGrant.findMany({
    where: userId ? eq(forumGrant.userId, userId) : undefined,
    with: { user: { columns: { username: true } } },
  });
/** Load account restrictions or the staff list; callers apply expiry and board-scope checks. */
export const listForumRestrictions = (db: Client, userId?: string) =>
  db.query.forumRestriction.findMany({
    where: userId ? eq(forumRestriction.userId, userId) : undefined,
    with: { user: { columns: { username: true } } },
  });
/** Find a topic without visibility filtering so callers can authorize normal reads or staff recovery. */
export const fetchThread = (db: Pick<DrizzleClient, "query">, id: string) =>
  db.query.forumThread.findFirst({ where: eq(forumThread.id, id) });
/** Find a post including removed/pending content; the caller must authorize its current topic. */
export const findForumPost = (db: Client, id: string) =>
  db.query.forumPost.findFirst({ where: eq(forumPost.id, id) });
/** Load only this account's resume positions for personal discussion views. */
export const listForumReads = (db: Client, userId: string) =>
  db.query.forumRead.findMany({ where: eq(forumRead.userId, userId) });
/** Load only this account's board/topic subscription preferences. */
export const listForumWatches = (db: Client, userId: string) =>
  db.query.forumWatch.findMany({ where: eq(forumWatch.userId, userId) });
/** Page published topics within pre-authorized boards, composing search, personal views and read positions. */
export const listForumThreads = (
  db: Client,
  input: {
    boards: string[];
    offset: number;
    limit: number;
    query?: string;
    author?: string;
    since?: Date;
    until?: Date;
    tag?: string;
    view?: string;
    userId?: string;
    pinned?: boolean;
  },
) => {
  const pattern = `%${(input.query ?? "").replace(/[\\%_]/g, "\\$&")}%`;
  const conditions: (SQL | undefined)[] = [
    inArray(forumThread.boardId, input.boards),
    isNull(forumThread.deletedAt),
    eq(forumThread.isApproved, true),
  ];
  const matchingAuthors = input.author
    ? db
        .select({ userId: userData.userId })
        .from(userData)
        .where(like(userData.username, `%${input.author.replace(/[\\%_]/g, "\\$&")}%`))
    : undefined;
  if (input.query || matchingAuthors) {
    const matchingPosts = db
      .select({ threadId: forumPost.threadId })
      .from(forumPost)
      .where(
        and(
          isNull(forumPost.deletedAt),
          eq(forumPost.isApproved, true),
          matchingAuthors ? inArray(forumPost.userId, matchingAuthors) : undefined,
          input.query ? like(forumPost.content, pattern) : undefined,
        ),
      );
    conditions.push(
      or(
        and(
          matchingAuthors ? inArray(forumThread.userId, matchingAuthors) : undefined,
          input.query ? like(forumThread.title, pattern) : undefined,
        ),
        inArray(forumThread.id, matchingPosts),
      ),
    );
  }
  if (input.since) conditions.push(sql`${forumThread.updatedAt} >= ${input.since}`);
  if (input.until) conditions.push(sql`${forumThread.updatedAt} <= ${input.until}`);
  if (input.tag)
    conditions.push(
      sql`JSON_CONTAINS(${forumThread.tags}, ${JSON.stringify(input.tag)})`,
    );
  if (input.view === "unanswered")
    conditions.push(
      eq(forumThread.kind, "QUESTION"),
      isNull(forumThread.acceptedPostId),
    );
  if (input.view === "mine")
    conditions.push(
      inArray(
        forumThread.id,
        db
          .select({ threadId: forumPost.threadId })
          .from(forumPost)
          .where(
            and(
              eq(forumPost.userId, input.userId ?? ""),
              isNull(forumPost.deletedAt),
              eq(forumPost.isApproved, true),
            ),
          ),
      ),
    );
  if (input.view === "unread")
    conditions.push(
      sql`${forumThread.id} NOT IN ${db
        .select({ threadId: forumRead.threadId })
        .from(forumRead)
        .innerJoin(forumThread, eq(forumThread.id, forumRead.threadId))
        .where(
          and(
            eq(forumRead.userId, input.userId ?? ""),
            sql`(${forumRead.readAt} > ${forumThread.updatedAt} OR (${forumRead.readAt} = ${forumThread.updatedAt} AND ${forumRead.postId} >= ${forumThread.lastPostId}))`,
          ),
        )}`,
    );
  if (input.view === "watched")
    conditions.push(
      or(
        inArray(
          forumThread.id,
          db
            .select({ scopeId: forumWatch.scopeId })
            .from(forumWatch)
            .where(
              and(
                eq(forumWatch.userId, input.userId ?? ""),
                eq(forumWatch.scope, "THREAD"),
              ),
            ),
        ),
        inArray(
          forumThread.boardId,
          db
            .select({ scopeId: forumWatch.scopeId })
            .from(forumWatch)
            .where(
              and(
                eq(forumWatch.userId, input.userId ?? ""),
                eq(forumWatch.scope, "BOARD"),
              ),
            ),
        ),
      ),
    );
  return db.query.forumThread.findMany({
    where: and(...conditions),
    offset: input.offset,
    limit: input.limit,
    with: {
      user: { columns: { username: true } },
      readPositions: {
        where: input.userId ? eq(forumRead.userId, input.userId) : sql`false`,
        columns: { readAt: true, postId: true },
        limit: 1,
      },
      posts: {
        where: and(isNull(forumPost.deletedAt), eq(forumPost.isApproved, true)),
        orderBy: [asc(forumPost.createdAt), asc(forumPost.id)],
        limit: 1,
      },
    },
    orderBy: input.pinned
      ? [desc(forumThread.isPinned), desc(forumThread.updatedAt), desc(forumThread.id)]
      : [desc(forumThread.updatedAt), desc(forumThread.id)],
  });
};
/** Page posts in stable creation/ID order; all=true is reserved for authorized restructuring. */
export const listForumPosts = (
  db: Client,
  threadId: string,
  offset = 0,
  limit = 100,
  includeRemoved = false,
) =>
  db.query.forumPost.findMany({
    where: and(
      eq(forumPost.threadId, threadId),
      includeRemoved
        ? undefined
        : and(isNull(forumPost.deletedAt), eq(forumPost.isApproved, true)),
    ),
    offset,
    limit,
    orderBy: [asc(forumPost.createdAt), asc(forumPost.id)],
    with: {
      user: {
        columns: userCardColumns,
      },
      reactions: { columns: { userId: true, reaction: true } },
    },
  });
/** Count visible posts only, matching the ordinary discussion-page query. */
export const countForumPosts = (db: Client, threadId: string) =>
  db
    .select({ count: count() })
    .from(forumPost)
    .where(
      and(
        eq(forumPost.threadId, threadId),
        isNull(forumPost.deletedAt),
        eq(forumPost.isApproved, true),
      ),
    );
/** Count visible posts through a stable post ID to resolve its page after moves or removals. */
export const forumPostPosition = (
  db: Client,
  post: { threadId: string; id: string; createdAt: Date },
) =>
  db
    .select({ count: count() })
    .from(forumPost)
    .where(
      and(
        eq(forumPost.threadId, post.threadId),
        isNull(forumPost.deletedAt),
        eq(forumPost.isApproved, true),
        sql`(${forumPost.createdAt} < ${post.createdAt} OR (${forumPost.createdAt} = ${post.createdAt} AND ${forumPost.id} <= ${post.id}))`,
      ),
    );
/** Insert a topic; callers commit its opening post and derived board state together. */
export const insertForumThread = (
  db: Client,
  values: typeof forumThread.$inferInsert,
) => db.insert(forumThread).values(values);
/** Insert a post after authorization; the caller owns visibility, counters and deferred publication. */
export const insertForumPost = (db: Client, values: typeof forumPost.$inferInsert) =>
  db.insert(forumPost).values(values);
/** Update only the requested topic and optional CAS predicate; activity changes must be explicit. */
export const updateForumThread = (
  db: Client,
  id: string,
  values: Partial<typeof forumThread.$inferInsert>,
  guard?: SQL,
) =>
  db
    .update(forumThread)
    .set(values)
    .where(and(eq(forumThread.id, id), guard));
/** Update one post under optional membership/content guards; callers inspect rowsAffected. */
export const updateForumPost = (
  db: Client,
  id: string,
  values: Partial<typeof forumPost.$inferInsert>,
  guard?: SQL,
) =>
  db
    .update(forumPost)
    .set(values)
    .where(and(eq(forumPost.id, id), guard));
/** Move only selected posts still belonging to the expected source topic; callers verify the full count. */
export const updateForumPosts = (
  db: Client,
  ids: string[],
  values: Partial<typeof forumPost.$inferInsert>,
  threadId: string,
) =>
  db
    .update(forumPost)
    .set(values)
    .where(and(inArray(forumPost.id, ids), eq(forumPost.threadId, threadId)));
/** The held opening keeps its identity even when older posts move ahead of it. */
export const approveForumOpening = (db: Client, threadId: string) =>
  db
    .update(forumPost)
    .set({ isApproved: true })
    .where(
      and(
        eq(forumPost.threadId, threadId),
        sql`JSON_UNQUOTE(JSON_EXTRACT(${forumPost.publicationIntent}, '$.threadId')) = ${threadId}`,
        sql`JSON_EXTRACT(${forumPost.publicationIntent}, '$.opening') = true`,
      ),
    );
/** Load visible posts whose first publication has not been claimed, retaining original opening identity. */
export const listPendingForumPublications = (
  db: Client,
  threadId: string,
  postId?: string,
) =>
  db.query.forumPost.findMany({
    where: and(
      eq(forumPost.threadId, threadId),
      isNotNull(forumPost.publicationIntent),
      eq(forumPost.isApproved, true),
      isNull(forumPost.deletedAt),
      postId ? eq(forumPost.id, postId) : undefined,
    ),
    orderBy: [asc(forumPost.createdAt), asc(forumPost.id)],
    with: { user: { columns: { avatar: true } } },
  });
/** Clear pending publication markers only for still-visible posts; callers verify every claim before delivery. */
export const claimForumPublications = (
  db: Client,
  threadId: string,
  postIds: string[],
) =>
  db
    .update(forumPost)
    .set({ publicationIntent: null })
    .where(
      and(
        eq(forumPost.threadId, threadId),
        inArray(forumPost.id, postIds),
        isNotNull(forumPost.publicationIntent),
        eq(forumPost.isApproved, true),
        isNull(forumPost.deletedAt),
      ),
    );
/** Lock shared topic state inside the caller's transaction, after section/board locks; a missing topic returns no row. */
export const lockForumThread = (db: Client, id: string, approvalOnly = false) =>
  db
    .select()
    .from(forumThread)
    .where(
      and(
        eq(forumThread.id, id),
        approvalOnly ? isNull(forumThread.deletedAt) : undefined,
        approvalOnly
          ? notExists(
              db
                .select({ id: forumPost.id })
                .from(forumPost)
                .where(
                  and(
                    eq(forumPost.threadId, id),
                    isNotNull(forumPost.deletedAt),
                    sql`JSON_UNQUOTE(JSON_EXTRACT(${forumPost.publicationIntent}, '$.threadId')) = ${id}`,
                    sql`JSON_EXTRACT(${forumPost.publicationIntent}, '$.opening') = true`,
                  ),
                ),
            )
          : undefined,
      ),
    )
    .for("update");
/** Lock a board and its joined section inside the caller's transaction; normally acquire the section first. */
export const lockForumBoard = (db: Client, id: string) =>
  db
    .select({
      ...getTableColumns(forumBoard),
      sectionArchived: forumSection.archived,
    })
    .from(forumBoard)
    .innerJoin(forumSection, eq(forumSection.id, forumBoard.sectionId))
    .where(eq(forumBoard.id, id))
    .for("update");
/** Read the latest actual-author post while the topic lock serializes slow-mode submissions. */
export const lastForumPostByAuthor = (db: Client, threadId: string, authorId: string) =>
  db.query.forumPost.findFirst({
    where: and(eq(forumPost.threadId, threadId), eq(forumPost.authorId, authorId)),
    orderBy: desc(forumPost.createdAt),
  });
/** Derive count, activity and accepted-answer validity solely from currently visible posts. */
const forumThreadRecount = (id: string | SQL) => ({
  lastPostId: sql`(SELECT id FROM ${forumPost} WHERE ${forumPost.threadId} = ${id} AND ${forumPost.deletedAt} IS NULL AND ${forumPost.isApproved} = true ORDER BY ${forumPost.createdAt} DESC, ${forumPost.id} DESC LIMIT 1)`,
  nPosts: sql`(SELECT COUNT(*) FROM ${forumPost} WHERE ${forumPost.threadId} = ${id} AND ${forumPost.deletedAt} IS NULL AND ${forumPost.isApproved} = true)`,
  updatedAt: sql`COALESCE((SELECT MAX(${forumPost.createdAt}) FROM ${forumPost} WHERE ${forumPost.threadId} = ${id} AND ${forumPost.deletedAt} IS NULL AND ${forumPost.isApproved} = true), ${forumThread.createdAt})`,
  acceptedPostId: sql`IF(EXISTS (SELECT 1 FROM ${forumPost} WHERE ${forumPost.id} = ${forumThread.acceptedPostId} AND ${forumPost.threadId} = ${id} AND ${forumPost.deletedAt} IS NULL AND ${forumPost.isApproved} = true), ${forumThread.acceptedPostId}, NULL)`,
});
/** Recompute one topic's visible-post state under the caller's existing topic/board locks. */
export const repairForumThread = (db: Client, id: string) =>
  db.update(forumThread).set(forumThreadRecount(id)).where(eq(forumThread.id, id));
/** Recompute a board's topics in one UPDATE while the caller excludes concurrent board writes. */
export const repairForumBoardThreads = (db: Client, boardId: string) =>
  db
    .update(forumThread)
    .set(forumThreadRecount(sql`${forumThread.id}`))
    .where(eq(forumThread.boardId, boardId));
/** Recompute board totals and activity from published, nonremoved topics under its write lock. */
export const repairForumBoard = (db: Client, id: string) =>
  db
    .update(forumBoard)
    .set({
      nThreads: sql`(SELECT COUNT(*) FROM ${forumThread} WHERE ${forumThread.boardId} = ${id} AND ${forumThread.deletedAt} IS NULL AND ${forumThread.isApproved} = true)`,
      nPosts: sql`(SELECT COALESCE(SUM(${forumThread.nPosts}), 0) FROM ${forumThread} WHERE ${forumThread.boardId} = ${id} AND ${forumThread.deletedAt} IS NULL AND ${forumThread.isApproved} = true)`,
      updatedAt: sql`COALESCE((SELECT MAX(${forumThread.updatedAt}) FROM ${forumThread} WHERE ${forumThread.boardId} = ${id} AND ${forumThread.deletedAt} IS NULL AND ${forumThread.isApproved} = true), ${forumBoard.createdAt})`,
    })
    .where(eq(forumBoard.id, id));
/** Append immutable action evidence; audited mutations commit this INSERT with their content/access write. */
export const insertForumAudit = (
  db: Client,
  values: Omit<typeof forumAudit.$inferInsert, "id">,
) => db.insert(forumAudit).values({ id: nanoid(), ...values });
/** Append replaced post content; the corresponding guarded edit must commit in the same transaction. */
export const insertForumRevision = (
  db: Client,
  values: Omit<typeof forumRevision.$inferInsert, "id">,
) => db.insert(forumRevision).values({ id: nanoid(), ...values });
/** Return the 50 latest versions after the caller authorizes the post's current scope. */
export const listForumRevisions = (db: Client, id: string) =>
  db.query.forumRevision.findMany({
    where: eq(forumRevision.postId, id),
    orderBy: desc(forumRevision.createdAt),
    limit: 50,
  });
/** Upsert stable section configuration; the caller commits its audit evidence with the write. */
export const saveForumSection = (
  db: Client,
  values: typeof forumSection.$inferInsert,
) => db.insert(forumSection).values(values).onDuplicateKeyUpdate({ set: values });
/** Update an explicitly existing ID or insert a new board; a name collision must never overwrite another board. */
export const saveForumBoard = (
  db: Client,
  values: typeof forumBoard.$inferInsert,
  existing = false,
) =>
  existing
    ? db
        .update(forumBoard)
        .set({ ...values, id: undefined })
        .where(eq(forumBoard.id, values.id))
    : db.insert(forumBoard).values(values);
/** Move a section's boards together; the caller locks both sections and validates hierarchy. */
export const moveForumBoards = (db: Client, sectionId: string, destinationId: string) =>
  db
    .update(forumBoard)
    .set({ sectionId: destinationId })
    .where(eq(forumBoard.sectionId, sectionId));
/** Move all topics, including recoverable content, between caller-locked boards. */
export const moveForumThreads = (db: Client, boardId: string, destinationId: string) =>
  db
    .update(forumThread)
    .set({ boardId: destinationId })
    .where(eq(forumThread.boardId, boardId));
/** Atomically reject removal if any board still references the section. */
export const deleteEmptyForumSection = (db: Client, id: string) =>
  db
    .delete(forumSection)
    .where(
      and(
        eq(forumSection.id, id),
        sql`NOT EXISTS (SELECT 1 FROM ${forumBoard} WHERE ${forumBoard.sectionId} = ${id})`,
      ),
    );
/** Atomically reject removal while topics or child boards still reference the board. */
export const deleteEmptyForumBoard = (db: Client, id: string) =>
  db
    .delete(forumBoard)
    .where(
      and(
        eq(forumBoard.id, id),
        sql`NOT EXISTS (SELECT 1 FROM ${forumThread} WHERE ${forumThread.boardId} = ${id})`,
        sql`NOT EXISTS (SELECT 1 FROM (SELECT parentId FROM ForumBoard) children WHERE children.parentId = ${id})`,
      ),
    );
/** Upsert permissions for the unique account/scope pair, preserving the assignment's stable identity. */
export const saveForumGrant = (db: Client, values: typeof forumGrant.$inferInsert) =>
  db
    .insert(forumGrant)
    .values(values)
    .onDuplicateKeyUpdate({
      set: { permissions: values.permissions, denies: values.denies },
    });
/** Remove the selected assignment after the caller authorizes forum administration. */
export const deleteForumGrant = (db: Client, id: string) =>
  db.delete(forumGrant).where(eq(forumGrant.id, id));
/** Upsert a forum-only restriction; expiry, target scope and audit evidence belong to the caller. */
export const saveForumRestriction = (
  db: Client,
  values: typeof forumRestriction.$inferInsert,
) => db.insert(forumRestriction).values(values).onDuplicateKeyUpdate({ set: values });
/** Remove only the selected restriction after its existing scope has been authorized. */
export const deleteForumRestriction = (db: Client, id: string) =>
  db.delete(forumRestriction).where(eq(forumRestriction.id, id));
/** Advance a resume cursor atomically by (createdAt, ID); an older observer callback cannot move it backward. */
export const saveForumRead = (
  db: Client,
  userId: string,
  post: { id: string; threadId: string; createdAt: Date },
) =>
  // MySQL evaluates assignments left to right; Drizzle puts readAt before postId.
  db.execute(sql`
    INSERT INTO ${forumRead} (userId, threadId, postId, readAt)
    VALUES (${userId}, ${post.threadId}, ${post.id}, ${sql.param(post.createdAt, forumRead.readAt)})
    ON DUPLICATE KEY UPDATE
      postId = IF(${forumRead.readAt} < ${post.createdAt} OR (${forumRead.readAt} = ${post.createdAt} AND ${forumRead.postId} < ${post.id}), ${post.id}, ${forumRead.postId}),
      readAt = GREATEST(${forumRead.readAt}, ${post.createdAt})
  `);
/** Clear source-topic cursors that would otherwise follow a moved post into a split destination. */
export const clearSplitForumReads = (db: Client, threadId: string, postIds: string[]) =>
  db
    .delete(forumRead)
    .where(and(eq(forumRead.threadId, threadId), inArray(forumRead.postId, postIds)));
/** Find the stable predecessor used when publication or removal rewinds affected read cursors. */
export const previousVisibleForumPost = (
  db: Client,
  post: { id: string; threadId: string; createdAt: Date },
) =>
  db.query.forumPost.findFirst({
    where: and(
      eq(forumPost.threadId, post.threadId),
      isNull(forumPost.deletedAt),
      eq(forumPost.isApproved, true),
      sql`(${forumPost.createdAt} < ${post.createdAt} OR (${forumPost.createdAt} = ${post.createdAt} AND ${forumPost.id} < ${post.id}))`,
    ),
    columns: { id: true, createdAt: true },
    orderBy: [desc(forumPost.createdAt), desc(forumPost.id)],
  });
/** Keep newly visible posts ahead of resume positions; removals can target just their own cursor. */
export const rewindForumReads = (
  db: Client,
  post: { id: string; threadId: string; createdAt: Date },
  previous?: { id: string; createdAt: Date },
  guard?: SQL,
) => {
  const affected = and(
    eq(forumRead.threadId, post.threadId),
    sql`(${forumRead.readAt} > ${post.createdAt} OR (${forumRead.readAt} = ${post.createdAt} AND ${forumRead.postId} >= ${post.id}))`,
    guard,
  );
  return previous
    ? db
        .update(forumRead)
        .set({ postId: previous.id, readAt: previous.createdAt })
        .where(affected)
    : db.delete(forumRead).where(affected);
};
/** Upsert one account/scope subscription atomically, changing only its push preference on conflict. */
export const saveForumWatch = (db: Client, values: typeof forumWatch.$inferInsert) =>
  db
    .insert(forumWatch)
    .values(values)
    .onDuplicateKeyUpdate({ set: { push: values.push } });
/** Remove only the caller-owned subscription for the exact board/topic scope. */
export const deleteForumWatch = (
  db: Client,
  userId: string,
  scope: "BOARD" | "THREAD",
  scopeId: string,
) =>
  db
    .delete(forumWatch)
    .where(
      and(
        eq(forumWatch.userId, userId),
        eq(forumWatch.scope, scope),
        eq(forumWatch.scopeId, scopeId),
      ),
    );
/** Load subscriptions for a topic and its board; callers deduplicate and authorize recipients. */
export const listForumWatchers = (db: Client, boardId: string, threadId: string) =>
  db.query.forumWatch.findMany({
    where: or(
      and(eq(forumWatch.scope, "BOARD"), eq(forumWatch.scopeId, boardId)),
      and(eq(forumWatch.scope, "THREAD"), eq(forumWatch.scopeId, threadId)),
    ),
  });
/** Insert deduplicated account/post notifications without resetting an existing alert's read state. */
export const insertForumAlerts = (
  db: Client,
  values: (typeof forumAlert.$inferInsert)[],
) =>
  db
    .insert(forumAlert)
    .values(values)
    .onDuplicateKeyUpdate({ set: { postId: sql`${forumAlert.postId}` } });
/** Retarget existing post alerts during restructuring while preserving alert identity and read state. */
export const moveForumAlerts = (db: Client, postIds: string[], threadId: string) =>
  db.update(forumAlert).set({ threadId }).where(inArray(forumAlert.postId, postIds));
/** Load recent alerts for visible posts/topics; callers additionally enforce current board permissions. */
export const listForumAlerts = (db: Client, id: string) =>
  db
    .select({
      id: forumAlert.id,
      postId: forumAlert.postId,
      threadId: forumAlert.threadId,
      createdAt: forumAlert.createdAt,
      readAt: forumAlert.readAt,
      boardId: forumThread.boardId,
      title: forumThread.title,
    })
    .from(forumAlert)
    .innerJoin(forumThread, eq(forumThread.id, forumAlert.threadId))
    .innerJoin(forumPost, eq(forumPost.id, forumAlert.postId))
    .where(
      and(
        eq(forumAlert.userId, id),
        isNull(forumThread.deletedAt),
        eq(forumThread.isApproved, true),
        isNull(forumPost.deletedAt),
        eq(forumPost.isApproved, true),
      ),
    )
    .orderBy(desc(forumAlert.createdAt))
    .limit(100);
/** Mark this account's unread alerts as read with one guarded UPDATE. */
export const readForumAlerts = (db: Client, userId: string) =>
  db
    .update(forumAlert)
    .set({ readAt: new Date() })
    .where(and(eq(forumAlert.userId, userId), isNull(forumAlert.readAt)));
/** Atomically upsert or remove only the exact account/post/reaction choice. */
export const setForumReaction = (
  db: Client,
  values: typeof forumReaction.$inferInsert,
  active: boolean,
) =>
  active
    ? db
        .insert(forumReaction)
        .values(values)
        .onDuplicateKeyUpdate({ set: { reaction: values.reaction } })
    : db
        .delete(forumReaction)
        .where(
          and(
            eq(forumReaction.userId, values.userId),
            eq(forumReaction.postId, values.postId),
            eq(forumReaction.reaction, values.reaction),
          ),
        );
/** Page scoped evidence; null board scope includes retained history and is reserved for forum managers. */
export const listForumAudit = (
  db: Client,
  boardIds: string[] | null,
  query: string,
  ownApprovals?: { actorId: string; boardIds: string[] },
) =>
  db
    .select({ ...getTableColumns(forumAudit), actorName: userData.username })
    .from(forumAudit)
    .leftJoin(userData, eq(userData.userId, forumAudit.actorId))
    .where(
      and(
        boardIds === null
          ? undefined
          : or(
              inArray(forumAudit.boardId, boardIds),
              ownApprovals
                ? and(
                    inArray(forumAudit.boardId, ownApprovals.boardIds),
                    eq(forumAudit.actorId, ownApprovals.actorId),
                    inArray(forumAudit.action, ["topic.approve", "post.approve"]),
                  )
                : undefined,
            ),
        query
          ? or(
              like(forumAudit.action, `%${query}%`),
              like(forumAudit.reason, `%${query}%`),
              like(userData.username, `%${query}%`),
              eq(forumAudit.targetId, query),
              eq(forumAudit.actorId, query),
            )
          : undefined,
      ),
    )
    .orderBy(desc(forumAudit.createdAt))
    .limit(100);
/** Page pending/recoverable topics, restricting approval-only staff to nonremoved pending topics. */
export const listForumReviewThreads = (
  db: Client,
  input: {
    boardIds: string[];
    moderatedBoardIds: string[];
    offset: number;
    limit: number;
  },
) =>
  db.query.forumThread.findMany({
    where: and(
      inArray(forumThread.boardId, input.boardIds),
      or(sql`${forumThread.deletedAt} IS NOT NULL`, eq(forumThread.isApproved, false)),
      or(
        inArray(forumThread.boardId, input.moderatedBoardIds),
        and(eq(forumThread.isApproved, false), isNull(forumThread.deletedAt)),
      ),
    ),
    orderBy: [desc(forumThread.updatedAt), desc(forumThread.id)],
    offset: input.offset,
    limit: input.limit,
  });
/** Page pending and recoverable posts; approval-only staff cannot inspect removed content. */
export const listForumReviewPosts = (
  db: Client,
  input: {
    boardIds: string[];
    moderatedBoardIds: string[];
    offset: number;
    limit: number;
  },
) =>
  db
    .select({
      post: forumPost,
      thread: forumThread,
    })
    .from(forumPost)
    .innerJoin(forumThread, eq(forumThread.id, forumPost.threadId))
    .where(
      and(
        inArray(forumThread.boardId, input.boardIds),
        or(sql`${forumPost.deletedAt} IS NOT NULL`, eq(forumPost.isApproved, false)),
        or(
          inArray(forumThread.boardId, input.moderatedBoardIds),
          and(
            eq(forumPost.isApproved, false),
            isNull(forumPost.deletedAt),
            isNull(forumThread.deletedAt),
          ),
        ),
      ),
    )
    .orderBy(desc(forumPost.createdAt), desc(forumPost.id))
    .offset(input.offset)
    .limit(input.limit);
/** Clear only the current account's global News unread counter. */
export const readNews = (db: Pick<DrizzleClient, "update">, userId: string) =>
  db.update(userData).set({ unreadNews: 0 }).where(eq(userData.userId, userId));
/** Increment other accounts' News unread counters atomically and cap them at the existing feed limit. */
export const updateUserDataForCreateThread = (db: Client, ctx: { userId: string }) =>
  db
    .update(userData)
    .set({ unreadNews: sql`LEAST(${userData.unreadNews} + 1, 1000)` })
    .where(ne(userData.userId, ctx.userId));
/** Select recipient account IDs; the shared push sender owns opt-outs, device fan-out and token cleanup. */
export const selectDistinctUserDeviceForNotifyNewsSubscribers = (
  db: Pick<DrizzleClient, "selectDistinct">,
) => db.selectDistinct({ userId: userDevice.userId }).from(userDevice);
/** Load the minimal News/History page account context alongside forum authorization. */
export const findUserDataForFetchForumPageData = (db: Client, userId: string) =>
  db.query.userData.findFirst({
    where: eq(userData.userId, userId),
    columns: { userId: true, role: true, unreadNews: true },
  });

/** Find a restriction by stable ID so its existing scope is authorized before reassignment or removal. */
export const findForumRestriction = (db: Client, id: string) =>
  db.query.forumRestriction.findFirst({ where: eq(forumRestriction.id, id) });
/** Lock shared ancestry/policy state in the caller's transaction; acquire multiple section IDs in sorted order. */
export const lockForumSection = (db: Client, id: string) =>
  db.select().from(forumSection).where(eq(forumSection.id, id)).for("update");

/** Guard topic identity and answer visibility in one UPDATE; callers reject rowsAffected=0. */
export const acceptForumAnswer = (
  db: Client,
  id: string,
  postId: string | null,
  boardId: string,
) =>
  updateForumThread(
    db,
    id,
    { acceptedPostId: postId },
    and(
      eq(forumThread.boardId, boardId),
      isNull(forumThread.deletedAt),
      eq(forumThread.kind, "QUESTION"),
      postId
        ? sql`EXISTS (SELECT 1 FROM ${forumPost} WHERE ${forumPost.id} = ${postId} AND ${forumPost.threadId} = ${id} AND ${forumPost.deletedAt} IS NULL AND ${forumPost.isApproved} = true)`
        : undefined,
    ),
  );

/** Mark only this account/topic's alerts through the observed stable post position. */
export const readForumAlertsThrough = (
  db: Client,
  userId: string,
  post: { threadId: string; id: string; createdAt: Date },
) =>
  db
    .update(forumAlert)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(forumAlert.userId, userId),
        eq(forumAlert.threadId, post.threadId),
        isNull(forumAlert.readAt),
        sql`${forumAlert.postId} IN (SELECT id FROM ${forumPost} WHERE ${forumPost.threadId} = ${post.threadId} AND (${forumPost.createdAt} < ${post.createdAt} OR (${forumPost.createdAt} = ${post.createdAt} AND ${forumPost.id} <= ${post.id})))`,
      ),
    );

/** Insert copied posts in one statement after the caller validates the locked source and destination. */
export const insertForumPosts = (
  db: Client,
  values: (typeof forumPost.$inferInsert)[],
) => db.insert(forumPost).values(values);

/** Count all topics, including removed/pending ones, before deleting their container. */
export const countForumBoardThreads = (db: Client, boardId: string) =>
  db
    .select({ count: sql<number>`COUNT(*)`.mapWith(Number) })
    .from(forumThread)
    .where(eq(forumThread.boardId, boardId));

/** Load only watchers and named recipients whose current access will be evaluated before notification. */
export const listForumNotificationActors = (
  db: Client,
  boardId: string,
  threadId: string,
  names: string[],
) =>
  db
    .select({
      userId: userData.userId,
      role: userData.role,
      isBanned: userData.isBanned,
      isSilenced: userData.isSilenced,
    })
    .from(userData)
    .where(
      or(
        inArray(
          userData.userId,
          db
            .select({ userId: forumWatch.userId })
            .from(forumWatch)
            .where(
              or(
                and(eq(forumWatch.scope, "BOARD"), eq(forumWatch.scopeId, boardId)),
                and(eq(forumWatch.scope, "THREAD"), eq(forumWatch.scopeId, threadId)),
              ),
            ),
        ),
        names.length ? inArray(userData.username, names) : undefined,
      ),
    );
/** Load recipient grants together so notification authorization avoids one query per account. */
export const listForumNotificationGrants = (db: Client, userIds: string[]) =>
  db.query.forumGrant.findMany({ where: inArray(forumGrant.userId, userIds) });

/** Load blocks in either direction involving the actor before deriving notification recipients. */
export const listForumNotificationBlocks = (db: Client, actorId: string) =>
  db.query.userBlackList.findMany({
    where: or(
      eq(userBlackList.creatorUserId, actorId),
      eq(userBlackList.targetUserId, actorId),
    ),
  });

/** Delete only an already-removed topic; callers verify the claim before removing dependents. */
export const purgeForumThread = (db: Client, id: string) =>
  db
    .delete(forumThread)
    .where(and(eq(forumThread.id, id), sql`${forumThread.deletedAt} IS NOT NULL`));
/** Delete topic posts after revision/reaction/case cleanup has resolved their IDs. */
export const purgeForumThreadPosts = (db: Client, id: string) =>
  db.delete(forumPost).where(eq(forumPost.threadId, id));
/** Delete revisions while their post-to-topic membership is still available during purge. */
export const purgeForumPostRevisions = (db: Client, threadId: string) =>
  db
    .delete(forumRevision)
    .where(
      inArray(
        forumRevision.postId,
        db
          .select({ id: forumPost.id })
          .from(forumPost)
          .where(eq(forumPost.threadId, threadId)),
      ),
    );
/** Delete reactions while their post-to-topic membership is still available during purge. */
export const purgeForumPostReactions = (db: Client, threadId: string) =>
  db
    .delete(forumReaction)
    .where(
      inArray(
        forumReaction.postId,
        db
          .select({ id: forumPost.id })
          .from(forumPost)
          .where(eq(forumPost.threadId, threadId)),
      ),
    );
/** Delete account resume positions for the permanently removed topic. */
export const purgeForumThreadReads = (db: Client, id: string) =>
  db.delete(forumRead).where(eq(forumRead.threadId, id));
/** Delete topic subscriptions while preserving unrelated board subscriptions. */
export const purgeForumThreadWatches = (db: Client, id: string) =>
  db
    .delete(forumWatch)
    .where(and(eq(forumWatch.scope, "THREAD"), eq(forumWatch.scopeId, id)));
/** Delete alerts for the purged topic; immutable moderation audits remain retained. */
export const purgeForumThreadAlerts = (db: Client, id: string) =>
  db.delete(forumAlert).where(eq(forumAlert.threadId, id));

/** Reuse moderated post-image uploads; the library is always scoped to its owner. */
export const listForumUploads = (db: Client, userId: string) =>
  db.query.userUpload.findMany({
    where: eq(userUpload.userId, userId),
    orderBy: desc(userUpload.createdAt),
    limit: 30,
  });

/** Count published posts and distinct actual authors in pre-authorized boards during the selected period. */
export const forumParticipation = (db: Client, boardIds: string[], since: Date) =>
  db
    .select({
      boardId: forumThread.boardId,
      posts: count(),
      participants: sql<number>`COUNT(DISTINCT ${forumPost.authorId})`.mapWith(Number),
    })
    .from(forumPost)
    .innerJoin(forumThread, eq(forumThread.id, forumPost.threadId))
    .where(
      and(
        inArray(forumThread.boardId, boardIds),
        isNull(forumThread.deletedAt),
        eq(forumThread.isApproved, true),
        isNull(forumPost.deletedAt),
        eq(forumPost.isApproved, true),
        gte(forumPost.createdAt, since),
      ),
    )
    .groupBy(forumThread.boardId);
/** Combine period-based topic creation with current unanswered, pending and removed backlog counts. */
export const forumTopicMetrics = (db: Client, boardIds: string[], since: Date) =>
  db
    .select({
      boardId: forumThread.boardId,
      topics:
        sql<number>`SUM(CASE WHEN ${forumThread.createdAt} >= ${since} AND ${forumThread.deletedAt} IS NULL AND ${forumThread.isApproved} = 1 THEN 1 ELSE 0 END)`.mapWith(
          Number,
        ),
      unanswered:
        sql<number>`SUM(CASE WHEN ${forumThread.kind} = 'QUESTION' AND ${forumThread.acceptedPostId} IS NULL AND ${forumThread.deletedAt} IS NULL AND ${forumThread.isApproved} = 1 THEN 1 ELSE 0 END)`.mapWith(
          Number,
        ),
      pending:
        sql<number>`SUM(CASE WHEN ${forumThread.isApproved} = 0 AND ${forumThread.deletedAt} IS NULL THEN 1 ELSE 0 END)`.mapWith(
          Number,
        ),
      removed:
        sql<number>`SUM(CASE WHEN ${forumThread.deletedAt} IS NOT NULL THEN 1 ELSE 0 END)`.mapWith(
          Number,
        ),
    })
    .from(forumThread)
    .where(inArray(forumThread.boardId, boardIds))
    .groupBy(forumThread.boardId);
/** Count the current pending, reported and removed-post backlog in pre-authorized boards. */
export const forumPostMetrics = (db: Client, boardIds: string[]) =>
  db
    .select({
      boardId: forumThread.boardId,
      pendingPosts:
        sql<number>`SUM(CASE WHEN ${forumPost.isApproved} = 0 AND ${forumPost.deletedAt} IS NULL AND ${forumThread.deletedAt} IS NULL THEN 1 ELSE 0 END)`.mapWith(
          Number,
        ),
      reported:
        sql<number>`SUM(CASE WHEN ${forumPost.isReported} = 1 AND ${forumPost.deletedAt} IS NULL THEN 1 ELSE 0 END)`.mapWith(
          Number,
        ),
      removedPosts:
        sql<number>`SUM(CASE WHEN ${forumPost.deletedAt} IS NOT NULL THEN 1 ELSE 0 END)`.mapWith(
          Number,
        ),
    })
    .from(forumPost)
    .innerJoin(forumThread, eq(forumThread.id, forumPost.threadId))
    .where(inArray(forumThread.boardId, boardIds))
    .groupBy(forumThread.boardId);
/** Group published posts by creation date within the authorized boards and selected period. */
export const forumDailyActivity = (db: Client, boardIds: string[], since: Date) =>
  db
    .select({
      date: sql<string>`DATE_FORMAT(${forumPost.createdAt}, '%Y-%m-%d')`,
      posts: count(),
    })
    .from(forumPost)
    .innerJoin(forumThread, eq(forumThread.id, forumPost.threadId))
    .where(
      and(
        inArray(forumThread.boardId, boardIds),
        isNull(forumThread.deletedAt),
        eq(forumThread.isApproved, true),
        isNull(forumPost.deletedAt),
        eq(forumPost.isApproved, true),
        gte(forumPost.createdAt, since),
      ),
    )
    .groupBy(sql`DATE_FORMAT(${forumPost.createdAt}, '%Y-%m-%d')`)
    .orderBy(sql`DATE_FORMAT(${forumPost.createdAt}, '%Y-%m-%d')`);
/** Count period-based staff audit actions per actor, excluding ordinary author edits and removals. */
export const forumReviewerWorkload = (db: Client, boardIds: string[], since: Date) =>
  db
    .select({
      actorId: forumAudit.actorId,
      username: userData.username,
      actions: count(),
    })
    .from(forumAudit)
    .leftJoin(userData, eq(userData.userId, forumAudit.actorId))
    .where(
      and(
        inArray(forumAudit.boardId, boardIds),
        gte(forumAudit.createdAt, since),
        notInArray(forumAudit.action, ["post.author-edit", "post.author-remove"]),
      ),
    )
    .groupBy(forumAudit.actorId, userData.username)
    .orderBy(desc(count()));
