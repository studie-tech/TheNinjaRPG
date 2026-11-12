import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import * as client from "@/app/_trpc/client";
import { clearInboxNotifications } from "@/deltas/chat";
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
import * as context from "@/utils/UserContext";

beforeEach(() => {
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
  getDefaultStore().set(chatPanelAtom, { owner: null, tab: "tavern" });
  getDefaultStore().set(chatMentionsAtom, {});
  getDefaultStore().set(chatTavernActivityAtom, {});
  vi.restoreAllMocks();
});

it("reconciles cleared inbox news when the phone chat list loads", () => {
  const updateNotifications = vi.fn();
  const notifications = [
    { href: "/inbox", name: "2 messages", notificationCount: 2 },
    { href: "/news", name: "News" },
  ];
  vi.spyOn(context, "useUserData").mockReturnValue({
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
  Object.assign(vi.spyOn(client, "api" as never), {
    comments: {
      getUserConversations: { useQuery: () => ({ data: [], isPending: false }) },
    },
  });
  const view = render(
    <ChatPanelBody isPhone isWide={false} onToggleWide={() => {}} onClose={() => {}} />,
  );
  expect(view.getByText("No private messages yet.")).toBeTruthy();
  expect(updateNotifications).toHaveBeenCalledWith(clearInboxNotifications);
});

it("shows new tavern messages per tavern on the phone chat list", () => {
  getDefaultStore().set(chatTavernActivityAtom, { global: 3, akikaze: 2 });
  getDefaultStore().set(chatMentionsAtom, { global: 1 });
  vi.spyOn(context, "useUserData").mockReturnValue({
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
  Object.assign(vi.spyOn(client, "api" as never), {
    comments: {
      getUserConversations: { useQuery: () => ({ data: [], isPending: false }) },
    },
  });
  const view = render(
    <ChatPanelBody isPhone isWide={false} onToggleWide={() => {}} onClose={() => {}} />,
  );
  expect(view.getByRole("button", { name: "Global, 3 unread" })).toBeTruthy();
  expect(view.getByRole("button", { name: "Akikaze, muted" })).toBeTruthy();
  expect(view.getByRole("tab", { name: /Chats/ }).textContent).toContain("3");
});
