"use client";
import { Loader2 } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import type { RouterOutputs } from "@/app/_trpc/client";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { COMMENT_MAX_LENGTH, COMMENT_MIN_LENGTH } from "@/drizzle/constants";
import { useConversationCacheUpdate } from "@/hooks/useConversationCacheUpdate";
import { subscribeConversation } from "@/libs/conversationEvents";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import { parseHtml } from "@/utils/parse";
import { getMessagingRestriction } from "@/utils/permissions";
import { useRequiredUserDataSelector } from "@/utils/UserContext";

/** Shared raid/quest chat using conversation permissions and live message invalidation. */
export const TeamChatPanel: React.FC<TeamChatPanelProps> = ({
  conversationId,
  title = "Team Chat",
}) => {
  const { data: userData, pusher } = useRequiredUserDataSelector((u) => ({
    userId: u.userId,
    isBanned: u.isBanned,
    isSilenced: u.isSilenced,
    level: u.level,
  }));
  const util = api.useUtils();
  const { refreshConversationComments } = useConversationCacheUpdate();
  const [message, setMessage] = useState("");

  const queryKey = useMemo(
    () => ({
      convo_id: conversationId,
      limit: 15,
    }),
    [conversationId],
  );

  const {
    data: commentsData,
    isPending,
    error,
    refetch,
  } = api.comments.getConversationComments.useInfiniteQuery(queryKey, {
    enabled: !!conversationId,
    // Recheck permissions after missed cross-tab events, even while cached history is fresh.
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const { mutate: sendMessage, isPending: isSending } =
    api.comments.createConversationComment.useMutation({
      onError: (error) => showMutationToast({ success: false, message: error.message }),
      onSuccess: async (data, newMessage) => {
        if (!data.success) {
          showMutationToast(data);
          return;
        }

        setMessage("");
        await refreshConversationComments(newMessage.object_id);
      },
    });

  useEffect(() => {
    if (!pusher || !conversationId) return;

    return subscribeConversation(
      pusher,
      conversationId,
      JSON.stringify(queryKey),
      (data, ownsCacheUpdate) => {
        // Skip the echo of our own send — onSuccess already invalidated.
        if (
          ownsCacheUpdate &&
          data.message === "new" &&
          data.fromId !== userData?.userId
        ) {
          void util.comments.getConversationComments.invalidate(queryKey);
        }
      },
    );
  }, [
    conversationId,
    pusher,
    queryKey,
    userData?.userId,
    util.comments.getConversationComments,
  ]);

  const comments = uniqueComments(commentsData?.pages);
  const restrictionMessage =
    commentsData?.pages[0]?.restrictionMessage ??
    commentsData?.pages[0]?.convo?.sendRestriction ??
    (userData ? getMessagingRestriction(userData) : null);

  /** Validate the draft while retaining it on failure; the conversation router enforces access. */
  const handleSendMessage = () => {
    if (!conversationId || restrictionMessage) return;
    const trimmedMessage = message.trim();
    if (trimmedMessage.length < COMMENT_MIN_LENGTH) {
      showMutationToast({
        success: false,
        message: `Chat messages must be at least ${COMMENT_MIN_LENGTH} characters long.`,
      });
      return;
    }

    sendMessage({
      object_id: conversationId,
      comment: trimmedMessage,
      quoteIds: null,
      senderId: null,
    });
  };

  return (
    <div className="space-y-3 border-t pt-3">
      <h4 className="font-semibold text-sm">{title}</h4>

      <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg bg-muted/30 p-3">
        {isPending ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading chat...
          </div>
        ) : error ? (
          <p role="alert" className="text-sm">
            {error.message}{" "}
            <Button variant="link" size="sm" onClick={() => void refetch()}>
              Retry chat
            </Button>
          </p>
        ) : comments.length > 0 ? (
          comments
            .slice()
            .reverse()
            .map((comment) => (
              <TeamChatMessage
                key={comment.id}
                comment={comment}
                isOwn={comment.userId === userData?.userId}
              />
            ))
        ) : (
          <p className="text-muted-foreground text-sm">
            No messages yet. Say hello to your team.
          </p>
        )}
      </div>

      {restrictionMessage && (
        <p role="alert" className="text-muted-foreground text-sm">
          {restrictionMessage}
        </p>
      )}
      <div className="flex items-end gap-2">
        <Textarea
          aria-label="Team message"
          rows={2}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={
            restrictionMessage ? "Chat unavailable" : "Write a message to your team..."
          }
          disabled={!!restrictionMessage || isSending}
          className="max-h-40 min-h-16 resize-y"
          maxLength={COMMENT_MAX_LENGTH}
        />
        <Button
          onClick={handleSendMessage}
          disabled={
            !!restrictionMessage ||
            isSending ||
            message.trim().length < COMMENT_MIN_LENGTH
          }
        >
          {isSending ? "Sending..." : "Send"}
        </Button>
      </div>
      {message.length > 0 && message.trim().length < COMMENT_MIN_LENGTH && (
        <p className="text-muted-foreground text-xs">
          Minimum {COMMENT_MIN_LENGTH} characters.
        </p>
      )}
    </div>
  );
};

// Cache updates preserve unchanged comment objects, so a new message renders and
// parses only its own row.
const TeamChatMessage = memo(function TeamChatMessage({
  comment,
  isOwn,
}: {
  comment: TeamChatComment;
  isOwn: boolean;
}) {
  const content = useMemo(() => parseHtml(comment.content), [comment.content]);
  return (
    <div
      className={cn(
        "rounded-lg bg-background px-3 py-2 text-sm",
        isOwn && "bg-primary/5",
      )}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-medium">{comment.username}</span>
        <span className="text-muted-foreground text-xs">
          {new Date(comment.createdAt).toLocaleTimeString()}
        </span>
      </div>
      <div className="break-words text-foreground">{content}</div>
    </div>
  );
});

/** Loaded pages can overlap after a refetch; keep the first copy of each comment. */
const uniqueComments = (pages: TeamChatPage[] | undefined) => {
  if (!pages) return [];
  const seen = new Set<string>();
  return pages
    .flatMap((page) => page.data)
    .filter((comment) => {
      if (seen.has(comment.id)) return false;
      seen.add(comment.id);
      return true;
    });
};

type TeamChatPage = RouterOutputs["comments"]["getConversationComments"];
type TeamChatComment = TeamChatPage["data"][number];

/** Existing activity conversation; its router owns membership and sending permissions. */
interface TeamChatPanelProps {
  title?: string;
  conversationId: string;
}
