"use client";

import { format } from "date-fns";
import { useAtom, useSetAtom } from "jotai";
import { ArrowDown, Reply, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useConversation } from "@/layout/Conversation";
import { ConversationComments } from "@/layout/ConversationComments";
import Loader from "@/layout/Loader";
import RichInput from "@/layout/RichInput";
import { type ChatStartUser, chatDraftsAtom, chatViewingAtom } from "@/libs/chatPanel";
import { stripBlockquotes } from "@/utils/sanitize";

/**
 * One conversation in the chat panel: messages oldest to newest with the composer
 * below. Shares all conversation behaviour with the tavern and inbox pages.
 */
export function ChatConversation({
  convoId,
  convoTitle,
  placeholder,
  tavernStyling,
  onConversationLoaded,
  onMessageUser,
  toolbarStart,
  toolbarEnd,
}: ChatConversationProps) {
  const {
    userData,
    comments,
    allComments,
    conversation,
    isPending,
    searchQuery,
    clearSearch,
    searchButtonElement,
    deletedCommentIds,
    setLastElement,
    canComposeMessage,
    composeRestrictionMessage,
    quoteIds,
    setValue,
    getValues,
    toggleQuoteId,
    control,
    errors,
    editorKey,
    isCommenting,
    handleSubmitComment,
    reactConversationComment,
    handleConversationCommentDeleted,
    typingUsers,
  } = useConversation({ convo_id: convoId, convo_title: convoTitle, refreshKey: 0 });

  const listRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const scrollHeightRef = useRef(0);
  const newestIdRef = useRef<string | undefined>(undefined);
  const [unseen, setUnseen] = useState(0);

  const newestId = allComments?.[0]?.id;
  const loadedCount = allComments?.length ?? 0;

  // While shown, this conversation's messages and pings count as seen.
  const setViewing = useSetAtom(chatViewingAtom);
  useEffect(() => {
    if (!conversation?.id) return;
    onConversationLoaded?.(conversation.id);
    setViewing(conversation.id);
    return () => setViewing(undefined);
  }, [conversation?.id, onConversationLoaded, setViewing]);

  // Keep the reader's place: follow new messages only when already at the bottom,
  // and hold the visible message steady when older history loads above it.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || loadedCount === 0) return;
    const previousNewest = newestIdRef.current;
    newestIdRef.current = newestId;
    if (newestId !== previousNewest) {
      if (isAtBottomRef.current || previousNewest === undefined) {
        list.scrollTop = list.scrollHeight;
      } else {
        setUnseen((count) => count + 1);
      }
    } else if (!isAtBottomRef.current) {
      list.scrollTop += list.scrollHeight - scrollHeightRef.current;
    }
    scrollHeightRef.current = list.scrollHeight;
  }, [newestId, loadedCount]);

  // Keep unsent text when the panel closes or another chat opens, and restore it.
  const draftKey = convoId ?? convoTitle ?? "";
  const [drafts, setDrafts] = useAtom(chatDraftsAtom);
  const savedDraft = useRef(drafts[draftKey]);
  useEffect(() => {
    if (savedDraft.current) setValue("comment", savedDraft.current);
    return () => {
      const text = getValues("comment") ?? "";
      setDrafts((current) => {
        const { [draftKey]: _previous, ...rest } = current;
        return text.trim() ? { ...rest, [draftKey]: text } : rest;
      });
    };
  }, [draftKey, getValues, setValue, setDrafts]);

  // Late layout (quotes, images, fonts) grows the list; stay pinned to the newest.
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = listRef.current;
    const content = contentRef.current;
    if (!list || !content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (isAtBottomRef.current) list.scrollTop = list.scrollHeight;
      scrollHeightRef.current = list.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [conversation?.id]);

  const onScroll = () => {
    const list = listRef.current;
    if (!list) return;
    isAtBottomRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    scrollHeightRef.current = list.scrollHeight;
    if (isAtBottomRef.current) setUnseen(0);
  };

  const scrollToBottom = () => {
    const list = listRef.current;
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
    setUnseen(0);
  };

  const mentionUser = (username: string) => {
    const current = getValues("comment") ?? "";
    setValue(
      "comment",
      `${current}${current && !current.endsWith(" ") ? " " : ""}@${username} `,
    );
  };

  const quotes =
    quoteIds
      ?.map((id) => allComments?.find((comment) => comment.id === id))
      .filter((comment) => !!comment) ?? [];
  const typingNames = Array.from(typingUsers.values()).map((user) => user.username);

  const toolbar = (
    <div className="flex shrink-0 items-center gap-[4px] border-b px-[8px] py-[4px] [&_button]:h-[32px]">
      <div className="flex min-w-0 flex-1 items-center gap-[4px]">{toolbarStart}</div>
      {conversation && searchButtonElement}
      {toolbarEnd}
    </div>
  );

  if (isPending || !conversation) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {toolbar}
        {isPending ? (
          <Loader explanation="Loading conversation" />
        ) : (
          <p className="text-muted-foreground p-[16px] text-center text-[13px]">
            {comments?.pages[0]?.restrictionMessage ?? "Conversation not found"}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {toolbar}
      {searchQuery && (
        <div className="flex items-center gap-[8px] border-b px-[12px] py-[6px] text-[12px]">
          <span className="min-w-0 flex-1 truncate">
            Showing messages containing <strong>{searchQuery}</strong>
          </span>
          <Button variant="ghost" size="sm" className="h-[28px]" onClick={clearSearch}>
            Clear search
          </Button>
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <div
          ref={listRef}
          onScroll={onScroll}
          role="log"
          aria-label={`Messages in ${conversation.title}`}
          className="h-full overflow-y-auto overscroll-contain py-[4px]"
        >
          <div ref={contentRef}>
            <ConversationComments
              compact
              pages={comments?.pages}
              conversationId={conversation.id}
              deletedCommentIds={deletedCommentIds}
              quoteIds={quoteIds}
              username={userData?.username}
              tavernStyling={tavernStyling}
              setLastElement={setLastElement}
              onReact={reactConversationComment}
              onToggleQuote={toggleQuoteId}
              onDeleted={handleConversationCommentDeleted}
              canInteract={canComposeMessage}
              onMentionUser={canComposeMessage ? mentionUser : undefined}
              onMessageUser={onMessageUser}
            />
          </div>
        </div>
        {unseen > 0 && (
          <Button
            type="button"
            size="sm"
            className="absolute bottom-[8px] left-1/2 h-[28px] -translate-x-1/2 gap-[4px] rounded-full shadow-md"
            onClick={scrollToBottom}
          >
            <ArrowDown className="h-[14px] w-[14px]" aria-hidden />
            {unseen} new {unseen === 1 ? "message" : "messages"}
          </Button>
        )}
      </div>
      {/* Reserve the line so the composer does not jump as people start and stop typing. */}
      {conversation.isPublic && (
        <p
          className="text-muted-foreground min-h-[16px] px-[12px] text-[12px] italic"
          aria-live="polite"
        >
          {typingNames.length === 1
            ? `${typingNames[0]} is typing…`
            : typingNames.length === 2
              ? `${typingNames[0]} and ${typingNames[1]} are typing…`
              : typingNames.length > 2
                ? `${typingNames.slice(0, 2).join(", ")} and ${typingNames.length - 2} more are typing…`
                : ""}
        </p>
      )}
      <div className="shrink-0 border-t p-[8px]">
        {conversation.isLocked ? (
          <p className="text-muted-foreground text-center text-[13px]">
            This conversation is locked.
          </p>
        ) : !canComposeMessage ? (
          composeRestrictionMessage && (
            <p className="text-muted-foreground text-center text-[13px]">
              {composeRestrictionMessage}
            </p>
          )
        ) : (
          <>
            {quotes.map((quote) => (
              <div
                key={quote.id}
                className="bg-muted mb-[4px] flex items-center gap-[8px] rounded-md px-[8px] py-[4px] text-[12px]"
              >
                <Reply
                  className="text-muted-foreground h-[14px] w-[14px] shrink-0"
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate">
                  Replying to <strong>{quote.username}</strong>{" "}
                  <span className="text-muted-foreground">
                    {format(quote.createdAt, "HH:mm")} ·{" "}
                    {stripBlockquotes(quote.content).replace(/<[^>]*>/g, " ")}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={`Stop replying to ${quote.username}`}
                  className="hover:bg-background rounded p-[2px]"
                  onClick={() => toggleQuoteId(quote.id)}
                >
                  <X className="h-[14px] w-[14px]" />
                </button>
              </div>
            ))}
            <RichInput
              compact
              // The id names the form field the editor writes to.
              id="comment"
              refreshKey={editorKey}
              height="32"
              disabled={isCommenting}
              placeholder={placeholder ?? `Message ${conversation.title}…`}
              control={control}
              error={errors.comment?.message}
              onSubmit={handleSubmitComment}
              enableMentions
              allowClipboardPaste
              focusEndOnExternalChange
              autoFocus={false}
            />
          </>
        )}
      </div>
    </div>
  );
}

interface ChatConversationProps {
  convoId?: string;
  convoTitle?: string;
  placeholder?: string;
  tavernStyling?: boolean;
  /** Reports the resolved conversation, e.g. to clear its mention count. */
  onConversationLoaded?: (conversationId: string) => void;
  onMessageUser?: (user: ChatStartUser) => void;
  /** Controls shown left of the search button, e.g. a tavern switch. */
  toolbarStart?: React.ReactNode;
  /** Controls shown right of the search button, e.g. mute and more. */
  toolbarEnd?: React.ReactNode;
}
