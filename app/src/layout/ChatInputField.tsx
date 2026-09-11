"use client";

import { Bot } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import ChatBox from "@/layout/ChatBox";
import { cn } from "@/libs/shadui";

interface ToolCall<NAME extends string, ARGS> {
  toolCallId: string;
  toolName: NAME;
  args: ARGS;
}

interface ChatInputFieldProps {
  inputProps: React.InputHTMLAttributes<HTMLInputElement>;
  aiProps: {
    apiEndpoint: string;
    systemMessage?: string;
  };
  onToolCall: (toolCall: ToolCall<string, unknown>) => void;
  disabled?: boolean;
}

const ChatInputField: React.FC<ChatInputFieldProps> = ({
  aiProps,
  onToolCall,
  disabled,
}) => {
  // State
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (disabled) setIsOpen(false);
  }, [disabled]);

  // Render
  return (
    <>
      <div className="flex w-full flex-row justify-end pl-3">
        <Button
          className={!isOpen ? "bg-green-600" : ""}
          type="submit"
          disabled={disabled}
          aria-busy={disabled}
          onClick={() => setIsOpen((prev) => !prev)}
        >
          <Bot className={cn("text-white", isOpen ? "animate-spin" : "")} size={22} />
        </Button>
      </div>
      {isOpen && (
        <ChatBox
          aiProps={aiProps}
          onToolCall={onToolCall}
          onClose={() => setIsOpen(false)}
          position="fixed"
        />
      )}
    </>
  );
};

export default ChatInputField;
