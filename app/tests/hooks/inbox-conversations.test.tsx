import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { getQueryKey } from "@trpc/react-query";
import type { PropsWithChildren } from "react";
import * as client from "@/app/_trpc/client";
import type { clearInboxNotifications } from "@/deltas/chat";
import { useInboxConversations } from "@/hooks/useConversationCacheUpdate";
import type { NavBarDropdownLink } from "@/libs/menus";
import * as userContext from "@/utils/UserContext";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";
import { deferred } from "../setup/deferred";
import { fakeTrpcClient, TrpcTestProviders, testApi } from "../setup/trpc";

const inboxNews = { href: "/inbox", name: "1 messages", notificationCount: 1 };
const updateNotifications = vi.fn(
  async (_update: typeof clearInboxNotifications) => {},
);
/** Order of server list reads and badge clears, which must reset the server counter first. */
const events: string[] = [];
let queryClient: QueryClient;
let failListReads = false;
const listReadGates: Promise<void>[] = [];
let notifications: NavBarDropdownLink[] = [];

const render = (options?: Parameters<typeof useInboxConversations>[0], consumers = 1) =>
  renderHook(
    () => Array.from({ length: consumers }, () => useInboxConversations(options)),
    {
      wrapper: ({ children }: PropsWithChildren) => (
        <TrpcTestProviders
          client={fakeTrpcClient(async (path) => {
            if (path !== "comments.getUserConversations") throw new Error(path);
            events.push("list read");
            // Reads stay asynchronous; tests can hold individual responses until assertions finish.
            await listReadGates.shift();
            if (failListReads) throw new Error("Too many requests");
            return [];
          })}
          queryClient={queryClient}
        >
          {children}
        </TrpcTestProviders>
      ),
    },
  );

const conversationsKey = () =>
  getQueryKey(testApi.comments.getUserConversations, undefined, "query");

/** A conversation list the panel read a second before the inbox news arrived. */
const seedEarlierList = () =>
  queryClient.setQueryData(conversationsKey(), [], { updatedAt: Date.now() - 1000 });

beforeEach(() => {
  installBrowserGlobals();
  events.length = 0;
  failListReads = false;
  listReadGates.length = 0;
  notifications = [inboxNews];
  updateNotifications.mockReset();
  updateNotifications.mockImplementation(async () => {
    events.push("badge cleared");
  });
  queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  Object.assign(vi.spyOn(client, "api" as never), { comments: testApi.comments });
  const userData = () =>
    ({
      data: { userId: "reader" },
      notifications,
      updateNotifications,
    }) as never;
  vi.spyOn(userContext, "useUserData").mockImplementation(userData);
  vi.spyOn(userContext, "useUserDataSelector").mockImplementation(userData);
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

it("reads a list cached in the same millisecond the badge appears", async () => {
  // The clock stands still until the server read starts, as on a fast machine.
  const frozenAt = Date.now();
  const now = Date.now.bind(Date);
  vi.spyOn(Date, "now").mockImplementation(() =>
    events.includes("list read") ? now() + 1 : frozenAt,
  );
  queryClient.setQueryData(
    getQueryKey(testApi.comments.getUserConversations, undefined, "query"),
    [],
  );
  render();
  await waitFor(() => expect(events).toEqual(["list read", "badge cleared"]));
});

it.each([undefined, "always"] as const)(
  "clears the badge with a fixed wall clock and refetchOnMount %s",
  async (refetchOnMount) => {
    vi.spyOn(Date, "now").mockReturnValue(Date.now());
    seedEarlierList();
    render({ refetchOnMount });
    await waitFor(() => expect(events).toEqual(["list read", "badge cleared"]));
  },
);

it("clears the badge after the read a page mount starts, without a second read", async () => {
  seedEarlierList();
  render({ staleTime: 30_000, refetchOnMount: "always" });
  await waitFor(() => expect(events).toContain("badge cleared"));
  expect(events.filter((event) => event === "list read")).toHaveLength(1);
  expect(events.indexOf("list read")).toBeLessThan(events.indexOf("badge cleared"));
});

it("leaves the list alone without inbox news", async () => {
  notifications = [];
  seedEarlierList();
  const { result } = render();
  await waitFor(() => expect(result.current[0]?.data).toEqual([]));
  expect(events).toEqual([]);
  expect(updateNotifications).not.toHaveBeenCalled();
});

it("reads the list once for a badge whose read fails, leaving the badge", async () => {
  failListReads = true;
  seedEarlierList();
  const { result } = render();
  await waitFor(() => expect(result.current[0]?.isError).toBe(true));
  expect(events).toEqual(["list read"]);
});

it("waits for the list read in flight when the list is written locally", async () => {
  const read = deferred();
  listReadGates.push(read.promise);
  seedEarlierList();
  render();
  await waitFor(() => expect(events).toEqual(["list read"]));
  // Opening a conversation marks it read in the cached list while the read is in flight.
  await act(async () => {
    queryClient.setQueryData(conversationsKey(), []);
  });
  expect(events).toEqual(["list read"]);
  await act(async () => read.resolve());
  await waitFor(() => expect(events).toEqual(["list read", "badge cleared"]));
});

it("keeps the badge when the read after a local write fails", async () => {
  failListReads = true;
  seedEarlierList();
  const { result } = render();
  await waitFor(() => expect(result.current[0]?.isError).toBe(true));
  // A conversation marked read in the cached list, which then reads the list again.
  await act(async () => {
    queryClient.setQueryData(conversationsKey(), []);
    await queryClient.invalidateQueries({ queryKey: conversationsKey() });
  });
  expect(result.current[0]?.isError).toBe(true);
  expect(events).toEqual(["list read", "list read"]);
});

it("waits for server recovery after a failed read and local write with a fixed clock", async () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.now());
  failListReads = true;
  seedEarlierList();
  const { result } = render();
  await waitFor(() => expect(result.current[0]?.isError).toBe(true));
  await act(async () => {
    queryClient.setQueryData(conversationsKey(), []);
  });
  expect(events).toEqual(["list read"]);
  failListReads = false;
  await act(async () => {
    await result.current[0]?.refetch();
  });
  expect(events).toEqual(["list read", "list read", "badge cleared"]);
});

it("preserves the badge after a cancelled read until a later server read succeeds", async () => {
  const read = deferred();
  listReadGates.push(read.promise);
  seedEarlierList();
  const { result } = render();
  await waitFor(() => expect(events).toEqual(["list read"]));
  await act(async () => {
    await queryClient.cancelQueries({ queryKey: conversationsKey() });
    read.resolve();
    await read.promise;
  });
  expect(events).toEqual(["list read"]);
  await act(async () => {
    await result.current[0]?.refetch();
  });
  expect(events).toEqual(["list read", "list read", "badge cleared"]);
});

it("preserves news cached before the successful read is rendered", async () => {
  const read = deferred();
  listReadGates.push(read.promise);
  seedEarlierList();
  updateNotifications.mockImplementation(async (update) => {
    const before = notifications;
    notifications = update(before) ?? before;
    events.push(notifications === before ? "new badge preserved" : "badge cleared");
  });
  render();
  await waitFor(() => expect(events).toEqual(["list read"]));
  // Profile cache updates precede the next context render.
  notifications = [{ ...inboxNews, name: "2 messages", notificationCount: 2 }];
  await act(async () => read.resolve());
  await waitFor(() =>
    expect(events).toEqual([
      "list read",
      "new badge preserved",
      "list read",
      "badge cleared",
    ]),
  );
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

it("reads the list again when the news arrives while a read is in flight", async () => {
  // That read may have reset the server counter before the news raised it.
  notifications = [];
  const olderRead = deferred();
  const currentRead = deferred();
  listReadGates.push(olderRead.promise, currentRead.promise);
  seedEarlierList();
  const { rerender } = render();
  void queryClient.refetchQueries({ queryKey: conversationsKey() });
  await waitFor(() => expect(events).toEqual(["list read"]));
  notifications = [inboxNews];
  rerender();
  await act(async () => olderRead.resolve());
  await waitFor(() => expect(events).toEqual(["list read", "list read"]));
  await act(async () => currentRead.resolve());
  await waitFor(() => expect(events).toContain("badge cleared"));
  expect(events).toEqual(["list read", "list read", "badge cleared"]);
});

it("clears news that was already there on mount after one read", async () => {
  render();
  await waitFor(() => expect(events).toContain("badge cleared"));
  expect(events).toEqual(["list read", "badge cleared"]);
});

it("keeps news that arrives during a shared read when another consumer mounts", async () => {
  notifications = [];
  updateNotifications.mockImplementation(async (update) => {
    const before = notifications;
    notifications = update(before) ?? before;
    if (notifications !== before) events.push("badge cleared");
  });
  const olderRead = deferred();
  const currentRead = deferred();
  listReadGates.push(olderRead.promise, currentRead.promise);
  seedEarlierList();
  const first = render();
  void queryClient.refetchQueries({ queryKey: conversationsKey() });
  await waitFor(() => expect(events).toEqual(["list read"]));
  notifications = [inboxNews];
  first.rerender();
  render();
  await act(async () => olderRead.resolve());
  await waitFor(() => expect(events).toEqual(["list read", "list read"]));
  await act(async () => currentRead.resolve());
  await waitFor(() => expect(events).toContain("badge cleared"));
  expect(events).toEqual(["list read", "list read", "badge cleared"]);
});
