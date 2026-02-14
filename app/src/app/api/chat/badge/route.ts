import { openai } from "@ai-sdk/openai";
import type { ModelMessage } from "ai";
import { stepCountIs, streamText } from "ai";
import { OPENAI_CONTENT_MODEL } from "@/drizzle/constants";
import { checkContentAiAuth } from "@/libs/llm";
import { convertToOpenaiCompatibleSchema } from "@/libs/zod_utils";
import { BadgeValidator } from "@/validators/badge";

export async function POST(req: Request) {
  // Auth guard
  await checkContentAiAuth();

  // Call LLM
  const { messages } = (await req.json()) as { messages: ModelMessage[] };
  const schema = convertToOpenaiCompatibleSchema(BadgeValidator.omit({ image: true }));
  const result = streamText({
    model: openai(OPENAI_CONTENT_MODEL),
    system: `You are a helpful assistant tasked with creating new badges set in the ninja world of Seichi.
    Your primary task is to call the function 'updateBadge' with appropriate parameters to update the badge shown to the user.
    Do not give detailed instructions to the user on what badge is created, instead just give a brief summary and start creating it.
    Do not use markdown.
    Do not ask the user for clarifying questions; if details are left out, simply fill in best guesses for the badge.
    Only update the badge if the user asks you to do so or asks you to create a new badge.`,
    messages,
    tools: {
      updateBadge: {
        description: "Update badge shown to the user",
        inputSchema: schema,
      },
    },
    stopWhen: stepCountIs(2),
  });

  return result.toUIMessageStreamResponse();
}
