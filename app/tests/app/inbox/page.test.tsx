import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import * as navigation from "next/navigation";
import * as client from "@/app/_trpc/client";
import Inbox from "@/app/[shell]/inbox/page";
import * as newConversation from "@/layout/NewConversationPrompt";
import * as blacklist from "@/layout/UserBlacklistControl";
import {
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";
import { fakeTrpcClient, TrpcTestProviders, testApi } from "../../setup/trpc";
import { mockUserContextValue } from "../../setup/userContext";

const updateNotifications = vi.fn();
const inboxNews = { href: "/inbox", name: "2 messages", notificationCount: 2 };
const otherNews = { href: "/hospital", name: "Hospitalized", notificationCount: 1 };
let queryClient: QueryClient;

beforeEach(() => {
  installBrowserGlobals();
  updateNotifications.mockReset();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: testApi.useUtils,
    comments: testApi.comments,
  });
  mockUserContextValue({
    data: { userId: "reader" },
    notifications: [inboxNews, otherNews],
    updateNotifications,
  });
  vi.spyOn(navigation, "useSearchParams").mockReturnValue(
    new URLSearchParams() as never,
  );
  vi.spyOn(navigation, "useRouter").mockReturnValue({ replace: vi.fn() } as never);
  vi.spyOn(newConversation, "NewConversationPrompt").mockImplementation(() => null);
  vi.spyOn(blacklist, "UserBlacklistPopover").mockImplementation(() => null);
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

it("clears the inbox notification once the conversation list loads", async () => {
  render(
    <TrpcTestProviders
      client={fakeTrpcClient((path) => {
        if (path !== "comments.getUserConversations") throw new Error(path);
        return [];
      })}
      queryClient={queryClient}
    >
      <Inbox />
    </TrpcTestProviders>,
  );
  await waitFor(() =>
    expect(updateNotifications).toHaveBeenCalledWith(expect.any(Function)),
  );
  expect(updateNotifications.mock.calls[0]?.[0]([inboxNews, otherNews])).toEqual([
    otherNews,
  ]);
});
