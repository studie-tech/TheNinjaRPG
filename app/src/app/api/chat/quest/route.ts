import { openai } from "@ai-sdk/openai";
import type { ModelMessage } from "ai";
import { stepCountIs, streamText } from "ai";
import { OPENAI_CONTENT_MODEL } from "@/drizzle/constants";
import { checkContentAiAuth } from "@/libs/llm";
import { convertToOpenaiCompatibleSchema } from "@/libs/zod_utils";
import { QuestValidatorRawSchema } from "@/validators/objectives";

export async function POST(req: Request) {
  // Auth guard
  await checkContentAiAuth();

  // Call LLM
  const { messages } = (await req.json()) as { messages: ModelMessage[] };
  const schema = convertToOpenaiCompatibleSchema(
    QuestValidatorRawSchema.omit({
      image: true,
      requiredVillage: true,
      content: true,
    }),
  );
  const result = streamText({
    model: openai(OPENAI_CONTENT_MODEL),
    system: `You are a helpful assistant tasked with creating new quests set in the ninja world of Seichi.
    Your primary task is to call the function 'updateQuest' with appropriate parameters to update the quest shown to the user.
    Do not give detailed instructions to the user on what quest is created, instead just give a brief summary and start creating it.
    Do not use markdown.
    Do not ask the user for clarifying questions; if details are left out, simply fill in best guesses for the quest.
    Only update the quest if the user asks you to do so or asks you to create a new quest.`,
    messages,
    tools: {
      updateQuest: {
        description: "Update quest shown to the user",
        inputSchema: schema,
      },
    },
    stopWhen: stepCountIs(2),
  });

  return result.toUIMessageStreamResponse();
}
