import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "bun:test";
import { useCombatPreferences } from "@/hooks/combat";
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
