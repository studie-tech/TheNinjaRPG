import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";

/**
 * Who else is typing in a conversation, and announcing the player's own typing in
 * public ones. Live "typing" events report other players through `markTyping`.
 */
export const useTypingIndicators = (
  conversation: { id: string; isPublic: boolean } | null | undefined,
  commentValue: string | undefined,
  userId: string | undefined,
) => {
  // Typing indicator state
  type TypingUser = { username: string; timestamp: number };
  const [typingUsers, setTypingUsers] = useState<Map<string, TypingUser>>(
    () => new Map(),
  );
  const lastTypingSentRef = useRef<number>(0);

  // Mutation for typing indicator
  const { mutate: sendTypingIndicator } =
    api.comments.sendTypingIndicator.useMutation();

  // Send typing indicator when user types (debounced)
  useEffect(() => {
    const DEBOUNCE_MS = 2000;
    if (
      userId &&
      conversation?.isPublic &&
      commentValue &&
      commentValue.length > 0 &&
      Date.now() - lastTypingSentRef.current > DEBOUNCE_MS
    ) {
      lastTypingSentRef.current = Date.now();
      sendTypingIndicator({ conversationId: conversation.id });
    }
  }, [
    commentValue,
    conversation?.isPublic,
    conversation?.id,
    sendTypingIndicator,
    userId,
  ]);

  // Cleanup stale typing indicators every second
  useEffect(() => {
    const TYPING_TIMEOUT_MS = 3000;
    const interval = setInterval(() => {
      setTypingUsers((prev) => {
        const now = Date.now();
        const next = new Map(prev);
        let changed = false;
        for (const [userId, data] of next) {
          if (now - data.timestamp > TYPING_TIMEOUT_MS) {
            next.delete(userId);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const markTyping = useCallback((fromId: string, username: string) => {
    setTypingUsers((prev) => {
      const next = new Map(prev);
      next.set(fromId, {
        username: username,
        timestamp: Date.now(),
      });
      return next;
    });
  }, []);

  return { typingUsers, markTyping };
};
