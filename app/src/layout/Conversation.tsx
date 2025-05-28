import React, { useEffect, useState } from "react";
import { nanoid } from "nanoid";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { parseHtml } from "@/utils/parse";
import { CommentOnConversation } from "@/layout/Comment";
import ContentBox from "@/layout/ContentBox";
import RichInput from "@/layout/RichInput";
import Loader from "@/layout/Loader";
import { Button } from "@/components/ui/button";
import { RefreshCw, Search, X } from "lucide-react";
import { useUserData } from "@/utils/UserContext";
import { api, useGlobalOnMutateProtect } from "@/app/_trpc/client";
import { secondsFromNow } from "@/utils/time";
import { showMutationToast } from "@/libs/toast";
import { Check } from "lucide-react";
import { mutateCommentSchema } from "@/validators/comments";
import { useInfinitePagination } from "@/libs/pagination";
import { CONVERSATION_QUIET_MINS } from "@/drizzle/constants";
import { Skeleton } from "@/components/ui/skeleton";
import { useWatch } from "react-hook-form";
import { format } from "date-fns";
import { getNewReactions, processMentions } from "@/utils/chat";
import { Quote } from "@/components/ui/quote";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Form, FormControl, FormField, FormItem } from "@/components/ui/form";
import { z } from "zod";
import type { MutateCommentSchema } from "@/validators/comments";
import type { ArrayElement } from "@/utils/typeutils";

interface ConversationProps {
  convo_title?: string;
  convo_id?: string;
  back_href?: string;
  refreshKey: number;
  title: string;
  subtitle: string;
  initialBreak?: boolean;
  topRightContent?: React.ReactNode;
  onBack?: () => void;
}

export const ConversationSkeleton: React.FC<ConversationProps> = (props) => {
  return (
    <ContentBox
      title={props.title}
      subtitle={props.subtitle}
      back_href={props.back_href}
      initialBreak={props.initialBreak}
      topRightContent={props.topRightContent}
      onBack={props.onBack}
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-[100px] w-full items-center justify-center flex bg-popover">
          <Loader explanation="Loading conversation" />
        </Skeleton>
        {Array.from({ length: 10 }).map((_, i) => (
          <div className="flex flex-row gap-2" key={i}>
            <Skeleton className="h-[110px] lg:h-[150px] w-1/4 bg-popover" />
            <Skeleton className="h-[110px] lg:h-[150px] w-3/4 bg-popover" />
          </div>
        ))}
      </div>
    </ContentBox>
  );
};

const Conversation: React.FC<ConversationProps> = (props) => {
  const onMutateCheck = useGlobalOnMutateProtect();
  const { data: userData, pusher } = useUserData();
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);
  const [editorKey, setEditorKey] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [quietTime, setQuietTime] = useState<Date>(
    secondsFromNow(CONVERSATION_QUIET_MINS * 60),
  );
  const silence = new Date() > quietTime;

  const queryKey = {
    convo_id: props.convo_id,
    convo_title: props.convo_title,
    limit: 10,
    refreshKey: props.refreshKey,
    searchQuery: searchQuery,
  };

  // Fetch comments
  const {
    data: comments,
    fetchNextPage,
    hasNextPage,
    isPending,
    refetch,
  } = api.comments.getConversationComments.useInfiniteQuery(queryKey, {
    enabled: props.convo_id !== undefined || props.convo_title !== undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    placeholderData: (previousData) => previousData,
  });
  const allComments = comments?.pages.map((page) => page.data).flat();
  const conversation = comments?.pages[0]?.convo;
  type ReturnedComment = ArrayElement<typeof allComments>;

  // Search functionality
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);

  // Create a search form schema
  const searchFormSchema = z.object({
    searchTerm: z.string(),
  });

  // Create form for search
  const searchForm = useForm<z.infer<typeof searchFormSchema>>({
    resolver: zodResolver(searchFormSchema),
    defaultValues: { searchTerm: "" },
  });

  const onSearchSubmit = (values: z.infer<typeof searchFormSchema>) => {
    setSearchQuery(values.searchTerm);
    void refetch();
  };

  const clearSearch = () => {
    setSearchQuery("");
    searchForm.reset({ searchTerm: "" });
    void refetch();
  };

  // Create search button component
  const SearchButton = () => (
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
            <div className="text-sm font-medium">Search in conversation</div>
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
          <div className="text-xs text-muted-foreground mt-1">
            Showing results for: <span className="font-medium">{searchQuery}</span>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );

  /**
   * Perform an optimistic update of the conversation reactions
   * @param newMessage
   * @returns
   */
  const optimisticReactionUpdate = async (
    commentId: string,
    emoji: string,
    username: string,
  ) => {
    let old = utils.comments.getConversationComments.getInfiniteData();
    await utils.comments.getConversationComments.cancel();
    utils.comments.getConversationComments.setInfiniteData(queryKey, (oldQueryData) => {
      if (!oldQueryData) return undefined;

      // Find the comment looking at all pages in the oldQueryData
      const comment = oldQueryData.pages
        .flatMap((page) => page.data)
        .find((c) => c.id === commentId);
      if (!comment) return oldQueryData;

      // Update the reactions
      const newReactions = getNewReactions(comment.reactions, emoji, username);

      old = {
        pageParams: oldQueryData.pageParams,
        pages: oldQueryData.pages.map((page) => {
          return {
            convo: page.convo,
            data: page.data.map((c) => {
              if (c.id === commentId) {
                return { ...c, reactions: newReactions };
              }
              return c;
            }),
            nextCursor: page.nextCursor,
          };
        }),
      };
      return old;
    });
    return { old };
  };

  // Mutation for reactions
  const { mutate: reactConversationComment } =
    api.comments.reactConversationComment.useMutation({
      onMutate: async (data) => {
        onMutateCheck();
        if (!userData) return;
        return await optimisticReactionUpdate(
          data.commentId,
          data.emoji,
          userData.username,
        );
      },
    });

  // tRPC utils
  const utils = api.useUtils();

  // infinite pagination
  useInfinitePagination({ fetchNextPage, hasNextPage, lastElement });

  // Handle for submission of comment
  const {
    handleSubmit,
    setValue,
    reset,
    control,
    formState: { errors },
  } = useForm<MutateCommentSchema>({
    resolver: zodResolver(mutateCommentSchema),
  });

  // Current quote ID
  const quoteIds = useWatch({
    control,
    name: "quoteIds",
    defaultValue: [],
  });

  // Set the object_id to the conversation id
  useEffect(() => {
    if (conversation) {
      setValue("object_id", conversation.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation?.id]);

  /**
   * Perform an optimistic update to the conversation comments, i.e. no API calls,
   * just directly insert message into the comments array.
   * @param newMessage
   * @returns
   */
  const optimisticConversationUpdate = async (
    newMessage: MutateCommentSchema | ReturnedComment,
  ) => {
    // We are active
    setQuietTime(secondsFromNow(CONVERSATION_QUIET_MINS * 60));
    // Bookkeeping of old and new
    let old = utils.comments.getConversationComments.getInfiniteData();
    // Get previous data
    if (!userData || !conversation) return { old };

    // If we're in search mode and this is a new message, don't show it unless it matches the search
    if (searchQuery && "comment" in newMessage) {
      if (!newMessage.comment.toLowerCase().includes(searchQuery.toLowerCase())) {
        return { old };
      }
    }

    // Optimistic update
    await utils.comments.getConversationComments.cancel();
    utils.comments.getConversationComments.setInfiniteData(queryKey, (oldQueryData) => {
      if (!oldQueryData) return undefined;
      const quoteText =
        quoteIds
          ?.map((id) => {
            const quote = allComments?.find((c) => c.id === id);
            return quote
              ? `<blockquote author="${quote.username || "Unknown"}" date="${format(quote.createdAt, "MM/dd/yyyy")}">${quote.content}</blockquote>`
              : "";
          })
          .join("") || "";

      // Process content for mentions and formatting if this is a new comment
      let processedContent = "";
      if (!("id" in newMessage)) {
        const content = quoteText + newMessage.comment;
        const { processedContent: processed } = processMentions(content);
        processedContent = processed;
      }

      const next =
        "id" in newMessage
          ? newMessage
          : {
              id: nanoid(),
              createdAt: new Date(),
              conversationId: conversation.id,
              content: processedContent,
              reactions: {},
              isPinned: 0,
              isReported: false,
              villageName: userData.village?.name ?? null,
              villageHexColor: userData.village?.hexColor ?? null,
              villageKageId: userData.village?.kageId ?? null,
              userId: userData.userId,
              username: userData.username,
              avatar: userData.avatar,
              rank: userData.rank,
              isOutlaw: userData.isOutlaw,
              level: userData.level,
              role: userData.role,
              customTitle: userData.customTitle,
              federalStatus: userData.federalStatus,
              nRecruited: userData.nRecruited,
              tavernMessages: userData.tavernMessages,
            };
      // Bookkeeping of old and new
      old = {
        pageParams: oldQueryData.pageParams,
        pages: oldQueryData.pages.map((page, i) => {
          if (i === 0) {
            return {
              convo: page.convo,
              data: [next, ...page.data],
              nextCursor: page.nextCursor,
            };
          }
          return page;
        }),
      };
      return old;
    });
    return { old };
  };

  // Create comment & optimistically update the interface
  const { mutate: createComment, isPending: isCommenting } =
    api.comments.createConversationComment.useMutation({
      onMutate: async (newMessage) => {
        onMutateCheck();
        return await optimisticConversationUpdate(newMessage);
      },
      onSuccess: (data, _newComment, context) => {
        if (conversation) reset({ object_id: conversation.id, comment: "" });
        setEditorKey((prev) => prev + 1);
        if (data.commentId) {
          // Update the ID of the latest message without a current ID
          if (!context?.old) return;
          const newComment = { ...context.old };
          if (newComment?.pages?.[0]?.data?.[0]) {
            newComment.pages[0].data[0].id = data.commentId;
            utils.comments.getConversationComments.setInfiniteData(
              queryKey,
              newComment,
            );
          }
        }
      },
      onError: (error, _newComment, context) => {
        utils.comments.getConversationComments.setInfiniteData(queryKey, context?.old);
        showMutationToast({ success: false, message: error.message });
      },
    });

  // Create comment & optimistically update the interface
  const { mutate: fetchComment } = api.comments.fetchConversationComment.useMutation({
    onSuccess: async (data) => {
      if (data) await optimisticConversationUpdate(data);
    },
  });

  /**
   * Websockets event listener
   */
  useEffect(() => {
    if (conversation && pusher) {
      const channel = pusher.subscribe(conversation.id);
      channel.bind(
        "event",
        (data: {
          message: string;
          fromId?: string;
          commentId?: string;
          emoji?: string;
          username?: string;
        }) => {
          switch (data.message) {
            case "new":
              if (!silence && data?.fromId !== userData?.userId && data?.commentId) {
                fetchComment({ commentId: data.commentId });
              }
              break;
            case "reaction":
              if (
                data?.fromId !== userData?.userId &&
                data?.commentId &&
                data?.username &&
                data?.emoji
              ) {
                console.log("Reaction", data);
                void optimisticReactionUpdate(
                  data.commentId,
                  data.emoji,
                  data.username,
                );
              }
              break;
          }
        },
      );
      return () => {
        pusher.unsubscribe(conversation.id);
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [silence, conversation]);

  /**
   * Submit comment
   */
  const handleSubmitComment = handleSubmit((data) => {
    if (userData?.isSilenced || userData?.isMuted) {
      showMutationToast({
        success: false,
        message: "You are silenced or muted and cannot send a message.",
      });
      return;
    }
    createComment(data);
  });

  /**
   * Invalidate comments & allow refetches again
   */
  const invalidateComments = async () => {
    // Clear search when refreshing comments manually
    setSearchQuery("");
    searchForm.reset({ searchTerm: "" });
    await utils.comments.getConversationComments.invalidate();
  };

  const unique = new Set();

  return (
    <div key={props.refreshKey}>
      {isPending && <ConversationSkeleton {...props} />}
      {!isPending && (
        <ContentBox
          title={props.title}
          subtitle={props.subtitle}
          back_href={props.back_href}
          initialBreak={props.initialBreak}
          topRightContent={
            <div className="flex items-center gap-1">
              <SearchButton />
              {props.topRightContent}
            </div>
          }
          onBack={props.onBack}
        >
          {searchQuery && (
            <div className="mb-4 flex items-center gap-2 bg-popover p-2 rounded-md">
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
          {conversation &&
            !conversation.isLocked &&
            userData &&
            !userData.isBanned &&
            !userData.isSilenced && (
              <div className="relative mb-2">
                {quoteIds &&
                  quoteIds.length > 0 &&
                  quoteIds.map((quoteId) => {
                    const quote = allComments?.find((c) => c.id === quoteId);
                    return quote ? (
                      <Quote
                        key={quoteId}
                        author={quote.username || "Unknown"}
                        date={format(quote.createdAt, "MM/dd/yyyy")}
                        onRemove={() => {
                          setValue(
                            "quoteIds",
                            quoteIds.filter((id) => id !== quoteId),
                          );
                        }}
                      >
                        {quote.content}
                      </Quote>
                    ) : (
                      ""
                    );
                  })}
                <div className="relative">
                  <RichInput
                    id="comment"
                    refreshKey={editorKey}
                    height="120"
                    disabled={isCommenting}
                    placeholder="Write comment..."
                    control={control}
                    error={errors.comment?.message}
                    onSubmit={handleSubmitComment}
                    enableMentions={true}
                    allowClipboardPaste={true}
                  />
                  <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 flex flex-row-reverse">
                    {isCommenting && <Loader />}
                  </div>
                  <RefreshCw
                    className="h-8 w-8 absolute right-24 top-[50%] translate-y-[-50%]  z-20 text-gray-400 hover:text-gray-600 opacity-50 hover:cursor-pointer"
                    onClick={invalidateComments}
                  />
                </div>
              </div>
            )}
          {allComments
            ?.filter((c) => c.conversationId === conversation?.id)
            .filter((c) => {
              const duplicate = unique.has(c.id);
              unique.add(c.id);
              return !duplicate;
            })
            .map((comment, i) => {
              return (
                <div
                  key={comment.id}
                  ref={i === allComments.length - 1 ? setLastElement : null}
                >
                  <CommentOnConversation
                    user={comment}
                    hover_effect={false}
                    comment={comment}
                    quoteIds={quoteIds}
                    color={
                      comment.content.includes(`quote author="${userData?.username}`) ||
                      comment.content.includes(`@${userData?.username}`)
                        ? "poppopover"
                        : undefined
                    }
                    toggleReaction={(emoji) =>
                      reactConversationComment({ commentId: comment.id, emoji })
                    }
                    setQuoteId={(quoteId) => {
                      if (quoteIds?.includes(quoteId)) {
                        setValue(
                          "quoteIds",
                          quoteIds.filter((id) => id !== quoteId),
                        );
                      } else if (quoteIds && quoteIds.length > 0) {
                        setValue("quoteIds", [...quoteIds, quoteId]);
                      } else {
                        setValue("quoteIds", [quoteId]);
                      }
                    }}
                  >
                    {parseHtml(comment.content)}
                  </CommentOnConversation>
                </div>
              );
            })}
          {silence && (
            <div className="absolute bottom-0 left-0 right-0 top-0 z-20 m-auto flex flex-col justify-start bg-black bg-opacity-80">
              <div className="text-center text-white pt-10">
                <p className="p-5 text-5xl">Are you still there?</p>
                <Button
                  size="xl"
                  onClick={async () => {
                    setQuietTime(secondsFromNow(CONVERSATION_QUIET_MINS * 60));
                    await invalidateComments();
                  }}
                >
                  <Check className="w-8 h-8 mr-3" />
                  Yep
                </Button>
              </div>
            </div>
          )}
        </ContentBox>
      )}
    </div>
  );
};

export default Conversation;
