import { auth } from "@clerk/nextjs/server";
import type { ModelMessage, UIMessage } from "ai";
import { convertToModelMessages } from "ai";
import { fetchUser } from "@/routers/profile";
import { drizzleDB } from "@/server/db";
import { canChangeContent } from "@/utils/permissions";

export const checkContentAiAuth = async () => {
  // Auth guard
  const { userId } = await auth();
  if (!userId) return "Not authenticated";

  // User guard
  const user = await fetchUser(drizzleDB, userId);
  if (!canChangeContent(user.role)) {
    throw new Error("You are not allowed to change content");
  }
};

/**
 * Turn the UIMessages a useChat client posts into streamText inputs.
 *
 * AI SDK 7 no longer converts UIMessages implicitly and rejects system-role
 * entries inside `messages`, so the page context ChatBox sends as a hidden
 * system message is folded into the system prompt here instead. Incomplete
 * tool calls are dropped — the editor chats run their tools client-side and
 * never report results back.
 */
export const prepareChatPrompt = async (
  uiMessages: UIMessage[],
  baseSystem: string,
): Promise<{ system: string; messages: ModelMessage[] }> => {
  const pageContext = (uiMessages ?? [])
    .filter((message) => message.role === "system")
    .flatMap((message) => message.parts)
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
  const messages = await convertToModelMessages(
    (uiMessages ?? []).filter((message) => message.role !== "system"),
    { ignoreIncompleteToolCalls: true },
  );
  return {
    system: pageContext ? `${baseSystem}\n\n${pageContext}` : baseSystem,
    messages,
  };
};
