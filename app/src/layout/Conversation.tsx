import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { RefreshCw, Search, X } from "lucide-react";
import { nanoid } from "nanoid";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Quote } from "@/components/ui/quote";
import { Skeleton } from "@/components/ui/skeleton";
import { matchesConversationSearch } from "@/deltas/chat";
import { CONVERSATION_PAUSE_HIDDEN_MINS } from "@/drizzle/constants";
import { useConversationCacheUpdate } from "@/hooks/useConversationCacheUpdate";
import { useConversationViewing } from "@/hooks/useConversationViewing";
import { useNativeShell } from "@/hooks/useNativeShell";
import { usePageActive } from "@/hooks/usePageActive";
import { useTypingIndicators } from "@/hooks/useTypingIndicators";
import { AiSenderSelect } from "@/layout/AiSenderSelect";
import ContentBox from "@/layout/ContentBox";
import { ConversationComments } from "@/layout/ConversationComments";
import Loader from "@/layout/Loader";
import RichInput from "@/layout/RichInput";
import { subscribeConversation } from "@/libs/conversationEvents";
import { useInfinitePagination } from "@/libs/pagination";
import { showMutationToast } from "@/libs/toast";
import { getNewReactions, processMentions } from "@/utils/chat";
import { canPostAsAi, getConversationComposeRestriction } from "@/utils/permissions";
import { buildQuoteBlock, stripBlockquotes } from "@/utils/sanitize";
import { useUserPicker } from "@/utils/search";
import type { ArrayElement } from "@/utils/typeutils";
import { selectUserWithoutPosition, useUserDataSelector } from "@/utils/UserContext";
import { type SearchFormSchema, searchFormSchema } from "@/validators/chat";
import type { MutateCommentSchema } from "@/validators/comments";
import { mutateCommentSchema } from "@/validators/comments";

/** Props that select a conversation and react to its events. */
export interface ConversationLogicProps {
  convo_title?: string;
  convo_id?: string;
  refreshKey: number;
  /** The compact panel remains visible while its phone dialog covers the full page. */
  isInChatPanel?: boolean;
  onCommentPosted?: (comment: string) => void;
  /** When set, banned/silenced users may only compose if they created this ticket */
  supportTicketCreatedByUserId?: string;
}

interface ConversationProps extends ConversationLogicProps {
  defaultBackHref?: string;
  title: string;
  subtitle: string;
  initialBreak?: boolean;
  topRightContent?: React.ReactNode;
  onBack?: () => void;
  /** Enables persisted username/title colors only for tavern conversations. */
  tavernStyling?: boolean;
}

export const ConversationSkeleton: React.FC<ConversationProps> = (props) => {
  return (
    <ContentBox
      title={props.title}
      subtitle={props.subtitle}
      defaultBackHref={props.defaultBackHref}
      initialBreak={props.initialBreak}
      topRightContent={props.topRightContent}
      onBack={props.onBack}
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="flex h-[100px] w-full items-center justify-center bg-popover">
          <Loader explanation="Loading conversation" />
        </Skeleton>
        {Array.from({ length: 10 }, (_, idx) => `conversation-skeleton-${idx}`).map(
          (key) => (
            <div className="flex flex-row gap-2" key={key}>
              <Skeleton className="h-[110px] w-1/4 bg-popover lg:h-[150px]" />
              <Skeleton className="h-[110px] w-3/4 bg-popover lg:h-[150px]" />
            </div>
          ),
        )}
      </div>
    </ContentBox>
  );
};

/**
 * State, live events and actions of one conversation. The tavern page and the
 * compact chat panel render the same conversation logic in different layouts.
 */
export const useConversation = (props: ConversationLogicProps) => {
  const isNativeShell = useNativeShell();
  const { data: userData, pusher } = useUserDataSelector(selectUserWithoutPosition);
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);
  const [editorKey, setEditorKey] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [deletedCommentIds, setDeletedCommentIds] = useState<Set<string>>(
    () => new Set(),
  );
  // A conversation left in a hidden tab or backgrounded app stops following live
  // events once the pause delay passes; showing the page again resumes and catches up.
  const isPageActive = usePageActive();
  const [isPaused, setIsPaused] = useState(false);
  useEffect(() => {
    if (isPageActive) return;
    const timeout = setTimeout(
      () => setIsPaused(true),
      CONVERSATION_PAUSE_HIDDEN_MINS * 60 * 1000,
    );
    return () => clearTimeout(timeout);
  }, [isPageActive]);

  const queryKey = useMemo(
    () => ({
      convo_id: props.convo_id,
      convo_title: props.convo_title,
      limit: 10,
      refreshKey: props.refreshKey,
      searchQuery,
    }),
    [props.convo_id, props.convo_title, props.refreshKey, searchQuery],
  );

  // Fetch comments
  const {
    data: comments,
    fetchNextPage,
    hasNextPage,
    isPending,
    refetch,
  } = api.comments.getConversationComments.useInfiniteQuery(queryKey, {
    enabled: props.convo_id !== undefined || props.convo_title !== undefined,
    // Preserve the immutable writer's row identities: index-based sharing rebuilds
    // unchanged comments when new messages are prepended.
    structuralSharing: false,
    // Recheck permissions after missed cross-tab events, even while cached history is fresh.
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    placeholderData: (previousData) => previousData,
  });
  const conversation = comments?.pages[0]?.convo;
  useConversationViewing(conversation?.id, isPageActive, props.isInChatPanel);
  const composeRestrictionMessage = getConversationComposeRestriction(
    userData,
    conversation,
    props.supportTicketCreatedByUserId,
  );
  const canComposeMessage = !!userData && !composeRestrictionMessage;
  type ReturnedComment = ArrayElement<
    NonNullable<typeof comments>["pages"][number]["data"]
  >;

  const utils = api.useUtils();
  const { refreshConversationComments, recordConversationRead } =
    useConversationCacheUpdate();
  const lastReadAt = conversation?.lastReadAt;
  useEffect(() => {
    if (conversation?.id && lastReadAt) {
      void recordConversationRead(conversation.id, lastReadAt);
    }
  }, [conversation?.id, lastReadAt, recordConversationRead]);

  /**
   * Shared infinite-query cache writer for conversation comments. It applies the
   * `pages[0].convo` guard and ValidPage cast, so callers just map each page's
   * `data` array.
   */
  const updateCachedComments = useCallback(
    (
      mapPageData: (data: ReturnedComment[], pageIndex: number) => ReturnedComment[],
    ) => {
      utils.comments.getConversationComments.setInfiniteData(queryKey, (old) => {
        if (!old?.pages[0]?.convo) return old;
        type ValidPage = Extract<(typeof old.pages)[number], { convo: object }>;
        return {
          pageParams: old.pageParams,
          pages: (old.pages as ValidPage[]).map((page, i) => ({
            ...page,
            data: mapPageData(page.data, i),
          })),
        };
      });
    },
    [utils, queryKey],
  );

  // Search functionality
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);

  // Create form for search
  const searchForm = useForm<SearchFormSchema>({
    resolver: zodResolver(searchFormSchema),
    defaultValues: { searchTerm: "" },
  });

  const onSearchSubmit = useCallback(
    (values: SearchFormSchema) => {
      setSearchQuery(values.searchTerm);
      void refetch();
    },
    [refetch],
  );

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    searchForm.reset({ searchTerm: "" });
    void refetch();
  }, [searchForm, refetch]);

  // Create search button element
  const searchButtonElement = useMemo(
    () => (
      <Popover open={isSearchOpen} onOpenChange={setIsSearchOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="ml-2"
            aria-label="Search messages"
          >
            <Search className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80">
          <Form {...searchForm}>
            <form
              onSubmit={searchForm.handleSubmit(onSearchSubmit)}
              className="flex flex-col gap-2"
            >
              <div className="font-medium text-sm">Search in conversation</div>
              <FormField
                control={searchForm.control}
                name="searchTerm"
                render={({ field }) => (
                  <FormItem className="flex-1">
                    <div className="flex items-center gap-2">
                      <FormControl>
                        <Input
                          placeholder="Search for messages..."
                          {...field}
                          className="flex-1"
                          autoComplete="off"
                          onFocus={(e) => {
                            // Prevent automatic selection of text on focus
                            const target = e.target;
                            const length = target.value.length;
                            setTimeout(() => {
                              target.setSelectionRange(length, length);
                            }, 0);
                          }}
                        />
                      </FormControl>
                      {searchQuery && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={clearSearch}
                          className="h-8 w-8"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                      <Button type="submit" size="sm">
                        Search
                      </Button>
                    </div>
                  </FormItem>
                )}
              />
            </form>
          </Form>
          {searchQuery && (
            <div className="mt-1 text-muted-foreground text-xs">
              Showing results for: <span className="font-medium">{searchQuery}</span>
            </div>
          )}
        </PopoverContent>
      </Popover>
    ),
    [isSearchOpen, searchForm, searchQuery, clearSearch, onSearchSubmit],
  );

  /** Optimistically toggle a user's emoji reaction on a cached comment. */
  const optimisticReactionUpdate = async (
    commentId: string,
    emoji: string,
    username: string,
  ) => {
    await utils.comments.getConversationComments.cancel(queryKey);
    const cached = utils.comments.getConversationComments.getInfiniteData(queryKey);
    const comment = cached?.pages
      .flatMap((page) => page.data)
      .find((c) => c.id === commentId);
    if (!comment) return;

    const newReactions = getNewReactions(comment.reactions, emoji, username);
    updateCachedComments((data) =>
      data.map((c) => (c.id === commentId ? { ...c, reactions: newReactions } : c)),
    );
  };

  // Mutation for reactions
  const { mutate: reactConversationComment } =
    api.comments.reactConversationComment.useMutation({
      onMutate: async (data) => {
        if (!userData) return;
        return await optimisticReactionUpdate(
          data.commentId,
          data.emoji,
          userData.username,
        );
      },
      onSuccess: (result) => {
        if (!result.success) {
          showMutationToast(result);
          void refetch();
        }
      },
      onError: () => void refetch(),
    });

  // infinite pagination
  useInfinitePagination({ fetchNextPage, hasNextPage, lastElement });

  // Handle for submission of comment
  const {
    handleSubmit,
    getValues,
    setValue,
    reset,
    control,
    formState: { errors },
  } = useForm<MutateCommentSchema>({
    defaultValues: {
      object_id: props.convo_id ?? "",
      comment: "",
      quoteIds: null,
      senderId: null,
    },
    resolver: zodResolver(mutateCommentSchema),
  });

  // User search for sender selection (AI posting)
  const { methods: userSearchMethods, user: senderUser } = useUserPicker();
  const canPostAsAI = userData && canPostAsAi(userData.role);

  // Current quote ID
  const quoteIds = useWatch({
    control,
    name: "quoteIds",
    defaultValue: [],
  });

  const toggleQuoteId = useCallback(
    (quoteId: string) => {
      const currentQuoteIds = getValues("quoteIds");
      setValue(
        "quoteIds",
        currentQuoteIds?.includes(quoteId)
          ? currentQuoteIds.filter((id) => id !== quoteId)
          : [...(currentQuoteIds ?? []), quoteId],
      );
    },
    [getValues, setValue],
  );

  // A proven-successful delete remains hidden even if the subsequent
  // best-effort invalidation fails or briefly returns stale data.
  const handleConversationCommentDeleted = useCallback(
    (commentId: string) => {
      setDeletedCommentIds((current) => {
        if (current.has(commentId)) return current;
        const next = new Set(current);
        next.add(commentId);
        return next;
      });
      updateCachedComments((data) =>
        data.filter((comment) => comment.id !== commentId),
      );
      if (getValues("quoteIds")?.includes(commentId)) toggleQuoteId(commentId);
    },
    [getValues, toggleQuoteId, updateCachedComments],
  );

  // Watch comment field for typing indicator
  const commentValue = useWatch({
    control,
    name: "comment",
    defaultValue: "",
  });

  const { typingUsers, markTyping } = useTypingIndicators(
    conversation,
    commentValue,
    userData?.userId,
  );

  // Set the object_id to the conversation id, and drop quotes from the previous one
  useEffect(() => {
    if (conversation) {
      setValue("object_id", conversation.id);
      setValue("quoteIds", null);
    }
  }, [conversation?.id]);

  /** Prepend a comment another player posted, fetched after its live event. */
  const prependFetchedComment = async (comment: ReturnedComment) => {
    if (!userData || !conversation) return;
    if (!matchesConversationSearch(searchQuery, comment)) return;
    await utils.comments.getConversationComments.cancel(queryKey);
    updateCachedComments((data, pageIndex) =>
      pageIndex === 0 ? [comment, ...data] : data,
    );
  };

  /**
   * Show the player's own submission at the top before the server confirms it. The
   * returned temp id lets success and failure reconcile exactly that row.
   */
  const insertOptimisticComment = async (newMessage: MutateCommentSchema) => {
    if (!userData || !conversation) return {};

    const cached = utils.comments.getConversationComments.getInfiniteData(queryKey);
    const cachedComments = cached?.pages.flatMap((page) => page.data);

    const quoteText =
      quoteIds
        ?.map((id) => {
          const quote = cachedComments?.find((c) => c.id === id);
          return quote ? buildQuoteBlock(quote) : "";
        })
        .join("") || "";

    // An AI sender's missing optional fields take defaults, never the poster's values.
    const author = senderUser ?? userData;
    const optimisticComment = {
      id: nanoid(),
      createdAt: new Date(),
      conversationId: conversation.id,
      content: quoteText + processMentions(newMessage.comment).processedContent,
      reactions: {},
      isPinned: false,
      isReported: false,
      isStaffOnly: false,
      villageName: author.village?.name ?? null,
      villageHexColor: author.village?.hexColor ?? null,
      villageKageId: author.village?.kageId ?? null,
      userId: author.userId,
      authorId: userData.userId,
      username: author.username,
      avatar: author.avatar ?? null,
      rank: author.rank,
      isOutlaw: author.isOutlaw ?? false,
      level: author.level,
      role: author.role ?? "USER",
      displayTitle: author.displayTitle ?? "",
      federalStatus: author.federalStatus,
      tavernUsernameColor: author.tavernUsernameColor ?? "DEFAULT",
      tavernTitleColor: author.tavernTitleColor ?? "DEFAULT",
      nRecruited: author.nRecruited ?? 0,
      tavernMessages: author.tavernMessages ?? 0,
    };
    // During a search, a new message only shows when it matches the search
    if (!matchesConversationSearch(searchQuery, optimisticComment)) return {};
    if (!cached?.pages[0]?.convo) return {};

    // Optimistic update
    await utils.comments.getConversationComments.cancel(queryKey);
    updateCachedComments((data, pageIndex) =>
      pageIndex === 0 ? [optimisticComment, ...data] : data,
    );
    return { optimisticCommentId: optimisticComment.id };
  };

  /** Remove a single optimistic comment by temp id without discarding later cache updates. */
  const removeOptimisticComment = (optimisticCommentId: string | undefined) => {
    if (!optimisticCommentId) return;
    updateCachedComments((data) => data.filter((c) => c.id !== optimisticCommentId));
  };

  // Create comment & optimistically update the interface
  const { mutate: createComment, isPending: isCommenting } =
    api.comments.createConversationComment.useMutation({
      onMutate: async (newMessage) => {
        const input = queryKey;
        return { ...(await insertOptimisticComment(newMessage)), input };
      },
      onSuccess: (data, newComment, context) => {
        if (data.success) {
          if (conversation)
            reset({
              object_id: conversation.id,
              comment: "",
              quoteIds: null,
              senderId: null,
            });
          setEditorKey((prev) => prev + 1);
          if (props.onCommentPosted) {
            props.onCommentPosted(newComment.comment);
          }
          if (data.commentId && context?.optimisticCommentId) {
            // Stamp the server id onto the matching optimistic comment only.
            const { commentId } = data;
            const { optimisticCommentId } = context;
            updateCachedComments((data) =>
              data.map((c) =>
                c.id === optimisticCommentId ? { ...c, id: commentId } : c,
              ),
            );
          }
          void refreshConversationComments(newComment.object_id, context?.input);
        } else {
          removeOptimisticComment(context?.optimisticCommentId);
          showMutationToast({ success: false, message: data.message });
        }
      },
      onError: (error, _newComment, context) => {
        removeOptimisticComment(context?.optimisticCommentId);
        showMutationToast({ success: false, message: error.message });
      },
    });

  // Fetch a comment announced over the websocket and prepend it to the cache
  const { mutate: fetchComment } = api.comments.fetchConversationComment.useMutation({
    onSuccess: async (data) => {
      if (!data) return;
      await prependFetchedComment(data);
      if (data.lastReadAt && data.conversationId)
        await recordConversationRead(data.conversationId, data.lastReadAt);
    },
  });

  /**
   * Websockets event listener
   */
  useEffect(() => {
    if (conversation && pusher && !isPaused) {
      const ownUserId = userData?.userId;
      return subscribeConversation(
        pusher,
        conversation.id,
        JSON.stringify(queryKey),
        (data, ownsCacheUpdate) => {
          switch (data.message) {
            case "new":
              if (ownsCacheUpdate && data.fromId !== ownUserId && data.commentId) {
                fetchComment({
                  commentId: data.commentId,
                  conversationId: conversation.id,
                  markRead: isPageActive,
                });
              }
              break;
            case "reaction":
              if (
                ownsCacheUpdate &&
                data.fromId !== ownUserId &&
                data.commentId &&
                data.username &&
                data.emoji
              ) {
                void optimisticReactionUpdate(
                  data.commentId,
                  data.emoji,
                  data.username,
                );
              }
              break;
            case "typing":
              if (data.fromId && data.fromId !== ownUserId && data.username) {
                markTyping(data.fromId, data.username);
              }
              break;
          }
        },
      );
    }
  }, [isPaused, isPageActive, conversation, pusher, queryKey]);

  // Resuming after the subscription above is restored fetches what arrived meanwhile.
  useEffect(() => {
    if (isPageActive && isPaused) {
      setIsPaused(false);
      void refetch();
    }
  }, [isPageActive, isPaused, refetch]);

  // Reconnecting restores live events but does not replay messages missed offline.
  useEffect(() => {
    if (!pusher) return;
    const refreshConversation = () => {
      if (!isPaused) void refetch();
    };
    pusher.connection.bind("connected", refreshConversation);
    return () => {
      pusher.connection.unbind("connected", refreshConversation);
    };
  }, [pusher, refetch, isPaused]);

  /**
   * Submit comment. The handler is built on submit, not during render: the compiler
   * cannot memoize what a render-time `handleSubmit(...)` captures.
   */
  const handleSubmitComment = (event?: React.BaseSyntheticEvent) =>
    handleSubmit((data) =>
      createComment({
        ...data,
        ...(senderUser?.userId ? { senderId: senderUser.userId } : {}),
      }),
    )(event);

  /**
   * Invalidate comments & allow refetches again
   */
  const invalidateComments = async () => {
    // Clear search when refreshing comments manually
    setSearchQuery("");
    searchForm.reset({ searchTerm: "" });
    await utils.comments.getConversationComments.invalidate();
  };

  const allComments = comments?.pages.flatMap((page) => page.data);

  return {
    userData,
    isNativeShell,
    comments,
    allComments,
    conversation,
    isPending,
    searchQuery,
    clearSearch,
    searchButtonElement,
    invalidateComments,
    deletedCommentIds,
    setLastElement,
    canComposeMessage,
    composeRestrictionMessage,
    canPostAsAI,
    userSearchMethods,
    senderUser,
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
  };
};

const Conversation: React.FC<ConversationProps> = (props) => {
  const {
    userData,
    isNativeShell,
    comments,
    allComments,
    conversation,
    isPending,
    searchQuery,
    clearSearch,
    searchButtonElement,
    invalidateComments,
    deletedCommentIds,
    setLastElement,
    canComposeMessage,
    composeRestrictionMessage,
    canPostAsAI,
    userSearchMethods,
    senderUser,
    quoteIds,
    toggleQuoteId,
    control,
    errors,
    editorKey,
    isCommenting,
    handleSubmitComment,
    reactConversationComment,
    handleConversationCommentDeleted,
    typingUsers,
  } = useConversation(props);

  return (
    <div key={`${props.refreshKey}-${senderUser?.userId}`}>
      {isPending && <ConversationSkeleton {...props} />}
      {!isPending && (
        <ContentBox
          title={props.title}
          subtitle={props.subtitle}
          defaultBackHref={props.defaultBackHref}
          initialBreak={props.initialBreak}
          topRightContent={
            <div className="flex items-center gap-1">
              {conversation && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Refresh messages"
                  title="Refresh messages"
                  onClick={() => void invalidateComments()}
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              )}
              {searchButtonElement}
              {props.topRightContent}
            </div>
          }
          onBack={props.onBack}
        >
          {searchQuery && (
            <div className="mb-4 flex items-center gap-2 rounded-md bg-popover p-2">
              <p className="text-sm">
                Showing messages containing: <strong>{searchQuery}</strong>
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearSearch}
                className="ml-auto"
              >
                Clear search
              </Button>
            </div>
          )}
          {!conversation && (
            <div className="text-center text-muted-foreground">
              {comments?.pages[0]?.restrictionMessage ?? "Conversation not found"}
            </div>
          )}
          {conversation &&
            !conversation.isLocked &&
            userData &&
            !canComposeMessage &&
            composeRestrictionMessage && (
              <p className="mb-2 text-center text-muted-foreground text-sm">
                {composeRestrictionMessage}
              </p>
            )}
          {conversation && !conversation.isLocked && canComposeMessage && (
            <div className="relative mb-2">
              {canPostAsAI && (
                <div className="mb-3">
                  <AiSenderSelect methods={userSearchMethods} />
                </div>
              )}
              {quoteIds &&
                quoteIds.length > 0 &&
                quoteIds.map((quoteId) => {
                  const quote = allComments?.find((c) => c.id === quoteId);
                  if (!quote) return null;
                  return (
                    <Quote
                      key={quoteId}
                      author={quote.username || "Unknown"}
                      date={format(quote.createdAt, "MM/dd/yyyy")}
                      onRemove={() => toggleQuoteId(quoteId)}
                    >
                      {stripBlockquotes(quote.content)}
                    </Quote>
                  );
                })}
              <div className="relative">
                {isNativeShell !== undefined && (
                  <RichInput
                    id="comment"
                    autoFocus={isNativeShell === false}
                    refreshKey={editorKey}
                    height="120"
                    disabled={isCommenting}
                    placeholder="Write comment..."
                    control={control}
                    error={errors.comment?.message}
                    onSubmit={handleSubmitComment}
                    // Support replies tend to run over several paragraphs.
                    submitOnEnter={
                      props.supportTicketCreatedByUserId ? "never" : "desktop"
                    }
                    enableMentions={true}
                    allowClipboardPaste={true}
                    chatPaste={true}
                  />
                )}
                <div className="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 transform flex-row-reverse">
                  {isCommenting && <Loader />}
                </div>
              </div>
              {/* Reserve the line's height even when nobody is typing, so the indicator
                  appearing and disappearing in a busy chat does not shift the messages below. */}
              {conversation?.isPublic && (
                <div className="mt-1 min-h-4 text-muted-foreground text-xs italic">
                  {typingUsers.size > 0 &&
                    (() => {
                      const names = Array.from(typingUsers.values()).map(
                        (u) => u.username,
                      );
                      if (names.length === 1) {
                        return `${names[0]} is typing...`;
                      } else if (names.length === 2) {
                        return `${names[0]} and ${names[1]} are typing...`;
                      } else {
                        return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more are typing...`;
                      }
                    })()}
                </div>
              )}
            </div>
          )}
          <ConversationComments
            pages={comments?.pages}
            conversationId={conversation?.id}
            deletedCommentIds={deletedCommentIds}
            quoteIds={quoteIds}
            username={userData?.username}
            tavernStyling={props.tavernStyling}
            setLastElement={setLastElement}
            onReact={reactConversationComment}
            onToggleQuote={toggleQuoteId}
            onDeleted={handleConversationCommentDeleted}
            canInteract={canComposeMessage}
          />
        </ContentBox>
      )}
    </div>
  );
};

export default Conversation;
