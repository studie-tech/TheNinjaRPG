import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import Tavern from "@/app/[shell]/tavern/page";
import * as localStorage from "@/hooks/localstorage";
import * as mutes from "@/hooks/useChatMutes";
import * as tavernActivity from "@/hooks/useTavernActivity";
import * as taverns from "@/hooks/useTaverns";
import * as conversation from "@/layout/Conversation";
import * as context from "@/utils/UserContext";

let unmutedTavernIds: string[];
let chatMuted: boolean;
const toggleTavernMute = vi.fn();
const setChatMuted = vi.fn();

beforeEach(() => {
  unmutedTavernIds = [];
  chatMuted = false;
  toggleTavernMute.mockReset();
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
  vi.spyOn(localStorage, "useLocalStorage").mockReturnValue([
    "Konoki",
    vi.fn(),
  ] as never);
  vi.spyOn(mutes, "useChatMutes").mockImplementation(
    () =>
      ({
        chatMuted,
        isPending: false,
        isTavernSilenced: (id: string) => chatMuted || !unmutedTavernIds.includes(id),
        toggleTavernMute,
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

it("starts the open tavern muted, and unmutes it from its own page", () => {
  const view = render(<Tavern />);
  const bell = view.getByRole("button", { name: "Unmute Konoki" });
  expect(bell.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(bell);
  expect(toggleTavernMute).toHaveBeenCalledWith("konoki-id");
});

it("mutes a tavern the player unmuted", () => {
  unmutedTavernIds = ["konoki-id"];
  const view = render(<Tavern />);
  const bell = view.getByRole("button", { name: "Mute Konoki" });
  expect(bell.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(bell);
  expect(toggleTavernMute).toHaveBeenCalledWith("konoki-id");
});

it("turns muting all chat off rather than changing one tavern", () => {
  chatMuted = true;
  unmutedTavernIds = ["konoki-id"];
  const view = render(<Tavern />);
  fireEvent.click(view.getByRole("button", { name: "Unmute chat notifications" }));
  expect(setChatMuted).toHaveBeenCalledWith(false);
  expect(toggleTavernMute).not.toHaveBeenCalled();
});
