import { Chat } from "@ai-sdk/react";
import {
  createUIMessageStreamResponse,
  DefaultChatTransport,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { describe, expect, it } from "vitest";
import { prepareChatPrompt } from "@/libs/llm";

describe("editor chat transport", () => {
  it("records client tool results and includes them in the next request", async () => {
    const requests: UIMessage[][] = [];
    const chat = new Chat<UIMessage>({
      transport: new DefaultChatTransport({
        api: "https://example.test/api/chat/jutsu",
        fetch: async (_url, options) => {
          const body = JSON.parse(options?.body as string) as { messages: UIMessage[] };
          requests.push(body.messages);
          return createUIMessageStreamResponse({
            stream: new ReadableStream<UIMessageChunk>({
              start(controller) {
                controller.enqueue({
                  type: "start",
                  messageId: `assistant-${requests.length}`,
                });
                if (requests.length === 1) {
                  controller.enqueue({
                    type: "tool-input-available",
                    toolCallId: "call-1",
                    toolName: "updateJutsu",
                    input: { name: "Flame" },
                  });
                }
                controller.enqueue({ type: "finish", finishReason: "stop" });
                controller.close();
              },
            }),
          });
        },
      }),
      onToolCall: ({ toolCall }) => {
        void chat.addToolOutput({
          tool: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          output: "Updated draft",
        });
      },
    });
    await chat.sendMessage({ text: "Create a fire jutsu" });
    expect(chat.status).toBe("ready");
    expect(chat.error).toBeUndefined();
    expect(chat.messages[1]?.parts[0]).toMatchObject({
      state: "output-available",
      output: "Updated draft",
    });
    await chat.sendMessage({ text: "Make it stronger" });
    expect(requests).toHaveLength(2);
    const prompt = await prepareChatPrompt(requests[1]!, "Create jutsu drafts");
    expect(prompt.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "user",
    ]);
    expect(chat.status).toBe("ready");
  });
});
