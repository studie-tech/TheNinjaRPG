import { zodResolver } from "@hookform/resolvers/zod";
import { BarChart2, Flag, Quote, SmilePlus, SquarePen, Trash2 } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  ConversationComment,
  ForumPost,
  UserReportComment,
} from "@/drizzle/schema";
import Confirm from "@/layout/Confirm";
import EmojiPicker from "@/layout/EmojiPicker";
import { ModerationSummary } from "@/layout/ModerationSummary";
import ReportUser from "@/layout/Report";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import { canDeleteComment, canSeeSecretData } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";
import type { DeleteCommentSchema, MutateCommentSchema } from "@/validators/comments";
import { mutateCommentSchema } from "@/validators/comments";
import type { systems } from "@/validators/reports";
import Post, { type PostProps } from "./Post";
import RichInput from "./RichInput";

/**
 * Component for handling comments on user reports
 * @param props
 * @returns
 */
interface UserReportCommentProps extends PostProps {
  comment: UserReportComment;
}
export const CommentOnReport: React.FC<UserReportCommentProps> = (props) => {
  const [editing, setEditing] = useState(false);
  return <BaseComment {...props} editing={editing} setEditing={setEditing} />;
};

/**
 * Component for handling comments on conversations
 */
interface ConversationCommentProps extends PostProps {
  comment: ConversationComment;
  toggleReaction?: (emoji: string) => void;
  setQuoteId?: (id: string) => void;
  quoteIds?: string[] | null;
  onDeleted?: (commentId: string) => void;
}
export const CommentOnConversation: React.FC<ConversationCommentProps> = (props) => {
  const [editing, setEditing] = useState(false);
  const utils = api.useUtils();
  const deleteInFlightRef = useRef(false);

  const editComment = api.comments.editConversationComment.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.comments.getConversationComments.invalidate();
        setEditing(false);
      }
    },
  });

  const deleteComment = api.comments.deleteConversationComment.useMutation({
    onSuccess: (data, variables) => {
      showMutationToast(data);
      if (data.success) {
        // Remove the proven-deleted item before refreshing. The parent keeps an
        // id-level suppression guard so a stale or failed refetch cannot bring
        // this exact delete action back.
        props.onDeleted?.(variables.id);
        setEditing(false);
        void utils.comments.getConversationComments.invalidate().catch(() => undefined);
      }
    },
    onError: (error) => {
      showMutationToast({ success: false, message: error.message });
    },
    onSettled: () => {
      deleteInFlightRef.current = false;
    },
  });

  const handleDelete = (data: DeleteCommentSchema) => {
    if (deleteInFlightRef.current || deleteComment.isPending) return;
    deleteInFlightRef.current = true;
    deleteComment.mutate(data);
  };

  return (
    <BaseComment
      {...props}
      system="conversation_comment"
      editComment={editComment.mutate}
      isEditPending={editComment.isPending}
      deleteComment={handleDelete}
      isDeletePending={deleteComment.isPending}
      editing={editing}
      setEditing={setEditing}
    />
  );
};

/**
 * Component for handling comments on forum threads
 */
interface ForumCommentProps extends PostProps {
  comment: ForumPost;
  toggleReaction?: (emoji: string) => void;
  setQuoteId?: (id: string) => void;
  quoteIds?: string[] | null;
  onDeleted?: (commentId: string) => void;
}
export const CommentOnForum: React.FC<ForumCommentProps> = (props) => {
  const [editing, setEditing] = useState(false);
  const utils = api.useUtils();
  const deleteInFlightRef = useRef(false);

  const editComment = api.comments.editForumComment.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.comments.getForumComments.invalidate();
        setEditing(false);
      }
    },
  });

  const deleteComment = api.comments.deleteForumComment.useMutation({
    onSuccess: (data, variables) => {
      showMutationToast(data);
      if (data.success) {
        // Hide the proven-deleted post synchronously. The thread owns an
        // id-level suppression guard, so even a stale or failed refresh cannot
        // resurrect this exact post.
        props.onDeleted?.(variables.id);
        setEditing(false);
        void utils.comments.getForumComments.invalidate().catch(() => undefined);
      }
    },
    onError: (error) => {
      showMutationToast({ success: false, message: error.message });
    },
    onSettled: () => {
      deleteInFlightRef.current = false;
    },
  });

  const handleDelete = (data: DeleteCommentSchema) => {
    if (deleteInFlightRef.current || deleteComment.isPending) return;
    deleteInFlightRef.current = true;
    deleteComment.mutate(data);
  };

  return (
    <BaseComment
      {...props}
      system="forum_comment"
      editComment={editComment.mutate}
      isEditPending={editComment.isPending}
      deleteComment={handleDelete}
      isDeletePending={deleteComment.isPending}
      editing={editing}
      setEditing={setEditing}
    />
  );
};

/**
/**
 * Base component on which other comment components are built
 * @param props
 * @returns
 */
interface BaseCommentProps extends PostProps {
  comment: UserReportComment | ForumPost | ConversationComment;
  editing: boolean;
  system?: (typeof systems)[number];
  quoteIds?: string[] | null;
  setEditing: React.Dispatch<React.SetStateAction<boolean>>;
  editComment?: (data: MutateCommentSchema) => void;
  isEditPending?: boolean;
  deleteComment?: (data: DeleteCommentSchema) => void;
  isDeletePending?: boolean;
  toggleReaction?: (emoji: string) => void;
  setQuoteId?: (id: string) => void;
}
const BaseComment: React.FC<BaseCommentProps> = (props) => {
  // State// Reference for emoji element
  const { data: userData } = useUserData();
  const emojiRef = useRef<HTMLDivElement | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);

  // Handle submit
  const {
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<MutateCommentSchema>({
    defaultValues: {
      object_id: props.comment.id,
      comment: props.comment.content,
      quoteIds: null,
      senderId: null,
    },
    resolver: zodResolver(mutateCommentSchema),
  });

  const onSubmit = handleSubmit((data) => {
    if (props.editComment && !props.isEditPending) props.editComment(data);
  });

  // Derived
  const isAuthor = props.user && userData?.userId === props.user.userId;
  const reactions = [];
  if ("reactions" in props.comment && props.comment.reactions) {
    for (const [reaction, users] of Object.entries(props.comment.reactions)) {
      reactions.push(
        <Tooltip key={`${props.comment.id}-${reaction}`} delayDuration={300}>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="cursor-pointer rounded-md border-2 bg-popover px-1 px-1 pt-1 text-lg hover:bg-poppopover/80"
              onClick={() => {
                props.toggleReaction?.(reaction);
              }}
            >
              {reaction} {users.length}
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            className="w-auto max-w-[250px] rounded-md border bg-poppopover p-2 text-poppopover-foreground shadow-md"
          >
            <div className="mb-1 border-b pb-1 text-center font-semibold">
              {users.length} {users.length === 1 ? "user" : "users"} reacted with{" "}
              {reaction}
            </div>
            <div className="max-h-40 overflow-y-auto">
              {users.map((username, i) => (
                <div key={`${username}-${i}`} className="px-2 py-0.5 text-sm">
                  {username}
                </div>
              ))}
            </div>
          </TooltipContent>
        </Tooltip>,
      );
    }
  }

  // Handler for clicks outside emoji selector
  const handleOutsideClick = (e: MouseEvent) => {
    if (emojiRef.current && !emojiRef.current.contains(e.target as HTMLElement)) {
      setEmojiOpen(false);
    }
  };
  useEffect(() => {
    document.addEventListener("mousedown", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  });

  return (
    <Post
      options={
        props.user && (
          <div className="flex flex-row gap-1">
            {props.toggleReaction && (
              <>
                <SmilePlus
                  className="h-6 w-6 cursor-pointer hover:text-orange-500"
                  onClick={() => setEmojiOpen(!emojiOpen)}
                />
                <div className="absolute top-0 right-2 z-50" ref={emojiRef}>
                  {emojiOpen && (
                    <EmojiPicker
                      perLine={12}
                      onSelect={(native) => {
                        props.toggleReaction?.(native);
                        setEmojiOpen(false);
                      }}
                      onClickOutside={() => setEmojiOpen(false)}
                    />
                  )}
                </div>
              </>
            )}
            {props.setQuoteId && (
              <Quote
                className={cn(
                  "h-6 w-6",
                  props.quoteIds?.includes(props.comment.id)
                    ? "fill-orange-500"
                    : "hover:text-orange-500",
                )}
                onClick={() => {
                  if (props.setQuoteId && props.comment.id) {
                    props.setQuoteId(props.comment.id);
                  }
                }}
              />
            )}
            {isAuthor && props.editComment && (
              <SquarePen
                className={cn(
                  "h-6 w-6",
                  props.editing ? "fill-orange-500" : "hover:text-orange-500",
                )}
                onClick={() => props.setEditing((prev) => !prev)}
              />
            )}
            {userData && (isAuthor || canSeeSecretData(userData.role)) && (
              <ModerationSummary
                userId={props.user.userId}
                username={props.user.username}
                trigger={
                  <BarChart2 className="h-6 w-6 cursor-pointer hover:text-orange-500" />
                }
              />
            )}
          </div>
        )
      }
      {...props}
    >
      {props.editing ? (
        <form onSubmit={onSubmit}>
          <RichInput
            id="comment"
            height="200"
            placeholder={props.comment.content}
            control={control}
            disabled={props.isEditPending}
            onSubmit={onSubmit}
            error={errors.comment?.message}
          />
        </form>
      ) : (
        <>
          <div className="mb-6">{props.children}</div>
          <div className="absolute right-2 bottom-0 flex flex-row items-end gap-1">
            {/* Rendered on the server for forum threads, so the server's locale and
                timezone format it first and the browser's reformats it on hydrate.
                Same opt-out FancyForumThreads already applies to its dates. */}
            <p className="pr-2 text-gray-600 text-xs italic" suppressHydrationWarning>
              @{props.comment.createdAt.toLocaleString()}
            </p>
            {props.user && props.system && !props.comment?.isReported && (
              <ReportUser
                user={props.user}
                content={props.comment}
                system={props.system}
                button={<Flag className="h-6 w-6 hover:text-orange-500" />}
              />
            )}
            {props.system && props.comment?.isReported && (
              <Flag className="h-6 w-6 fill-orange-500" />
            )}
            {props.user &&
              userData &&
              canDeleteComment(userData, props.user.userId) &&
              props.deleteComment && (
                <Confirm
                  id={`delete-comment-${props.comment.id}`}
                  title="Confirm Deletion"
                  button={
                    <Trash2
                      aria-label="Delete comment"
                      className="h-6 w-6 hover:text-orange-500"
                    />
                  }
                  disabled={props.isDeletePending}
                  confirmClassName="bg-red-600 text-white hover:bg-red-700"
                  proceed_label="Delete comment"
                  proceed_loading_label="Deleting comment…"
                  isLoading={props.isDeletePending}
                  keepOpenOnAccept={true}
                  onAccept={(e) => {
                    e.preventDefault();
                    if (props.deleteComment && !props.isDeletePending) {
                      props.deleteComment({ id: props.comment.id });
                    }
                  }}
                >
                  <div className="space-y-2">
                    <p>
                      Delete this comment by {props.user.username}? This cannot be
                      undone.
                    </p>
                    <blockquote className="line-clamp-3 border-muted-foreground/40 border-l-4 pl-3 text-muted-foreground text-sm italic">
                      “
                      {props.comment.content
                        .replace(/<[^>]*>/g, " ")
                        .replace(/\s+/g, " ")
                        .trim()}
                      ”
                    </blockquote>
                  </div>
                </Confirm>
              )}
          </div>

          <TooltipProvider>
            <div className="flex flex-row flex-wrap gap-2">{reactions}</div>
          </TooltipProvider>
        </>
      )}
    </Post>
  );
};
