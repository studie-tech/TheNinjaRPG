import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { TextStreamPart, ToolSet } from "ai";
import { createUIMessageStreamResponse, toUIMessageStream } from "ai";
import type { PropsWithChildren } from "react";
import * as client from "@/app/_trpc/client";
import ChatBox from "@/layout/ChatBox";
import * as richInput from "@/layout/RichInput";
import * as userContext from "@/utils/UserContext";
import { TrpcTestProviders, testApi } from "../setup/trpc";

const clients: QueryClient[] = [];
const storageKey = "seichiAiChat:history-reader";
const otherStorageKey = "seichiAiChat:another-reader";
let scrollToDescriptor: PropertyDescriptor | undefined;
beforeEach(() => {
  scrollToDescriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "scrollTo",
  );
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  for (const queryClient of clients.splice(0)) queryClient.clear();
  localStorage.removeItem(storageKey);
  localStorage.removeItem(otherStorageKey);
  if (scrollToDescriptor)
    Object.defineProperty(HTMLElement.prototype, "scrollTo", scrollToDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  vi.restoreAllMocks();
});

const session = () => {
  Object.assign(vi.spyOn(client, "api" as never), { misc: testApi.misc });
  vi.spyOn(userContext, "useUserData").mockReturnValue({
    data: { userId: "history-reader", username: "Me", level: 50 },
  } as never);
  vi.spyOn(richInput, "default").mockReturnValue(<textarea aria-label="Question" />);
  const queryClient = new QueryClient();
  clients.push(queryClient);
  const trpcClient = testApi.createClient({ links: [] });
  const wrapper = ({ children }: PropsWithChildren) => (
    <TrpcTestProviders client={trpcClient} queryClient={queryClient}>
      {children}
    </TrpcTestProviders>
  );
  return { wrapper };
};

it.each([null, "text", { type: "text", text: 7 }, { type: "file", text: "Saved" }])(
  "recovers from invalid saved message parts and keeps a fresh chat usable (%j)",
  (part) => {
    localStorage.setItem(
      storageKey,
      JSON.stringify([{ id: "saved", role: "user", parts: [part] }]),
    );
    const { wrapper } = session();
    const view = render(<ChatBox />, { wrapper });
    expect(view.getByText("Hello! How can I help you today?")).toBeTruthy();
    expect(view.getByRole("textbox", { name: "Question" })).toBeTruthy();
    expect(
      (view.getByRole("button", { name: "Clear" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  },
);

it("restores streamed SDK replies after reopening and clears only the current player's conversation", async () => {
  const { wrapper } = session();
  const otherHistory = JSON.stringify([
    {
      id: "other",
      role: "user",
      parts: [{ type: "text", text: "Another player's question" }],
    },
  ]);
  localStorage.setItem(otherStorageKey, otherHistory);
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    createUIMessageStreamResponse({
      // Use the support route's SDK converter so useChat receives step metadata too.
      stream: toUIMessageStream({
        stream: new ReadableStream<TextStreamPart<ToolSet>>({
          start(controller) {
            const parts: TextStreamPart<ToolSet>[] = [
              { type: "start" },
              { type: "start-step", request: {}, warnings: [] },
              { type: "text-start", id: "answer" },
              {
                type: "text-delta",
                id: "answer",
                text: "Train your highest offensive stat.",
              },
              { type: "text-end", id: "answer" },
              {
                type: "finish",
                finishReason: "stop",
                rawFinishReason: undefined,
                totalUsage: {
                  inputTokens: 1,
                  outputTokens: 1,
                  totalTokens: 2,
                  inputTokenDetails: {
                    noCacheTokens: 1,
                    cacheReadTokens: 0,
                    cacheWriteTokens: 0,
                  },
                  outputTokenDetails: { textTokens: 1, reasoningTokens: 0 },
                },
              },
            ];
            for (const part of parts) controller.enqueue(part);
            controller.close();
          },
        }),
      }),
    }),
  );
  const view = render(<ChatBox />, { wrapper });
  expect(view.getByText("Hello! How can I help you today?")).toBeTruthy();
  expect(view.queryByText("Another player's question")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "How do I get stronger?" }));
  await view.findByText("Train your highest offensive stat.");
  await waitFor(() =>
    expect(
      (view.getByRole("button", { name: "Clear" }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  expect(localStorage.getItem(storageKey)).toContain('"type":"step-start"');
  expect(localStorage.getItem(storageKey)).toContain(
    "Train your highest offensive stat.",
  );
  expect(fetch).toHaveBeenCalledTimes(1);
  view.unmount();

  const reopened = render(<ChatBox />, { wrapper });
  expect(reopened.getByText("How do I get stronger?")).toBeTruthy();
  expect(reopened.getByText("Train your highest offensive stat.")).toBeTruthy();
  expect(reopened.getByText("Hello! How can I help you today?")).toBeTruthy();
  fireEvent.click(reopened.getByRole("button", { name: "Clear" }));
  expect(reopened.queryByText("Train your highest offensive stat.")).toBeNull();
  expect(localStorage.getItem(storageKey)).toBeNull();
  expect(localStorage.getItem(otherStorageKey)).toBe(otherHistory);
  reopened.unmount();

  const cleared = render(<ChatBox />, { wrapper });
  expect(cleared.getByText("Hello! How can I help you today?")).toBeTruthy();
  expect(
    (cleared.getByRole("button", { name: "Clear" }) as HTMLButtonElement).disabled,
  ).toBe(true);
});
