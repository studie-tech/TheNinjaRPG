import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { getDefaultStore } from "jotai";
import * as dialog from "@/components/ui/dialog";
import * as media from "@/hooks/useMediaQuery";
import { ChatPanel } from "@/layout/ChatPanel";
import * as content from "@/layout/ChatPanelContent";
import { chatMentionsAtom, chatPanelAtom } from "@/libs/chatPanel";
import * as context from "@/utils/UserContext";
import { ensureDom } from "../setup/dom.mjs";
import { actualDialog } from "../setup/preload";

const eventDescriptors = ["Event", "CustomEvent"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);

beforeEach(() => {
  ensureDom();
  Object.defineProperties(globalThis, {
    Event: { configurable: true, value: window.Event },
    CustomEvent: { configurable: true, value: window.CustomEvent },
  });
  for (const key of Object.keys(actualDialog) as (keyof typeof actualDialog)[]) {
    vi.spyOn(dialog, key).mockImplementation(actualDialog[key] as never);
  }
  vi.spyOn(media, "useMediaQuery").mockReturnValue(true);
  vi.spyOn(context, "useUserData").mockReturnValue({ data: { userId: "reader", tutorialOn: true, chatMuted: false, mutedConversationIds: [] } } as never);
  vi.spyOn(content, "default").mockImplementation(({ onClose }) => <button type="button" onClick={onClose}>Close chat</button>);
  getDefaultStore().set(chatPanelAtom, { owner: null, tab: "tavern" });
  getDefaultStore().set(chatMentionsAtom, {});
});

afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 0));
  getDefaultStore().set(chatPanelAtom, { owner: null, tab: "tavern" });
  getDefaultStore().set(chatMentionsAtom, {});
  vi.restoreAllMocks();
  for (const [key, descriptor] of eventDescriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

const openPhoneChat = async () => {
  const view = render(<ChatPanel>Chat</ChatPanel>);
  const trigger = view.getByRole("button", { name: "Chat" });
  vi.spyOn(trigger, "getClientRects").mockImplementation(() => (trigger.hidden ? [] : [{}]) as unknown as DOMRectList);
  act(() => trigger.focus());
  // jsdom requires the click that a browser dispatches when Enter activates a button.
  fireEvent.keyDown(trigger, { key: "Enter" });
  fireEvent.click(trigger);
  const close = await view.findByRole("button", { name: "Close chat" });
  act(() => close.focus());
  return { view, trigger, close };
};

it.each(["Escape", "Close button"])("returns phone chat focus to its opener after %s", async (dismissal) => {
  const { view, trigger, close } = await openPhoneChat();
  if (dismissal === "Escape") fireEvent.keyDown(close, { key: "Escape" });
  else fireEvent.click(close);
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement === trigger).toBe(true));
  expect(getDefaultStore().get(chatPanelAtom).owner).toBeNull();
});

it.each(["hidden", "disconnected"])("does not return phone chat focus to a %s opener", async (state) => {
  const { view, trigger, close } = await openPhoneChat();
  if (state === "hidden") trigger.hidden = true;
  else Object.defineProperty(trigger, "isConnected", { configurable: true, value: false });
  const focus = vi.spyOn(trigger, "focus");
  fireEvent.click(close);
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(focus).not.toHaveBeenCalled();
});
