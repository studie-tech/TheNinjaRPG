import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import Tavern from "@/app/[shell]/tavern/page";
import * as localStorage from "@/hooks/localstorage";
import * as mutes from "@/hooks/useChatMutes";
import * as tavernActivity from "@/hooks/useTavernActivity";
import * as taverns from "@/hooks/useTaverns";
import * as conversation from "@/layout/Conversation";
import * as context from "@/utils/UserContext";

let mutedIds: string[];
let chatMuted: boolean;
const toggleMute = vi.fn();
const setChatMuted = vi.fn();

beforeEach(() => {
  mutedIds = [];
  chatMuted = false;
  toggleMute.mockReset();
  setChatMuted.mockReset();
  vi.spyOn(context, "useRequiredUserData").mockReturnValue({
    data: { userId: "reader", role: "USER", isBanned: false, isSilenced: false },
  } as never);
  vi.spyOn(taverns, "useTaverns").mockReturnValue({
    availTaverns: ["Global", "Konoki"],
    localTavern: "Konoki",
    canAccessGlobal: true,
    globalTavernEnabled: true,
    isLoading: false,
  } as never);
  vi.spyOn(tavernActivity, "useTavernIds").mockReturnValue([
    { id: "global-id", title: "Global" },
    { id: "konoki-id", title: "Konoki" },
  ]);
  vi.spyOn(localStorage, "useLocalStorage").mockReturnValue(["Konoki", vi.fn()] as never);
  vi.spyOn(mutes, "useChatMutes").mockImplementation(
    () =>
      ({
        chatMuted,
        isPending: false,
        isSilenced: (id: string | undefined) => chatMuted || mutedIds.includes(id ?? ""),
        toggleMute,
        setChatMuted,
      }) as never,
  );
  // The conversation itself loads over the network; the page only places the controls.
  vi.spyOn(conversation, "default").mockImplementation((({
    topRightContent,
  }: {
    topRightContent: React.ReactNode;
  }) => <div>{topRightContent}</div>) as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("mutes the open tavern from its own page", () => {
  const view = render(<Tavern />);
  const bell = view.getByRole("button", { name: "Mute Konoki" });
  expect(bell.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(bell);
  expect(toggleMute).toHaveBeenCalledWith("konoki-id");
});

it("unmutes a muted tavern", () => {
  mutedIds = ["konoki-id"];
  const view = render(<Tavern />);
  const bell = view.getByRole("button", { name: "Unmute Konoki" });
  expect(bell.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(bell);
  expect(toggleMute).toHaveBeenCalledWith("konoki-id");
});

it("turns muting all chat off rather than muting one tavern", () => {
  chatMuted = true;
  const view = render(<Tavern />);
  fireEvent.click(view.getByRole("button", { name: "Unmute all chat notifications" }));
  expect(setChatMuted).toHaveBeenCalledWith(false);
  expect(toggleMute).not.toHaveBeenCalled();
});
