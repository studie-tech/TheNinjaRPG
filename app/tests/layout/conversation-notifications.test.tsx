import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as clerk from "@clerk/nextjs";
import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { getQueryKey } from "@trpc/react-query";
import { observable } from "@trpc/server/observable";
import { getDefaultStore } from "jotai";
import * as navigation from "next/navigation";
import * as Pusher from "pusher-js";
import * as client from "@/app/_trpc/client";
import * as mastery from "@/hooks/useMasteryQueueRefresh";
import * as media from "@/hooks/useMediaQuery";
import * as refresh from "@/hooks/useRefreshAt";
import { ChatConversation } from "@/layout/ChatConversation";
import { ChatPanel } from "@/layout/ChatPanel";
import * as panelContent from "@/layout/ChatPanelContent";
import Conversation from "@/layout/Conversation";
import * as comments from "@/layout/ConversationComments";
import * as richInput from "@/layout/RichInput";
import { chatMentionsAtom, chatPanelAtom } from "@/libs/chatPanel";
import * as pagination from "@/libs/pagination";
import * as toast from "@/libs/toast";
import * as routing from "@/utils/routing";
import * as userContext from "@/utils/UserContext";
import { UserContextProvider } from "@/utils/UserContext";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../setup/browserGlobals";
import { actualUserContext } from "../setup/preload";
import { TrpcTestProviders, testApi } from "../setup/trpc";

const clients: QueryClient[] = [];
const hiddenDescriptor = Object.getOwnPropertyDescriptor(document, "hidden");
let pathname = "/tavern";
beforeEach(() => {
  installBrowserGlobals();
  getDefaultStore().set(chatPanelAtom, { owner: null, tab: "tavern" });
  vi.spyOn(media, "useMediaQuery").mockReturnValue(false);
  // Bun retains other suites' module mocks; exercise the provider's real cache observers.
  vi.spyOn(userContext, "useUserData").mockImplementation(
    actualUserContext.useUserData,
  );
  vi.spyOn(userContext, "useUserDataSelector").mockImplementation(
    actualUserContext.useUserDataSelector,
  );
  vi.spyOn(clerk, "useUser").mockReturnValue({
    isSignedIn: true,
    isLoaded: true,
    user: { id: "player" },
  } as never);
  vi.spyOn(navigation, "useRouter").mockReturnValue({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
    bfcacheId: "conversation-notifications",
  } as never);
  vi.spyOn(routing, "usePublicPathname").mockImplementation(() => pathname);
  vi.spyOn(mastery, "useMasteryQueueRefresh").mockImplementation(() => {});
  vi.spyOn(refresh, "useRefreshAt").mockImplementation(() => {});
  vi.spyOn(pagination, "useInfinitePagination").mockImplementation(() => {});
  vi.spyOn(richInput, "default").mockReturnValue(<textarea aria-label="Message" />);
  vi.spyOn(comments, "ConversationComments").mockImplementation(({ pages }) => (
    <>
      {pages
        ?.flatMap((page) => page.data ?? [])
        .map((comment) => (
          <p key={comment.id}>{comment.content}</p>
        ))}
    </>
  ));
  Object.assign(vi.spyOn(client, "api" as never), {
    profile: testApi.profile,
    comments: testApi.comments,
    tournament: testApi.tournament,
    useUtils: testApi.useUtils,
  });
  getDefaultStore().set(chatMentionsAtom, {});
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
});
afterEach(async () => {
  cleanup();
  await flushRadixFocus();
  for (const qc of clients.splice(0)) qc.clear();
  getDefaultStore().set(chatMentionsAtom, {});
  vi.restoreAllMocks();
  if (hiddenDescriptor) Object.defineProperty(document, "hidden", hiddenDescriptor);
  else Reflect.deleteProperty(document, "hidden");
  getDefaultStore().set(chatPanelAtom, { owner: null, tab: "tavern" });
  restoreBrowserGlobals();
});
function mount(
  kind: "public" | "private",
  panel: boolean | string = false,
  hidden = false,
) {
  const id = kind === "public" ? "global" : "private";
  pathname = kind === "public" ? "/tavern" : "/inbox";
  const channels = new Map<string, Set<(data: object) => void | Promise<void>>>();
  vi.spyOn(Pusher, "default").mockImplementation((() => ({
    subscribe: (name: string) => {
      let handlers = channels.get(name);
      if (!handlers) {
        handlers = new Set();
        channels.set(name, handlers);
      }
      return {
        bind: (_event: string, handler: (data: object) => void) =>
          handlers!.add(handler),
        unbind: (_event: string, handler: (data: object) => void) =>
          handlers!.delete(handler),
      };
    },
    unsubscribe: vi.fn(),
    disconnect: vi.fn(),
    connection: {
      socket_id: "conversation-notifications",
      bind: vi.fn(),
      unbind: vi.fn(),
    },
  })) as never);
  const showToast = vi.spyOn(toast, "showMutationToast").mockImplementation(() => {});
  showToast.mockClear();
  const qc = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  clients.push(qc);
  const profileKey = getQueryKey(testApi.profile.getUser, undefined, "query");
  qc.setQueryData(profileKey, {
    userData: {
      userId: "player",
      username: "Reader",
      status: "AWAKE",
      role: "USER",
      level: 50,
      rank: "CHUNIN",
      clanId: null,
      villageId: null,
      chatMuted: false,
      mutedConversationIds: [],
      unmutedTavernIds: [],
    },
    notifications: [],
    serverTime: Date.now(),
  });
  const trpc = testApi.createClient({
    links: [
      () =>
        ({ op }) =>
          observable((observer) => {
            if (op.path === "profile.getUser") {
              observer.next({
                result: {
                  data: {
                    ...qc.getQueryData<object>(profileKey),
                    notifications: [
                      { href: "/inbox", name: "1 messages", notificationCount: 1 },
                    ],
                  },
                },
              });
              observer.complete();
              return;
            }
            if (op.path !== "comments.getConversationComments")
              throw new Error(op.path);
            const conversationId = (op.input as { convo_id: string }).convo_id;
            observer.next({
              result: {
                data: {
                  data: [
                    {
                      id: `${conversationId}-message`,
                      content: "Visible conversation message",
                      conversationId,
                      createdAt: new Date(),
                    },
                  ],
                  convo: {
                    id: conversationId,
                    title: conversationId,
                    isPublic: conversationId === "global",
                  },
                  nextCursor: null,
                },
              },
            });
            observer.complete();
          }),
    ],
  });
  const Page = ({ showPanel }: { showPanel: boolean }) => (
    <TrpcTestProviders client={trpc} queryClient={qc}>
      <UserContextProvider initialIsSignedIn>
        <Conversation
          title="Full conversation"
          subtitle="Full page"
          convo_id={id}
          refreshKey={0}
        />
        {panel === "launcher" ? (
          <ChatPanel>Chat</ChatPanel>
        ) : (
          showPanel && (
            <ChatConversation convoId={typeof panel === "string" ? panel : id} />
          )
        )}
      </UserContextProvider>
    </TrpcTestProviders>
  );
  if (hidden) {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    qc.setQueryData(
      getQueryKey(
        testApi.comments.getConversationComments,
        {
          convo_id: id,
          limit: 10,
          refreshKey: 0,
          searchQuery: "",
        },
        "infinite",
      ),
      {
        pages: [
          {
            data: [],
            convo: { id, title: id, isPublic: kind === "public" },
            nextCursor: null,
          },
        ],
        pageParams: [undefined],
      },
    );
  }
  const view = render(<Page showPanel={!!panel} />);
  return {
    id,
    view,
    qc,
    profileKey,
    showToast,
    removePanel: () => view.rerender(<Page showPanel={false} />),
    receive: (data: object) =>
      Promise.all([...(channels.get("player") ?? [])].map((handler) => handler(data))),
  };
}
it.each(["public", "private"] as const)(
  "suppresses pings for a visible full %s conversation",
  async (kind) => {
    const test = mount(kind);
    await test.view.findByText("Visible conversation message");

    await act(async () =>
      test.receive({
        type: "pinged",
        conversationId: test.id,
        isPublic: kind === "public",
        message: "Already visible",
      }),
    );
    expect(test.showToast).not.toHaveBeenCalled();
    expect(getDefaultStore().get(chatMentionsAtom)).toEqual({});
  },
);
it("suppresses inbox badge updates for a visible full private conversation", async () => {
  const test = mount("private");
  await test.view.findByText("Visible conversation message");
  await act(async () => test.receive({ type: "newInbox", conversationId: test.id }));
  expect(
    test.qc.getQueryData<{ notifications: unknown[] }>(test.profileKey)?.notifications,
  ).toEqual([]);
  expect(test.showToast).not.toHaveBeenCalled();
});
it("keeps full conversation ownership when its matching panel closes", async () => {
  const test = mount("public", true);
  await waitFor(() =>
    expect(test.view.getAllByText("Visible conversation message")).toHaveLength(2),
  );

  await act(async () =>
    test.receive({ type: "pinged", conversationId: "global", isPublic: true }),
  );
  expect(test.showToast).not.toHaveBeenCalled();
  test.removePanel();
  await waitFor(() =>
    expect(test.view.getAllByText("Visible conversation message")).toHaveLength(1),
  );

  await act(async () =>
    test.receive({ type: "pinged", conversationId: "global", isPublic: true }),
  );
  expect(test.showToast).not.toHaveBeenCalled();
});
it("notifies for hidden conversations and clears only their mentions on return", async () => {
  getDefaultStore().set(chatMentionsAtom, { global: 2, other: 3 });
  const test = mount("public", true);
  await waitFor(() =>
    expect(test.view.getAllByText("Visible conversation message")).toHaveLength(2),
  );
  expect(getDefaultStore().get(chatMentionsAtom)).toEqual({ other: 3 });
  act(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new window.Event("visibilitychange"));
  });
  await act(async () =>
    test.receive({ type: "pinged", conversationId: "global", isPublic: true }),
  );
  expect(test.showToast).toHaveBeenCalledTimes(1);
  expect(getDefaultStore().get(chatMentionsAtom)).toEqual({ global: 1, other: 3 });
  act(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new window.Event("visibilitychange"));
  });
  expect(getDefaultStore().get(chatMentionsAtom)).toEqual({ other: 3 });
  await act(async () =>
    test.receive({ type: "pinged", conversationId: "global", isPublic: true }),
  );
  expect(test.showToast).toHaveBeenCalledTimes(1);
});

it("tracks different full-page and panel conversations independently", async () => {
  const test = mount("public", "private");
  await waitFor(() =>
    expect(test.view.getAllByText("Visible conversation message")).toHaveLength(2),
  );
  for (const conversationId of ["global", "private"]) {
    await act(async () =>
      test.receive({ type: "pinged", conversationId, isPublic: true }),
    );
  }
  expect(test.showToast).not.toHaveBeenCalled();
  test.removePanel();
  await act(async () =>
    test.receive({ type: "pinged", conversationId: "global", isPublic: true }),
  );
  expect(test.showToast).not.toHaveBeenCalled();
  await act(async () => test.receive({ type: "newInbox", conversationId: "private" }));
  expect(test.showToast).toHaveBeenCalledTimes(1);
  expect(
    test.qc.getQueryData<{ notifications: { notificationCount: number }[] }>(
      test.profileKey,
    )?.notifications[0]?.notificationCount,
  ).toBe(1);
  test.view.unmount();
  await act(async () =>
    test.receive({ type: "pinged", conversationId: "global", isPublic: true }),
  );
  // An unmounted socket must not notify, even when a test transport retains its callback.
  expect(test.showToast).toHaveBeenCalledTimes(1);
});

it("preserves existing mentions when cached conversations mount in a hidden page", async () => {
  getDefaultStore().set(chatMentionsAtom, { global: 2, other: 3 });
  const test = mount("public", true, true);
  await waitFor(() =>
    expect(test.view.getAllByText("Visible conversation message")).toHaveLength(2),
  );
  expect(getDefaultStore().get(chatMentionsAtom)).toEqual({ global: 2, other: 3 });
  await act(async () =>
    test.receive({ type: "pinged", conversationId: "global", isPublic: true }),
  );
  expect(test.showToast).toHaveBeenCalledTimes(1);
  expect(getDefaultStore().get(chatMentionsAtom)).toEqual({ global: 3, other: 3 });
});

it.each([false, true])(
  "suppresses only visible conversations while phone chat covers the full page (%s)",
  async (isPhone) => {
    vi.spyOn(media, "useMediaQuery").mockReturnValue(isPhone);
    vi.spyOn(panelContent, "default").mockImplementation(() => (
      <ChatConversation convoId="private" />
    ));
    const test = mount("public", "launcher");
    await test.view.findByText("Visible conversation message");
    fireEvent.click(test.view.getByRole("button", { name: "Chat" }));
    await waitFor(() =>
      expect(test.view.getAllByText("Visible conversation message")).toHaveLength(2),
    );
    expect(test.view.container.getAttribute("aria-hidden")).toBe(
      isPhone ? "true" : null,
    );
    await act(async () =>
      test.receive({ type: "pinged", conversationId: "global", isPublic: true }),
    );
    expect(test.showToast).toHaveBeenCalledTimes(isPhone ? 1 : 0);
    expect(getDefaultStore().get(chatMentionsAtom)).toEqual(
      isPhone ? { global: 1 } : {},
    );
    await act(async () =>
      test.receive({ type: "pinged", conversationId: "private", isPublic: false }),
    );
    expect(test.showToast).toHaveBeenCalledTimes(isPhone ? 1 : 0);
    act(() =>
      getDefaultStore().set(chatPanelAtom, (current) => ({ ...current, owner: null })),
    );
    expect(getDefaultStore().get(chatMentionsAtom)).toEqual({});
    await act(async () =>
      test.receive({ type: "pinged", conversationId: "global", isPublic: true }),
    );
    expect(test.showToast).toHaveBeenCalledTimes(isPhone ? 1 : 0);
  },
);
