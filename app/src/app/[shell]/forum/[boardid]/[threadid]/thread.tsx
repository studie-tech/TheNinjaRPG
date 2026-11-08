"use client";

import { CheckCircle2, Link2, LockKeyhole, Quote, ThumbsUp } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  FORUM_MIN_LEVEL,
  FORUM_THREAD_POSTS_PER_PAGE,
  forumLevelMessage,
} from "@/drizzle/constants";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import { ForumComposer, ForumNavigation, ForumWatchButton } from "@/layout/Forum";
import { ForumRestructureTools, ForumTopicTools } from "@/layout/ForumModeration";
import { ForumPoll, ForumTopicExtras } from "@/layout/ForumPoll";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import Pagination from "@/layout/Pagination";
import Post from "@/layout/Post";
import ReportUser from "@/layout/Report";
import RichInput from "@/layout/RichInput";
import { showMutationToast } from "@/libs/toast";
import { parseHtml } from "@/utils/parse";
import { useUserData } from "@/utils/UserContext";

/** Coordinate stable post links, visible read positions, drafts and confirmed-removal cache reconciliation. */
export default function Thread({
  threadId,
  initialPage,
}: {
  threadId: string;
  initialPage: ThreadData;
}) {
  const { data: user } = useUserData();
  const params = useSearchParams();
  const router = useRouter();
  const utils = api.useUtils();
  const [page, setPage] = useState(0);
  const [quote, setQuote] = useState("");
  const [tools, setTools] = useState(false);
  const [selectedPosts, setSelectedPosts] = useState<string[]>([]);
  const postId = params.get("post");
  const resolved = api.forum.resolvePost.useQuery(
    { postId: postId ?? "" },
    { enabled: !!postId },
  );
  const comments = api.comments.getForumComments.useQuery(
    { thread_id: threadId, limit: FORUM_THREAD_POSTS_PER_PAGE, cursor: page },
    {
      initialData: page === 0 ? initialPage : undefined,
      staleTime: 15000,
      refetchOnMount: "always",
      refetchInterval: 20000,
    },
  );
  const thread = comments.data?.thread;
  const board = comments.data?.board;
  const reply = api.comments.createForumComment.useMutation();
  const read = api.forum.markRead.useMutation({
    onSuccess: () => {
      void utils.forum.personal.invalidate();
      void utils.forum.alerts.invalidate();
    },
  });
  const observedPosts = useRef(new Set<string>());
  const scrolledPost = useRef<string | null>(null);
  const readMutationRef = useRef(read.mutate);
  readMutationRef.current = read.mutate;
  useEffect(() => {
    const target = resolved.data;
    if (!target) return;
    if (target.threadId !== threadId) {
      router.replace(
        `/forum/${target.boardId}/${target.threadId}?post=${target.postId}`,
      );
      return;
    }
    setPage(target.page);
  }, [resolved.data, router, threadId]);
  useEffect(() => {
    if (
      !postId ||
      scrolledPost.current === postId ||
      !comments.data?.data.some((p) => p.id === postId)
    )
      return;
    scrolledPost.current = postId;
    document
      .getElementById(`post-${postId}`)
      ?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [postId, comments.data?.data]);
  const readingPosts = JSON.stringify(comments.data?.data.map((p) => p.id) ?? []);
  // Advance only fully visible posts; failed writes re-observe instead of recording local progress.
  useEffect(() => {
    if (!user || readingPosts === "[]") return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    // A stable post set prevents polling from resetting reading progress observers.
    const sentinels = Array.from(
      document.querySelectorAll<HTMLElement>("[data-read-post]"),
    );
    let candidate: HTMLElement | null = null;
    const save = () => {
      if (!active || !candidate || document.visibilityState !== "visible") return;
      const target = candidate;
      candidate = null;
      const id = target.dataset.readPost;
      if (!id) return;
      readMutationRef.current(
        { postId: id },
        {
          onSuccess: (result) => {
            if (!result.success) {
              retry = setTimeout(() => {
                if (active) observer.observe(target);
              }, 5000);
              return;
            }
            observedPosts.current.add(id);
          },
          onError: () => {
            retry = setTimeout(() => {
              if (active) observer.observe(target);
            }, 5000);
          },
        },
      );
    };
    const observer = new IntersectionObserver(
      (entries) => {
        if (document.visibilityState !== "visible") return;
        for (const entry of entries) {
          const element = entry.target as HTMLElement;
          const id = element.dataset.readPost;
          if (!entry.isIntersecting || !id || observedPosts.current.has(id)) continue;
          if (!candidate || sentinels.indexOf(element) > sentinels.indexOf(candidate))
            candidate = element;
          observer.unobserve(element);
        }
        if (candidate) {
          clearTimeout(timer);
          timer = setTimeout(save, 400);
        }
      },
      { threshold: 1 },
    );
    for (const sentinel of sentinels)
      if (!observedPosts.current.has(sentinel.dataset.readPost ?? ""))
        observer.observe(sentinel);
    return () => {
      active = false;
      observer.disconnect();
      clearTimeout(timer);
      clearTimeout(retry);
    };
  }, [readingPosts, user?.userId]);
  useEffect(() => {
    const total = comments.data?.totalPages ?? 0;
    if (total > 0 && page >= total) setPage(total - 1);
  }, [comments.data?.totalPages, page]);
  const refresh = async (removedPostId?: string) => {
    if (removedPostId) {
      // Cancel older reads so a failed refresh retains the confirmed removal.
      await utils.comments.getForumComments.cancel({
        thread_id: threadId,
        limit: FORUM_THREAD_POSTS_PER_PAGE,
      });
      const cachedPage = utils.comments.getForumComments.getData({
        thread_id: threadId,
        limit: FORUM_THREAD_POSTS_PER_PAGE,
        cursor: page,
      });
      // A completed read may already include the removal; never decrement that total twice.
      const totalComments = Math.max(
        0,
        (cachedPage?.totalComments ?? 0) -
          Number(cachedPage?.data.some((post) => post.id === removedPostId)),
      );
      const totalPages = Math.ceil(totalComments / FORUM_THREAD_POSTS_PER_PAGE);
      utils.comments.getForumComments.setQueriesData(
        { thread_id: threadId, limit: FORUM_THREAD_POSTS_PER_PAGE },
        {},
        (current) => {
          if (!current?.thread) return current;
          return {
            ...current,
            data: current.data.filter((post) => post.id !== removedPostId),
            totalComments,
            totalPages,
            nextCursor:
              current.nextCursor !== null && current.nextCursor < totalPages
                ? current.nextCursor
                : null,
            thread: {
              ...current.thread,
              nPosts: totalComments,
              acceptedPostId:
                current.thread.acceptedPostId === removedPostId
                  ? null
                  : current.thread.acceptedPostId,
            },
          };
        },
      );
      setSelectedPosts((ids) => ids.filter((id) => id !== removedPostId));
    }
    await Promise.all([
      utils.comments.getForumComments.invalidate(),
      utils.forum.getThreads.invalidate(),
      utils.forum.getAll.invalidate(),
    ]);
  };
  return (
    <ContentBox
      title={thread?.title ?? "Forum discussion"}
      subtitle={
        board ? (
          <Link href={`/forum/${board.id}`} className="hover:underline">
            {board.name}
          </Link>
        ) : undefined
      }
      defaultBackHref={thread ? `/forum/${thread.boardId}` : "/forum"}
      stackTopRight
      topRightContent={<ForumNavigation />}
    >
      {comments.error && (
        <p role="alert">
          This discussion could not load.{" "}
          <Button onClick={() => void comments.refetch()}>Try again</Button>
        </p>
      )}
      {comments.isPending && <Loader explanation="Loading discussion…" />}
      {!comments.isPending && !thread && (
        <p>This topic is unavailable or you do not have permission to read it.</p>
      )}
      {postId && resolved.isSuccess && !resolved.data && (
        <p role="status" className="mb-3 rounded-md border p-3 text-sm">
          The linked post is no longer available.
        </p>
      )}
      {thread && board && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>
                {comments.data?.totalComments}{" "}
                {comments.data?.totalComments === 1 ? "post" : "posts"}
              </span>
              {thread.isPinned && (
                <span className="bg-muted rounded px-2 py-1">Pinned</span>
              )}
              {thread.isLocked && (
                <span className="bg-muted flex items-center gap-1 rounded px-2 py-1">
                  <LockKeyhole className="h-4 w-4" />
                  Locked
                </span>
              )}
              {thread.tags.map((t) => (
                <Link
                  key={t}
                  href={`/forum?view=latest&tag=${encodeURIComponent(t)}`}
                  className="bg-muted rounded px-2 py-1"
                >
                  {t}
                </Link>
              ))}
            </div>
            <ForumWatchButton scope="THREAD" scopeId={thread.id} />
          </div>
          {thread.summary && (
            <section
              aria-label="Staff topic summary"
              className="rounded-lg border bg-muted/30 p-4"
            >
              <h2 className="font-semibold">Discussion at a glance</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
                {thread.summary}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Staff summary
                {thread.summaryUpdatedAt
                  ? ` · Updated ${thread.summaryUpdatedAt.toISOString().slice(0, 10)}`
                  : ""}
              </p>
            </section>
          )}
          {thread.pollId && <ForumPoll threadId={thread.id} />}
          {thread.acceptedPostId && (
            <Link
              href={`/forum/${thread.boardId}/${thread.id}?post=${thread.acceptedPostId}`}
              className="flex items-center gap-2 rounded-md border border-green-600 p-3 font-medium text-green-700"
            >
              <CheckCircle2 className="h-5 w-5" />
              Jump to the accepted answer
            </Link>
          )}
          {board.permissions.moderate && (
            <>
              <Button variant="outline" size="sm" onClick={() => setTools((t) => !t)}>
                {tools ? "Close topic tools" : "Moderate topic"}
              </Button>
              {tools && (
                <ForumTopicTools
                  ids={[thread.id]}
                  thread={thread}
                  onDone={() => {
                    setTools(false);
                  }}
                />
              )}
            </>
          )}
          {board.permissions.moderate && tools && (
            <ForumTopicExtras key={thread.id} thread={thread} onDone={refresh} />
          )}
          {board.permissions.moderate && tools && (
            <ForumRestructureTools
              thread={thread}
              postIds={selectedPosts}
              onDone={(boardId, id) => {
                setSelectedPosts([]);
                router.push(`/forum/${boardId}/${id}`);
              }}
            />
          )}
          {comments.data && comments.data.totalPages > 1 && (
            <Pagination
              current={page}
              total={comments.data.totalPages}
              setPage={setPage}
            />
          )}
          {comments.data?.data.map((post, index) => (
            <ForumPost
              key={post.id}
              post={post}
              thread={thread}
              board={board}
              number={page * FORUM_THREAD_POSTS_PER_PAGE + index + 1}
              selected={selectedPosts.includes(post.id)}
              onSelect={() =>
                setSelectedPosts((ids) =>
                  ids.includes(post.id)
                    ? ids.filter((id) => id !== post.id)
                    : [...ids, post.id],
                )
              }
              onChange={refresh}
              onQuote={() => {
                setQuote(
                  `<blockquote><p>${post.user?.username ?? "Player"} wrote:</p>${post.content}</blockquote><p><br></p><p><br></p><!--${Date.now()}-->`,
                );
                document
                  .getElementById("forum-composer")
                  ?.scrollIntoView({ block: "center", behavior: "smooth" });
              }}
            />
          ))}
          {(comments.data?.totalPages ?? 0) > 1 && (
            <Pagination
              current={page}
              total={comments.data?.totalPages ?? 0}
              setPage={setPage}
            />
          )}
          {comments.data && page < comments.data.totalPages - 1 && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setPage(comments.data?.totalPages - 1)}
            >
              Go to latest posts
            </Button>
          )}
          {thread.isLocked || board.permissions.archived ? (
            <p role="status" className="rounded-md border p-4 text-sm">
              {thread.isLocked
                ? "This topic is locked. New replies are closed."
                : "This board is archived. New replies are closed."}
            </p>
          ) : !user ? (
            <p className="rounded-md border p-4 text-sm">
              <Link href="/login" className="underline">
                Sign in
              </Link>{" "}
              to join the discussion.
            </p>
          ) : user.level < FORUM_MIN_LEVEL ? (
            <p>{forumLevelMessage}</p>
          ) : board.permissions.reply ? (
            <ForumComposer
              key={`${user.userId}:${thread.id}`}
              draftKey={`thread:${thread.id}`}
              pending={reply.isPending}
              quote={quote}
              uploads={board.permissions.upload}
              onSubmit={async (value) => {
                const result = await reply.mutateAsync({
                  object_id: thread.id,
                  comment: value.content,
                  quoteIds: null,
                  senderId: null,
                });
                showMutationToast(result);
                if (!result.success) return false;
                const nextPage = Math.floor(
                  (comments.data?.totalComments ?? 0) / FORUM_THREAD_POSTS_PER_PAGE,
                );
                setPage(nextPage);
                await refresh();
                return true;
              }}
            />
          ) : (
            <p role="status" className="rounded-md border p-4 text-sm">
              {board.restriction
                ? `Posting restricted: ${board.restriction.reason}`
                : "You do not have permission to reply in this board."}
            </p>
          )}
        </div>
      )}
    </ContentBox>
  );
}

/** Expose permitted post actions and retain inline rejection feedback without assuming mutation success. */
function ForumPost({
  post,
  thread,
  board,
  number,
  onQuote,
  onChange,
  selected,
  onSelect,
}: {
  post: ThreadData["data"][number];
  thread: NonNullable<ThreadData["thread"]>;
  board: NonNullable<ThreadData["board"]>;
  number: number;
  onQuote: () => void;
  onChange: (removedPostId?: string) => Promise<void>;
  selected: boolean;
  onSelect: () => void;
}) {
  const fieldPrefix = useId();
  const { data: user } = useUserData();
  const [editing, setEditing] = useState(false);
  const [history, setHistory] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const form = useForm({ defaultValues: { content: post.content } });
  const edit = api.forum.editPost.useMutation();
  const remove = api.comments.deleteForumComment.useMutation();
  const moderation = api.forum.moderatePost.useMutation();
  const accept = api.forum.acceptAnswer.useMutation();
  const react = api.forum.react.useMutation();
  const revisions = api.forum.revisions.useQuery(
    { postId: post.id },
    { enabled: history },
  );
  const own = post.authorId === user?.userId;
  const accepted = thread.acceptedPostId === post.id;
  const canEdit =
    !!user &&
    ((own && board.permissions.edit && !thread.isLocked && !post.isLocked) ||
      board.permissions.editOthers);
  const run = async (
    action: () => Promise<{ success: boolean; message: string }>,
    removesPost = false,
  ) => {
    setError("");
    try {
      const result = await action();
      showMutationToast(result);
      if (!result.success) {
        setError(result.message);
        return;
      }
      setEditing(false);
      await onChange(removesPost ? post.id : undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The action could not be completed.");
    }
  };
  return (
    <article
      id={`post-${post.id}`}
      className={`scroll-mt-6 rounded-lg ${accepted ? "ring-2 ring-green-600" : ""}`}
    >
      <Post
        user={post.user ?? undefined}
        hover_effect={false}
        options={
          <div className="flex items-center gap-2">
            {board.permissions.moderate && (
              <input
                type="checkbox"
                aria-label={`Select post ${number}`}
                checked={selected}
                onChange={onSelect}
              />
            )}
            <Link
              href={`/forum/${thread.boardId}/${thread.id}?post=${post.id}`}
              className="text-muted-foreground text-xs hover:underline"
            >
              #{number}
            </Link>
          </div>
        }
      >
        {accepted && (
          <p className="mb-3 flex items-center gap-2 font-semibold text-green-700">
            <CheckCircle2 className="h-4 w-4" />
            Accepted answer
          </p>
        )}
        {editing ? (
          <form
            className="space-y-3"
            onSubmit={form.handleSubmit(
              (value) =>
                void run(() =>
                  edit.mutateAsync({
                    object_id: post.id,
                    comment: value.content,
                    reason: own ? "Author edit" : reason,
                  }),
                ),
            )}
          >
            <RichInput
              id="content"
              height="200px"
              control={form.control}
              allowImages={board.permissions.upload}
              disabled={edit.isPending}
              autoFocus={false}
            />
            {!own && (
              <label className="block text-sm" htmlFor={`${fieldPrefix}-1`}>
                Edit reason
                <Input
                  id={`${fieldPrefix}-1`}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                  minLength={3}
                />
              </label>
            )}
            <div className="flex gap-2">
              <Button type="submit" disabled={edit.isPending}>
                {edit.isPending ? "Saving…" : "Save post"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div data-reading-text className="min-w-0 leading-relaxed break-words">
            {parseHtml(post.content)}
          </div>
        )}
        <div className="text-muted-foreground mt-4 flex flex-wrap items-center gap-2 border-t pt-3 text-xs">
          <time suppressHydrationWarning dateTime={post.createdAt.toISOString()}>
            {post.createdAt.toLocaleString()}
          </time>
          {post.editedAt && <span>Edited</span>}
          {post.isLocked && <span>Post locked</span>}
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  `${window.location.origin}/forum/${thread.boardId}/${thread.id}?post=${post.id}`,
                );
                showMutationToast({ success: true, message: "Post link copied" });
              } catch {
                setError("Copy the post number link to share this post.");
              }
            }}
          >
            <Link2 className="mr-1 h-3 w-3" />
            Copy link
          </Button>
          {user && board.permissions.reply && !thread.isLocked && (
            <Button size="sm" variant="ghost" onClick={onQuote}>
              <Quote className="mr-1 h-3 w-3" />
              Quote
            </Button>
          )}
          {canEdit && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                form.reset({ content: post.content });
                setEditing((v) => !v);
              }}
            >
              Edit
            </Button>
          )}
          {user && (own || board.permissions.moderate) && (
            <Button size="sm" variant="ghost" onClick={() => setHistory((h) => !h)}>
              History
            </Button>
          )}
          {user &&
            ((own && board.permissions.remove && !thread.isLocked && !post.isLocked) ||
              board.permissions.removeOthers) && (
              <Confirm
                title="Remove post?"
                button={
                  <span className="hover:bg-accent rounded px-3 py-2">Remove</span>
                }
                disabled={remove.isPending}
                proceed_label="Remove post"
                onAccept={() =>
                  void run(() => remove.mutateAsync({ id: post.id }), true)
                }
              >
                This post will be hidden. Staff can restore it from the forum workspace.
              </Confirm>
            )}
          {post.user && user && !post.isReported && (
            <ReportUser
              user={post.user}
              content={post}
              system="forum_comment"
              button={<span className="hover:bg-accent rounded px-3 py-2">Report</span>}
            />
          )}
        </div>
        {user && board.permissions.vote && (
          <div className="mt-2 flex flex-wrap gap-2">
            {(["helpful", "❤️", "😂", "👏"] as const).map((reaction) => {
              const entries = post.reactions.filter((r) => r.reaction === reaction);
              const active = entries.some((r) => r.userId === user.userId);
              return (
                <Button
                  key={reaction}
                  variant={active ? "secondary" : "outline"}
                  size="sm"
                  aria-pressed={active}
                  disabled={react.isPending}
                  onClick={() =>
                    void run(() =>
                      react.mutateAsync({ postId: post.id, reaction, active: !active }),
                    )
                  }
                >
                  {reaction === "helpful" ? (
                    <>
                      <ThumbsUp className="mr-1 h-3 w-3" />
                      Helpful
                    </>
                  ) : (
                    reaction
                  )}{" "}
                  {entries.length || ""}
                </Button>
              );
            })}
          </div>
        )}
        {user &&
          thread.kind === "QUESTION" &&
          (thread.userId === user.userId || board.permissions.moderate) && (
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              disabled={accept.isPending}
              onClick={() =>
                void run(() =>
                  accept.mutateAsync({
                    threadId: thread.id,
                    postId: accepted ? null : post.id,
                  }),
                )
              }
            >
              {accepted ? "Clear accepted answer" : "Accept answer"}
            </Button>
          )}
        {board.permissions.moderate && (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-medium">
              Post moderation
            </summary>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Input
                aria-label="Moderation reason"
                placeholder="Reason for the moderation log"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
              />
              {[post.isLocked ? "UNLOCK" : "LOCK", "REMOVE"].map((action) => (
                <Button
                  key={action}
                  size="sm"
                  variant="outline"
                  disabled={reason.trim().length < 3 || moderation.isPending}
                  onClick={() =>
                    void run(
                      () =>
                        moderation.mutateAsync({
                          postId: post.id,
                          action: action as "LOCK" | "UNLOCK" | "REMOVE",
                          reason,
                        }),
                      action === "REMOVE",
                    )
                  }
                >
                  {action === "REMOVE"
                    ? "Remove with reason"
                    : post.isLocked
                      ? "Unlock post"
                      : "Lock post"}
                </Button>
              ))}
            </div>
          </details>
        )}
        {history && (
          <div className="mt-3 space-y-3 rounded-md border p-3">
            <h4 className="text-sm font-semibold">Previous versions</h4>
            {revisions.isPending ? (
              <Loader explanation="Loading history…" />
            ) : !revisions.data?.length ? (
              <p className="text-muted-foreground text-sm">No previous versions.</p>
            ) : (
              revisions.data.map((r) => (
                <div key={r.id} className="border-t pt-2">
                  <p className="text-muted-foreground text-xs" suppressHydrationWarning>
                    {r.createdAt.toLocaleString()} · {r.reason}
                  </p>
                  <div className="mt-2 text-sm">{parseHtml(r.content)}</div>
                </div>
              ))
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="text-destructive mt-2 text-sm">
            {error}
          </p>
        )}
        <div id={`read-${post.id}`} data-read-post={post.id} className="h-px" />
      </Post>
    </article>
  );
}

type ThreadData = RouterOutputs["comments"]["getForumComments"];
