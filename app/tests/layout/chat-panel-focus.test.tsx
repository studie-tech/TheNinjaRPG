import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { MESSAGING_MIN_LEVEL } from "@/drizzle/constants";
import * as media from "@/hooks/useMediaQuery";
import { ChatPanel } from "@/layout/ChatPanel";
import * as content from "@/layout/ChatPanelContent";
import { chatMentionsAtom, chatPanelAtom } from "@/libs/chatPanel";
import * as context from "@/utils/UserContext";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../setup/browserGlobals";
import { mockUserContextValue } from "../setup/userContext";

let level: number;

beforeEach(() => {
  level = MESSAGING_MIN_LEVEL;
  installBrowserGlobals();
  vi.spyOn(media, "useMediaQuery").mockReturnValue(true);
  mockUserContextValue(
    () =>
      ({
        data: {
          userId: "reader",
          level,
          tutorialOn: true,
          chatMuted: false,
          mutedConversationIds: [],
          unmutedTavernIds: [],
        },
      }) as never,
  );
  vi.spyOn(content, "default").mockImplementation(({ onClose }) => (
    <button type="button" onClick={onClose}>
      Close chat
    </button>
  ));
  getDefaultStore().set(chatPanelAtom, { owner: null, tab: "tavern" });
  getDefaultStore().set(chatMentionsAtom, {});
});

afterEach(async () => {
  cleanup();
  await flushRadixFocus();
  getDefaultStore().set(chatPanelAtom, { owner: null, tab: "tavern" });
  getDefaultStore().set(chatMentionsAtom, {});
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

const openPhoneChat = async () => {
  const view = render(<ChatPanel>Chat</ChatPanel>);
  const trigger = view.getByRole("button", { name: "Chat" });
  vi.spyOn(trigger, "getClientRects").mockImplementation(
    () => (trigger.hidden ? [] : [{}]) as unknown as DOMRectList,
  );
  act(() => trigger.focus());
  // jsdom requires the click that a browser dispatches when Enter activates a button.
  fireEvent.keyDown(trigger, { key: "Enter" });
  fireEvent.click(trigger);
  const close = await view.findByRole("button", { name: "Close chat" });
  act(() => close.focus());
  return { view, trigger, close };
};

it.each([false, true])(
  "only offers chat from the messaging minimum level (phone=%s)",
  (isPhone) => {
    vi.spyOn(media, "useMediaQuery").mockReturnValue(isPhone);
    level = MESSAGING_MIN_LEVEL - 1;
    const view = render(<ChatPanel>Chat</ChatPanel>);
    expect(view.queryByRole("button", { name: "Chat" })).toBeNull();
    for (const eligibleLevel of [MESSAGING_MIN_LEVEL, MESSAGING_MIN_LEVEL + 1]) {
      level = eligibleLevel;
      view.rerender(<ChatPanel>Chat</ChatPanel>);
      expect(view.getByRole("button", { name: "Chat" })).toBeTruthy();
    }
  },
);

it("closes chat and releases Activity when a character falls below the messaging minimum", async () => {
  const { view } = await openPhoneChat();
  level = MESSAGING_MIN_LEVEL - 1;
  act(() =>
    getDefaultStore().set(chatPanelAtom, (current) => ({
      ...current,
      openRequested: true,
    })),
  );
  view.rerender(<ChatPanel>Chat</ChatPanel>);
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  expect(view.queryByRole("button", { name: "Chat" })).toBeNull();
  expect(getDefaultStore().get(chatPanelAtom).owner).toBeNull();
  expect(getDefaultStore().get(chatPanelAtom).openRequested).toBe(false);
});

it.each(["Escape", "Close button"])(
  "returns phone chat focus to its opener after %s",
  async (dismissal) => {
    const { view, trigger, close } = await openPhoneChat();
    if (dismissal === "Escape") fireEvent.keyDown(close, { key: "Escape" });
    else fireEvent.click(close);
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement === trigger).toBe(true));
    expect(getDefaultStore().get(chatPanelAtom).owner).toBeNull();
  },
);

it.each(["hidden", "disconnected"])(
  "does not return phone chat focus to a %s opener",
  async (state) => {
    const { view, trigger, close } = await openPhoneChat();
    if (state === "hidden") trigger.hidden = true;
    else
      Object.defineProperty(trigger, "isConnected", {
        configurable: true,
        value: false,
      });
    const focus = vi.spyOn(trigger, "focus");
    fireEvent.click(close);
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(focus).not.toHaveBeenCalled();
  },
);
