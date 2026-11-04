import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createTRPCReact, getQueryKey } from "@trpc/react-query";
import * as navigation from "next/navigation";
import * as Pusher from "pusher-js";
import { getDefaultStore } from "jotai";
import type { PropsWithChildren, ReactElement } from "react";
import type { AppRouter } from "@/api/root";
import * as client from "@/app/_trpc/client";
import { type UserEvent, usePusherHandler } from "@/layout/PusherHandler";
import { MESSAGING_MIN_LEVEL } from "@/drizzle/constants";
import { chatMentionsAtom, chatPanelAtom } from "@/libs/chatPanel";
import * as toast from "@/libs/toast";
import * as routing from "@/utils/routing";

const testApi = createTRPCReact<AppRouter>();
const queryClients: QueryClient[] = [];
const router = {
  back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), push: vi.fn(),
  replace: vi.fn(), prefetch: vi.fn(), bfcacheId: "pusher-inbox",
};

beforeEach(() => {
  vi.spyOn(navigation, "useRouter").mockReturnValue(router);
  Object.assign(vi.spyOn(client, "api" as never), { profile: testApi.profile, tournament: testApi.tournament, useUtils: testApi.useUtils });
});
afterEach(() => {
  cleanup();
  getDefaultStore().set(chatPanelAtom, { owner: null, tab: "tavern" });
  for (const queryClient of queryClients.splice(0)) queryClient.clear();
  vi.restoreAllMocks();
});

it("suppresses the inbox toast from the page the user is on, not the one they subscribed on", async () => {
  let receiveEvent!: (data: UserEvent) => Promise<void>;
  vi.spyOn(Pusher, "default").mockImplementation(function () {
    return {
      subscribe: () => ({ bind: (_event: string, handler: typeof receiveEvent) => { receiveEvent = handler; } }),
      unsubscribe: vi.fn(), disconnect: vi.fn(),
    };
  } as never);
  const showToast = vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  // Another suite's module mock may already be the spied function; count only this test's calls.
  showToast.mockClear();
  let pathname = "/profile";
  vi.spyOn(routing, "usePublicPathname").mockImplementation(() => pathname);

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClients.push(queryClient);
  const profileKey = getQueryKey(testApi.profile.getUser, undefined, "query");
  const profile = {
    userData: { userId: "player", level: MESSAGING_MIN_LEVEL, chatMuted: false, mutedConversationIds: [] },
    notifications: [],
  };
  queryClient.setQueryDefaults(profileKey, { queryFn: async () => profile });
  queryClient.setQueryData(profileKey, profile);
  const trpcClient = testApi.createClient({ links: [] });
  const wrapper = ({ children }: PropsWithChildren) => (
    <testApi.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </testApi.Provider>
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
  const chatAction = showToast.mock.calls[0]![0].action as unknown as ReactElement<{ onClick: () => void; children: string }>;
  expect(chatAction.props.children).toBe("Open chat");
  act(() => chatAction.props.onClick());
  expect(getDefaultStore().get(chatPanelAtom).openRequested).toBe(true);

  getDefaultStore().set(chatPanelAtom, { owner: null, tab: "tavern" });
  profile.userData.level = MESSAGING_MIN_LEVEL - 1;
  await act(async () => receiveEvent({ type: "newInbox" }));
  const inboxAction = showToast.mock.calls[1]![0].action as unknown as ReactElement<{ onClick: () => void; children: string }>;
  expect(inboxAction.props.children).toBe("To Inbox");
  act(() => inboxAction.props.onClick());
  expect(router.push).toHaveBeenCalledWith("/inbox");
  expect(getDefaultStore().get(chatPanelAtom).openRequested).not.toBe(true);
});


it("counts only public conversation pings as Tavern notifications", async () => {
  let receiveEvent!: (data: UserEvent) => Promise<void>;
  vi.spyOn(Pusher, "default").mockImplementation(function () {
    return {
      subscribe: () => ({ bind: (_event: string, handler: typeof receiveEvent) => { receiveEvent = handler; } }),
      unsubscribe: vi.fn(), disconnect: vi.fn(),
    };
  } as never);
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  vi.spyOn(routing, "usePublicPathname").mockReturnValue("/profile");
  const store = getDefaultStore();
  store.set(chatMentionsAtom, {});
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClients.push(queryClient);
  const profileKey = getQueryKey(testApi.profile.getUser, undefined, "query");
  const profile = {
    userData: { userId: "player", chatMuted: false, mutedConversationIds: [] },
    notifications: [],
  };
  queryClient.setQueryDefaults(profileKey, { queryFn: async () => profile });
  queryClient.setQueryData(profileKey, profile);
  const trpcClient = testApi.createClient({ links: [] });
  const wrapper = ({ children }: PropsWithChildren) => (
    <testApi.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </testApi.Provider>
  );
  renderHook(() => usePusherHandler("player"), { wrapper });
  await act(async () => receiveEvent({ type: "pinged", conversationId: "private", isPublic: false }));
  expect(store.get(chatMentionsAtom)).toEqual({});
  await act(async () => receiveEvent({ type: "pinged", conversationId: "tavern", isPublic: true }));
  expect(store.get(chatMentionsAtom)).toEqual({ tavern: 1 });
  store.set(chatMentionsAtom, {});
});

it("keeps the notification list when a battle event finds the derived combat entry", async () => {
  let receiveEvent!: (data: UserEvent) => Promise<void>;
  vi.spyOn(Pusher, "default").mockImplementation(function () {
    return {
      subscribe: () => ({ bind: (_event: string, handler: typeof receiveEvent) => { receiveEvent = handler; } }),
      unsubscribe: vi.fn(), disconnect: vi.fn(),
    };
  } as never);
  vi.spyOn(routing, "usePublicPathname").mockReturnValue("/profile");
  const pushToCombat = vi.spyOn(routing, "pushToCombat").mockImplementation(() => undefined);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClients.push(queryClient);
  const profileKey = getQueryKey(testApi.profile.getUser, undefined, "query");
  const notifications = [
    { href: "/combat", name: "In combat", color: "red" },
    { href: "/", name: "Saved", color: "toast" },
  ];
  queryClient.setQueryData(profileKey, {
    userData: { userId: "player", status: "AWAKE", battleId: null, rank: "GENIN", titles: [], items: [] },
    notifications,
  });
  const trpcClient = testApi.createClient({ links: [] });
  const wrapper = ({ children }: PropsWithChildren) => (
    <testApi.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </testApi.Provider>
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
