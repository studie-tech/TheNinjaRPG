import { openai } from "@ai-sdk/openai";
import { auth } from "@clerk/nextjs/server";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";

import { OPENAI_CHAT_MODEL } from "@/drizzle/constants";
import { SUPPORT_CHAT_INSTRUCTIONS } from "@/libs/supportPrompt";
import { updateUserDataForPOST } from "@/queries/support";
import { drizzleDB } from "@/server/db";

export async function POST(req: Request) {
  // Auth guard
  const { userId } = await auth();
  if (!userId) {
    return new Response("Not authenticated", { status: 401 });
  }

  // User update & guard
  const updateResult = await updateUserDataForPOST(drizzleDB, userId);
  if (updateResult.rowsAffected === 0) {
    return new Response(
      "You have reached the maximum number of AI calls for the day.",
      { status: 429 },
    );
  }

  // Call LLM
  const { messages: uiMessages } = (await req.json()) as { messages: UIMessage[] };
  const messages = await convertToModelMessages(
    uiMessages.filter((message) => message.role !== "system"),
  );
  const result = streamText({
    model: openai(OPENAI_CHAT_MODEL),
    instructions: SUPPORT_CHAT_INSTRUCTIONS,
    messages,
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
}
