/**
 * Live, paid compatibility checks without database writes or image uploads.
 * Run from app/: bun scripts/smoke-openai.ts [--text-only]
 * Requires OPENAI_API_KEY; generates five content drafts, a review, moderation
 * outputs, three images and one transparent image edit.
 */
import { openai } from "@ai-sdk/openai";
import {
  generateText,
  isStepCount,
  readUIMessageStream,
  streamText,
  toUIMessageStream,
} from "ai";
import sharp from "sharp";
import { OPENAI_CONTENT_MODEL, OPENAI_REVIEW_MODEL } from "@/drizzle/constants";
import { prepareChatPrompt } from "@/libs/llm";
import { classifyNsfwPrompt, validateUserUpdateReason } from "@/libs/moderator";
import { generateImageWithOpenAI } from "@/libs/replicate";
import { convertToOpenaiCompatibleSchema } from "@/libs/zod_utils";
import { BadgeValidator } from "@/validators/badge";
import {
  BloodlineValidator,
  ItemValidatorRawSchema,
  JutsuValidatorRawSchema,
} from "@/validators/combat";
import { QuestValidatorRawSchema } from "@/validators/objectives";

if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const tools = {
  updateJutsu: {
    inputSchema: convertToOpenaiCompatibleSchema(
      JutsuValidatorRawSchema.omit({
        effects: true,
        villageId: true,
        bloodlineId: true,
      }),
    ),
  },
  updateItem: {
    inputSchema: convertToOpenaiCompatibleSchema(
      ItemValidatorRawSchema.omit({ effects: true }),
    ),
  },
  updateBloodline: {
    inputSchema: convertToOpenaiCompatibleSchema(
      BloodlineValidator.omit({ effects: true, villageId: true }),
    ),
  },
  updateBadge: { inputSchema: BadgeValidator },
  updateQuest: {
    inputSchema: convertToOpenaiCompatibleSchema(
      QuestValidatorRawSchema.omit({
        image: true,
        requiredVillage: true,
        content: true,
      }),
    ),
  },
};

for (const [toolName, tool] of Object.entries(tools)) {
  const result = streamText({
    model: openai(OPENAI_CONTENT_MODEL),
    instructions:
      "Create a simple ninja RPG content draft using the requested tool. Use https://example.com/image.png for any required image URL. Choose the smallest valid numerical values.",
    prompt: `Create a ${toolName.replace("update", "")} called Flame.`,
    tools: { [toolName]: tool },
    toolChoice: { type: "tool", toolName },
    stopWhen: isStepCount(1),
    maxRetries: 0,
  });
  // Exercise the same v7 UI stream adapter the chat routes return.
  const uiStream = toUIMessageStream({ stream: result.stream });
  let message;
  for await (const snapshot of readUIMessageStream({
    stream: uiStream,
    terminateOnError: true,
  }))
    message = snapshot;
  const calls = await result.toolCalls;
  assert(
    calls.length === 1 && calls[0]?.toolName === toolName,
    `${toolName}: missing tool call`,
  );
  assert(
    message?.parts.some((part) => part.type === `tool-${toolName}`),
    `${toolName}: missing UI tool part`,
  );
  console.log(`${toolName}: streamed tool call OK`);
  if (toolName === "updateJutsu" && message) {
    const completedMessage = {
      ...message,
      parts: message.parts.map((part) =>
        part.type === "tool-updateJutsu" && part.state === "input-available"
          ? { ...part, state: "output-available" as const, output: "Updated draft" }
          : part,
      ),
    };
    const prompt = await prepareChatPrompt(
      [
        completedMessage,
        {
          id: "follow-up",
          role: "user",
          parts: [
            {
              type: "text",
              text: "Describe this draft in one sentence without changing it.",
            },
          ],
        },
      ],
      "You help create ninja RPG content drafts.",
    );
    const continuation = await generateText({
      model: openai(OPENAI_CONTENT_MODEL),
      ...prompt,
      tools: { [toolName]: tool },
      toolChoice: "none",
      maxRetries: 0,
    });
    assert(continuation.text.length > 0, "Empty chat continuation");
    console.log("Chat continuation with completed tool result: OK");
  }
}

const review = await generateText({
  model: openai(OPENAI_REVIEW_MODEL),
  prompt:
    "Summarize this staff review in one HTML list item: Helpful and quick to resolve tickets.",
  maxRetries: 0,
});
assert(review.text.length > 0, "Empty review");
console.log("Staff review: OK");
assert(
  (await classifyNsfwPrompt("A fully clothed anime ninja holding a wooden staff"))
    .isNsfw === false,
  "Safe prompt rejected",
);
assert(
  (
    await validateUserUpdateReason(
      "Fix typo in jutsu description",
      "Correct spelling for clarity",
    )
  ).allowUpdate === true,
  "Valid update reason rejected",
);
console.log("Structured moderation outputs: OK");

if (process.argv.includes("--text-only")) process.exit(0);

const config = {
  userId: "ai-sdk-smoke-test",
  preprompt: "Simple game icon",
  prompt: "A small red wooden training sword, centered, flat colors, no text",
  removeBg: true,
  width: 512,
  height: 512,
};
let squareBase64 = "";
for (const size of ["square", "portrait", "landscape"] as const) {
  const response = await generateImageWithOpenAI({ ...config, size });
  const data = response.data?.[0]?.b64_json;
  assert(data, `${size}: missing b64_json`);
  const buffer = Buffer.from(data!, "base64");
  const metadata = await sharp(buffer).metadata();
  assert(
    metadata.format === "png" && metadata.hasAlpha,
    `${size}: expected transparent PNG`,
  );
  const stats = await sharp(buffer).stats();
  assert(stats.channels[3]?.min === 0, `${size}: no transparent pixels`);
  await sharp(buffer)
    .resize({ width: 512, height: 512, fit: "inside" })
    .webp({ quality: 70 })
    .toBuffer();
  if (size === "square") squareBase64 = data!;
  console.log(
    `Image ${size}: ${metadata.width}x${metadata.height}, transparency and WebP conversion OK`,
  );
}
const edit = await generateImageWithOpenAI({
  ...config,
  size: "square",
  previousImg: `data:image/png;base64,${squareBase64}`,
  prompt: "Change the sword to blue and keep the background transparent",
});
assert(edit.data?.[0]?.b64_json, "Edit: missing b64_json");
const editStats = await sharp(Buffer.from(edit.data![0]!.b64_json!, "base64")).stats();
assert(editStats.channels[3]?.min === 0, "Edit: missing transparency");
console.log("Transparent image edit: OK");
