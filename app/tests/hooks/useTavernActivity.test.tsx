import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { getDefaultStore } from "jotai";
import type Pusher from "pusher-js";
import * as client from "@/app/_trpc/client";
import * as taverns from "@/hooks/useTaverns";
import { useTavernActivity } from "@/hooks/useTavernActivity";
import { chatTavernActivityAtom, chatViewedConversationsAtom } from "@/libs/chatPanel";

type Handler = (event: { message: string; fromId?: string }) => void;
let handlers: Record<string, Handler>;
let blocked: { targetUserId: string }[];

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

const player = (mutedConversationIds: string[] = [], chatMuted = false) =>
  ({
    userId: "me",
    level: 50,
    isBanned: false,
    isSilenced: false,
    chatMuted,
    mutedConversationIds,
  }) as never;

const store = getDefaultStore();
const activity = () => store.get(chatTavernActivityAtom);

beforeEach(() => {
  handlers = {};
  blocked = [];
  store.set(chatTavernActivityAtom, {});
  store.set(chatViewedConversationsAtom, {});
  vi.spyOn(taverns, "useTaverns").mockReturnValue({
    availTaverns: ["Global", "Akikaze"],
    isLoading: false,
  } as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    comments: {
      getTavernIds: {
        useQuery: () => ({
          data: [
            { id: "global", title: "Global" },
            { id: "akikaze", title: "Akikaze" },
          ],
        }),
      },
    },
    useUtils: () => ({
      profile: { getBlacklist: { fetch: async () => blocked } },
    }),
  });
});

afterEach(() => {
  cleanup();
  store.set(chatTavernActivityAtom, {});
  store.set(chatViewedConversationsAtom, {});
  vi.restoreAllMocks();
});

it("counts new messages from other players in every unmuted tavern", async () => {
  renderHook(() => useTavernActivity(pusher, player()));
  handlers.global?.({ message: "new", fromId: "sora" });
  handlers.global?.({ message: "new", fromId: "hana" });
  handlers.akikaze?.({ message: "new", fromId: "sora" });
  await waitFor(() => expect(activity()).toEqual({ global: 2, akikaze: 1 }));
});

it("leaves out muted taverns and every tavern while all chat is muted", () => {
  const { rerender } = renderHook(({ user }) => useTavernActivity(pusher, user), {
    initialProps: { user: player(["global"]) },
  });
  expect(Object.keys(handlers)).toEqual(["akikaze"]);
  store.set(chatTavernActivityAtom, { global: 1, akikaze: 2 });
  rerender({ user: player([], true) });
  expect(Object.keys(handlers)).toEqual([]);
  expect(activity()).toEqual({ global: 1, akikaze: 2 });
});

it("ignores own messages, other events, open taverns and blocked players", async () => {
  blocked = [{ targetUserId: "troll" }];
  store.set(chatViewedConversationsAtom, { akikaze: 1 });
  renderHook(() => useTavernActivity(pusher, player()));
  handlers.global?.({ message: "new", fromId: "me" });
  handlers.global?.({ message: "typing", fromId: "sora" });
  handlers.global?.({ message: "new", fromId: "troll" });
  handlers.akikaze?.({ message: "new", fromId: "sora" });
  handlers.global?.({ message: "new", fromId: "hana" });
  await waitFor(() => expect(activity()).toEqual({ global: 1 }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(activity()).toEqual({ global: 1 });
});

it("starts fresh for another account and drops messages still being checked", async () => {
  let release!: () => void;
  const pending = new Promise<{ targetUserId: string }[]>((resolve) => {
    release = () => resolve([]);
  });
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({ profile: { getBlacklist: { fetch: () => pending } } }),
  });
  store.set(chatTavernActivityAtom, { global: 4 });
  const other = { ...(player() as object), userId: "other" } as never;
  const { rerender } = renderHook(({ user }) => useTavernActivity(pusher, user), {
    initialProps: { user: player() },
  });
  handlers.global?.({ message: "new", fromId: "sora" });
  rerender({ user: other });
  expect(activity()).toEqual({});
  release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(activity()).toEqual({});
});

it("keeps the count clear when the tavern opens during a blacklist lookup", async () => {
  let release!: () => void;
  const pending = new Promise<{ targetUserId: string }[]>((resolve) => {
    release = () => resolve([]);
  });
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({ profile: { getBlacklist: { fetch: () => pending } } }),
  });
  renderHook(() => useTavernActivity(pusher, player()));
  handlers.global?.({ message: "new", fromId: "sora" });
  store.set(chatViewedConversationsAtom, { global: 1 });
  await act(async () => release());
  expect(activity()).toEqual({});
});

it("skips the message when the blacklist lookup fails", async () => {
  const fetchBlacklist = vi.fn().mockRejectedValue(new Error("Blacklist unavailable"));
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({ profile: { getBlacklist: { fetch: fetchBlacklist } } }),
  });
  renderHook(() => useTavernActivity(pusher, player()));
  await act(async () => handlers.global?.({ message: "new", fromId: "troll" }));
  expect(activity()).toEqual({});
});

it("keeps counts during a tavern lookup and discards unavailable taverns once it settles", async () => {
  let visible: { id: string; title: string }[] | undefined = [
    { id: "global", title: "Global" },
    { id: "akikaze", title: "Akikaze" },
  ];
  Object.assign(vi.spyOn(client, "api" as never), {
    comments: { getTavernIds: { useQuery: () => ({ data: visible }) } },
  });
  const { rerender } = renderHook(() => useTavernActivity(pusher, player()));
  await act(async () => {
    handlers.global?.({ message: "new", fromId: "sora" });
    handlers.akikaze?.({ message: "new", fromId: "sora" });
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
    await act(async () => handlers.global?.({ message: "new", fromId: "sora" }));
    expect(activity()).toEqual({ global: 1 });
    rerender({ user: { ...(player() as object), ...restriction } as never });
    expect(Object.keys(handlers)).toEqual([]);
    expect(activity()).toEqual({});
  },
);
