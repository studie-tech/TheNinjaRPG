import { memo, useMemo } from "react";
import type { RouterOutputs } from "@/app/_trpc/client";
import { CommentOnConversation } from "@/layout/Comment";
import type { ChatStartUser } from "@/libs/chatPanel";
import { parseHtml } from "@/utils/parse";

export const ConversationComments = ({
  canInteract,
  pages,
  conversationId,
  deletedCommentIds,
  quoteIds,
  username,
  tavernStyling,
  setLastElement,
  onReact,
  onToggleQuote,
  onDeleted,
  compact,
  onMentionUser,
  onMessageUser,
}: ConversationCommentsProps) => {
  const unique = new Set<string>();
  const visibleComments = pages
    ?.flatMap((page) => page.data)
    .filter((comment) => comment.conversationId === conversationId)
    .filter((comment) => !deletedCommentIds.has(comment.id))
    .filter((comment) => {
      const duplicate = unique.has(comment.id);
      unique.add(comment.id);
      return !duplicate;
    });

  // Pages arrive newest first. Compact chat reads top to bottom, oldest first, and
  // its pagination sentinel (the oldest loaded message) moves to the top.
  const ordered =
    compact && visibleComments ? [...visibleComments].reverse() : visibleComments;
  const sentinelIndex = compact ? 0 : (visibleComments?.length ?? 0) - 1;

  return (
    <>
      {ordered?.map((comment, i) => (
        <div key={comment.id} ref={i === sentinelIndex ? setLastElement : null}>
          <ConversationCommentRow
            comment={comment}
            isQuoted={quoteIds?.includes(comment.id) ?? false}
            isHighlighted={
              comment.content.includes(`quote author="${username}`) ||
              comment.content.includes(`@${username}`)
            }
            tavernStyling={tavernStyling}
            canInteract={canInteract}
            onReact={onReact}
            onToggleQuote={onToggleQuote}
            onDeleted={onDeleted}
            compact={compact}
            onMentionUser={onMentionUser}
            onMessageUser={onMessageUser}
          />
        </div>
      ))}
    </>
  );
};

// Cache updates preserve unchanged comment objects. Keep row-local callbacks and
// parsed content behind this boundary so a chat event only renders changed rows.
const ConversationCommentRow = memo(function ConversationCommentRow({
  comment,
  isQuoted,
  isHighlighted,
  tavernStyling,
  canInteract,
  onReact,
  onToggleQuote,
  onDeleted,
  compact,
  onMentionUser,
  onMessageUser,
}: ConversationCommentRowProps) {
  const content = useMemo(() => parseHtml(comment.content), [comment.content]);

  return (
    <CommentOnConversation
      user={comment}
      hover_effect={false}
      comment={comment}
      quoteIds={isQuoted ? [comment.id] : null}
      tavernStyling={tavernStyling}
      color={isHighlighted ? "poppopover" : undefined}
      toggleReaction={
        canInteract ? (emoji) => onReact({ commentId: comment.id, emoji }) : undefined
      }
      canEdit={canInteract}
      setQuoteId={canInteract ? onToggleQuote : undefined}
      onDeleted={onDeleted}
      compact={compact}
      onMentionUser={onMentionUser}
      onMessageUser={onMessageUser}
    >
      {content}
    </CommentOnConversation>
  );
});

interface ConversationCommentsProps {
  pages?: RouterOutputs["comments"]["getConversationComments"][];
  conversationId?: string;
  deletedCommentIds: Set<string>;
  quoteIds: string[] | null;
  username?: string;
  tavernStyling?: boolean;
  setLastElement: (element: HTMLDivElement | null) => void;
  onReact: (reaction: { commentId: string; emoji: string }) => void;
  onToggleQuote: (quoteId: string) => void;
  onDeleted: (commentId: string) => void;
  canInteract: boolean;
  /** Dense chat rows, oldest first, for the chat panel. */
  compact?: boolean;
  onMentionUser?: (username: string) => void;
  onMessageUser?: (user: ChatStartUser) => void;
}

type ConversationCommentRowProps = Pick<
  ConversationCommentsProps,
  | "tavernStyling"
  | "canInteract"
  | "onReact"
  | "onToggleQuote"
  | "onDeleted"
  | "compact"
  | "onMentionUser"
  | "onMessageUser"
> & {
  comment: RouterOutputs["comments"]["getConversationComments"]["data"][number];
  isQuoted: boolean;
  isHighlighted: boolean;
};
