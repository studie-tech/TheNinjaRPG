import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import { MESSAGING_MIN_LEVEL, messagingLevelMessage } from "@/drizzle/constants";
import { TeamChatPanel } from "@/layout/TeamChatPanel";
import * as UserContext from "@/utils/UserContext";
import { fakeTrpcClient, TrpcTestProviders, testApi } from "../setup/trpc";

let queryClient: QueryClient;
let user: { userId: string; level: number; isBanned: boolean; isSilenced: boolean };

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  user = {
    userId: "me",
    level: MESSAGING_MIN_LEVEL - 1,
    isBanned: false,
    isSilenced: false,
  };
  Object.assign(vi.spyOn(client, "api" as never), {
    comments: testApi.comments,
    useUtils: testApi.useUtils,
  });
  vi.spyOn(UserContext, "useRequiredUserData").mockImplementation(
    () => ({ data: user }) as never,
  );
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
});

const mount = () => {
  const trpcClient = fakeTrpcClient(async (path) => {
    if (path === "comments.getConversationComments")
      return {
        data: [],
        nextCursor: null,
        restrictionMessage: null,
        convo: { sendRestriction: null },
      };
    throw new Error(`Unexpected procedure ${path}`);
  });
  return render(
    <TrpcTestProviders client={trpcClient} queryClient={queryClient}>
      <TeamChatPanel conversationId="chat" />
    </TrpcTestProviders>,
  );
};

it("explains the messaging level gate beside a disabled composer", async () => {
  const view = mount();
  expect((await view.findByRole("alert")).textContent).toBe(messagingLevelMessage);
  expect(
    (view.getByRole("textbox", { name: "Team message" }) as HTMLTextAreaElement)
      .disabled,
  ).toBe(true);
  expect(
    (view.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled,
  ).toBe(true);
});

it("explains a silence beside a disabled composer", async () => {
  user = { ...user, level: 50, isSilenced: true };
  const view = mount();
  expect((await view.findByRole("alert")).textContent).toBe("You are silenced");
  expect(
    (view.getByRole("textbox", { name: "Team message" }) as HTMLTextAreaElement)
      .disabled,
  ).toBe(true);
});

it("leaves the composer open to eligible players", async () => {
  user = { ...user, level: 50 };
  const view = mount();
  await view.findByText("No messages yet. Say hello to your team.");
  expect(view.queryByRole("alert")).toBeNull();
  expect(
    (view.getByRole("textbox", { name: "Team message" }) as HTMLTextAreaElement)
      .disabled,
  ).toBe(false);
});
