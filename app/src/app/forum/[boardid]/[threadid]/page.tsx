"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { use, useState } from "react";
import { useForm } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import NotFoundPage from "@/app/[...not-found]/page";
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

export default function Thread(props: { params: Promise<{ threadid: string }> }) {
  const params = use(props.params);
  const limit = 10;
  const { data: userData } = useUserData();
  const [page, setPage] = useState(0);
  const thread_id = params.threadid;

  const {
    data: comments,
    isPending: isPendingComments,
    refetch,
  } = api.comments.getForumComments.useQuery(
    { thread_id: thread_id, limit: limit, cursor: page },
    {
      enabled: !!thread_id,
      placeholderData: (previousData) => previousData,
    },
  );
  const thread = comments?.thread;
  const allComments = comments?.data;
  const totalPages = comments?.totalPages ?? 0;
  const totalComments = comments?.totalComments ?? 0;

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
        reset();
        if (totalComments && totalPages && allComments) {
          const newPage = totalComments % limit === 0 ? totalPages : totalPages - 1;
          if (newPage !== page) {
            setPage(newPage);
          }
          await refetch();
        }
      },
    });

  const handleSubmitComment = handleSubmit(
    (data) => createComment(data),
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
          {allComments?.map((comment, i) => {
            return (
              <div key={comment.id}>
                <CommentOnForum
                  title={i === 0 && page === 0 ? thread.title : undefined}
                  user={comment.user}
                  hover_effect={false}
                  comment={comment}
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
            !userData.isSilenced && (
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
