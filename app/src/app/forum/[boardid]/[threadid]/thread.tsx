"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import type { RouterOutputs } from "@/app/_trpc/client";
import { api } from "@/app/_trpc/client";
import NotFoundPage from "@/components/layout/NotFoundPage";
import {
  FORUM_MIN_LEVEL,
  FORUM_THREAD_POSTS_PER_PAGE,
  forumLevelMessage,
} from "@/drizzle/constants";
import { CommentOnForum } from "@/layout/Comment";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import Pagination from "@/layout/Pagination";
import RichInput from "@/layout/RichInput";
import { forumText } from "@/layout/seoTexts";
import { showMutationToast } from "@/libs/toast";
import { parseHtml } from "@/utils/parse";
import { useUserData } from "@/utils/UserContext";
import { type MutateCommentSchema, mutateCommentSchema } from "@/validators/comments";

interface ThreadProps {
  threadId: string;
  /**
   * First page of the thread, resolved during the server render.
   *
   * Seeding the query is what puts the thread's own title and posts into the HTML.
   * Without it the server sent every thread the same boilerplate intro and nothing else,
   * and Search Console filed 381 of them as "Duplicate without user-selected canonical".
   */
  initialPage: RouterOutputs["comments"]["getForumComments"];
}

export default function Thread({ threadId, initialPage }: ThreadProps) {
  const limit = FORUM_THREAD_POSTS_PER_PAGE;
  const { data: userData } = useUserData();
  const [page, setPage] = useState(0);
  const [deletedCommentIds, setDeletedCommentIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [pendingDeletionIds, setPendingDeletionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const thread_id = threadId;
  const utils = api.useUtils();

  const {
    data: comments,
    isPending: isPendingComments,
    refetch,
  } = api.comments.getForumComments.useQuery(
    { thread_id: thread_id, limit: limit, cursor: page },
    {
      enabled: !!thread_id,
      placeholderData: (previousData) => previousData,
      // Only page 0 was rendered on the server; every other cursor is its own query key
      // and must be fetched.
      initialData: page === 0 ? initialPage : undefined,
    },
  );
  const thread = comments?.thread;
  const allComments = comments?.data;
  const visibleComments = useMemo(
    () => allComments?.filter((comment) => !deletedCommentIds.has(comment.id)),
    [allComments, deletedCommentIds],
  );
  const rawTotalComments = comments?.totalComments ?? 0;
  // Keep each successful deletion counted globally while a stale page/query
  // still reports a total from before that deletion. This is deliberately not
  // tied to whether the current page contains the tombstoned id: deleting the
  // sole post on the final page immediately moves the user to the prior page.
  const pendingDeletionCount = pendingDeletionIds.size;
  const totalComments = Math.max(0, rawTotalComments - pendingDeletionCount);
  const totalPages = Math.ceil(totalComments / limit);
  const isSoleCommentOnLastPage =
    allComments?.length === 1 && comments?.nextCursor === null && totalComments > limit;
  const belowForumMinLevel = (userData?.level ?? 0) < FORUM_MIN_LEVEL;

  const handleCommentDeleted = useCallback(
    (commentId: string) => {
      const expectedTotal = Math.max(0, totalComments - 1);
      const expectedPages = Math.ceil(expectedTotal / limit);
      setDeletedCommentIds((current) => {
        if (current.has(commentId)) return current;
        return new Set(current).add(commentId);
      });
      setPendingDeletionIds((current) => {
        if (current.has(commentId)) return current;
        return new Set(current).add(commentId);
      });
      // Decide the destination from the known pre-delete count, rather than a
      // transient placeholder returned while React Query changes page keys.
      if (expectedPages > 0 && (page >= expectedPages || isSoleCommentOnLastPage)) {
        setPage(expectedPages - 1);
      }

      utils.comments.getForumComments.setData(
        { thread_id, limit, cursor: page },
        (current) => {
          if (!current?.data.some((comment) => comment.id === commentId)) {
            return current;
          }
          return {
            ...current,
            data: current.data.filter((comment) => comment.id !== commentId),
          };
        },
      );
      // This fetch starts only after the mutation has confirmed this exact id was
      // deleted. Its total therefore incorporates that deletion regardless of
      // unrelated comments being created or removed at the same time.
      void refetch({ throwOnError: true })
        .then(() => {
          setPendingDeletionIds((current) => {
            if (!current.has(commentId)) return current;
            const next = new Set(current);
            next.delete(commentId);
            return next;
          });
        })
        .catch(() => undefined);
    },
    [
      isSoleCommentOnLastPage,
      limit,
      page,
      refetch,
      thread_id,
      totalComments,
      utils.comments.getForumComments,
    ],
  );

  const {
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<MutateCommentSchema>({
    defaultValues: {
      comment: "",
      object_id: thread_id,
      quoteIds: null,
      senderId: null,
    },
    resolver: zodResolver(mutateCommentSchema),
  });

  const { mutate: createComment, isPending } =
    api.comments.createForumComment.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (!data.success) return;
        reset();
        if (totalComments && totalPages && allComments) {
          const newPage = totalComments % limit === 0 ? totalPages : totalPages - 1;
          if (newPage !== page) {
            setPage(newPage);
          } else {
            await refetch();
          }
        }
      },
    });

  const handleSubmitComment = handleSubmit(
    (data) => {
      if (belowForumMinLevel) {
        showMutationToast({ success: false, message: forumLevelMessage });
        return;
      }
      createComment(data);
    },
    (errors) => console.error(errors),
  );

  return (
    <>
      {!userData && (
        <ContentBox
          title="Public Forum"
          defaultBackHref={thread ? `/forum/${thread.boardId}` : "/forum"}
        >
          {forumText}
        </ContentBox>
      )}
      {!thread && !isPendingComments && <NotFoundPage />}
      {thread && (
        <ContentBox
          title="Forum"
          defaultBackHref={userData ? `/forum/${thread.boardId}` : undefined}
          initialBreak={!userData}
          subtitle={thread.title}
        >
          {visibleComments?.map((comment, i) => {
            return (
              <div key={comment.id}>
                <CommentOnForum
                  title={i === 0 && page === 0 ? thread.title : undefined}
                  user={comment.user}
                  hover_effect={false}
                  comment={comment}
                  onDeleted={handleCommentDeleted}
                >
                  {parseHtml(comment.content)}
                </CommentOnForum>
              </div>
            );
          })}
          {thread &&
            userData &&
            !thread.isLocked &&
            !userData.isBanned &&
            !userData.isSilenced &&
            belowForumMinLevel && (
              <p className="mb-3 text-center text-muted-foreground text-sm">
                {forumLevelMessage}
              </p>
            )}
          {thread &&
            userData &&
            !thread.isLocked &&
            !userData.isBanned &&
            !userData.isSilenced &&
            !belowForumMinLevel && (
              <div className="relative mb-3">
                <RichInput
                  id="comment"
                  height="200"
                  refreshKey={totalComments}
                  placeholder=""
                  control={control}
                  disabled={isPending}
                  error={errors.comment?.message}
                  onSubmit={handleSubmitComment}
                />
                <div className="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 transform flex-row-reverse">
                  {isPending && <Loader />}
                </div>
              </div>
            )}
        </ContentBox>
      )}
      {totalPages > 0 && (
        <Pagination current={page} total={totalPages} setPage={setPage} />
      )}
    </>
  );
}
