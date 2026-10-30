import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "bun:test";
import { useCombatPreferences } from "@/hooks/combat";
import { ensureDom } from "../setup/dom.mjs";

const customEventDescriptor = Object.getOwnPropertyDescriptor(globalThis, "CustomEvent");

beforeEach(() => {
  ensureDom();
  Object.defineProperty(globalThis, "CustomEvent", {
    configurable: true,
    value: window.CustomEvent,
  });
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  if (customEventDescriptor) {
    Object.defineProperty(globalThis, "CustomEvent", customEventDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "CustomEvent");
  }
});

it("restores the desktop panel preference independently of battle focus", () => {
  const first = renderHook(useCombatPreferences);
  expect(first.result.current.swapFocusPanels).toBe(false);
  act(() => first.result.current.setSwapFocusPanels(true));
  act(() => first.result.current.setBattleFocus(false));
  first.unmount();

  const restored = renderHook(useCombatPreferences);
  expect(restored.result.current.swapFocusPanels).toBe(true);
  expect(restored.result.current.battleFocus).toBe(false);
  act(() => restored.result.current.setBattleFocus(true));
  expect(restored.result.current.swapFocusPanels).toBe(true);
});
