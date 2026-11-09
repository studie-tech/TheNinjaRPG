import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import * as navigation from "next/navigation";
import * as liveActivity from "@/hooks/useLiveActivity";
import * as push from "@/hooks/useNativePush";
import * as native from "@/libs/native";
import * as userContext from "@/utils/UserContext";
import NativeBridge from "@/components/native/NativeBridge";

const back = vi.fn();
const exit = vi.fn();
const pushRoute = vi.fn();
let onUrl: (url: string) => void;
let onBack: undefined | ((canGoBack: boolean) => void);

beforeEach(() => {
  vi.spyOn(userContext, "useUserDataSelector").mockImplementation((select) => {
    const info = userContext.useUserData();
    return { ...info, data: info.data ? select(info.data) : undefined } as never;
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(navigation, "usePathname").mockReturnValue("/login");
  vi.spyOn(navigation, "useRouter").mockReturnValue({
    back,
    forward: vi.fn(),
    refresh: vi.fn(),
    push: pushRoute,
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
  vi.spyOn(native.appEvents, "onUrlOpen").mockImplementation((callback) => {
    onUrl = callback;
    return () => {};
  });
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
      expect(dismiss).toHaveBeenCalledTimes(1);
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

describe("native viewport lifecycle", () => {
  it("updates system-bar contrast when device appearance changes and cleans up", () => {
    const events = new EventTarget();
    const appearance = Object.assign(events, { matches: false });
    const previous = window.matchMedia;
    const fit = vi.spyOn(native.viewport, "fitContent").mockResolvedValue(undefined);
    vi.spyOn(native, "platform").mockReturnValue("android");
    window.matchMedia = () => appearance as MediaQueryList;
    try {
      const view = render(<NativeBridge />);
      expect(fit).toHaveBeenLastCalledWith(false);
      appearance.matches = true;
      events.dispatchEvent(new Event("change"));
      expect(fit).toHaveBeenLastCalledWith(true);
      view.unmount();
      const count = fit.mock.calls.length;
      appearance.matches = false;
      events.dispatchEvent(new Event("change"));
      expect(fit).toHaveBeenCalledTimes(count);
    } finally {
      window.matchMedia = previous;
    }
  });
  it("fits Android on mount and foreground only, and releases its state listener", () => {
    let onState: undefined | ((active: boolean) => void);
    const remove = vi.fn();
    const fit = vi.spyOn(native.viewport, "fitContent").mockResolvedValue(undefined);
    vi.spyOn(native, "platform").mockReturnValue("android");
    vi.spyOn(native.appEvents, "onStateChange").mockImplementation((callback) => {
      onState = callback;
      return remove;
    });
    const view = render(<NativeBridge />);
    expect(fit).toHaveBeenCalledTimes(1);
    onState?.(false);
    expect(fit).toHaveBeenCalledTimes(1);
    onState?.(true);
    expect(fit).toHaveBeenCalledTimes(2);
    view.rerender(<NativeBridge />);
    expect(fit).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });
  it.each(["ios", "web"] as const)("does not configure %s viewport", (platform) => {
    vi.spyOn(native, "platform").mockReturnValue(platform);
    const fit = vi.spyOn(native.viewport, "fitContent").mockResolvedValue(undefined);
    render(<NativeBridge />);
    expect(fit).not.toHaveBeenCalled();
  });
});

describe("browser-owned authentication routes", () => {
  it("keeps the auth screen mounted while ordinary app links still navigate", () => {
    render(<NativeBridge />);
    onUrl("https://www.theninja-rpg.com/native-sign-in?flow=current&step=callback");
    onUrl("https://www.theninja-rpg.com/native-sign-in/?flow=current");
    expect(pushRoute).not.toHaveBeenCalled();
    onUrl("https://www.theninja-rpg.com/jutsus");
    expect(pushRoute).toHaveBeenCalledWith("/jutsus");
  });
});
