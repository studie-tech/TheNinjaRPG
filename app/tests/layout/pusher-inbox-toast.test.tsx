import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { getQueryKey } from "@trpc/react-query";
import { getDefaultStore } from "jotai";
import * as navigation from "next/navigation";
import * as Pusher from "pusher-js";
import type { PropsWithChildren, ReactElement } from "react";
import superjson from "superjson";
import * as client from "@/app/_trpc/client";
import type { UserCache } from "@/deltas/profile";
import { MESSAGING_MIN_LEVEL } from "@/drizzle/constants";
import { type UserEvent, usePusherHandler } from "@/layout/PusherHandler";
import { chatMentionsAtom, chatPanelAtom } from "@/libs/chatPanel";
import * as toast from "@/libs/toast";
import type { UserWithRelations } from "@/server/api/routers/profile";
import * as routing from "@/utils/routing";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { deferred } from "../setup/deferred";
import { testRouter } from "../setup/router";
import { TrpcTestProviders, testApi } from "../setup/trpc";

const queryClients: QueryClient[] = [];
const router = testRouter("pusher-inbox");

beforeEach(() => {
  vi.spyOn(navigation, "useRouter").mockReturnValue(router);
  Object.assign(vi.spyOn(client, "api" as never), {
    profile: testApi.profile,
    comments: testApi.comments,
    tournament: testApi.tournament,
    useUtils: testApi.useUtils,
  });
});
afterEach(() => {
  cleanup();
  getDefaultStore().set(chatPanelAtom, { owner: null, tab: "tavern" });
  for (const queryClient of queryClients.splice(0)) queryClient.clear();
  vi.restoreAllMocks();
});

it("suppresses the inbox toast from the page the user is on, not the one they subscribed on", async () => {
  let receiveEvent!: (data: UserEvent) => Promise<void>;
  vi.spyOn(Pusher, "default").mockImplementation((() => ({
    subscribe: () => ({
      bind: (_event: string, handler: typeof receiveEvent) => {
        receiveEvent = handler;
      },
    }),
    unsubscribe: vi.fn(),
    disconnect: vi.fn(),
  })) as never);
  const showToast = vi
    .spyOn(toast, "showMutationToast")
    .mockImplementation(() => undefined);
  // Another suite's module mock may already be the spied function; count only this test's calls.
  showToast.mockClear();
  let pathname = "/profile";
  vi.spyOn(routing, "usePublicPathname").mockImplementation(() => pathname);

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClients.push(queryClient);
  const profileKey = getQueryKey(testApi.profile.getUser, undefined, "query");
  const profile = {
    userData: {
      userId: "player",
      level: MESSAGING_MIN_LEVEL,
      chatMuted: false,
      mutedConversationIds: [],
      unmutedTavernIds: [],
    },
    notifications: [],
  };
  queryClient.setQueryDefaults(profileKey, { queryFn: async () => profile });
  queryClient.setQueryData(profileKey, profile);
  const trpcClient = testApi.createClient({ links: [] });
  const wrapper = ({ children }: PropsWithChildren) => (
    <TrpcTestProviders client={trpcClient} queryClient={queryClient}>
      {children}
    </TrpcTestProviders>
  );
  const view = renderHook(() => usePusherHandler("player"), { wrapper });

  pathname = "/inbox";
  view.rerender();
  await act(async () => receiveEvent({ type: "newInbox" }));
  expect(showToast).not.toHaveBeenCalled();

  pathname = "/profile";
  view.rerender();
  await act(async () => receiveEvent({ type: "newInbox" }));
  expect(showToast).toHaveBeenCalledTimes(1);
  const chatAction = showToast.mock.calls[0]![0].action as unknown as ReactElement<{
    onClick: () => void;
    children: string;
  }>;
  expect(chatAction.props.children).toBe("Open chat");
  act(() => chatAction.props.onClick());
  expect(getDefaultStore().get(chatPanelAtom).openRequested).toBe(true);

  getDefaultStore().set(chatPanelAtom, { owner: null, tab: "tavern" });
  profile.userData.level = MESSAGING_MIN_LEVEL - 1;
  await act(async () => receiveEvent({ type: "newInbox" }));
  const inboxAction = showToast.mock.calls[1]![0].action as unknown as ReactElement<{
    onClick: () => void;
    children: string;
  }>;
  expect(inboxAction.props.children).toBe("To Inbox");
  act(() => inboxAction.props.onClick());
  expect(router.push).toHaveBeenCalledWith("/inbox");
  expect(getDefaultStore().get(chatPanelAtom).openRequested).not.toBe(true);
});

it("counts a delivered private message in the cached profile without rereading it", async () => {
  let receiveEvent!: (data: UserEvent) => Promise<void>;
  vi.spyOn(Pusher, "default").mockImplementation((() => ({
    subscribe: () => ({
      bind: (_event: string, handler: typeof receiveEvent) => {
        receiveEvent = handler;
      },
    }),
    unsubscribe: vi.fn(),
    disconnect: vi.fn(),
  })) as never);
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  vi.spyOn(routing, "usePublicPathname").mockImplementation(() => "/profile");
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClients.push(queryClient);
  const profileKey = getQueryKey(testApi.profile.getUser, undefined, "query");
  const profile = {
    userData: {
      userId: "player",
      level: MESSAGING_MIN_LEVEL,
      chatMuted: false,
      mutedConversationIds: ["muted"],
      unmutedTavernIds: [],
    },
    notifications: [{ href: "/news", name: "1 news", color: "blue" as const }],
    serverTime: 1_000,
  };
  const readProfile = vi.fn(async () => profile);
  queryClient.setQueryDefaults(profileKey, { queryFn: readProfile });
  queryClient.setQueryData(profileKey, profile);
  // An observer makes any profile invalidation start a read.
  const observer = new QueryObserver(queryClient, {
    queryKey: profileKey,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const unsubscribe = observer.subscribe(() => undefined);
  const trpcClient = testApi.createClient({ links: [] });
  const wrapper = ({ children }: PropsWithChildren) => (
    <TrpcTestProviders client={trpcClient} queryClient={queryClient}>
      {children}
    </TrpcTestProviders>
  );
  renderHook(() => usePusherHandler("player"), { wrapper });
  const inboxNews = () =>
    queryClient
      .getQueryData<UserCache>(profileKey)
      ?.notifications?.find((link) => link.href === "/inbox")?.notificationCount;

  await act(async () =>
    receiveEvent({ type: "newInbox", conversationId: "chat", countedAt: 10_000 }),
  );
  await act(async () =>
    receiveEvent({ type: "newInbox", conversationId: "chat", countedAt: 10_000 }),
  );
  expect(inboxNews()).toBe(2);
  // The server does not count muted conversations, so neither does the cache.
  await act(async () =>
    receiveEvent({ type: "newInbox", conversationId: "muted", countedAt: 10_000 }),
  );
  expect(inboxNews()).toBe(2);
  expect(
    queryClient.getQueryData<UserCache>(profileKey)?.notifications?.[0]?.href,
  ).toBe("/news");
  expect(readProfile).not.toHaveBeenCalled();
  // A shown inbox list rereads instead, resetting the server count it would otherwise show.
  const listKey = getQueryKey(
    testApi.comments.getUserConversations,
    undefined,
    "query",
  );
  const readList = vi.fn(async () => []);
  const list = new QueryObserver(queryClient, { queryKey: listKey, queryFn: readList });
  const unsubscribeList = list.subscribe(() => undefined);
  await waitFor(() => expect(readList).toHaveBeenCalledTimes(1));
  await act(async () =>
    receiveEvent({ type: "newInbox", conversationId: "chat", countedAt: 10_000 }),
  );
  await waitFor(() => expect(readList).toHaveBeenCalledTimes(2));
  expect(inboxNews()).toBe(2);
  expect(readProfile).not.toHaveBeenCalled();
  unsubscribeList();
  // A profile read just before the delivery may already count it, so the count is reread.
  await act(async () =>
    receiveEvent({ type: "newInbox", conversationId: "chat", countedAt: 1_500 }),
  );
  await waitFor(() => expect(readProfile).toHaveBeenCalledTimes(1));
  unsubscribe();
});

it("counts only public conversation pings as Tavern notifications", async () => {
  let receiveEvent!: (data: UserEvent) => Promise<void>;
  vi.spyOn(Pusher, "default").mockImplementation((() => ({
    subscribe: () => ({
      bind: (_event: string, handler: typeof receiveEvent) => {
        receiveEvent = handler;
      },
    }),
    unsubscribe: vi.fn(),
    disconnect: vi.fn(),
  })) as never);
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  vi.spyOn(routing, "usePublicPathname").mockReturnValue("/profile");
  const store = getDefaultStore();
  store.set(chatMentionsAtom, {});
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClients.push(queryClient);
  const profileKey = getQueryKey(testApi.profile.getUser, undefined, "query");
  const profile = {
    userData: {
      userId: "player",
      chatMuted: false,
      mutedConversationIds: [],
      unmutedTavernIds: [],
    },
    notifications: [],
  };
  queryClient.setQueryDefaults(profileKey, { queryFn: async () => profile });
  queryClient.setQueryData(profileKey, profile);
  const trpcClient = testApi.createClient({ links: [] });
  const wrapper = ({ children }: PropsWithChildren) => (
    <TrpcTestProviders client={trpcClient} queryClient={queryClient}>
      {children}
    </TrpcTestProviders>
  );
  renderHook(() => usePusherHandler("player"), { wrapper });
  await act(async () =>
    receiveEvent({ type: "pinged", conversationId: "private", isPublic: false }),
  );
  expect(store.get(chatMentionsAtom)).toEqual({});
  await act(async () =>
    receiveEvent({ type: "pinged", conversationId: "tavern", isPublic: true }),
  );
  expect(store.get(chatMentionsAtom)).toEqual({ tavern: 1 });
  store.set(chatMentionsAtom, {});
});

it("keeps the notification list when a battle event finds the derived combat entry", async () => {
  let receiveEvent!: (data: UserEvent) => Promise<void>;
  vi.spyOn(Pusher, "default").mockImplementation((() => ({
    subscribe: () => ({
      bind: (_event: string, handler: typeof receiveEvent) => {
        receiveEvent = handler;
      },
    }),
    unsubscribe: vi.fn(),
    disconnect: vi.fn(),
  })) as never);
  vi.spyOn(routing, "usePublicPathname").mockReturnValue("/profile");
  const pushToCombat = vi
    .spyOn(routing, "pushToCombat")
    .mockImplementation(() => undefined);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClients.push(queryClient);
  const profileKey = getQueryKey(testApi.profile.getUser, undefined, "query");
  const notifications = [
    { href: "/combat", name: "In combat", color: "red" },
    { href: "/", name: "Saved", color: "toast" },
  ];
  queryClient.setQueryData(profileKey, {
    userData: {
      userId: "player",
      status: "AWAKE",
      battleId: null,
      rank: "GENIN",
      titles: [],
      items: [],
    },
    notifications,
  });
  const trpcClient = testApi.createClient({ links: [] });
  const wrapper = ({ children }: PropsWithChildren) => (
    <TrpcTestProviders client={trpcClient} queryClient={queryClient}>
      {children}
    </TrpcTestProviders>
  );
  renderHook(() => usePusherHandler("player"), { wrapper });

  await act(async () => receiveEvent({ type: "battle", battleId: "battle-1" }));

  const cached = queryClient.getQueryData<{
    userData: { status: string; battleId: string };
    notifications: typeof notifications;
  }>(profileKey);
  expect(cached?.userData).toMatchObject({ status: "BATTLE", battleId: "battle-1" });
  // UserContext replays toast entries when this array changes identity.
  expect(cached?.notifications).toBe(notifications);
  expect(pushToCombat).toHaveBeenCalledWith(expect.anything(), "battle-1");
});

it.each([
  { outcome: "confirmed", eventAfterResponse: false, abandon: "none", recovery: false },
  { outcome: "confirmed", eventAfterResponse: true, abandon: "none", recovery: false },
  {
    outcome: "lost-response",
    eventAfterResponse: false,
    abandon: "none",
    recovery: false,
  },
  {
    outcome: "lost-response",
    eventAfterResponse: true,
    abandon: "none",
    recovery: false,
  },
  {
    outcome: "lost-response",
    eventAfterResponse: false,
    abandon: "unmount",
    recovery: false,
  },
  {
    outcome: "lost-response",
    eventAfterResponse: false,
    abandon: "account-change",
    recovery: false,
  },
  { outcome: "confirmed", eventAfterResponse: false, abandon: "none", recovery: true },
  { outcome: "confirmed", eventAfterResponse: true, abandon: "none", recovery: true },
  {
    outcome: "lost-response",
    eventAfterResponse: false,
    abandon: "none",
    recovery: true,
  },
  {
    outcome: "lost-response",
    eventAfterResponse: true,
    abandon: "none",
    recovery: true,
  },
])(
  "settles own battle admission without profile reads (%s)",
  async ({ outcome, eventAfterResponse, abandon, recovery }) => {
    let receiveEvent!: (data: UserEvent) => Promise<void>;
    vi.spyOn(Pusher, "default").mockImplementation((() => ({
      connection: { socket_id: "own-tab" },
      subscribe: () => ({
        bind: (_event: string, handler: typeof receiveEvent) => {
          receiveEvent = handler;
        },
      }),
      unsubscribe: vi.fn(),
      disconnect: vi.fn(),
    })) as never);
    vi.spyOn(routing, "usePublicPathname").mockReturnValue("/battlearena");
    const navigate = vi
      .spyOn(routing, "pushToCombat")
      .mockImplementation(() => undefined);
    navigate.mockClear();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClients.push(queryClient);
    const profileKey = getQueryKey(testApi.profile.getUser, undefined, "query");
    const profile: UserCache = {
      userData: {
        userId: "player",
        status: "ASLEEP",
        battleId: null,
        rank: "GENIN",
        titles: [],
        items: [],
        pveFights: 2,
        curHealth: 1,
        curEnergy: 10,
        regenAt: new Date(0),
      } as unknown as NonNullable<UserWithRelations>,
      notifications: [],
    };
    const userRecovery = {
      userId: "player",
      userPatch: {
        status: "AWAKE" as const,
        curHealth: 100,
        curEnergy: 80,
        regenAt: new Date("2026-01-01T00:00:00Z"),
      },
    };
    const packet = JSON.parse(
      JSON.stringify({
        type: "battle",
        battleId: "battle",
        originSocketId: "own-tab",
        ...(recovery ? { userRecovery: superjson.serialize(userRecovery) } : {}),
      }),
    ) as UserEvent;
    const canonical: UserCache = {
      ...profile,
      userData: {
        ...profile.userData!,
        status: "BATTLE",
        battleId: "battle",
        curHealth: 100,
        pveFights: 3,
      },
    };
    queryClient.setQueryData(profileKey, profile);
    const read = vi.fn(async () => canonical);
    const observer = new QueryObserver(queryClient, {
      queryKey: profileKey,
      staleTime: Infinity,
      queryFn: read,
    });
    const unsubscribe = observer.subscribe(() => {});
    const trpcClient = testApi.createClient({ links: [] });
    const wrapper = ({ children }: PropsWithChildren) => (
      <TrpcTestProviders client={trpcClient} queryClient={queryClient}>
        {children}
      </TrpcTestProviders>
    );
    const view = renderHook(() => usePusherHandler("player"), { wrapper });
    try {
      const { promise: responseReady, resolve: settle } = deferred<void>();
      const mutation = queryClient.getMutationCache().build(queryClient, {
        mutationFn: async (_variables: { originSocketId: string }) => {
          await responseReady;
          if (outcome === "lost-response")
            throw new Error("Response lost after commit");
          return {
            success: true,
            userPatch: { status: "BATTLE" as const, battleId: "battle" },
            userDelta: { pveFights: 1 },
            userRecovery,
          };
        },
        onMutate: () => prepareUserUpdate(queryClient, profileKey),
        onSuccess: async (result, _variables, revision) => {
          await updateUserCache(queryClient, profileKey, result, {
            revision,
            refetch: false,
          });
        },
      });
      const execution = mutation
        .execute({ originSocketId: "own-tab" })
        .catch(() => undefined);
      const revision = queryClient.getQueryState(profileKey)?.dataUpdateCount;
      if (!eventAfterResponse) {
        // Admission precedes HTTP completion without consuming its captured cache revision.
        await act(async () => receiveEvent(packet));
        expect(queryClient.getQueryState(profileKey)?.dataUpdateCount).toBe(revision);
        expect(navigate).not.toHaveBeenCalled();
      }
      if (abandon === "unmount") view.unmount();
      if (abandon === "account-change")
        queryClient.setQueryData(profileKey, {
          ...profile,
          userData: { ...profile.userData!, userId: "another-player" },
        });
      await act(async () => {
        settle();
        await execution;
      });
      if (abandon !== "none") {
        expect(queryClient.getQueryData<UserCache>(profileKey)?.userData).toMatchObject(
          {
            userId: abandon === "account-change" ? "another-player" : "player",
            status: "ASLEEP",
            battleId: null,
            pveFights: 2,
            curHealth: 1,
          },
        );
        expect(navigate).not.toHaveBeenCalled();
        expect(read).not.toHaveBeenCalled();
        return;
      }
      if (eventAfterResponse) await act(async () => receiveEvent(packet));
      expect(read).not.toHaveBeenCalled();
      expect(queryClient.getQueryData<UserCache>(profileKey)?.userData).toMatchObject({
        status: "BATTLE",
        battleId: "battle",
        curHealth: outcome === "confirmed" || recovery ? 100 : 1,
        curEnergy: outcome === "confirmed" || recovery ? 80 : 10,
        regenAt:
          outcome === "confirmed" || recovery
            ? userRecovery.userPatch.regenAt
            : new Date(0),
        pveFights: outcome === "confirmed" ? 3 : 2,
      });
      expect(navigate).toHaveBeenCalledTimes(outcome === "confirmed" ? 0 : 1);
      // Replayed own events are idempotent once admission is visible.
      await act(async () => receiveEvent(packet));
      expect(navigate).toHaveBeenCalledTimes(outcome === "confirmed" ? 0 : 1);
      expect(read).not.toHaveBeenCalled();
      // The actor's other tabs and other fighters still receive authoritative navigation.
      await act(async () =>
        receiveEvent({
          type: "battle",
          battleId: "another-battle",
          originSocketId: "another-tab",
        }),
      );
      expect(queryClient.getQueryData<UserCache>(profileKey)?.userData?.battleId).toBe(
        "another-battle",
      );
      expect(navigate).toHaveBeenCalledWith(expect.anything(), "another-battle");
    } finally {
      unsubscribe();
    }
  },
);
