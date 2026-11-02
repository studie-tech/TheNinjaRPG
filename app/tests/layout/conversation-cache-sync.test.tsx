import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, renderHook, waitFor } from "@testing-library/react";
import { createTRPCReact, getQueryKey } from "@trpc/react-query";
import { observable } from "@trpc/server/observable";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { getDefaultStore } from "jotai";
import type { PropsWithChildren } from "react";
import { useController } from "react-hook-form";
import type { AppRouter } from "@/api/root";
import * as client from "@/app/_trpc/client";
import * as mutes from "@/hooks/useChatMutes";
import * as taverns from "@/hooks/useTaverns";
import * as chatConversation from "@/layout/ChatConversation";
import ChatPanelBody from "@/layout/ChatPanelContent";
import { useConversation } from "@/layout/Conversation";
import * as modal from "@/layout/Modal";
import * as richInput from "@/layout/RichInput";
import { TeamChatPanel } from "@/layout/TeamChatPanel";
import * as userSearch from "@/layout/UserSearchSelect";
import { chatPanelAtom } from "@/libs/chatPanel";
import * as pagination from "@/libs/pagination";
import * as userContext from "@/utils/UserContext";
import { ensureDom } from "../setup/dom.mjs";

const testApi = createTRPCReact<AppRouter>();
const clients: QueryClient[] = [];
const user = {
  userId: "me", username: "Me", role: "USER", level: 50, rank: "CHUNIN",
  isBanned: false, isSilenced: false, tutorialOn: true,
};
const comment = (id: string, content: string) => ({
  id, content, conversationId: "chat", userId: "me", authorId: "me", username: "Me",
  createdAt: new Date(), reactions: {},
});
const conversation = (id: string, title: string) => ({
  id, title, users: [], updatedAt: new Date(), lastReadAt: new Date(),
});

beforeEach(() => {
  ensureDom();
  Object.assign(vi.spyOn(client, "api" as never), {
    comments: testApi.comments, useUtils: testApi.useUtils,
  });
  vi.spyOn(client, "useGlobalOnMutateProtect").mockReturnValue(() => undefined);
  vi.spyOn(userContext, "useUserData").mockReturnValue({ data: user, notifications: [] } as never);
  vi.spyOn(userContext, "useRequiredUserData").mockReturnValue({ data: user } as never);
  vi.spyOn(pagination, "useInfinitePagination").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  for (const queryClient of clients.splice(0)) queryClient.clear();
  getDefaultStore().set(chatPanelAtom, { owner: null, tab: "tavern" });
  vi.restoreAllMocks();
});

/** Keep the actual tRPC hooks, keys and invalidation behavior while replacing only transport. */
const session = (read: (path: string, input: unknown) => unknown) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  clients.push(queryClient);
  const trpcClient = testApi.createClient({ links: [() => ({ op }) => observable((observer) => {
    Promise.resolve().then(() => read(op.path, op.input)).then((data) => {
      observer.next({ result: { data } });
      observer.complete();
    });
  })] });
  const wrapper = ({ children }: PropsWithChildren) => (
    <testApi.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </testApi.Provider>
  );
  return { queryClient, wrapper };
};

it.each([false, true])("selects a submitted new conversation after refreshing the panel rail (existing chat: %s)", async (hasExisting) => {
  const old = conversation("old", "Old conversation");
  const created = conversation("new", "Created chat");
  let conversations = hasExisting ? [old] : [];
  let listReads = 0;
  const { wrapper } = session((path) => {
    if (path === "comments.getUserConversations") { listReads++; return conversations; }
    if (path === "comments.createConversation") {
      conversations = [created, ...conversations];
      return { success: true, message: "Message sent.", conversationId: "new" };
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  const store = getDefaultStore();
  store.set(chatPanelAtom, {
    owner: "panel", tab: "inbox", conversationId: hasExisting ? "old" : undefined,
    startWith: { userId: "friend", username: "Friend", level: 50, rank: "CHUNIN", federalStatus: "NONE" },
  });
  vi.spyOn(taverns, "useTaverns").mockReturnValue({ availTaverns: ["Global"], isLoading: false } as never);
  vi.spyOn(mutes, "useChatMutes").mockReturnValue({ isSilenced: () => false } as never);
  vi.spyOn(chatConversation, "ChatConversation").mockImplementation(({ convoId }) => <span data-testid="selected-conversation">{convoId}</span>);
  vi.spyOn(modal, "default").mockImplementation(({ isOpen, children, onAccept }) => isOpen ? <div>
    {children}<button type="button" onClick={onAccept}>Submit conversation</button>
  </div> : null);
  vi.spyOn(userSearch, "default").mockReturnValue(<></>);
  vi.spyOn(richInput, "default").mockImplementation(({ id, control }) => {
    const { field } = useController({ name: id, control });
    return <textarea aria-label="Initial message" {...field} />;
  });
  const view = render(<ChatPanelBody isPhone={false} isWide={false} onToggleWide={() => {}} onClose={() => {}} />, { wrapper });
  fireEvent.change(await view.findByRole("textbox", { name: "Conversation name" }), { target: { value: "New conversation" } });
  fireEvent.change(view.getByRole("textbox", { name: "Initial message" }), { target: { value: "First message" } });
  fireEvent.click(view.getByRole("button", { name: "Submit conversation" }));
  await waitFor(() => expect(view.getByTestId("selected-conversation").textContent).toBe("new"));
  expect(listReads).toBe(2);
  expect(store.get(chatPanelAtom).conversationId).toBe("new");
  expect(view.getByRole("button", { name: /^Created chat/ }).getAttribute("aria-current")).toBe("true");
  expect(view.queryByRole("button", { name: "Submit conversation" })).toBeNull();
});

it("keeps team and panel messages synchronized in both send directions without duplicating shared-cache events", async () => {
  let comments = [comment("old", "Initial message")];
  const reads: number[] = [];
  let receive!: (event: object) => void;
  const pusher = {
    subscribe: () => ({ bind: (_event: string, handler: typeof receive) => { receive = handler; }, unbind: vi.fn() }),
    unsubscribe: vi.fn(), connection: { bind: vi.fn(), unbind: vi.fn() },
  };
  vi.spyOn(userContext, "useUserData").mockReturnValue({ data: user, pusher } as never);
  vi.spyOn(userContext, "useRequiredUserData").mockReturnValue({ data: user, pusher } as never);
  const { wrapper, queryClient } = session((path, input) => {
    if (path === "comments.getConversationComments") {
      reads.push((input as { limit: number }).limit);
      return { data: comments, convo: { id: "chat", isPublic: false }, nextCursor: undefined };
    }
    if (path === "comments.createConversationComment") {
      const saved = comment(`saved-${comments.length}`, (input as { comment: string }).comment);
      comments = [saved, ...comments];
      // Delivery can precede mutation success; its own echo must not insert another row.
      receive({ message: "new", fromId: "me", commentId: saved.id });
      return { success: true, message: "Comment posted", commentId: saved.id };
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  const hooks = renderHook(() => ({
    panel: useConversation({ convo_id: "chat", refreshKey: 0 }),
    duplicate: useConversation({ convo_id: "chat", refreshKey: 0 }),
  }), { wrapper });
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
  expect(hooks.result.current.panel.allComments?.map((row) => row.id)).toEqual(["saved-1", "old"]);
  expect(hooks.result.current.duplicate.comments).toBe(hooks.result.current.panel.comments);
  reads.length = 0;

  fireEvent.change(team.getByRole("textbox", { name: "Team message" }), { target: { value: "Sent from team" } });
  fireEvent.click(team.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(hooks.result.current.panel.allComments?.[0]?.content).toBe("Sent from team"));
  await team.findByText("Sent from team");
  expect(reads.sort()).toEqual([10, 15]);
  expect(hooks.result.current.panel.allComments?.map((row) => row.id)).toEqual(["saved-2", "saved-1", "old"]);

  await act(async () => receive({ message: "reaction", fromId: "peer", commentId: "old", username: "Peer", emoji: "👍" }));
  const panelKey = getQueryKey(testApi.comments.getConversationComments, { convo_id: "chat", limit: 10, refreshKey: 0, searchQuery: "" }, "infinite");
  const cached = queryClient.getQueryData<{ pages: { data: { id: string; reactions: unknown }[] }[] }>(panelKey);
  expect(cached?.pages[0]?.data.find((row) => row.id === "old")?.reactions).toEqual({ "👍": ["Peer"] });
});
