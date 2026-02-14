"use client";

import { type UIMessage, useChat } from "@ai-sdk/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { DefaultChatTransport, getToolName, isTextUIPart, isToolUIPart } from "ai";
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
import AvatarImage from "@/layout/Avatar";
import RichInput from "@/layout/RichInput";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import { useUserData } from "@/utils/UserContext";
import { type ChatMessageSchema, chatMessageSchema } from "@/validators/chat";

interface ToolCall<NAME extends string, ARGS> {
  toolCallId: string;
  toolName: NAME;
  args: ARGS;
}

export interface ChatBoxProps {
  className?: string;
  position?: "fixed" | "relative";
  onClose?: () => void;
  showCloseButton?: boolean;
  showHeader?: boolean;
  showFeedback?: boolean;
  autoFocus?: boolean;
  aiProps: {
    apiEndpoint: string;
    systemMessage?: string;
  };
  onToolCall: (toolCall: ToolCall<string, unknown>) => void;
}

const getMessageText = (message: UIMessage): string => {
  const textParts = message.parts.filter(isTextUIPart);
  if (textParts.length > 0) {
    return textParts.map((p) => p.text).join("");
  }

  const toolParts = message.parts.filter(isToolUIPart);
  if (toolParts.length > 0) {
    return toolParts.map((tool) => `Calling ${getToolName(tool)}`).join(", ");
  }

  return "";
};

const ChatBox: React.FC<ChatBoxProps> = ({
  className,
  position = "fixed",
  onClose,
  showCloseButton = true,
  showHeader = true,
  showFeedback = true,
  autoFocus = true,
  aiProps,
  onToolCall,
}) => {
  // State
  const { data: userData } = useUserData();
  const messagesEndRef = useRef<null | HTMLDivElement>(null);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);

  const initialMessages: UIMessage[] = [
    ...(aiProps.systemMessage
      ? [
          {
            id: "system",
            role: "system" as const,
            parts: [{ type: "text" as const, text: aiProps.systemMessage }],
          },
        ]
      : []),
    {
      id: "initial",
      role: "assistant" as const,
      parts: [{ type: "text" as const, text: "Hello! How can I help you today?" }],
    },
  ];

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: aiProps.apiEndpoint }),
    messages: initialMessages,
    onToolCall: ({ toolCall }) => {
      onToolCall({
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        args: toolCall.input,
      });
    },
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
  const handleFeedback = (sentiment: "POSITIVE" | "NEGATIVE" | "NEUTRAL") => {
    if (feedbackSubmitted) return;

    submitFeedback({
      apiRoute: aiProps.apiEndpoint,
      chatHistory: messages,
      sentiment,
    });
  };

  // Scroll to bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };
  useEffect(() => {
    scrollToBottom();
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

  // Calculate max height for messages container
  const messagesContainerClass =
    showFeedback && messages.length > 2
      ? "min-h-[200px] max-h-[500px]"
      : "min-h-96 max-h-[700px]";

  // Render
  return (
    <div
      className={cn(
        position === "fixed"
          ? "fixed right-4 bottom-28 z-50 min-w-96 max-w-96 shadow-lg"
          : "w-full",
        "overflow-hidden rounded-md bg-popover",
        className,
      )}
    >
      <div className="flex h-full flex-col">
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
        <div className={cn("flex-1 overflow-y-auto bg-card", messagesContainerClass)}>
          {messages
            .filter((message) => message.role !== "system")
            .map((message, i) => {
              const content = getMessageText(message);
              const isUser = message.role === "user";

              return (
                <div
                  className={cn(
                    "flex flex-row items-start space-x-2 p-4",
                    i % 2 === 0 ? "bg-card" : "bg-popover",
                  )}
                  key={message.id}
                >
                  <div className="shrink-0">
                    {isUser ? (
                      <AvatarImage
                        href={userData.avatar}
                        alt={userData.username}
                        className="h-10 w-10 border-0"
                        size={100}
                        hover_effect={true}
                        priority
                      />
                    ) : (
                      <BrainCircuit className="h-10 w-10" />
                    )}
                  </div>
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-sm">
                        {isUser ? userData.username : "Seichi AI"}
                      </div>
                      <div className="text-xs">{new Date().toLocaleTimeString()}</div>
                    </div>
                    <p className="text-sm">{content}</p>
                  </div>
                </div>
              );
            })}
          {isLoading && (
            <div
              className={cn(
                "flex flex-row items-start space-x-2 p-4",
                messages.length % 2 === 0 ? "bg-card" : "bg-popover",
              )}
            >
              <div className="shrink-0">
                <BrainCircuit className="h-10 w-10" />
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex items-center justify-between">
                  <div className="font-medium text-sm">Seichi AI</div>
                  <div className="text-xs">{new Date().toLocaleTimeString()}</div>
                </div>
                <div className="flex flex-row items-center gap-2">
                  <p className="text-sm">Thinking</p>
                  <div className="h-1 w-1 animate-bounce rounded-full bg-black [animation-delay:-0.3s] dark:bg-white"></div>
                  <div className="h-1 w-1 animate-bounce rounded-full bg-black [animation-delay:-0.15s] dark:bg-white"></div>
                  <div className="h-1 w-1 animate-bounce rounded-full bg-black dark:bg-white"></div>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
        <div className="border-t p-4">
          <Form {...form}>
            <FormField
              control={form.control}
              name="message"
              render={() => (
                <FormItem>
                  <FormControl>
                    <RichInput
                      id="message"
                      height="120"
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

          {/* Feedback section */}
          {showFeedback && messages.length > 2 && (
            <div className="mt-2 flex flex-col items-center">
              <p className="mb-1 text-muted-foreground text-xs">
                {feedbackSubmitted
                  ? "Thank you for your feedback!"
                  : "How was your chat experience?"}
              </p>
              {!feedbackSubmitted && (
                <div className="flex space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleFeedback("POSITIVE")}
                    disabled={isSubmittingFeedback}
                    className="flex h-8 items-center gap-1 px-2 py-1"
                  >
                    <ThumbsUp className="h-3 w-3" />
                    <span className="text-xs">Good</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleFeedback("NEUTRAL")}
                    disabled={isSubmittingFeedback}
                    className="flex h-8 items-center gap-1 px-2 py-1"
                  >
                    <Meh className="h-3 w-3" />
                    <span className="text-xs">Neutral</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleFeedback("NEGATIVE")}
                    disabled={isSubmittingFeedback}
                    className="flex h-8 items-center gap-1 px-2 py-1"
                  >
                    <ThumbsDown className="h-3 w-3" />
                    <span className="text-xs">Poor</span>
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatBox;
