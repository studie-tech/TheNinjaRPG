import { afterEach, beforeEach, expect, it } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import {
  COMBAT_LAYOUT_COMPONENTS,
  DEFAULT_LAYOUT_ORDER,
  useCombatPreferences,
} from "@/hooks/combat";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

beforeEach(() => {
  installBrowserGlobals({ events: ["CustomEvent"] });
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  restoreBrowserGlobals();
});

it("restores the desktop panel preference independently of battle focus", () => {
  const first = renderHook(useCombatPreferences);
  expect(first.result.current.battleFocus).toBe(false);
  expect(first.result.current.swapFocusPanels).toBe(false);
  act(() => first.result.current.setSwapFocusPanels(true));
  act(() => first.result.current.setBattleFocus(false));
  first.unmount();

  const restored = renderHook(useCombatPreferences);
  expect(restored.result.current.swapFocusPanels).toBe(true);
  expect(restored.result.current.battleFocus).toBe(false);
  act(() => restored.result.current.setBattleFocus(true));
  expect(restored.result.current.swapFocusPanels).toBe(true);
  restored.unmount();
  expect(renderHook(useCombatPreferences).result.current.battleFocus).toBe(true);
});

it.each([
  ["toggleGridNumbers", "showGridNumbers", "showGridNumbers", false],
  ["toggleSmallActions", "useSmallActions", "combatSmallActions", false],
  ["toggleBattleLog", "showBattleLog", "combatShowBattleLog", false],
  ["toggleTimeline", "showTimeline", "combatShowTimeline", true],
  ["toggleAggro", "showAggro", "combatShowAggro", true],
  ["toggleBasicActions", "showBasicActions", "combatShowBasicActions", true],
  ["toggleUseTabs", "useTabs", "combatUseTabs", false],
] as const)("%s flips %s under its storage key", (toggle, value, key, initial) => {
  const { result } = renderHook(useCombatPreferences);
  expect(result.current[value]).toBe(initial);
  act(() => result.current[toggle]());
  expect(result.current[value]).toBe(!initial);
  expect(JSON.parse(window.localStorage.getItem(key) ?? "null")).toBe(!initial);
  act(() => result.current[toggle]());
  expect(result.current[value]).toBe(initial);
});

it("orders the layout by component and restores a copy after a change", () => {
  expect(DEFAULT_LAYOUT_ORDER).toEqual(
    COMBAT_LAYOUT_COMPONENTS.map((component) => component.id),
  );
  expect(DEFAULT_LAYOUT_ORDER).toEqual([
    "timer",
    "battlefield",
    "actions",
    "timeline",
    "battlelog",
  ]);
  const { result } = renderHook(useCombatPreferences);
  act(() => result.current.setLayoutOrder(["battlelog", "timer"]));
  expect(result.current.layoutOrder).toEqual(["battlelog", "timer"]);
  act(() => result.current.resetLayoutOrder());
  expect(result.current.layoutOrder).toEqual(DEFAULT_LAYOUT_ORDER);
  expect(result.current.layoutOrder).not.toBe(DEFAULT_LAYOUT_ORDER);
});

it("stores the resource bar visibility", () => {
  const { result } = renderHook(useCombatPreferences);
  expect(result.current.resourceBarsVisibility).toBe("mobile-only");
  act(() => result.current.setResourceBarsVisibility("off"));
  expect(result.current.resourceBarsVisibility).toBe("off");
  expect(
    JSON.parse(window.localStorage.getItem("combatResourceBarsVisibility") ?? "null"),
  ).toBe("off");
});
