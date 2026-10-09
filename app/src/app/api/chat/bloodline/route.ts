import { openai } from "@ai-sdk/openai";
import type { UIMessage } from "ai";
import {
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
} from "ai";
import { OPENAI_CONTENT_MODEL } from "@/drizzle/constants";
import { checkContentAiAuth, prepareChatPrompt } from "@/libs/llm";
import { convertToOpenaiCompatibleSchema } from "@/libs/zod_utils";
import { BloodlineValidator } from "@/validators/combat";

export async function POST(req: Request) {
  // Auth guard
  const authError = await checkContentAiAuth();
  if (authError) return authError;

  // Call LLM
  const { messages: uiMessages } = (await req.json()) as { messages: UIMessage[] };
  const schema = convertToOpenaiCompatibleSchema(
    BloodlineValidator.omit({ effects: true, villageId: true }),
  );
  const { instructions, messages } = await prepareChatPrompt(
    uiMessages,
    `You are a helpful assistant tasked with creating new bloodlines set in the ninja world of Seichi.
    Your primary task is to call the function 'updateBloodline' with appropriate parameters to update the bloodline shown to the user.
    Do not give detailed instructions to the user on what bloodline is created, instead just give a brief summary and start creating it.
    Do not use markdown.
    Do not ask the user for clarifying questions; if details are left out, simply fill in best guesses for the bloodline.
    Only update the bloodline if the user asks you to do so or asks you to create a new bloodline.`,
  );
  const result = streamText({
    model: openai(OPENAI_CONTENT_MODEL),
    instructions,
    messages,
    tools: {
      updateBloodline: {
        description: "Update bloodline shown to the user",
        inputSchema: schema,
      },
    },
    stopWhen: isStepCount(2),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
}
