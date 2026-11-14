import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import * as client from "@/app/_trpc/client";
import * as mutes from "@/hooks/useChatMutes";
import * as tavernActivity from "@/hooks/useTavernActivity";
import * as taverns from "@/hooks/useTaverns";
import ChatPanelBody from "@/layout/ChatPanelContent";
import * as prompt from "@/layout/NewConversationPrompt";
import {
  chatMentionsAtom,
  chatPanelAtom,
  chatTavernActivityAtom,
} from "@/libs/chatPanel";
import { fakeTrpcClient, TrpcTestProviders, testApi } from "../setup/trpc";
import { mockUserContextValue } from "../setup/userContext";

let queryClient: QueryClient;

const mount = () =>
  render(
    <TrpcTestProviders
      client={fakeTrpcClient((path) => {
        if (path !== "comments.getUserConversations") throw new Error(path);
        return [];
      })}
      queryClient={queryClient}
    >
      <ChatPanelBody
        isPhone
        isWide={false}
        onToggleWide={() => {}}
        onClose={() => {}}
      />
    </TrpcTestProviders>,
  );

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  Object.assign(vi.spyOn(client, "api" as never), { comments: testApi.comments });
  getDefaultStore().set(chatPanelAtom, { owner: "panel", tab: "tavern" });
  getDefaultStore().set(chatMentionsAtom, {});
  getDefaultStore().set(chatTavernActivityAtom, {});
  vi.spyOn(tavernActivity, "useTavernIds").mockReturnValue([
    { id: "global", title: "Global" },
    { id: "akikaze", title: "Akikaze" },
  ]);
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  getDefaultStore().set(chatPanelAtom, { owner: null, tab: "tavern" });
  getDefaultStore().set(chatMentionsAtom, {});
  getDefaultStore().set(chatTavernActivityAtom, {});
  vi.restoreAllMocks();
});

it("reconciles cleared inbox news when the phone chat list loads", async () => {
  const updateNotifications = vi.fn();
  const notifications = [
    { href: "/inbox", name: "2 messages", notificationCount: 2 },
    { href: "/news", name: "News" },
  ];
  mockUserContextValue({
    data: {
      userId: "reader",
      tutorialOn: true,
      chatMuted: false,
      mutedConversationIds: [],
      unmutedTavernIds: [],
    },
    notifications,
    updateNotifications,
  } as never);
  vi.spyOn(taverns, "useTaverns").mockReturnValue({
    availTaverns: ["Global"],
    isLoading: false,
  } as never);
  vi.spyOn(mutes, "useChatMutes").mockReturnValue({
    chatMuted: false,
    isSilenced: () => false,
  } as never);
  vi.spyOn(prompt, "NewConversationPrompt").mockReturnValue(<></>);
  const view = mount();
  expect(await view.findByText("No private messages yet.")).toBeTruthy();
  await waitFor(() =>
    expect(updateNotifications).toHaveBeenCalledWith(expect.any(Function)),
  );
  expect(updateNotifications.mock.calls[0]?.[0](notifications)).toEqual([
    notifications[1],
  ]);
});

it("shows new tavern messages per tavern on the phone chat list", () => {
  getDefaultStore().set(chatTavernActivityAtom, { global: 3, akikaze: 2 });
  getDefaultStore().set(chatMentionsAtom, { global: 1 });
  mockUserContextValue({
    data: {
      userId: "reader",
      tutorialOn: true,
      chatMuted: false,
      mutedConversationIds: [],
      unmutedTavernIds: ["global"],
    },
    notifications: [],
    updateNotifications: vi.fn(),
  } as never);
  vi.spyOn(taverns, "useTaverns").mockReturnValue({
    availTaverns: ["Global", "Akikaze"],
    isLoading: false,
  } as never);
  vi.spyOn(mutes, "useChatMutes").mockReturnValue({
    chatMuted: false,
    isSilenced: (id: string) => id === "akikaze",
  } as never);
  vi.spyOn(prompt, "NewConversationPrompt").mockReturnValue(<></>);
  const view = mount();
  expect(view.getByRole("button", { name: "Global, 3 unread" })).toBeTruthy();
  expect(view.getByRole("button", { name: "Akikaze, muted" })).toBeTruthy();
  expect(view.getByRole("tab", { name: /Chats/ }).textContent).toContain("3");
});
