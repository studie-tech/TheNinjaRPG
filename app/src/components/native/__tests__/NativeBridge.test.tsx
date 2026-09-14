import { cleanup, render } from "@testing-library/react";
import * as navigation from "next/navigation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as liveActivity from "@/hooks/useLiveActivity";
import * as push from "@/hooks/useNativePush";
import * as native from "@/libs/native";
import * as userContext from "@/utils/UserContext";
import { ensureDom } from "../../../../tests/setup-dom.mjs";
import NativeBridge from "../NativeBridge";

const back = vi.fn();
const exit = vi.fn();
let onBack: undefined | ((canGoBack: boolean) => void);

beforeEach(() => {
  ensureDom();
  vi.clearAllMocks();
  vi.spyOn(navigation, "usePathname").mockReturnValue("/login");
  vi.spyOn(navigation, "useRouter").mockReturnValue({
    back,
    forward: vi.fn(),
    refresh: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    bfcacheId: "test",
  });
  vi.spyOn(userContext, "useUserData").mockReturnValue({
    isClerkLoaded: false,
  } as ReturnType<typeof userContext.useUserData>);
  vi.spyOn(liveActivity, "useLiveActivity").mockImplementation(() => {});
  vi.spyOn(push, "useNativePush").mockReturnValue(
    {} as ReturnType<typeof push.useNativePush>,
  );
  vi.spyOn(native, "isNative").mockReturnValue(true);
  vi.spyOn(native.appEvents, "onBackButton").mockImplementation((callback) => {
    onBack = callback;
    return () => {
      onBack = undefined;
    };
  });
  vi.spyOn(native.appEvents, "onUrlOpen").mockReturnValue(() => {});
  vi.spyOn(native.appEvents, "exitApp").mockImplementation(exit);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("native Back navigation", () => {
  it("does not navigate when an overlay consumes Escape", () => {
    render(<NativeBridge />);
    const dismiss = vi.fn((event: KeyboardEvent) => event.preventDefault());
    document.addEventListener("keydown", dismiss);
    try {
      onBack?.(true);
      expect(dismiss).toHaveBeenCalledOnce();
      expect(dismiss.mock.calls[0]?.[0].key).toBe("Escape");
      expect(back).not.toHaveBeenCalled();
      expect(exit).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", dismiss);
    }
  });
  it.each([true, false])(
    "preserves navigation without an overlay (history: %s)",
    (canGoBack) => {
      render(<NativeBridge />);
      onBack?.(canGoBack);
      expect(back).toHaveBeenCalledTimes(canGoBack ? 1 : 0);
      expect(exit).toHaveBeenCalledTimes(canGoBack ? 0 : 1);
    },
  );
});
