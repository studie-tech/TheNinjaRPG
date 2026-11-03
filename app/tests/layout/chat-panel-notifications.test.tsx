import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { getDefaultStore } from "jotai";
import * as client from "@/app/_trpc/client";
import * as mutes from "@/hooks/useChatMutes";
import * as taverns from "@/hooks/useTaverns";
import ChatPanelBody from "@/layout/ChatPanelContent";
import * as prompt from "@/layout/NewConversationPrompt";
import { chatPanelAtom } from "@/libs/chatPanel";
import * as context from "@/utils/UserContext";

beforeEach(() => {
  getDefaultStore().set(chatPanelAtom, { owner: "panel", tab: "tavern" });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("reconciles cleared inbox news when the phone chat list loads", () => {
  const updateNotifications = vi.fn();
  const notifications = [{ href: "/inbox", name: "2 messages", notificationCount: 2 }, { href: "/news", name: "News" }];
  vi.spyOn(context, "useUserData").mockReturnValue({ data: { userId: "reader", tutorialOn: true }, notifications, updateNotifications } as never);
  vi.spyOn(taverns, "useTaverns").mockReturnValue({ availTaverns: ["Global"], isLoading: false } as never);
  vi.spyOn(mutes, "useChatMutes").mockReturnValue({ chatMuted: false, isSilenced: () => false } as never);
  vi.spyOn(prompt, "NewConversationPrompt").mockReturnValue(<></>);
  Object.assign(vi.spyOn(client, "api" as never), {
    comments: { getUserConversations: { useQuery: () => ({ data: [], isPending: false }) } },
  });
  const view = render(<ChatPanelBody isPhone isWide={false} onToggleWide={() => {}} onClose={() => {}} />);
  expect(view.getByText("No private messages yet.")).toBeTruthy();
  expect(updateNotifications).toHaveBeenCalledWith([{ href: "/news", name: "News" }]);
});
