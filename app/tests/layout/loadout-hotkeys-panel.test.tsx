import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import * as battleHotkeys from "@/hooks/useBattleHotkeys";
import { LoadoutHotkeysPanel } from "@/layout/HotkeyControls";
import { mockUserContextValue } from "../setup/userContext";

beforeEach(() => {
  mockUserContextValue({
    data: { role: "USER" },
  } as never);
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
  expect(rows.map((row) => row.textContent)).toEqual(["QChakra Sword", "Widow's Bite"]);
  // An unset key draws a centred plus icon rather than a text glyph.
  expect(rows[1]?.querySelector("button svg")).not.toBeNull();
  expect(rows[0]?.parentElement?.className).toContain("grid");
  expect(rows[0]?.firstElementChild?.getAttribute("aria-label")).toBe(
    "Chakra Sword: hotkey Q",
  );
});
