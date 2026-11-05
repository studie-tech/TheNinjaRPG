import {
  FANCY_FORUM_THREADS_PER_PAGE,
  FORUM_THREAD_POSTS_PER_PAGE,
} from "@/drizzle/constants";
import { canAdminForum, forumBoardPermissions } from "@/libs/forumAccess";
import {
  countForumPosts,
  fetchThread,
  findForumActor,
  findForumPost,
  findUserDataForFetchForumPageData,
  forumPostPosition,
  listForumBoards,
  listForumGrants,
  listForumPosts,
  listForumReads,
  listForumRestrictions,
  listForumSections,
  listForumThreads,
  listForumWatches,
} from "@/queries/forum";
import type { DrizzleClient } from "@/server/db";
import { canCreateNews } from "@/utils/permissions";

/** One access snapshot shared by all forum reads and mutations, including server-rendered pages. */
export const getForumContext = async (
  client: DrizzleClient,
  userId?: string | null,
) => {
  const [boards, sections, actor, grants, restrictions] = await Promise.all([
    listForumBoards(client),
    listForumSections(client),
    userId ? findForumActor(client, userId) : null,
    userId ? listForumGrants(client, userId) : [],
    userId ? listForumRestrictions(client, userId) : [],
  ]);
  const canManage =
    !!actor &&
    !actor.isBanned &&
    !actor.isSilenced &&
    (canAdminForum(actor.role) ||
      grants.some(
        (g) =>
          g.scope === "GLOBAL" &&
          g.permissions.includes("manage") &&
          !grants.some((d) => d.scope === "GLOBAL" && d.denies.includes("manage")),
      ));
  const accessibleBoards = boards.map((board) => {
    const basePermissions = forumBoardPermissions(
      actor ?? null,
      board,
      boards,
      grants,
      canManage,
    );
    const publicRead = forumBoardPermissions(null, board, boards, []).read;
    const restriction = restrictions.find(
      (r) => (!r.boardId || r.boardId === board.id) && r.expiresAt > new Date(),
    );
    const permissions = applyPostingRestriction(basePermissions, restriction);
    return {
      ...board,
      permissions,
      publicRead,
      restriction: restriction
        ? { reason: restriction.reason, expiresAt: restriction.expiresAt }
        : null,
    };
  });
  const sorted = accessibleBoards.sort(
    (a, b) =>
      (a.section?.position ?? 0) - (b.section?.position ?? 0) ||
      a.sectionId.localeCompare(b.sectionId) ||
      a.position - b.position ||
      a.name.localeCompare(b.name),
  );
  const ordered: typeof sorted = [];
  const visited = new Set<string>();
  const append = (board: (typeof sorted)[number]) => {
    if (visited.has(board.id)) return;
    visited.add(board.id);
    ordered.push(board);
    for (const child of sorted.filter(
      (b) => b.parentId === board.id && b.sectionId === board.sectionId,
    ))
      append(child);
  };
  for (const board of sorted.filter(
    (b) =>
      !b.parentId ||
      !sorted.some(
        (parent) => parent.id === b.parentId && parent.sectionId === b.sectionId,
      ),
  ))
    append(board);
  for (const board of sorted) append(board);
  return {
    actor: actor ?? null,
    boards: ordered,
    sections,
    grants,
    canManage,
  };
};
export type ForumContext = Awaited<ReturnType<typeof getForumContext>>;
/** Return readable topics with stable paging and account-specific unread/resume state. */
export const getInfiniteThreads = async (props: {
  client: DrizzleClient;
  limit: number;
  highlightPinned?: boolean;
  cursor?: number | null;
  boardId?: string;
  boardName?: string;
  context?: ForumContext;
  query?: string;
  author?: string;
  since?: Date;
  until?: Date;
  tag?: string;
  view?: string;
}) => {
  const context = props.context ?? (await getForumContext(props.client));
  const board = context.boards.find((b) =>
    props.boardId ? b.id === props.boardId : b.name === props.boardName,
  );
  if ((props.boardId || props.boardName) && !board?.permissions.read)
    return { board: null, threads: [], nextCursor: null };
  const allowed = context.boards.filter(
    (b) => b.permissions.read && (!board || b.id === board.id),
  );
  if (
    allowed.length === 0 ||
    (["mine", "unread", "watched"].includes(props.view ?? "") && !context.actor)
  )
    return { board: board ?? null, threads: [], nextCursor: null };
  const threads = await listForumThreads(props.client, {
    boards: allowed.map((b) => b.id),
    offset: (props.cursor ?? 0) * props.limit,
    limit: props.limit + 1,
    query: props.query,
    author: props.author,
    since: props.since,
    until: props.until,
    tag: props.tag,
    view: props.view,
    userId: context.actor?.userId,
    pinned: props.highlightPinned,
  });
  return {
    board: board ?? null,
    threads: threads.slice(0, props.limit).map(({ readPositions, ...thread }) => {
      const read = readPositions[0];
      return {
        ...thread,
        boardName: allowed.find((b) => b.id === thread.boardId)?.name ?? "Forum",
        unread:
          !!context.actor &&
          (!read ||
            read.readAt < thread.updatedAt ||
            (read.readAt.getTime() === thread.updatedAt.getTime() &&
              !!thread.lastPostId &&
              read.postId < thread.lastPostId)),
        resumePostId: read?.postId ?? null,
      };
    }),
    nextCursor: threads.length > props.limit ? (props.cursor ?? 0) + 1 : null,
  };
};
export type InfiniteThreads = ReturnType<typeof getInfiniteThreads>;
/** Load a named game destination through the same forum access rules as the interactive pages. */
export const fetchForumPageData = async (
  client: DrizzleClient,
  boardName: string,
  userId: string | null,
) => {
  const [context, userRow] = await Promise.all([
    getForumContext(client, userId),
    userId ? findUserDataForFetchForumPageData(client, userId) : null,
  ]);
  const initialThreads = await getInfiniteThreads({
    client,
    boardName,
    limit: FANCY_FORUM_THREADS_PER_PAGE,
    highlightPinned: true,
    context,
  });
  return {
    initialThreads,
    userData: userRow ?? null,
    canPost: userRow ? canCreateNews(userRow.role) : null,
  };
};
/** Return only a readable, published topic and its visible posts; denied topics have an empty result. */
export const fetchForumThreadPage = async (
  client: DrizzleClient,
  input: { thread_id: string; limit: number; cursor?: number | null },
  context?: ForumContext,
) => {
  const [access, thread] = await Promise.all([
    context ?? getForumContext(client),
    fetchThread(client, input.thread_id),
  ]);
  const board = access.boards.find((b) => b.id === thread?.boardId);
  const visible =
    thread && !thread.deletedAt && thread.isApproved && board?.permissions.read;
  if (!visible)
    return {
      thread: null,
      data: [],
      nextCursor: null,
      totalComments: 0,
      totalPages: 0,
      board: null,
    };
  const [comments, counts] = await Promise.all([
    listForumPosts(client, thread.id, (input.cursor ?? 0) * input.limit, input.limit),
    countForumPosts(client, thread.id),
  ]);
  const totalComments = counts[0]?.count ?? 0;
  return {
    thread,
    data: comments,
    nextCursor:
      ((input.cursor ?? 0) + 1) * input.limit < totalComments
        ? (input.cursor ?? 0) + 1
        : null,
    totalComments,
    totalPages: Math.ceil(totalComments / input.limit),
    board,
  };
};
/** A stable post ID resolves its current topic and page after moves, deletions and splits. */
export const resolveForumPost = async (
  client: DrizzleClient,
  postId: string,
  context: ForumContext,
) => {
  const post = await findForumPost(client, postId);
  if (!post || post.deletedAt || !post.isApproved) return null;
  const thread = await fetchThread(client, post.threadId);
  if (
    !thread ||
    thread.deletedAt ||
    !thread.isApproved ||
    !context.boards.find((b) => b.id === thread.boardId)?.permissions.read
  )
    return null;
  const position = await forumPostPosition(client, post);
  return {
    boardId: thread.boardId,
    threadId: thread.id,
    postId,
    page: Math.floor(
      Math.max(0, (position[0]?.count ?? 1) - 1) / FORUM_THREAD_POSTS_PER_PAGE,
    ),
  };
};
/** Load this account's read positions and watches together without exposing another account's state. */
export const forumPersonalState = async (client: DrizzleClient, userId: string) => {
  const [reads, watches] = await Promise.all([
    listForumReads(client, userId),
    listForumWatches(client, userId),
  ]);
  return { reads, watches };
};

/**
 * Recheck board/section hierarchy, policy and posting configuration under the caller's section lock.
 * Actor, grants and posting restrictions remain inputs from the request's access snapshot.
 */
export const forumWriteSnapshotMatches = async (
  client: DrizzleClient,
  context: ForumContext,
  boardId: string,
) => {
  const boards = await listForumBoards(client);
  const current = boards.find((b) => b.id === boardId);
  const previous = context.boards.find((b) => b.id === boardId);
  return (
    !!current &&
    !!previous &&
    current.sectionId === previous.sectionId &&
    current.parentId === previous.parentId &&
    current.requireApproval === previous.requireApproval &&
    current.slowModeSeconds === previous.slowModeSeconds &&
    forumBoardPermissions(null, current, boards, [], false).read ===
      previous.publicRead &&
    JSON.stringify(
      applyPostingRestriction(
        forumBoardPermissions(
          context.actor,
          current,
          boards,
          context.grants,
          context.canManage,
        ),
        previous.restriction,
      ),
    ) === JSON.stringify(previous.permissions)
  );
};

/** Posting restrictions leave delegated moderation and recovery capabilities available. */
const applyPostingRestriction = (
  permissions: ReturnType<typeof forumBoardPermissions>,
  restriction: { expiresAt: Date } | null | undefined,
) =>
  restriction && restriction.expiresAt > new Date()
    ? { ...permissions, create: false, reply: false, edit: false, vote: false }
    : permissions;
