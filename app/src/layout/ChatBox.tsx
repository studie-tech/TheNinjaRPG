"use client";

import { type UIMessage, useChat } from "@ai-sdk/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { convertToModelMessages, DefaultChatTransport, isTextUIPart } from "ai";
import { BrainCircuit, Meh, ThumbsDown, ThumbsUp, X } from "lucide-react";
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
import RichInput from "@/layout/RichInput";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import { useUserData } from "@/utils/UserContext";
import { type ChatMessageSchema, chatMessageSchema } from "@/validators/chat";

export interface ChatBoxProps {
  className?: string;
  position?: "fixed" | "relative";
  onClose?: () => void;
  showCloseButton?: boolean;
  showHeader?: boolean;
  showFeedback?: boolean;
  autoFocus?: boolean;
}

const getMessageText = (message: UIMessage): string =>
  message.parts
    .filter(isTextUIPart)
    .map((part) => part.text)
    .join("");

const ChatBox: React.FC<ChatBoxProps> = ({
  className,
  position = "fixed",
  onClose,
  showCloseButton = true,
  showHeader = true,
  showFeedback = true,
  autoFocus = true,
}) => {
  // State
  const { data: userData } = useUserData();
  const messagesRef = useRef<null | HTMLDivElement>(null);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);

  const initialMessages: UIMessage[] = [
    {
      id: "initial",
      role: "assistant" as const,
      parts: [{ type: "text" as const, text: "Hello! How can I help you today?" }],
    },
  ];

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat/support" }),
    messages: initialMessages,
    onError: (error) => {
      const message = error?.message || "Error sending message. Not allowed?";
      showMutationToast({ success: false, message: message });
    },
  });

  const isLoading = status === "streaming" || status === "submitted";

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
    <div
      className={cn(
        position === "fixed"
          ? "fixed right-4 bottom-28 z-50 h-[32rem] min-w-96 max-w-96 shadow-lg"
          : "w-full",
        "flex flex-col overflow-hidden rounded-md bg-popover",
        className,
      )}
    >
      {showHeader && (
        <header className="flex items-center justify-between border-b px-4 py-2">
          <h4 className="font-medium text-lg">Chat</h4>
          {showCloseButton && (
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
              <span className="sr-only">Close chat window</span>
            </Button>
          )}
        </header>
      )}
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
              <p
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

        {showFeedback && hasAnswer && !isLoading && (
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

export default ChatBox;
