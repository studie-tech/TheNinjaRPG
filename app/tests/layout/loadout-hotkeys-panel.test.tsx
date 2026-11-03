import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as battleHotkeys from "@/hooks/useBattleHotkeys";
import { LoadoutHotkeysPanel } from "@/layout/HotkeyControls";
import * as userContext from "@/utils/UserContext";

beforeEach(() => {
  vi.spyOn(userContext, "useUserData").mockReturnValue({ data: { role: "USER" } } as never);
  vi.spyOn(battleHotkeys, "useBattleHotkeys").mockReturnValue({
    byAction: { sword: "q" },
    hasItemLoadout: true,
    hasJutsuLoadout: true,
    setHotkey: vi.fn(),
  } as never);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

it("puts each key directly before its action's name", () => {
  render(
    <LoadoutHotkeysPanel
      kind="item"
      actions={[
        { id: "sword", name: "Chakra Sword" },
        { id: "bite", name: "Widow's Bite" },
      ]}
    />,
  );
  const rows = screen.getAllByRole("listitem");
  expect(rows.map((row) => row.textContent)).toEqual(["QChakra Sword", "+Widow's Bite"]);
  expect(rows[0]?.firstElementChild?.getAttribute("aria-label")).toBe("Chakra Sword: hotkey Q");
});
