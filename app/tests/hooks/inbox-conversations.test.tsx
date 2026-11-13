import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { getQueryKey } from "@trpc/react-query";
import type { PropsWithChildren } from "react";
import * as client from "@/app/_trpc/client";
import { clearInboxNotifications } from "@/deltas/chat";
import { useInboxConversations } from "@/hooks/useConversationCacheUpdate";
import * as userContext from "@/utils/UserContext";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";
import { fakeTrpcClient, TrpcTestProviders, testApi } from "../setup/trpc";

const inboxNews = { href: "/inbox", name: "1 messages", notificationCount: 1 };
const updateNotifications = vi.fn(async () => {});
/** Order of server list reads and badge clears, which must reset the server counter first. */
const events: string[] = [];
let queryClient: QueryClient;
let failListReads = false;
let notifications: { href: string; name: string; notificationCount: number }[] = [];

const render = (options?: Parameters<typeof useInboxConversations>[0], consumers = 1) =>
  renderHook(
    () => Array.from({ length: consumers }, () => useInboxConversations(options)),
    {
      wrapper: ({ children }: PropsWithChildren) => (
        <TrpcTestProviders
          client={fakeTrpcClient(async (path) => {
            if (path !== "comments.getUserConversations") throw new Error(path);
            events.push("list read");
            if (failListReads) {
              // A failure that arrives after the hook rendered the running read.
              await new Promise((resolve) => setTimeout(resolve, 30));
              throw new Error("Too many requests");
            }
            return [];
          })}
          queryClient={queryClient}
        >
          {children}
        </TrpcTestProviders>
      ),
    },
  );

/** A conversation list the panel read a second before the inbox news arrived. */
const seedEarlierList = () =>
  queryClient.setQueryData(
    getQueryKey(testApi.comments.getUserConversations, undefined, "query"),
    [],
    { updatedAt: Date.now() - 1000 },
  );

beforeEach(() => {
  installBrowserGlobals();
  events.length = 0;
  failListReads = false;
  notifications = [inboxNews];
  updateNotifications.mockReset();
  updateNotifications.mockImplementation(async () => {
    events.push("badge cleared");
  });
  queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  Object.assign(vi.spyOn(client, "api" as never), { comments: testApi.comments });
  vi.spyOn(userContext, "useUserData").mockImplementation(
    () =>
      ({
        data: { userId: "reader" },
        notifications,
        updateNotifications,
      }) as never,
  );
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

it("reads the conversation list again before clearing a badge that arrived after it", async () => {
  // The chat panel keeps the list it read earlier; the server counter only resets on a read.
  seedEarlierList();
  render();
  await waitFor(() => expect(events).toEqual(["list read", "badge cleared"]));
});

it("clears the badge after the read a page mount starts, without a second read", async () => {
  seedEarlierList();
  render({ staleTime: 30_000, refetchOnMount: "always" });
  await waitFor(() => expect(events).toContain("badge cleared"));
  expect(events.filter((event) => event === "list read")).toHaveLength(1);
  expect(events.indexOf("list read")).toBeLessThan(events.indexOf("badge cleared"));
});

it("leaves the list alone without inbox news", async () => {
  vi.spyOn(userContext, "useUserData").mockReturnValue({
    data: { userId: "reader" },
    notifications: [],
    updateNotifications,
  } as never);
  seedEarlierList();
  const { result } = render();
  await waitFor(() => expect(result.current[0]?.data).toEqual([]));
  expect(events).toEqual([]);
  expect(updateNotifications).not.toHaveBeenCalledWith(clearInboxNotifications);
});

it("reads the list once for a badge whose read fails, leaving the badge", async () => {
  failListReads = true;
  seedEarlierList();
  render();
  await waitFor(() => expect(events).toContain("list read"));
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(events).toEqual(["list read"]);
});

it("reads the list again when more news arrives", async () => {
  const view = render({ staleTime: 30_000, refetchOnMount: "always" });
  await waitFor(() => expect(events).toEqual(["list read", "badge cleared"]));
  notifications = [{ ...inboxNews, name: "2 messages", notificationCount: 2 }];
  view.rerender();
  await waitFor(() =>
    expect(events).toEqual([
      "list read",
      "badge cleared",
      "list read",
      "badge cleared",
    ]),
  );
});

it("shares one read between views mounted together", async () => {
  seedEarlierList();
  render(undefined, 2);
  await waitFor(() => expect(events).toContain("badge cleared"));
  expect(events.filter((event) => event === "list read")).toHaveLength(1);
});

it("reads the list again when the count changes without reaching zero", async () => {
  notifications = [{ ...inboxNews, name: "2 messages", notificationCount: 2 }];
  const view = render({ staleTime: 30_000, refetchOnMount: "always" });
  await waitFor(() => expect(events).toEqual(["list read", "badge cleared"]));
  notifications = [inboxNews];
  view.rerender();
  await waitFor(() =>
    expect(events).toEqual([
      "list read",
      "badge cleared",
      "list read",
      "badge cleared",
    ]),
  );
});
