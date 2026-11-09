import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { getDefaultStore } from "jotai";
import type Pusher from "pusher-js";
import * as client from "@/app/_trpc/client";
import {
  conversation,
  conversationComment,
  parentalControl,
  user2conversation,
  userBlackList,
  userData,
} from "@/drizzle/schema";
import { useConversationViewing } from "@/hooks/useConversationViewing";
import * as taverns from "@/hooks/useTaverns";
import { useTavernActivity } from "@/hooks/useTavernActivity";
import {
  chatMentionsAtom,
  chatPanelAtom,
  chatTavernActivityAtom,
  chatViewedConversationsAtom,
} from "@/libs/chatPanel";
import { commentsRouter } from "@/server/api/routers/comments";
import { insertUsers } from "../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../setup/testDatabase";

type Handler = (event: {
  message: string;
  fromId?: string;
  commentId?: string;
}) => void;
let handlers: Record<string, Handler>;
let hiddenCommentIds: string[];
let fetchComment: ReturnType<typeof vi.fn>;

const pusher = {
  subscribe: (id: string) => ({
    bind: (_name: string, handler: Handler) => {
      handlers[id] = handler;
    },
    unbind: () => {},
  }),
  unsubscribe: (id: string) => {
    delete handlers[id];
  },
} as unknown as Pusher;

const player = (
  unmutedTavernIds: string[] = ["global", "akikaze"],
  chatMuted = false,
) =>
  ({
    userId: "me",
    level: 50,
    isBanned: false,
    isSilenced: false,
    chatMuted,
    mutedConversationIds: [],
    unmutedTavernIds,
  }) as never;

const store = getDefaultStore();
const activity = () => store.get(chatTavernActivityAtom);
const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");

beforeEach(() => {
  handlers = {};
  hiddenCommentIds = [];
  fetchComment = vi.fn(async ({ commentId }: { commentId: string }) =>
    hiddenCommentIds.includes(commentId) ? null : { id: commentId },
  );
  store.set(chatTavernActivityAtom, {});
  store.set(chatViewedConversationsAtom, {});
  store.set(chatMentionsAtom, {});
  store.set(chatPanelAtom, { owner: null, tab: "tavern" });
  vi.spyOn(taverns, "useTaverns").mockReturnValue({
    availTaverns: ["Global", "Akikaze"],
    isLoading: false,
  } as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    comments: {
      fetchConversationComment: { useMutation: () => ({ mutateAsync: fetchComment }) },
      getTavernIds: {
        useQuery: () => ({
          data: [
            { id: "global", title: "Global" },
            { id: "akikaze", title: "Akikaze" },
          ],
        }),
      },
    },
  });
});

afterEach(() => {
  cleanup();
  store.set(chatTavernActivityAtom, {});
  store.set(chatViewedConversationsAtom, {});
  store.set(chatMentionsAtom, {});
  store.set(chatPanelAtom, { owner: null, tab: "tavern" });
  if (originalMatchMedia)
    Object.defineProperty(window, "matchMedia", originalMatchMedia);
  else Reflect.deleteProperty(window, "matchMedia");
  vi.restoreAllMocks();
});

it("counts new messages from other players in every unmuted tavern", async () => {
  renderHook(() => useTavernActivity(pusher, player()));
  handlers.global?.({ message: "new", fromId: "sora", commentId: "sora" });
  handlers.global?.({ message: "new", fromId: "hana", commentId: "hana" });
  handlers.akikaze?.({ message: "new", fromId: "sora", commentId: "sora" });
  await waitFor(() => expect(activity()).toEqual({ global: 2, akikaze: 1 }));
});

it("leaves out muted taverns and every tavern while all chat is muted", () => {
  const { rerender } = renderHook(({ user }) => useTavernActivity(pusher, user), {
    initialProps: { user: player(["akikaze"]) },
  });
  expect(Object.keys(handlers)).toEqual(["akikaze"]);
  store.set(chatTavernActivityAtom, { global: 1, akikaze: 2 });
  rerender({ user: player([], true) });
  expect(Object.keys(handlers)).toEqual([]);
  expect(activity()).toEqual({ global: 1, akikaze: 2 });
});

it("follows no tavern until the player unmutes one", () => {
  renderHook(() => useTavernActivity(pusher, player([])));
  expect(Object.keys(handlers)).toEqual([]);
});

it("follows no tavern for a profile without the unmute list", () => {
  const { unmutedTavernIds: _, ...profile } = player() as unknown as Record<
    string,
    unknown
  >;
  renderHook(() => useTavernActivity(pusher, profile as never));
  expect(Object.keys(handlers)).toEqual([]);
});

it("ignores own messages, other events, open taverns and blocked players", async () => {
  hiddenCommentIds = ["troll"];
  store.set(chatViewedConversationsAtom, { akikaze: 1 });
  renderHook(() => useTavernActivity(pusher, player()));
  handlers.global?.({ message: "new", fromId: "me", commentId: "me" });
  handlers.global?.({ message: "typing", fromId: "sora" });
  handlers.global?.({ message: "new", fromId: "sora" });
  handlers.global?.({ message: "new", fromId: "troll", commentId: "troll" });
  handlers.akikaze?.({ message: "new", fromId: "sora", commentId: "sora" });
  handlers.global?.({ message: "new", fromId: "hana", commentId: "hana" });
  await waitFor(() => expect(activity()).toEqual({ global: 1 }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(activity()).toEqual({ global: 1 });
  expect(fetchComment.mock.calls).toEqual([
    [{ commentId: "troll", conversationId: "global" }],
    [{ commentId: "hana", conversationId: "global" }],
  ]);
});

it("starts fresh for another account and drops messages still being checked", async () => {
  let release!: () => void;
  const pending = new Promise<{ id: string } | null>((resolve) => {
    release = () => resolve({ id: "new" });
  });
  fetchComment.mockImplementation(() => pending);
  store.set(chatTavernActivityAtom, { global: 4 });
  const other = { ...(player() as object), userId: "other" } as never;
  const { rerender } = renderHook(({ user }) => useTavernActivity(pusher, user), {
    initialProps: { user: player() },
  });
  handlers.global?.({ message: "new", fromId: "sora", commentId: "sora" });
  rerender({ user: other });
  expect(activity()).toEqual({});
  release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(activity()).toEqual({});
});

it("keeps the count clear when the tavern opens during a comment lookup", async () => {
  let release!: () => void;
  const pending = new Promise<{ id: string } | null>((resolve) => {
    release = () => resolve({ id: "new" });
  });
  fetchComment.mockImplementation(() => pending);
  renderHook(() => useTavernActivity(pusher, player()));
  handlers.global?.({ message: "new", fromId: "sora", commentId: "sora" });
  store.set(chatViewedConversationsAtom, { global: 1 });
  await act(async () => release());
  expect(activity()).toEqual({});
});

it("discards messages read before lookup settles while retaining other and later activity", async () => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
  let release!: () => void;
  const pending = new Promise<{ id: string } | null>((resolve) => {
    release = () => resolve({ id: "new" });
  });
  fetchComment.mockImplementation(() => pending);
  const { rerender } = renderHook(
    ({ open }) => {
      useTavernActivity(pusher, player());
      useConversationViewing(open ? "global" : undefined, true);
    },
    { initialProps: { open: false } },
  );
  handlers.global?.({ message: "new", fromId: "sora", commentId: "sora" });
  handlers.akikaze?.({ message: "new", fromId: "hana", commentId: "hana" });
  rerender({ open: true });
  expect(store.get(chatViewedConversationsAtom)).toEqual({ global: 1 });
  expect(activity()).toEqual({});
  rerender({ open: false });
  expect(store.get(chatViewedConversationsAtom)).toEqual({});
  handlers.global?.({ message: "new", fromId: "sora", commentId: "sora" });
  await act(async () => release());
  expect(activity()).toEqual({ global: 1, akikaze: 1 });
});

it("skips the message when the comment lookup fails", async () => {
  fetchComment.mockRejectedValue(new Error("Comment unavailable"));
  renderHook(() => useTavernActivity(pusher, player()));
  await act(async () =>
    handlers.global?.({ message: "new", fromId: "troll", commentId: "troll" }),
  );
  expect(activity()).toEqual({});
});

it("keeps counts during a tavern lookup and discards unavailable taverns once it settles", async () => {
  let visible: { id: string; title: string }[] | undefined = [
    { id: "global", title: "Global" },
    { id: "akikaze", title: "Akikaze" },
  ];
  Object.assign(vi.spyOn(client, "api" as never), {
    comments: {
      fetchConversationComment: { useMutation: () => ({ mutateAsync: fetchComment }) },
      getTavernIds: { useQuery: () => ({ data: visible }) },
    },
  });
  const { rerender } = renderHook(() =>
    useTavernActivity(pusher, player(["global", "akikaze", "hyorin"])),
  );
  await act(async () => {
    handlers.global?.({ message: "new", fromId: "sora", commentId: "sora" });
    handlers.akikaze?.({ message: "new", fromId: "sora", commentId: "sora" });
  });
  expect(activity()).toEqual({ global: 1, akikaze: 1 });
  visible = undefined;
  vi.spyOn(taverns, "useTaverns").mockReturnValue({
    availTaverns: ["Global", "Hyorin"],
    isLoading: false,
  } as never);
  rerender();
  expect(activity()).toEqual({ global: 1, akikaze: 1 });
  visible = [
    { id: "global", title: "Global" },
    { id: "hyorin", title: "Hyorin" },
  ];
  rerender();
  expect(Object.keys(handlers)).toEqual(["global", "hyorin"]);
  expect(activity()).toEqual({ global: 1 });
});

it.each([{ level: 1 }, { isBanned: true }, { isSilenced: true }])(
  "drops cached subscriptions and activity when tavern reading is disallowed: %j",
  async (restriction) => {
    const { rerender } = renderHook(({ user }) => useTavernActivity(pusher, user), {
      initialProps: { user: player() },
    });
    await act(async () =>
      handlers.global?.({ message: "new", fromId: "sora", commentId: "sora" }),
    );
    expect(activity()).toEqual({ global: 1 });
    rerender({ user: { ...(player() as object), ...restriction } as never });
    expect(Object.keys(handlers)).toEqual([]);
    expect(activity()).toEqual({});
  },
);

describeWithDatabase("authorized tavern activity", () => {
  beforeEach(async () => {
    await resetTables(
      conversationComment,
      user2conversation,
      conversation,
      parentalControl,
      userBlackList,
      userData,
    );
  });

  it.each([
    { readerRole: "USER", senderRole: "USER", blockedBy: "me", visible: false },
    { readerRole: "USER", senderRole: "USER", blockedBy: "sender", visible: false },
    { readerRole: "USER", senderRole: "MODERATOR", blockedBy: "me", visible: true },
    { readerRole: "MODERATOR", senderRole: "USER", blockedBy: "sender", visible: true },
  ] as const)(
    "matches public comment visibility for %j",
    async ({ readerRole, senderRole, blockedBy, visible }) => {
      await insertUsers([
        { userId: "me", role: readerRole },
        { userId: "sender", role: senderRole },
      ]);
      const db = await getTestDatabase();
      await db
        .insert(conversation)
        .values({ id: "global", title: "Global", isPublic: true });
      await db.insert(conversationComment).values({
        id: "message",
        conversationId: "global",
        userId: "sender",
        authorId: "sender",
        content: "A tavern message",
      });
      await db.insert(userBlackList).values({
        creatorUserId: blockedBy,
        targetUserId: blockedBy === "me" ? "sender" : "me",
      });
      const caller = await callerFor(commentsRouter, "me");
      const comments = await caller.getConversationComments({
        convo_id: "global",
        limit: 10,
      });
      expect(comments.data.map((comment) => comment.id)).toEqual(
        visible ? ["message"] : [],
      );
      fetchComment.mockImplementation((input) =>
        caller.fetchConversationComment(input),
      );
      renderHook(() => useTavernActivity(pusher, player()));
      await act(async () => {
        handlers.global?.({ message: "new", fromId: "sender", commentId: "message" });
      });
      await fetchComment.mock.results[0]?.value;
      await waitFor(() => expect(activity()).toEqual(visible ? { global: 1 } : {}));
      expect(fetchComment).toHaveBeenCalledWith({
        commentId: "message",
        conversationId: "global",
      });
    },
  );
});
