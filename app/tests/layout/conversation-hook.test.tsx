import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { PropsWithChildren } from "react";
import * as client from "@/app/_trpc/client";
import * as sanitizerLoader from "@/hooks/useHtmlSanitizer";
import * as media from "@/hooks/useMediaQuery";
import { useConversation } from "@/layout/Conversation";
import * as pagination from "@/libs/pagination";
import * as sanitizeModule from "@/utils/sanitize";
import * as userContext from "@/utils/UserContext";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../setup/browserGlobals";
import { deferred } from "../setup/deferred";
import { fakeTrpcClient, TrpcTestProviders, testApi } from "../setup/trpc";

const user = {
  userId: "me",
  username: "Me",
  avatar: "me.png",
  role: "USER",
  level: 50,
  rank: "CHUNIN",
  isOutlaw: false,
  federalStatus: "NONE",
  displayTitle: "Leaf",
  village: { name: "Leaf", hexColor: "#00ff00", kageId: "kage" },
  tavernUsernameColor: "GOLD",
  tavernTitleColor: "SILVER",
  nRecruited: 3,
  tavernMessages: 7,
  isBanned: false,
  isSilenced: false,
};
const row = (id: string, content: string, username = "Me") => ({
  id,
  content,
  conversationId: "chat",
  userId: username === "Me" ? "me" : "peer",
  authorId: username === "Me" ? "me" : "peer",
  username,
  createdAt: new Date(),
  reactions: {},
});
const clients: QueryClient[] = [];
let receive: (event: object) => void;
let typingSent: unknown[];
let createInputs: unknown[];
let finishCreate: (value: object) => void;
let fetched: ReturnType<typeof row> | undefined;
let reads = 0;
let searchReads: string[] = [];
let fetchInputs: unknown[] = [];
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

beforeEach(() => {
  installBrowserGlobals();
  typingSent = [];
  createInputs = [];
  searchReads = [];
  fetchInputs = [];
  fetched = undefined;
  Object.assign(vi.spyOn(client, "api" as never), {
    comments: testApi.comments,
    profile: testApi.profile,
    useUtils: testApi.useUtils,
  });
  vi.spyOn(userContext, "useUserDataSelector").mockImplementation(((
    select: (profile: typeof user) => unknown,
  ) => ({ data: select(user), pusher })) as never);
  vi.spyOn(pagination, "useInfinitePagination").mockImplementation(() => undefined);
  vi.spyOn(media, "useMediaQuery").mockReturnValue(false);
});

afterEach(async () => {
  cleanup();
  await flushRadixFocus();
  for (const queryClient of clients.splice(0)) queryClient.clear();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

const mount = (
  isPublic = true,
  rows = [row("a", "Alpha"), row("b", "Bravo", "Peer")],
) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  clients.push(queryClient);
  const trpcClient = fakeTrpcClient((path, input) => {
    if (path === "comments.getConversationComments") {
      reads++;
      searchReads.push((input as { searchQuery: string }).searchQuery);
      return {
        data: [...rows],
        convo: { id: "chat", isPublic },
        nextCursor: null,
      };
    }
    if (path === "comments.sendTypingIndicator") {
      typingSent.push(input);
      return { success: true };
    }
    if (path === "comments.createConversationComment") {
      createInputs.push(input);
      return new Promise((resolve) => {
        finishCreate = resolve;
      });
    }
    if (path === "comments.fetchConversationComment") {
      fetchInputs.push(input);
      return fetched;
    }
    if (path === "comments.reactConversationComment") return { success: true };
    throw new Error(`Unexpected request: ${path}`);
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <TrpcTestProviders client={trpcClient} queryClient={queryClient}>
      {children}
    </TrpcTestProviders>
  );
  // The search control is part of the hook's result, so render it beside the state.
  const hook = { result: {} as { current: ReturnType<typeof useConversation> } };
  const Harness = () => {
    hook.result.current = useConversation({ convo_id: "chat", refreshKey: 0 });
    return hook.result.current.searchButtonElement;
  };
  render(<Harness />, { wrapper });
  return hook;
};

const loaded = async (hook: ReturnType<typeof mount>) => {
  await waitFor(() => expect(hook.result.current.allComments).toHaveLength(2));
};

it("toggles quotes in order and drops a deleted comment's quote", async () => {
  const hook = mount();
  await loaded(hook);
  expect(hook.result.current.getValues("quoteIds")).toBeNull();
  act(() => hook.result.current.toggleQuoteId("a"));
  act(() => hook.result.current.toggleQuoteId("b"));
  expect(hook.result.current.quoteIds).toEqual(["a", "b"]);
  act(() => hook.result.current.toggleQuoteId("a"));
  expect(hook.result.current.quoteIds).toEqual(["b"]);
  act(() => hook.result.current.handleConversationCommentDeleted("a"));
  expect(hook.result.current.quoteIds).toEqual(["b"]);
  act(() => hook.result.current.handleConversationCommentDeleted("b"));
  expect(hook.result.current.quoteIds).toEqual([]);
  expect(hook.result.current.allComments?.map((comment) => comment.id)).toEqual([]);
  act(() => hook.result.current.toggleQuoteId("a"));
  expect(hook.result.current.quoteIds).toEqual(["a"]);
});

it("shows other typists, forgets them after a pause, and announces own typing at most every two seconds", async () => {
  const hook = mount();
  await loaded(hook);
  act(() => receive({ message: "typing", fromId: "peer", username: "Peer" }));
  act(() => receive({ message: "typing", fromId: "me", username: "Me" }));
  expect([...hook.result.current.typingUsers.values()].map((u) => u.username)).toEqual([
    "Peer",
  ]);
  const now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now + 3500);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1100));
  });
  expect(hook.result.current.typingUsers.size).toBe(0);
  clock.mockRestore();

  act(() => hook.result.current.setValue("comment", "H"));
  await waitFor(() => expect(typingSent).toEqual([{ conversationId: "chat" }]));
  act(() => hook.result.current.setValue("comment", "He"));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(typingSent).toHaveLength(1);
});

it("does not announce typing in a private conversation", async () => {
  const hook = mount(false);
  await loaded(hook);
  act(() => hook.result.current.setValue("comment", "Hidden"));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(typingSent).toEqual([]);
});

it("inserts own messages optimistically with the poster's details and removes them on rejection", async () => {
  const hook = mount();
  await loaded(hook);
  act(() => hook.result.current.toggleQuoteId("b"));
  await act(async () => {
    hook.result.current.setValue("comment", "Hello");
    await hook.result.current.handleSubmitComment();
  });
  await waitFor(() => expect(hook.result.current.allComments).toHaveLength(3));
  const optimistic = hook.result.current.allComments?.[0];
  expect(optimistic).toEqual(
    expect.objectContaining({
      conversationId: "chat",
      userId: "me",
      authorId: "me",
      username: "Me",
      avatar: "me.png",
      rank: "CHUNIN",
      level: 50,
      role: "USER",
      isOutlaw: false,
      federalStatus: "NONE",
      displayTitle: "Leaf",
      villageName: "Leaf",
      villageHexColor: "#00ff00",
      villageKageId: "kage",
      tavernUsernameColor: "GOLD",
      tavernTitleColor: "SILVER",
      nRecruited: 3,
      tavernMessages: 7,
      reactions: {},
      isPinned: false,
      isReported: false,
      isStaffOnly: false,
    }),
  );
  expect(optimistic?.content).toContain("Hello");
  expect(optimistic?.content).toContain("<blockquote");
  await act(async () => finishCreate({ success: false, message: "Nope" }));
  await waitFor(() => expect(hook.result.current.allComments).toHaveLength(2));
});

it("sanitizes on-demand optimistic messages, quote previews and reactions", async () => {
  const quoted =
    '<p>Quoted<img src="x" onerror="alert(1)"></p><blockquote author="C">Nested</blockquote>';
  const hook = mount(true, [row("a", "Alpha"), row("b", quoted, "Peer")]);
  await loaded(hook);
  await waitFor(() => expect(hook.result.current.sanitizer).toBeDefined());
  const preview = hook.result.current.sanitizer?.stripBlockquotes(quoted);
  expect(preview).toBe('<p>Quoted<img src="x" /></p>');
  act(() => hook.result.current.toggleQuoteId("b"));
  await act(async () => {
    hook.result.current.setValue(
      "comment",
      '<p>Hi @Peer<script>alert(2)</script><a href="javascript:alert(3)">link</a><iframe srcdoc="<script>alert(4)</script>"></iframe><svg onload="alert(5)"></svg><span style="background:url(javascript:alert(6))">x</span></p>',
    );
    await hook.result.current.handleSubmitComment();
  });
  await waitFor(() => expect(hook.result.current.allComments).toHaveLength(3));
  const content = hook.result.current.allComments?.[0]?.content ?? "";
  for (const unsafe of [
    "onerror",
    "<script",
    "javascript:",
    "srcdoc",
    "<svg",
    "onload",
    "url(",
  ])
    expect(content).not.toContain(unsafe);
  expect(content).toContain('<a href="/username/Peer"><b>@Peer</b></a>');
  expect(content).toContain('<blockquote author="Peer"');
  expect(content).not.toContain("Nested");
  await act(async () => finishCreate({ success: false, message: "Nope" }));

  act(() =>
    hook.result.current.reactConversationComment({
      commentId: "a",
      emoji: "<script>alert(7)</script>",
    }),
  );
  act(() =>
    hook.result.current.reactConversationComment({ commentId: "a", emoji: "👍" }),
  );
  await waitFor(() =>
    expect(
      hook.result.current.allComments?.find((c) => c.id === "a")?.reactions,
    ).toEqual({ "👍": ["Me"] }),
  );
});

it("retains a remote reaction included by a refetch while helpers load", async () => {
  const rows = [row("a", "Alpha"), row("b", "Bravo", "Peer")];
  const hook = mount(true, rows);
  await loaded(hook);
  const chat = await import("@/utils/chat");
  const helpers = deferred<typeof chat>();
  vi.spyOn(sanitizerLoader, "loadChatHelpers").mockReturnValue(helpers.promise);
  act(() =>
    receive({
      message: "reaction",
      fromId: "peer",
      commentId: "a",
      username: "Peer",
      emoji: "👍",
    }),
  );
  rows[0] = { ...rows[0]!, reactions: { "👍": ["Peer"] } } as never;
  await act(async () => hook.result.current.invalidateComments());
  const reactions = () =>
    hook.result.current.allComments?.find((comment) => comment.id === "a")?.reactions;
  expect(reactions()).toEqual({ "👍": ["Peer"] });
  await act(async () => helpers.resolve(chat));
  expect(reactions()).toEqual({ "👍": ["Peer"] });
});

it("shows a sent message and a reaction after success when their helpers fail to load", async () => {
  const rows = [row("a", "Alpha"), row("b", "Bravo", "Peer")];
  const hook = mount(true, rows);
  await loaded(hook);
  vi.spyOn(sanitizerLoader, "loadHtmlSanitizer").mockRejectedValue(new Error("chunk"));
  vi.spyOn(sanitizerLoader, "loadChatHelpers").mockRejectedValue(new Error("chunk"));
  await act(async () => {
    hook.result.current.setValue("comment", "Sent without helpers");
    await hook.result.current.handleSubmitComment();
  });
  await waitFor(() => expect(createInputs).toHaveLength(1));
  expect(hook.result.current.allComments).toHaveLength(2);
  rows.unshift(row("c", "Sent without helpers"));
  const readsBeforeSend = reads;
  await act(async () => finishCreate({ success: true, commentId: "c" }));
  await waitFor(() => expect(hook.result.current.allComments).toHaveLength(3));
  expect(reads).toBeGreaterThan(readsBeforeSend);

  rows[0] = { ...rows[0]!, reactions: { "👍": ["Me"] } } as never;
  act(() =>
    hook.result.current.reactConversationComment({ commentId: "c", emoji: "👍" }),
  );
  await waitFor(() =>
    expect(
      hook.result.current.allComments?.find((c) => c.id === "c")?.reactions,
    ).toEqual({
      "👍": ["Me"],
    }),
  );
});

it("retries a failed sanitizer load when a quote is toggled and fills its preview", async () => {
  let attempts = 0;
  const store = sanitizerLoader.createLazyModule(async () => {
    attempts++;
    if (attempts === 1) throw new Error("chunk failed");
    return sanitizeModule;
  });
  vi.spyOn(sanitizerLoader, "useHtmlSanitizer").mockImplementation((enabled) => {
    const { module, failed } = sanitizerLoader.useLazyModule(store, enabled);
    return { sanitizer: module, failed };
  });
  vi.spyOn(sanitizerLoader, "loadHtmlSanitizer").mockImplementation(() => store.load());
  const hook = mount(true, [
    row("a", "Alpha"),
    row("b", '<p>Bravo</p><blockquote author="C">Nested</blockquote>', "Peer"),
  ]);
  await loaded(hook);
  await waitFor(() => expect(attempts).toBe(1));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(hook.result.current.sanitizer).toBeUndefined();
  act(() => hook.result.current.toggleQuoteId("b"));
  await waitFor(() => expect(hook.result.current.sanitizer).toBeDefined());
  expect(attempts).toBe(2);
  expect(hook.result.current.quoteIds).toEqual(["b"]);
  const quoted =
    hook.result.current.allComments?.find((c) => c.id === "b")?.content ?? "";
  expect(hook.result.current.sanitizer?.stripBlockquotes(quoted)).toBe("<p>Bravo</p>");
});

it("keeps the live channel across a hide and show and marks messages read only while visible", async () => {
  let hidden = false;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  const setHidden = (value: boolean) =>
    act(async () => {
      hidden = value;
      document.dispatchEvent(new window.Event("visibilitychange", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  const subscribe = vi.spyOn(pusher, "subscribe");
  try {
    const hook = mount();
    await loaded(hook);
    const subscribes = subscribe.mock.calls.length;
    const unsubscribes = pusher.unsubscribe.mock.calls.length;
    await setHidden(true);
    fetched = row("hidden", "Sent while hidden", "Peer");
    await act(async () =>
      receive({ message: "new", fromId: "peer", commentId: "hidden" }),
    );
    await waitFor(() => expect(fetchInputs).toHaveLength(1));
    await setHidden(false);
    fetched = row("shown", "Sent while shown", "Peer");
    await act(async () =>
      receive({ message: "new", fromId: "peer", commentId: "shown" }),
    );
    await waitFor(() => expect(fetchInputs).toHaveLength(2));
    expect(subscribe.mock.calls.length).toBe(subscribes);
    expect(pusher.unsubscribe.mock.calls.length).toBe(unsubscribes);
    expect(fetchInputs).toEqual([
      expect.objectContaining({ commentId: "hidden", markRead: false }),
      expect.objectContaining({ commentId: "shown", markRead: true }),
    ]);
  } finally {
    Reflect.deleteProperty(document, "hidden");
  }
});

it("reads only the selected search, repeating it when the same term is submitted again", async () => {
  const hook = mount();
  await loaded(hook);
  expect(searchReads).toEqual([""]);
  fireEvent.click(screen.getByRole("button", { name: "Search messages" }));
  const input = await screen.findByPlaceholderText("Search for messages...");
  const submit = async () => {
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  };
  fireEvent.change(input, { target: { value: "find" } });
  await submit();
  await waitFor(() => expect(hook.result.current.searchQuery).toBe("find"));
  expect(searchReads).toEqual(["", "find"]);
  await submit();
  expect(searchReads).toEqual(["", "find", "find"]);
  // The unsearched history is still fresh in the cache, so clearing reads nothing.
  act(() => hook.result.current.clearSearch());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(hook.result.current.searchQuery).toBe("");
  expect(searchReads).toEqual(["", "find", "find"]);
});

it("keeps non-matching new messages out of search results and shows matching ones", async () => {
  const hook = mount();
  await loaded(hook);
  fireEvent.click(screen.getByRole("button", { name: "Search messages" }));
  fireEvent.change(await screen.findByPlaceholderText("Search for messages..."), {
    target: { value: "find" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await waitFor(() => expect(hook.result.current.searchQuery).toBe("find"));
  await loaded(hook);

  await act(async () => {
    hook.result.current.setValue("comment", "Unrelated");
    await hook.result.current.handleSubmitComment();
  });
  await waitFor(() => expect(createInputs).toHaveLength(1));
  expect(hook.result.current.allComments).toHaveLength(2);
  await act(async () => finishCreate({ success: false, message: "Nope" }));

  await act(async () => {
    hook.result.current.setValue("comment", "Please FIND me");
    await hook.result.current.handleSubmitComment();
  });
  await waitFor(() => expect(hook.result.current.allComments).toHaveLength(3));
  await act(async () => finishCreate({ success: false, message: "Nope" }));
  await waitFor(() => expect(hook.result.current.allComments).toHaveLength(2));

  fetched = row("unrelated", "Peer message", "Peer");
  await act(async () =>
    receive({ message: "new", fromId: "peer", commentId: "unrelated" }),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(hook.result.current.allComments).toHaveLength(2);

  fetched = row("incoming", "Peer message", "Pathfinder");
  await act(async () =>
    receive({ message: "new", fromId: "peer", commentId: "incoming" }),
  );
  await waitFor(() =>
    expect(hook.result.current.allComments?.[0]?.id).toBe("incoming"),
  );
});

it("gives an AI sender's missing details defaults rather than the poster's", async () => {
  const hook = mount();
  await loaded(hook);
  act(() =>
    hook.result.current.userSearchMethods.setValue("users", [
      {
        userId: "ai",
        username: "Kakashi",
        rank: "JONIN",
        level: 80,
        federalStatus: "NONE",
      },
    ]),
  );
  await act(async () => {
    hook.result.current.setValue("comment", "Hello");
    await hook.result.current.handleSubmitComment();
  });
  await waitFor(() => expect(hook.result.current.allComments).toHaveLength(3));
  expect(hook.result.current.allComments?.[0]).toEqual(
    expect.objectContaining({
      userId: "ai",
      authorId: "me",
      username: "Kakashi",
      avatar: null,
      rank: "JONIN",
      level: 80,
      role: "USER",
      isOutlaw: false,
      displayTitle: "",
      villageName: null,
      villageHexColor: null,
      villageKageId: null,
      tavernUsernameColor: "DEFAULT",
      tavernTitleColor: "DEFAULT",
      nRecruited: 0,
      tavernMessages: 0,
    }),
  );
  expect(createInputs[0]).toEqual(expect.objectContaining({ senderId: "ai" }));
  await act(async () => finishCreate({ success: false, message: "Nope" }));
});
