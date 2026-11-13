import { zodResolver } from "@hookform/resolvers/zod";
import { BarChart2, Flag, Quote, SmilePlus, SquarePen, Trash2 } from "lucide-react";
import type React from "react";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ConversationComment, UserReportComment } from "@/drizzle/schema";
import { CompactComment } from "@/layout/CompactComment";
import Confirm from "@/layout/Confirm";
import { EmojiPicker } from "@/layout/EmojiPicker";
import { ModerationSummary } from "@/layout/ModerationSummary";
import Post, { type PostProps } from "@/layout/Post";
import { QuotingNote } from "@/layout/QuotingNote";
import { ReactionPill } from "@/layout/ReactionPill";
import ReportUser from "@/layout/Report";
import RichInput from "@/layout/RichInput";
import type { ChatStartUser } from "@/libs/chatPanel";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import { canDeleteComment, canSeeSecretData } from "@/utils/permissions";
import { splitQuotedReply } from "@/utils/richText";
import { stripHtmlPreview } from "@/utils/string";
import { formatDateTime } from "@/utils/time";
import { useUserData } from "@/utils/UserContext";
import type { DeleteCommentSchema, MutateCommentSchema } from "@/validators/comments";
import { mutateCommentSchema } from "@/validators/comments";
import type { systems } from "@/validators/reports";

/**
 * Component for handling comments on user reports
 * @param props
 * @returns
 */
interface UserReportCommentProps extends PostProps {
  comment: UserReportComment;
}
export const CommentOnReport: React.FC<UserReportCommentProps> = (props) => {
  return <BaseComment {...props} editing={false} setEditing={() => {}} />;
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
  /** Revoking edit permission hides an open editor without discarding its unsaved draft. */
  canEdit?: boolean;
  /** Dense chat row for the chat panel. */
  compact?: boolean;
  onMentionUser?: (username: string) => void;
  onMessageUser?: (user: ChatStartUser) => void;
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
        void utils.comments.getConversationComments.invalidate();
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

  if (props.compact && props.user) {
    return (
      <CompactComment
        user={props.user}
        comment={props.comment}
        tavernStyling={props.tavernStyling}
        highlighted={props.color === "poppopover"}
        quoteIds={props.quoteIds}
        toggleReaction={props.toggleReaction}
        setQuoteId={props.setQuoteId}
        editComment={props.canEdit === false ? undefined : editComment.mutate}
        isEditPending={editComment.isPending}
        deleteComment={handleDelete}
        isDeletePending={deleteComment.isPending}
        editing={editing && props.canEdit !== false}
        setEditing={setEditing}
        onMentionUser={props.onMentionUser}
        onMessageUser={props.onMessageUser}
      >
        {props.children}
      </CompactComment>
    );
  }

  return (
    <BaseComment
      {...props}
      system="conversation_comment"
      editComment={props.canEdit === false ? undefined : editComment.mutate}
      isEditPending={editComment.isPending}
      deleteComment={handleDelete}
      isDeletePending={deleteComment.isPending}
      editing={editing && props.canEdit !== false}
      setEditing={setEditing}
    />
  );
};

/**
 * Base component on which other comment components are built
 * @param props
 * @returns
 */
interface BaseCommentProps extends PostProps {
  comment: UserReportComment | ConversationComment;
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
  const { data: userData } = useUserData();
  const [emojiOpen, setEmojiOpen] = useState(false);

  // Handle submit: an edit sends only the author's own text; the server keeps attached quotes
  const quoted = splitQuotedReply(props.comment.content);
  const {
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<MutateCommentSchema>({
    defaultValues: {
      object_id: props.comment.id,
      comment: quoted.reply,
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
  const reactions =
    "reactions" in props.comment && props.comment.reactions
      ? Object.entries(props.comment.reactions).map(([reaction, users]) => (
          <ReactionPill
            key={`${props.comment.id}-${reaction}`}
            emoji={reaction}
            usernames={users}
            size="md"
            isMine={!!userData && users.includes(userData.username)}
            onToggle={
              props.toggleReaction ? () => props.toggleReaction?.(reaction) : undefined
            }
          />
        ))
      : [];

  return (
    <Post
      options={
        props.user && (
          <div className="flex flex-row gap-1">
            {props.toggleReaction && (
              <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={postActionClassName}
                    aria-label="Add reaction"
                  >
                    <SmilePlus className="h-6 w-6 hover:text-orange-500" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  collisionPadding={8}
                  className="max-h-[var(--radix-popover-content-available-height)] w-[300px] overflow-y-auto border-0 p-0"
                >
                  <EmojiPicker
                    perLine={12}
                    // Radix cannot scan shadow-root controls; let the loaded picker focus search.
                    autoFocus
                    onSelect={(native) => {
                      props.toggleReaction?.(native);
                      setEmojiOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>
            )}
            {props.setQuoteId && (
              <Button
                variant="ghost"
                size="icon"
                className={postActionClassName}
                aria-label={`Quote ${props.user.username}`}
                aria-pressed={!!props.quoteIds?.includes(props.comment.id)}
                onClick={() => {
                  if (props.setQuoteId && props.comment.id) {
                    props.setQuoteId(props.comment.id);
                  }
                }}
              >
                <Quote
                  className={cn(
                    "h-6 w-6",
                    props.quoteIds?.includes(props.comment.id)
                      ? "fill-orange-500"
                      : "hover:text-orange-500",
                  )}
                />
              </Button>
            )}
            {isAuthor && props.editComment && (
              <Button
                variant="ghost"
                size="icon"
                className={postActionClassName}
                aria-label="Edit message"
                aria-pressed={!!props.editing}
                onClick={() => props.setEditing((prev) => !prev)}
              >
                <SquarePen
                  className={cn(
                    "h-6 w-6",
                    props.editing ? "fill-orange-500" : "hover:text-orange-500",
                  )}
                />
              </Button>
            )}
            {userData && (isAuthor || canSeeSecretData(userData.role)) && (
              <ModerationSummary
                userId={props.user.userId}
                username={props.user.username}
                trigger={
                  <Button
                    variant="ghost"
                    size="icon"
                    className={postActionClassName}
                    aria-label={`Moderation summary for ${props.user.username}`}
                  >
                    <BarChart2 className="h-6 w-6 hover:text-orange-500" />
                  </Button>
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
          <QuotingNote authors={quoted.authors} />
          <RichInput
            id="comment"
            height="200"
            placeholder={quoted.reply}
            control={control}
            disabled={props.isEditPending}
            onSubmit={onSubmit}
            submitOnEnter="never"
            error={errors.comment?.message}
          />
        </form>
      ) : (
        <>
          <div data-reading-text className="[&_img]:h-auto [&_img]:max-w-full">
            {props.children}
          </div>
          {/* In flow below the message, so a long message or wrapped actions never overlap it. */}
          <div className="flex flex-row items-center justify-end gap-1">
            {/* Server and browser locale or timezone settings can format this date
                differently during hydration. */}
            <p className="pr-2 text-gray-600 text-xs italic" suppressHydrationWarning>
              {formatDateTime(props.comment.createdAt)}
            </p>
            {props.user && props.system && !props.comment?.isReported && (
              <ReportUser
                user={props.user}
                content={props.comment}
                system={props.system}
                label={`Report message by ${props.user.username}`}
                className={postActionClassName}
                button={<Flag className="h-6 w-6 hover:text-orange-500" />}
              />
            )}
            {props.system && props.comment?.isReported && (
              <span className="inline-flex p-0.5">
                <Flag className="h-6 w-6 fill-orange-500" aria-hidden="true" />
                <span className="sr-only">Reported</span>
              </span>
            )}
            {props.user &&
              userData &&
              canDeleteComment(userData, props.user.userId) &&
              props.deleteComment && (
                <Confirm
                  id={`delete-comment-${props.comment.id}`}
                  title="Confirm Deletion"
                  triggerLabel="Delete comment"
                  triggerClassName={cn(postActionClassName, "justify-center")}
                  button={<Trash2 className="h-6 w-6 hover:text-orange-500" />}
                  disabled={props.isDeletePending}
                  confirmClassName="bg-red-600 text-white hover:bg-red-700"
                  proceed_label="Delete comment"
                  proceed_loading_label="Deleting"
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
                      “{stripHtmlPreview(props.comment.content)}”
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

/** An icon action in a post's header or footer row, sized to its icon. */
const postActionClassName = "size-auto shrink-0 rounded-md p-0.5 hover:bg-accent";
