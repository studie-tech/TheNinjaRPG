import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import Tavern from "@/app/[shell]/tavern/page";
import * as localStorage from "@/hooks/localstorage";
import * as mutes from "@/hooks/useChatMutes";
import * as tavernActivity from "@/hooks/useTavernActivity";
import * as taverns from "@/hooks/useTaverns";
import * as conversation from "@/layout/Conversation";
import * as context from "@/utils/UserContext";

let unmutedTavernIds: string[];
let chatMuted: boolean;
let storedTavern: string | undefined;
let role: string;
let globalTavernEnabled: boolean;
const toggleTavernMute = vi.fn();
const setChatMuted = vi.fn();

beforeEach(() => {
  unmutedTavernIds = [];
  chatMuted = false;
  storedTavern = "Konoki";
  role = "USER";
  globalTavernEnabled = true;
  toggleTavernMute.mockReset();
  setChatMuted.mockReset();
  vi.spyOn(context, "useRequiredUserData").mockImplementation(
    () =>
      ({
        data: { userId: "reader", role, isBanned: false, isSilenced: false },
      }) as never,
  );
  vi.spyOn(taverns, "useTaverns").mockImplementation(() => {
    const canAccessGlobal = globalTavernEnabled || role !== "USER";
    return {
      availTaverns: canAccessGlobal ? ["Global", "Konoki"] : ["Konoki"],
      localTavern: "Konoki",
      canAccessGlobal,
      globalTavernEnabled,
      isLoading: false,
    } as never;
  });
  vi.spyOn(tavernActivity, "useTavernIds").mockReturnValue([
    { id: "global-id", title: "Global" },
    { id: "konoki-id", title: "Konoki" },
  ]);
  vi.spyOn(localStorage, "useLocalStorage").mockImplementation(
    () => [storedTavern, vi.fn()] as never,
  );
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
    convo_title,
    topRightContent,
  }: {
    convo_title: string;
    topRightContent: React.ReactNode;
  }) => (
    <div>
      <h1>{`Conversation ${convo_title}`}</h1>
      {topRightContent}
    </div>
  )) as never);
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

it.each([
  ["no stored tavern", undefined, true, "Global"],
  ["a stored Global tavern while it is disabled", "Global", false, "Konoki"],
] as const)("selects the shown tavern with %s", (_case, stored, enabled, expected) => {
  storedTavern = stored;
  globalTavernEnabled = enabled;
  const view = render(<Tavern />);
  expect(view.getByRole("heading", { name: `Conversation ${expected}` })).toBeDefined();
  expect(
    view.getByRole("button", { name: expected }).classList.contains("active"),
  ).toBe(true);
});

it("shows the open tavern in the staff tavern picker before one is chosen", () => {
  storedTavern = undefined;
  role = "MODERATOR";
  const view = render(<Tavern />);
  expect(view.getByRole("heading", { name: "Conversation Global" })).toBeDefined();
  expect(view.getByRole("combobox").textContent).toBe("Global");
});
