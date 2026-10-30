"use client";

import { type UIMessage, useChat } from "@ai-sdk/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { convertToModelMessages, DefaultChatTransport, isTextUIPart } from "ai";
import { BrainCircuit, Meh, RotateCcw, ThumbsDown, ThumbsUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import {
  safeLocalStorageGetItem,
  safeLocalStorageRemoveItem,
  safeLocalStorageSetItem,
} from "@/hooks/localstorage";
import Link from "@/layout/Link";
import RichInput from "@/layout/RichInput";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import { useUserData } from "@/utils/UserContext";
import { type ChatMessageSchema, chatMessageSchema } from "@/validators/chat";

export interface ChatBoxProps {
  className?: string;
  autoFocus?: boolean;
  /** Switches the chat panel to the tavern from the help line. */
  onAskTavern?: () => void;
}

const getMessageText = (message: UIMessage): string =>
  message.parts
    .filter(isTextUIPart)
    .map((part) => part.text)
    .join("");

const ChatBox: React.FC<ChatBoxProps> = ({
  className,
  autoFocus = true,
  onAskTavern,
}) => {
  // State
  const { data: userData } = useUserData();
  const messagesRef = useRef<null | HTMLDivElement>(null);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  // The conversation is kept per player in this browser until they clear it.
  const storageKey = userData ? `${AI_CHAT_STORAGE_PREFIX}${userData.userId}` : null;
  const [savedMessages] = useState(() => loadSavedMessages(storageKey));

  const { messages, sendMessage, setMessages, status } = useChat({
    id: storageKey ?? undefined,
    transport: new DefaultChatTransport({ api: "/api/chat/support" }),
    messages: savedMessages ?? INITIAL_MESSAGES,
    onError: (error) => {
      const message = error?.message || "Error sending message. Not allowed?";
      showMutationToast({ success: false, message: message });
    },
  });

  const isLoading = status === "streaming" || status === "submitted";

  // Save finished exchanges; a streaming answer is saved once it completes.
  useEffect(() => {
    if (!storageKey || status !== "ready") return;
    if (messages.some((message) => message.role === "user")) {
      safeLocalStorageSetItem(
        storageKey,
        JSON.stringify(messages.slice(-AI_CHAT_MAX_SAVED_MESSAGES)),
      );
    }
  }, [messages, status, storageKey]);

  const clearConversation = () => {
    if (storageKey) safeLocalStorageRemoveItem(storageKey);
    setMessages(INITIAL_MESSAGES);
    setFeedbackSubmitted(false);
  };

  // Feedback mutation
  const { mutate: submitFeedback, isPending: isSubmittingFeedback } =
    api.misc.reviewSupportWithAI.useMutation({
      onSuccess: (data) => {
        setFeedbackSubmitted(true);
        showMutationToast(data);
      },
    });

  // Handle feedback submission
  const handleFeedback = async (sentiment: "POSITIVE" | "NEGATIVE" | "NEUTRAL") => {
    if (feedbackSubmitted) return;

    try {
      // Feedback stores model messages, while useChat keeps UI messages with parts.
      const chatHistory = await convertToModelMessages(messages, {
        ignoreIncompleteToolCalls: true,
      });
      submitFeedback({ apiRoute: "/api/chat/support", chatHistory, sentiment });
    } catch (error) {
      showMutationToast({
        success: false,
        message: error instanceof Error ? error.message : "Could not submit feedback",
      });
    }
  };

  // Keep the newest message in view. Only the message list scrolls: scrollIntoView
  // would also scroll clipped ancestors and hide the start of the conversation.
  useEffect(() => {
    const list = messagesRef.current;
    if (list && messages.length > 1) {
      list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
    }
  }, [messages]);

  // Input form
  const form = useForm<ChatMessageSchema>({
    resolver: zodResolver(chatMessageSchema),
    defaultValues: { message: "" },
  });

  // Submissions handle
  const handleSubmit = form.handleSubmit((data) => {
    void sendMessage({ text: data.message });
    form.setValue("message", "");
  });

  // Loader
  if (!userData) return <p>Must be logged in to use chat</p>;

  const visibleMessages = messages.filter((message) => message.role !== "system");
  const hasConversation = visibleMessages.some((message) => message.role === "user");
  const hasAnswer = hasConversation && visibleMessages.at(-1)?.role === "assistant";
  const starterQuestions = [
    `What should I do next at level ${userData.level}?`,
    "How do I get stronger?",
    "How do I earn more ryo?",
  ];

  // Render
  return (
    <div className={cn("flex w-full flex-col overflow-hidden bg-popover", className)}>
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-1.5">
        <p className="flex items-center gap-1.5 font-semibold text-sm">
          <BrainCircuit className="h-4 w-4 text-muted-foreground" aria-hidden />
          Seichi AI
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-muted-foreground"
          disabled={!hasConversation || isLoading}
          onClick={clearConversation}
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Clear
        </Button>
      </div>
      <div
        ref={messagesRef}
        role="log"
        aria-live="polite"
        aria-label="Conversation with Seichi AI"
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-3"
      >
        {visibleMessages.map((message) => {
          const isUser = message.role === "user";
          return (
            <div
              key={message.id}
              className={cn("flex items-end gap-2", isUser && "flex-row-reverse")}
            >
              {!isUser && <AssistantMark />}
              {/* Defer live announcements until the streamed answer is complete. */}
              <p
                aria-busy={
                  status === "streaming" &&
                  message.role === "assistant" &&
                  message.id === visibleMessages.at(-1)?.id
                }
                className={cn(
                  "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm",
                  isUser
                    ? "rounded-br-sm bg-primary text-primary-foreground"
                    : "rounded-bl-sm bg-muted text-foreground",
                )}
              >
                <span className="sr-only">{isUser ? "You: " : "Seichi AI: "}</span>
                {getMessageText(message)}
              </p>
            </div>
          );
        })}
        {!hasConversation && !isLoading && (
          <div className="flex flex-wrap gap-2 pl-9">
            {starterQuestions.map((question) => (
              <Button
                key={question}
                type="button"
                variant="outline"
                size="sm"
                className="h-auto whitespace-normal rounded-full px-3 py-1.5 text-left text-sm"
                onClick={() => void sendMessage({ text: question })}
              >
                {question}
              </Button>
            ))}
          </div>
        )}
        {isLoading && (
          <div className="flex items-end gap-2">
            <AssistantMark />
            <div
              className="flex h-9 items-center gap-1 rounded-2xl rounded-bl-sm bg-muted px-3"
              role="status"
            >
              <span className="sr-only">Seichi AI is writing an answer</span>
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s] motion-reduce:animate-none" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s] motion-reduce:animate-none" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current motion-reduce:animate-none" />
            </div>
          </div>
        )}
      </div>
      <div className="border-t p-2">
        <Form {...form}>
          <FormField
            control={form.control}
            name="message"
            render={() => (
              <FormItem>
                <FormControl>
                  <RichInput
                    plainText
                    compact
                    id="message"
                    placeholder="Ask about the game…"
                    height="40"
                    rows={1}
                    control={form.control}
                    disabled={isLoading}
                    onSubmit={handleSubmit}
                    error={form.formState.errors.message?.message}
                    autoFocus={autoFocus}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </Form>

        {hasAnswer && !isLoading && (
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            {feedbackSubmitted ? (
              <p className="text-muted-foreground text-sm">Thanks for the feedback.</p>
            ) : (
              <>
                <p className="text-muted-foreground text-sm">Was this helpful?</p>
                {FEEDBACK_OPTIONS.map(({ sentiment, label, icon: Icon }) => (
                  <Button
                    key={sentiment}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleFeedback(sentiment)}
                    disabled={isSubmittingFeedback}
                    className="h-8 gap-1 px-2"
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                    <span className="text-sm">{label}</span>
                  </Button>
                ))}
              </>
            )}
          </div>
        )}
        <p className="mt-1.5 text-center text-muted-foreground text-xs">
          Not what you needed?{" "}
          {onAskTavern ? (
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={onAskTavern}
            >
              Ask in the Tavern
            </button>
          ) : (
            <Link href="/tavern" className="text-primary hover:underline">
              Ask in the Tavern
            </Link>
          )}
          {" · "}
          <Link href="/support" className="text-primary hover:underline">
            Support ticket
          </Link>
          {" · "}
          <Link href="/guide" className="text-primary hover:underline">
            Player guide
          </Link>
        </p>
      </div>
    </div>
  );
};

/** Small avatar marking assistant messages. */
const AssistantMark: React.FC = () => (
  <span
    aria-hidden
    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
  >
    <BrainCircuit className="h-4 w-4" />
  </span>
);

const FEEDBACK_OPTIONS = [
  { sentiment: "POSITIVE", label: "Yes", icon: ThumbsUp },
  { sentiment: "NEUTRAL", label: "Partly", icon: Meh },
  { sentiment: "NEGATIVE", label: "No", icon: ThumbsDown },
] as const;

const INITIAL_MESSAGES: UIMessage[] = [
  {
    id: "initial",
    role: "assistant",
    parts: [{ type: "text", text: "Hello! How can I help you today?" }],
  },
];

const AI_CHAT_STORAGE_PREFIX = "seichiAiChat:";
const AI_CHAT_MAX_SAVED_MESSAGES = 50;

/** Restore a saved conversation, ignoring anything that is not a list of text messages. */
const loadSavedMessages = (key: string | null): UIMessage[] | null => {
  if (!key) return null;
  try {
    const parsed: unknown = JSON.parse(safeLocalStorageGetItem(key) ?? "null");
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every(
        (message) =>
          typeof message?.id === "string" &&
          ["user", "assistant"].includes(message?.role) &&
          Array.isArray(message?.parts),
      )
    ) {
      return parsed as UIMessage[];
    }
  } catch {
    // Unreadable data starts a fresh conversation.
  }
  return null;
};

export default ChatBox;
