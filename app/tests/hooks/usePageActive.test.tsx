import { ensureDom } from "../setup-dom.mjs";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { usePageActive } from "@/hooks/usePageActive";
import * as native from "@/libs/native";

ensureDom();

let isHidden = false;
let onAppState: ((active: boolean) => void) | undefined;
const unsubscribe = vi.fn();

beforeEach(() => {
  isHidden = false;
  onAppState = undefined;
  unsubscribe.mockClear();
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => isHidden,
  });
  vi.spyOn(native, "isNative").mockReturnValue(true);
  vi.spyOn(native.appEvents, "onStateChange").mockImplementation((callback) => {
    onAppState = callback;
    return unsubscribe;
  });
});

afterEach(() => {
  cleanup();
  delete (document as unknown as { hidden?: boolean }).hidden;
  vi.restoreAllMocks();
});

it("resumes only when both the native app and document are active", () => {
  const { result } = renderHook(usePageActive);
  expect(result.current).toBe(true);
  act(() => onAppState?.(false));
  expect(result.current).toBe(false);
  act(() => {
    document.dispatchEvent(new window.Event("visibilitychange"));
  });
  expect(result.current).toBe(false);
  act(() => {
    isHidden = true;
    onAppState?.(true);
  });
  expect(result.current).toBe(false);
  act(() => {
    isHidden = false;
    document.dispatchEvent(new window.Event("visibilitychange"));
  });
  expect(result.current).toBe(true);
});

it("reads initial visibility and removes lifecycle listeners on unmount", () => {
  isHidden = true;
  const removeListener = vi.spyOn(window.EventTarget.prototype, "removeEventListener");
  const { result, unmount } = renderHook(usePageActive);
  expect(result.current).toBe(false);
  unmount();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  expect(removeListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
});

it("does not register native listeners on the web", () => {
  vi.spyOn(native, "isNative").mockReturnValue(false);
  renderHook(usePageActive);
  expect(native.appEvents.onStateChange).not.toHaveBeenCalled();
});
