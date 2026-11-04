import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { getDefaultStore } from "jotai";
import * as sector from "@/hooks/useSectorVillage";
import { chatMentionsAtom, chatTavernActivityAtom } from "@/libs/chatPanel";
import { useGameMenu } from "@/libs/menus";
import * as routing from "@/utils/routing";
import * as context from "@/utils/UserContext";

const store = getDefaultStore();
let mutedConversationIds: string[] = [];

beforeEach(() => {
  mutedConversationIds = [];
  store.set(chatMentionsAtom, {});
  store.set(chatTavernActivityAtom, {});
  vi.spyOn(context, "useUserDataSelector").mockImplementation(((select: (user: unknown) => unknown) => ({
    data: select({
      sector: 1,
      village: { sector: 1 },
      villageId: "v1",
      isOutlaw: false,
      status: "AWAKE",
      longitude: 0,
      latitude: 0,
      chatMuted: false,
      mutedConversationIds,
    }),
  })) as never);
  vi.spyOn(context, "useUserInfo").mockReturnValue({ notifications: [] } as never);
  vi.spyOn(routing, "usePublicPathname").mockReturnValue("/profile");
  vi.spyOn(sector, "useSectorVillage").mockReturnValue({ sectorVillage: undefined, isLoading: false } as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  store.set(chatMentionsAtom, {});
  store.set(chatTavernActivityAtom, {});
});

const tavernCount = () => {
  const { result } = renderHook(() => useGameMenu());
  return result.current.systems.find((link) => link.href === "/tavern")?.notificationCount;
};

it("counts new tavern messages on the menu's Tavern entry", () => {
  store.set(chatTavernActivityAtom, { global: 3, akikaze: 2 });
  store.set(chatMentionsAtom, { global: 1 });
  expect(tavernCount()).toBe(5);
});

it("leaves muted taverns out of the menu count", () => {
  mutedConversationIds = ["akikaze"];
  store.set(chatTavernActivityAtom, { global: 3, akikaze: 2 });
  expect(tavernCount()).toBe(3);
});
