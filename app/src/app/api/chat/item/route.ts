import { openai } from "@ai-sdk/openai";
import type { UIMessage } from "ai";
import { stepCountIs, streamText } from "ai";
import { OPENAI_CONTENT_MODEL } from "@/drizzle/constants";
import { checkContentAiAuth, prepareChatPrompt } from "@/libs/llm";
import { convertToOpenaiCompatibleSchema } from "@/libs/zod_utils";
import { ItemValidatorRawSchema } from "@/validators/combat";

export async function POST(req: Request) {
  // Auth guard
  await checkContentAiAuth();
  // Call LLM
  const { messages: uiMessages } = (await req.json()) as { messages: UIMessage[] };
  const schema = convertToOpenaiCompatibleSchema(
    ItemValidatorRawSchema.omit({ effects: true, requiredSkillId: true }),
  );
  const { system, messages } = await prepareChatPrompt(
    uiMessages,
    `You are a helpful assistant tasked with creating new items set in the ninja world of Seichi.
    Your primary task is to call the function 'updateItem' with appropriate parameters to update the item shown to the user.
    Do not give detailed instructions to the user on what item is created, instead just give a brief summary and start creating it.
    Do not use markdown.
    Do not ask the user for clarifying questions; if details are left out, simply fill in best guesses for the item.
    Only update the item if the user asks you to do so or asks you to create a new item.`,
  );
  const result = streamText({
    model: openai(OPENAI_CONTENT_MODEL),
    system,
    messages,
    tools: {
      updateItem: {
        description: "Update item shown to the user",
        inputSchema: schema,
      },
    },
    stopWhen: stepCountIs(2),
  });

  return result.toUIMessageStreamResponse();
}
