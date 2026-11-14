import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  waitFor,
} from "@testing-library/react";
import { getQueryKey } from "@trpc/react-query";
import { getDefaultStore } from "jotai";
import type { PropsWithChildren } from "react";
import { useController } from "react-hook-form";
import * as client from "@/app/_trpc/client";
import * as mutes from "@/hooks/useChatMutes";
import { useConversationCacheUpdate } from "@/hooks/useConversationCacheUpdate";
import * as media from "@/hooks/useMediaQuery";
import * as tavernActivity from "@/hooks/useTavernActivity";
import * as taverns from "@/hooks/useTaverns";
import * as chatConversation from "@/layout/ChatConversation";
import ChatPanelBody from "@/layout/ChatPanelContent";
import { CompactComment } from "@/layout/CompactComment";
import { useConversation } from "@/layout/Conversation";
import * as conversationComments from "@/layout/ConversationComments";
import * as modal from "@/layout/Modal";
import * as richInput from "@/layout/RichInput";
import { TeamChatPanel } from "@/layout/TeamChatPanel";
import * as userSearch from "@/layout/UserSearchSelect";
import {
  chatDraftsAtom,
  chatPanelAtom,
  chatViewedConversationsAtom,
  isConversationUnread,
} from "@/libs/chatPanel";
import * as pagination from "@/libs/pagination";
import * as toast from "@/libs/toast";
import * as userContext from "@/utils/UserContext";
import * as uploadthing from "@/utils/uploadthing";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../setup/browserGlobals";
import { fakeTrpcClient, TrpcTestProviders, testApi } from "../setup/trpc";
import { mockUserContextValue } from "../setup/userContext";

const clients: QueryClient[] = [];
/** Procedures a test did not expect; the query error alone would pass unnoticed. */
const refused: unknown[] = [];
const user = {
  userId: "me",
  username: "Me",
  role: "USER",
  level: 50,
  rank: "CHUNIN",
  isBanned: false,
  isSilenced: false,
  tutorialOn: true,
};
const comment = (id: string, content: string) => ({
  id,
  content,
  conversationId: "chat",
  userId: "me",
  authorId: "me",
  username: "Me",
  createdAt: new Date(),
  reactions: {},
});
const conversation = (id: string, title: string) => ({
  id,
  title,
  users: [],
  updatedAt: new Date(),
  lastReadAt: new Date(),
});

beforeEach(() => {
  // Tavern counts are covered by their own suites.
  vi.spyOn(tavernActivity, "useTavernIds").mockReturnValue([]);
  vi.spyOn(media, "useMediaQuery").mockReturnValue(false);
  installBrowserGlobals();
  Object.assign(vi.spyOn(client, "api" as never), {
    comments: testApi.comments,
    profile: testApi.profile,
    reports: testApi.reports,
    useUtils: testApi.useUtils,
  });
  mockUserContextValue({
    data: user,
    notifications: [],
  } as never);
  mockUserContextValue({ data: user } as never);
  vi.spyOn(pagination, "useInfinitePagination").mockImplementation(() => undefined);
});

afterEach(async () => {
  cleanup();
  await flushRadixFocus();
  for (const queryClient of clients.splice(0)) queryClient.clear();
  getDefaultStore().set(chatPanelAtom, { owner: null, tab: "tavern" });
  getDefaultStore().set(chatDraftsAtom, {});
  getDefaultStore().set(chatViewedConversationsAtom, {});
  localStorage.removeItem("selectedTavern2");
  vi.restoreAllMocks();
  restoreBrowserGlobals();
  expect(refused.splice(0)).toEqual([]);
});

/** Keep the actual tRPC hooks, keys and invalidation behavior while replacing only transport. */
const session = (read: (path: string, input: unknown) => unknown) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  clients.push(queryClient);
  const trpcClient = fakeTrpcClient((path, input) => {
    try {
      return read(path, input);
    } catch (error) {
      refused.push(error);
      throw error;
    }
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <TrpcTestProviders client={trpcClient} queryClient={queryClient}>
      {children}
    </TrpcTestProviders>
  );
  return { queryClient, wrapper };
};

/** Exercise both block entry points while the conversation-list refresh is still pending. */
const blacklistPanel = (success: boolean) => {
  let listReads = 0;
  let finishList!: (value: object[]) => void;
  const friend = {
    userId: "friend",
    username: "Friend",
    avatar: null,
    level: 50,
    rank: "GENIN" as const,
    role: "USER" as const,
    federalStatus: "NONE" as const,
    isOutlaw: false,
  };
  const privateChat = {
    ...conversation("private", "Private chat"),
    users: [{ userId: friend.userId, userData: friend }],
  };
  const friendComment = {
    ...comment("message", "Private message"),
    userId: friend.userId,
    authorId: friend.userId,
    isPinned: false,
    isReported: false,
    isStaffOnly: false,
  };
  const outcome = {
    success,
    message: success ? "Added Friend to blacklist" : "Cannot block this player",
  };
  const { wrapper, queryClient } = session((path, input) => {
    if (path === "comments.getUserConversations") {
      if (++listReads === 1) return [privateChat];
      return new Promise((resolve) => {
        finishList = resolve;
      });
    }
    if (path === "profile.toggleBlacklistEntry") {
      expect(input).toEqual({ userId: "friend", active: true });
      return outcome;
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  const seededKeys = [
    getQueryKey(testApi.profile.getBlacklist, undefined, "query"),
    ...[
      { convo_id: "private", limit: 10 },
      { convo_title: "Global", limit: 15 },
    ].map((input) =>
      getQueryKey(testApi.comments.getConversationComments, input, "infinite"),
    ),
  ];
  for (const key of seededKeys) queryClient.setQueryData(key, []);
  const affectedKeys = [
    ...seededKeys,
    getQueryKey(testApi.comments.getUserConversations, undefined, "query"),
  ];
  getDefaultStore().set(chatPanelAtom, {
    owner: "panel",
    tab: "inbox",
    conversationId: "private",
  });
  vi.spyOn(mutes, "useChatMutes").mockReturnValue({ isSilenced: () => false } as never);
  vi.spyOn(chatConversation, "ChatConversation").mockImplementation(
    ({ toolbarStart, toolbarEnd }) => (
      <div>
        {toolbarStart}
        {toolbarEnd}
        <CompactComment
          user={friend}
          comment={friendComment}
          editing={false}
          setEditing={() => {}}
        >
          Private message
        </CompactComment>
      </div>
    ),
  );
  const feedback = vi.spyOn(toast, "showMutationToast");
  const view = render(
    <ChatPanelBody
      isPhone={false}
      isWide={false}
      onToggleWide={() => {}}
      onClose={() => {}}
    />,
    { wrapper },
  );
  return {
    view,
    queryClient,
    affectedKeys,
    outcome,
    feedback,
    listReads: () => listReads,
    finishList: () => finishList([]),
  };
};

const blockEntryPoints = [
  { trigger: "Options for Private chat", action: "Block Friend" },
  { trigger: "Actions for Friend", action: "Block user" },
];

it.each(blockEntryPoints)(
  "reconciles blocked conversation and message caches from $trigger",
  async ({ trigger, action }) => {
    const {
      view,
      queryClient,
      affectedKeys,
      feedback,
      outcome,
      listReads,
      finishList,
    } = blacklistPanel(true);
    fireEvent.click(await view.findByRole("button", { name: trigger }));
    fireEvent.click(await view.findByRole("menuitem", { name: action }));
    await waitFor(() => expect(listReads()).toBe(2));
    // Close immediately, even if the conversation-list reconciliation is still in flight.
    expect(view.queryByRole("menuitem", { name: action })).toBeNull();
    expect(view.getByText("Private message")).toBeTruthy();
    expect(feedback).toHaveBeenCalledWith(outcome);
    for (const key of affectedKeys)
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    await act(async () => finishList());
    await view.findByText("No private messages yet.");
    expect(view.queryByRole("button", { name: /^Private chat/ })).toBeNull();
    expect(view.queryByText("Private message")).toBeNull();
  },
);

it.each(blockEntryPoints)(
  "retains the conversation and shows a rejected block from $trigger",
  async ({ trigger, action }) => {
    const { view, queryClient, affectedKeys, feedback, outcome, listReads } =
      blacklistPanel(false);
    fireEvent.click(await view.findByRole("button", { name: trigger }));
    fireEvent.click(await view.findByRole("menuitem", { name: action }));
    await waitFor(() =>
      expect(queryClient.getMutationCache().getAll().at(-1)?.state.status).toBe(
        "success",
      ),
    );
    expect(feedback).toHaveBeenCalledWith(outcome);
    expect(view.getByRole("menuitem", { name: action }).hasAttribute("disabled")).toBe(
      false,
    );
    expect(view.getByText("Private message")).toBeTruthy();
    expect(listReads()).toBe(1);
    for (const key of affectedKeys)
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
  },
);

it.each([false, true])(
  "selects a submitted new conversation after refreshing the panel rail (existing chat: %s)",
  async (hasExisting) => {
    const old = conversation("old", "Old conversation");
    const created = conversation("new", "Created chat");
    let conversations = hasExisting ? [old] : [];
    let listReads = 0;
    const { wrapper } = session((path) => {
      if (path === "comments.getUserConversations") {
        listReads++;
        return conversations;
      }
      if (path === "comments.createConversation") {
        conversations = [created, ...conversations];
        return { success: true, message: "Message sent.", conversationId: "new" };
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const store = getDefaultStore();
    store.set(chatPanelAtom, {
      owner: "panel",
      tab: "inbox",
      conversationId: hasExisting ? "old" : undefined,
      startWith: {
        userId: "friend",
        username: "Friend",
        level: 50,
        rank: "CHUNIN",
        federalStatus: "NONE",
      },
    });
    vi.spyOn(taverns, "useTaverns").mockReturnValue({
      availTaverns: ["Global"],
      isLoading: false,
    } as never);
    vi.spyOn(mutes, "useChatMutes").mockReturnValue({
      isSilenced: () => false,
    } as never);
    vi.spyOn(chatConversation, "ChatConversation").mockImplementation(({ convoId }) => (
      <span data-testid="selected-conversation">{convoId}</span>
    ));
    vi.spyOn(modal, "default").mockImplementation(({ isOpen, children, onAccept }) =>
      isOpen ? (
        <div>
          {children}
          <button type="button" onClick={onAccept}>
            Submit conversation
          </button>
        </div>
      ) : null,
    );
    vi.spyOn(userSearch, "default").mockReturnValue(<></>);
    vi.spyOn(richInput, "default").mockImplementation(({ id, control }) => {
      const { field } = useController({ name: id, control });
      return <textarea aria-label="Initial message" {...field} />;
    });
    const view = render(
      <ChatPanelBody
        isPhone={false}
        isWide={false}
        onToggleWide={() => {}}
        onClose={() => {}}
      />,
      { wrapper },
    );
    fireEvent.change(await view.findByRole("textbox", { name: "Conversation name" }), {
      target: { value: "New conversation" },
    });
    fireEvent.change(view.getByRole("textbox", { name: "Initial message" }), {
      target: { value: "First message" },
    });
    fireEvent.click(view.getByRole("button", { name: "Submit conversation" }));
    await waitFor(() =>
      expect(view.getByTestId("selected-conversation").textContent).toBe("new"),
    );
    expect(listReads).toBe(2);
    expect(store.get(chatPanelAtom).conversationId).toBe("new");
    expect(
      view.getByRole("button", { name: /^Created chat/ }).getAttribute("aria-current"),
    ).toBe("true");
    expect(view.queryByRole("button", { name: "Submit conversation" })).toBeNull();
  },
);

it("keeps team and panel messages synchronized in both send directions without duplicating shared-cache events", async () => {
  let comments = [comment("old", "Initial message")];
  const reads: number[] = [];
  let receive!: (event: object) => void;
  const pusher = {
    subscribe: () => ({
      bind: (_event: string, handler: typeof receive) => {
        receive = handler;
      },
      unbind: vi.fn(),
    }),
    unsubscribe: vi.fn(),
    connection: { bind: vi.fn(), unbind: vi.fn() },
  };
  mockUserContextValue({ data: user, pusher } as never);
  mockUserContextValue({
    data: user,
    pusher,
  } as never);
  const { wrapper, queryClient } = session((path, input) => {
    if (path === "comments.getConversationComments") {
      reads.push((input as { limit: number }).limit);
      return {
        data: comments,
        convo: { id: "chat", isPublic: false },
        nextCursor: undefined,
      };
    }
    if (path === "comments.createConversationComment") {
      const saved = comment(
        `saved-${comments.length}`,
        (input as { comment: string }).comment,
      );
      comments = [saved, ...comments];
      // Delivery can precede mutation success; its own echo must not insert another row.
      receive({ message: "new", fromId: "me", commentId: saved.id });
      return { success: true, message: "Comment posted", commentId: saved.id };
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  const hooks = renderHook(
    () => ({
      panel: useConversation({ convo_id: "chat", refreshKey: 0 }),
      duplicate: useConversation({ convo_id: "chat", refreshKey: 0 }),
    }),
    { wrapper },
  );
  const team = render(<TeamChatPanel conversationId="chat" />, { wrapper });
  await waitFor(() => expect(hooks.result.current.panel.allComments).toHaveLength(1));
  await team.findByText("Initial message");
  expect(reads.sort()).toEqual([10, 15]);
  reads.length = 0;

  await act(async () => {
    hooks.result.current.panel.setValue("comment", "Sent from panel");
    await hooks.result.current.panel.handleSubmitComment();
  });
  await team.findByText("Sent from panel");
  await waitFor(() => expect(hooks.result.current.panel.isCommenting).toBe(false));
  expect(reads).toEqual([15]);
  expect(hooks.result.current.panel.allComments?.map((row) => row.id)).toEqual([
    "saved-1",
    "old",
  ]);
  expect(hooks.result.current.duplicate.comments).toBe(
    hooks.result.current.panel.comments,
  );
  reads.length = 0;

  fireEvent.change(team.getByRole("textbox", { name: "Team message" }), {
    target: { value: "Sent from team" },
  });
  fireEvent.click(team.getByRole("button", { name: "Send" }));
  await waitFor(() =>
    expect(hooks.result.current.panel.allComments?.[0]?.content).toBe("Sent from team"),
  );
  await team.findByText("Sent from team");
  expect(reads.sort()).toEqual([10, 15]);
  expect(hooks.result.current.panel.allComments?.map((row) => row.id)).toEqual([
    "saved-2",
    "saved-1",
    "old",
  ]);

  await act(async () =>
    receive({
      message: "reaction",
      fromId: "peer",
      commentId: "old",
      username: "Peer",
      emoji: "👍",
    }),
  );
  const panelKey = getQueryKey(
    testApi.comments.getConversationComments,
    { convo_id: "chat", limit: 10, refreshKey: 0, searchQuery: "" },
    "infinite",
  );
  const cached = queryClient.getQueryData<{
    pages: { data: { id: string; reactions: unknown }[] }[];
  }>(panelKey);
  expect(cached?.pages[0]?.data.find((row) => row.id === "old")?.reactions).toEqual({
    "👍": ["Peer"],
  });
});

it.each(["sent", "failed", "newer draft"])(
  "retains only unsent drafts after a closed panel's request completes (%s)",
  async (outcome) => {
    let finish!: (value: object) => void;
    vi.spyOn(conversationComments, "ConversationComments").mockReturnValue(<></>);
    const { wrapper, queryClient } = session((path) => {
      if (path === "comments.getConversationComments")
        return {
          data: [],
          convo: { id: "chat", title: "Chat", isPublic: false },
          nextCursor: null,
        };
      if (path === "comments.createConversationComment")
        return new Promise((resolve) => {
          finish = resolve;
        });
      throw new Error(path);
    });
    vi.spyOn(richInput, "default").mockImplementation(({ id, control, onSubmit }) => {
      const { field } = useController({ name: id, control });
      return (
        <>
          <textarea aria-label="Message" {...field} />
          <button type="button" onClick={onSubmit}>
            Send message
          </button>
        </>
      );
    });
    const view = render(<chatConversation.ChatConversation convoId="chat" />, {
      wrapper,
    });
    fireEvent.change(await view.findByRole("textbox", { name: "Message" }), {
      target: { value: "Submitted message" },
    });
    fireEvent.click(view.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(finish).toBeDefined());
    view.unmount();
    expect(getDefaultStore().get(chatDraftsAtom).chat).toBe("Submitted message");
    if (outcome === "newer draft")
      getDefaultStore().set(chatDraftsAtom, { chat: "New unsent text" });
    await act(async () =>
      finish({ success: outcome !== "failed", message: "Result", commentId: "saved" }),
    );
    await waitFor(() =>
      expect(queryClient.getMutationCache().getAll().at(-1)?.state.status).toBe(
        "success",
      ),
    );
    const reopened = render(<chatConversation.ChatConversation convoId="chat" />, {
      wrapper,
    });
    const expected =
      outcome === "sent"
        ? ""
        : outcome === "failed"
          ? "Submitted message"
          : "New unsent text";
    expect(
      (
        (await reopened.findByRole("textbox", {
          name: "Message",
        })) as HTMLTextAreaElement
      ).value,
    ).toBe(expected);
  },
);

it("refreshes title and ID variants of a sent conversation while retaining its initiating optimistic row", async () => {
  const calls: string[] = [];
  const { wrapper, queryClient } = session((path, input) => {
    if (path === "comments.getConversationComments") {
      const value = input as {
        convo_title?: string;
        convo_id?: string;
        searchQuery?: string;
      };
      calls.push(value.convo_title ?? value.convo_id ?? "");
      return {
        data: [],
        convo: { id: value.convo_id === "other" ? "other" : "chat", isPublic: true },
        nextCursor: null,
      };
    }
    throw new Error(path);
  });
  const inputs = [
    { convo_title: "Global", limit: 10, searchQuery: "Find" },
    { convo_id: "chat", limit: 15 },
    { convo_id: "other", limit: 10 },
  ];
  const hooks = renderHook(
    () => ({
      search: testApi.comments.getConversationComments.useInfiniteQuery(inputs[0]!, {
        getNextPageParam: () => null,
      }),
      id: testApi.comments.getConversationComments.useInfiniteQuery(inputs[1]!, {
        getNextPageParam: () => null,
      }),
      other: testApi.comments.getConversationComments.useInfiniteQuery(inputs[2]!, {
        getNextPageParam: () => null,
      }),
      cache: useConversationCacheUpdate(),
    }),
    { wrapper },
  );
  await waitFor(() =>
    expect(
      hooks.result.current.search.isSuccess &&
        hooks.result.current.id.isSuccess &&
        hooks.result.current.other.isSuccess,
    ).toBe(true),
  );
  const initiating = {
    convo_title: "Global",
    limit: 10,
    refreshKey: 0,
    searchQuery: "",
  };
  const key = getQueryKey(
    testApi.comments.getConversationComments,
    initiating,
    "infinite",
  );
  const optimistic = {
    pages: [
      { convo: { id: "chat" }, data: [comment("optimistic", "Find new message")] },
    ],
    pageParams: [null],
  };
  queryClient.setQueryData(key, optimistic);
  calls.length = 0;
  await act(async () => {
    await hooks.result.current.cache.refreshConversationComments("chat", initiating);
  });
  expect(calls.sort()).toEqual(["Global", "chat"]);
  expect(queryClient.getQueryData(key)).toBe(optimistic);
});

it("clears cached unread markers only after authorized reads, including messages received while viewing", async () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 10, 1, 12, minute));
  let finishRead!: (value: object) => void;
  let receive!: (event: object) => void;
  let singleReadInput: unknown;
  const pusher = {
    subscribe: () => ({
      bind: (_event: string, handler: typeof receive) => {
        receive = handler;
      },
      unbind: vi.fn(),
    }),
    unsubscribe: vi.fn(),
    connection: { bind: vi.fn(), unbind: vi.fn() },
  };
  mockUserContextValue({ data: user, pusher } as never);
  const { wrapper, queryClient } = session((path, input) => {
    if (path === "comments.getUserConversations")
      return [
        { ...conversation("chat", "Private"), updatedAt: at(2), lastReadAt: at(1) },
      ];
    if (path === "comments.getConversationComments")
      return new Promise((resolve) => {
        finishRead = resolve;
      });
    if (path === "comments.fetchConversationComment") {
      singleReadInput = input;
      return { ...comment("incoming", "Received while viewing"), lastReadAt: at(4) };
    }
    throw new Error(path);
  });
  const list = renderHook(() => testApi.comments.getUserConversations.useQuery(), {
    wrapper,
  });
  await waitFor(() => expect(list.result.current.data).toHaveLength(1));
  const selected = renderHook(
    () => useConversation({ convo_id: "chat", refreshKey: 0 }),
    { wrapper },
  );
  await waitFor(() => expect(finishRead).toBeDefined());
  expect(isConversationUnread(list.result.current.data![0]!)).toBe(true);
  await act(async () =>
    finishRead({
      data: [],
      convo: { id: "chat", isPublic: false, lastReadAt: at(3) },
      nextCursor: null,
    }),
  );
  await waitFor(() =>
    expect(isConversationUnread(list.result.current.data![0]!)).toBe(false),
  );
  const listKey = getQueryKey(
    testApi.comments.getUserConversations,
    undefined,
    "query",
  );
  await act(async () => {
    queryClient.setQueryData(listKey, [
      { ...conversation("chat", "Private"), updatedAt: at(4), lastReadAt: at(3) },
    ]);
    receive({ message: "new", fromId: "friend", commentId: "incoming" });
  });
  await waitFor(() => expect(selected.result.current.allComments).toHaveLength(1));
  await waitFor(() =>
    expect(isConversationUnread(list.result.current.data![0]!)).toBe(false),
  );
  expect(singleReadInput).toEqual({
    commentId: "incoming",
    conversationId: "chat",
    markRead: true,
  });
});

it("targets the selected tavern's mute control only after that conversation loads", async () => {
  let finishVillage!: (value: object) => void;
  const { wrapper } = session((path, input) => {
    if (path === "comments.getConversationComments") {
      if ((input as { convo_title: string }).convo_title === "Village")
        return new Promise((resolve) => {
          finishVillage = resolve;
        });
      return {
        data: [],
        convo: { id: "global-id", title: "Global", isPublic: true },
        nextCursor: null,
      };
    }
    throw new Error(path);
  });
  localStorage.removeItem("selectedTavern2");
  vi.spyOn(taverns, "useTaverns").mockReturnValue({
    availTaverns: ["Global", "Village"],
    localTavern: "Village",
    canAccessGlobal: true,
    isLoading: false,
  } as never);
  const toggleTavernMute = vi.fn();
  vi.spyOn(mutes, "useChatMutes").mockReturnValue({
    chatMuted: false,
    isSilenced: () => false,
    isTavernSilenced: () => false,
    toggleTavernMute,
  } as never);
  vi.spyOn(richInput, "default").mockReturnValue(<textarea aria-label="Message" />);
  const view = render(
    <ChatPanelBody
      isPhone={false}
      isWide={false}
      onToggleWide={() => {}}
      onClose={() => {}}
    />,
    { wrapper },
  );
  await view.findByRole("button", { name: "Mute Global" });
  fireEvent.click(view.getByRole("button", { name: "Village" }));
  await waitFor(() => expect(finishVillage).toBeDefined());
  expect(view.getByText("Loading conversation")).toBeTruthy();
  expect(view.queryByRole("button", { name: "Mute Village" })).toBeNull();
  expect(view.queryByRole("button", { name: "Mute Global" })).toBeNull();
  await act(async () =>
    finishVillage({
      data: [],
      convo: { id: "village-id", title: "Village", isPublic: true },
      nextCursor: null,
    }),
  );
  fireEvent.click(await view.findByRole("button", { name: "Mute Village" }));
  expect(toggleTavernMute.mock.calls).toEqual([["village-id"]]);
});

it.each(["", "<p>Unsent Tavern draft</p>"])(
  "keeps arrow-key tab focus when mounting and restoring the Tavern composer (%s)",
  async (draft) => {
    const { wrapper } = session((path) => {
      if (path === "comments.getUserConversations") return [];
      if (path === "comments.getConversationComments")
        return {
          data: [],
          convo: { id: "global-id", title: "Global", isPublic: true },
          nextCursor: null,
        };
      if (path === "comments.sendTypingIndicator") return { success: true };
      throw new Error(path);
    });
    localStorage.removeItem("selectedTavern2");
    getDefaultStore().set(chatDraftsAtom, { Global: draft });
    vi.spyOn(taverns, "useTaverns").mockReturnValue({
      availTaverns: ["Global"],
      canAccessGlobal: true,
      isLoading: false,
    } as never);
    vi.spyOn(mutes, "useChatMutes").mockReturnValue({
      isSilenced: () => false,
      isTavernSilenced: () => false,
    } as never);
    vi.spyOn(uploadthing, "useUploadThing").mockReturnValue({
      startUpload: vi.fn(),
    } as never);
    vi.spyOn(conversationComments, "ConversationComments").mockImplementation(
      ({ onMentionUser }) => (
        <button type="button" onClick={() => onMentionUser?.("Friend")}>
          Mention Friend
        </button>
      ),
    );
    if (!Range.prototype.getBoundingClientRect)
      Range.prototype.getBoundingClientRect = () => ({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        top: 0,
        left: 0,
        bottom: 0,
        right: 0,
        toJSON: () => ({}),
      });
    if (!Range.prototype.getClientRects)
      Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
    const view = render(
      <ChatPanelBody
        isPhone={false}
        isWide={false}
        onToggleWide={() => {}}
        onClose={() => {}}
      />,
      { wrapper },
    );
    act(() => view.getByRole("tab", { name: "Tavern" }).focus());
    await waitFor(() =>
      expect(view.getByRole("textbox", { name: "Message Global…" }).textContent).toBe(
        draft ? "Unsent Tavern draft" : "",
      ),
    );
    expect(document.activeElement).toBe(view.getByRole("tab", { name: "Tavern" }));
    fireEvent.keyDown(view.getByRole("tab", { name: "Tavern" }), { key: "ArrowRight" });
    await waitFor(() =>
      expect(
        view.getByRole("tab", { name: "Inbox" }).getAttribute("aria-selected"),
      ).toBe("true"),
    );
    expect(document.activeElement).toBe(view.getByRole("tab", { name: "Inbox" }));
    expect(view.queryByRole("textbox", { name: "Message Global…" })).toBeNull();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    await waitFor(() =>
      expect(
        view.getByRole("tab", { name: "Tavern" }).getAttribute("aria-selected"),
      ).toBe("true"),
    );
    await waitFor(() =>
      expect(view.getByRole("textbox", { name: "Message Global…" }).textContent).toBe(
        draft ? "Unsent Tavern draft" : "",
      ),
    );
    expect(document.activeElement).toBe(view.getByRole("tab", { name: "Tavern" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    await waitFor(() =>
      expect(document.activeElement).toBe(view.getByRole("tab", { name: "Inbox" })),
    );
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    const editor = await view.findByRole("textbox", { name: "Message Global…" });
    fireEvent.click(view.getByRole("button", { name: "Mention Friend" }));
    await waitFor(() => expect(editor.textContent?.endsWith("@Friend ")).toBe(true));
    if (draft) expect(editor.textContent).toContain("Unsent Tavern draft");
    expect(document.activeElement).toBe(editor);
  },
);
