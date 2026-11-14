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
import * as media from "@/hooks/useMediaQuery";
import { useConversation } from "@/layout/Conversation";
import * as pagination from "@/libs/pagination";
import * as userContext from "@/utils/UserContext";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../setup/browserGlobals";
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

const mount = (isPublic = true) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  clients.push(queryClient);
  const trpcClient = fakeTrpcClient((path, input) => {
    if (path === "comments.getConversationComments") {
      return {
        data: [row("a", "Alpha"), row("b", "Bravo", "Peer")],
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
    if (path === "comments.fetchConversationComment") return fetched;
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
