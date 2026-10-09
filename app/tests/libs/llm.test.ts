import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { prepareChatPrompt } from "@/libs/llm";

const userMessage: UIMessage = {
  id: "user",
  role: "user",
  parts: [{ type: "text", text: "Create a fire jutsu" }],
};

describe("chat prompt conversion", () => {
  it("moves hidden page context into instructions and keeps user messages", async () => {
    const prompt = await prepareChatPrompt(
      [
        {
          id: "context",
          role: "system",
          parts: [{ type: "text", text: "Current jutsu: Flame" }],
        },
        userMessage,
      ],
      "Create jutsu drafts",
    );
    expect(prompt.instructions).toBe("Create jutsu drafts\n\nCurrent jutsu: Flame");
    expect(prompt.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "Create a fire jutsu" }] },
    ]);
  });

  it("keeps completed editor updates and their results on the next turn", async () => {
    const prompt = await prepareChatPrompt(
      [
        userMessage,
        {
          id: "assistant",
          role: "assistant",
          parts: [
            {
              type: "tool-updateJutsu",
              toolCallId: "call-1",
              state: "output-available",
              input: { name: "Flame" },
              output: "Updated draft",
            },
          ],
        },
        {
          ...userMessage,
          id: "next",
          parts: [{ type: "text", text: "Make it stronger" }],
        },
      ],
      "Create jutsu drafts",
    );
    expect(prompt.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "user",
    ]);
    expect(prompt.messages[1]?.content).toEqual([
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "updateJutsu",
        input: { name: "Flame" },
      },
    ]);
  });

  it("drops interrupted tool calls so a follow-up can recover", async () => {
    const prompt = await prepareChatPrompt(
      [
        userMessage,
        {
          id: "assistant",
          role: "assistant",
          parts: [
            {
              type: "tool-updateJutsu",
              toolCallId: "call-1",
              state: "input-available",
              input: { name: "Flame" },
            },
          ],
        },
      ],
      "Create jutsu drafts",
    );
    expect(prompt.messages).toHaveLength(1);
    expect(prompt.instructions).toBe("Create jutsu drafts");
  });
});
