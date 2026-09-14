import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureDom } from "../../../../tests/setup-dom.mjs";
import NativeBridge from "../NativeBridge";

const state = vi.hoisted(() => ({
  back: vi.fn(),
  exit: vi.fn(),
  onBack: undefined as undefined | ((canGoBack: boolean) => void),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/login",
  useRouter: () => ({ back: state.back }),
}));
vi.mock("@/utils/UserContext", () => ({
  useUserData: () => ({ isClerkLoaded: false }),
}));
vi.mock("@/hooks/useLiveActivity", () => ({ useLiveActivity: vi.fn() }));
vi.mock("@/hooks/useNativePush", () => ({ useNativePush: () => ({}) }));
vi.mock("@/libs/native", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/libs/native")>()),
  isNative: () => true,
  appEvents: {
    onBackButton: (callback: (canGoBack: boolean) => void) => {
      state.onBack = callback;
      return () => {
        state.onBack = undefined;
      };
    },
    onUrlOpen: () => () => {},
    exitApp: state.exit,
  },
}));

beforeEach(() => {
  ensureDom();
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("native Back navigation", () => {
  it("does not navigate when an overlay consumes Escape", () => {
    render(<NativeBridge />);
    const dismiss = vi.fn((event: KeyboardEvent) => event.preventDefault());
    document.addEventListener("keydown", dismiss);
    try {
      state.onBack?.(true);
      expect(dismiss).toHaveBeenCalledOnce();
      expect(dismiss.mock.calls[0]?.[0].key).toBe("Escape");
      expect(state.back).not.toHaveBeenCalled();
      expect(state.exit).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", dismiss);
    }
  });
  it.each([true, false])(
    "preserves navigation without an overlay (history: %s)",
    (canGoBack) => {
      render(<NativeBridge />);
      state.onBack?.(canGoBack);
      expect(state.back).toHaveBeenCalledTimes(canGoBack ? 1 : 0);
      expect(state.exit).toHaveBeenCalledTimes(canGoBack ? 0 : 1);
    },
  );
});
