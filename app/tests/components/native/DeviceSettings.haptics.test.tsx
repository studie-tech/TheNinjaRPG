import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as clerk from "@clerk/nextjs";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import DeviceSettings from "@/components/native/DeviceSettings";
import * as permission from "@/hooks/useNativePush";
import * as shell from "@/hooks/useNativeShell";
import { haptics } from "@/libs/native";
import {
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";

const impact = vi.fn();
beforeEach(() => {
  installBrowserGlobals({ events: ["CustomEvent"] });
  window.localStorage.clear();
  window.localStorage.setItem(haptics.HAPTICS_STORAGE_KEY, "false");
  impact.mockClear();
  Object.assign(window, {
    Capacitor: {
      isNativePlatform: () => true,
      getPlatform: () => "android",
      Plugins: { Haptics: { impact } },
    },
  });
  vi.spyOn(clerk, "useUser").mockReturnValue({
    isLoaded: true,
    isSignedIn: true,
  } as ReturnType<typeof clerk.useUser>);
  vi.spyOn(shell, "useNativeShell").mockReturnValue(true);
  vi.spyOn(permission, "useNativePushPermission").mockReturnValue({
    isSupported: true,
    permission: "granted",
    requestPermission: vi.fn(),
  });
  Object.assign(vi.spyOn(client, "api" as never), {
    push: {
      getPreferences: { useQuery: () => ({ data: { categories: [] } }) },
      setPreference: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      sendTest: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    useUtils: () => ({ push: { getPreferences: { invalidate: vi.fn() } } }),
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
  window.localStorage.clear();
  delete (window as Window & { Capacitor?: unknown }).Capacitor;
});

it("plays exactly one native preview when re-enabling saved Off feedback and persists both transitions", () => {
  const view = render(<DeviceSettings />);
  const toggle = view.getByRole("switch", { name: "Toggle haptic feedback" });
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  expect(impact).not.toHaveBeenCalled();
  fireEvent.click(toggle);
  expect(window.localStorage.getItem(haptics.HAPTICS_STORAGE_KEY)).toBe("true");
  expect(impact).toHaveBeenCalledTimes(1);
  expect(impact).toHaveBeenCalledWith({ style: "MEDIUM" });
  fireEvent.click(toggle);
  expect(window.localStorage.getItem(haptics.HAPTICS_STORAGE_KEY)).toBe("false");
  expect(impact).toHaveBeenCalledTimes(1);
});

it.each([false, true])(
  "shows Lock Screen timer guidance only when the iOS shell exposes Live Activities: %s",
  (supported) => {
    Object.assign(window, {
      Capacitor: {
        isNativePlatform: () => true,
        getPlatform: () => "ios",
        Plugins: { Haptics: { impact }, ...(supported ? { TNRLiveActivity: {} } : {}) },
      },
    });
    const view = render(<DeviceSettings />);
    expect(view.queryByText("Lock Screen timers") !== null).toBe(supported);
    expect(view.getByText("Add a widget")).toBeTruthy();
    expect(view.getByRole("switch", { name: "Toggle haptic feedback" })).toBeTruthy();
  },
);
