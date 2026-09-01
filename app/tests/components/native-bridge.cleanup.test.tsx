import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearNativeAccountState,
  nativeWidgetAccountAction,
  shouldClearNativeAccountState,
} from "@/libs/native/accountCleanup";
import { ensureDom } from "../setup-dom.mjs";

ensureDom();

const capacitorWindow = window as typeof window & {
  Capacitor?: {
    getPlatform: () => string;
    isNativePlatform: () => boolean;
    Plugins: Record<string, Record<string, unknown>>;
  };
};

const clearWidget = vi.fn();
const endAll = vi.fn();
const logOut = vi.fn();

beforeEach(() => {
  clearWidget.mockReset().mockResolvedValue(undefined);
  endAll.mockReset().mockResolvedValue(undefined);
  logOut.mockReset().mockResolvedValue(undefined);
  capacitorWindow.Capacitor = {
    getPlatform: () => "ios",
    isNativePlatform: () => true,
    Plugins: {
      Purchases: { logOut },
      TNRLiveActivity: { endAll },
      TNRWidgetSync: { clear: clearWidget },
    },
  };
});

afterEach(() => {
  delete capacitorWindow.Capacitor;
});

describe("NativeBridge deleted-profile cleanup", () => {
  it("distinguishes a missing profile from the signed-in loading gap", () => {
    expect(
      shouldClearNativeAccountState({
        isClerkLoaded: true,
        status: "pending",
        userData: undefined,
        userId: "deleted-player",
      }),
    ).toBe(false);
    expect(
      shouldClearNativeAccountState({
        isClerkLoaded: true,
        status: "success",
        userData: undefined,
        userId: "deleted-player",
      }),
    ).toBe(true);
  });

  it("clears cached A widget data throughout a direct Clerk A-to-B replacement", () => {
    expect(
      nativeWidgetAccountAction({
        isClerkLoaded: true,
        snapshotOwnerUserId: "account-a",
        userData: { userId: "account-a" },
        userId: "account-a",
      }),
    ).toBe("sync");
    expect(
      nativeWidgetAccountAction({
        isClerkLoaded: true,
        snapshotOwnerUserId: "account-a",
        userData: { userId: "account-a" },
        userId: "account-b",
      }),
    ).toBe("clear");
    expect(
      nativeWidgetAccountAction({
        isClerkLoaded: true,
        snapshotOwnerUserId: "account-a",
        userData: undefined,
        userId: "account-b",
      }),
    ).toBe("clear");
    expect(
      nativeWidgetAccountAction({
        isClerkLoaded: true,
        snapshotOwnerUserId: null,
        userData: { userId: "account-b" },
        userId: "account-b",
      }),
    ).toBe("sync");
  });

  it("keeps a known-current widget snapshot during cold profile loading and failures", () => {
    expect(
      nativeWidgetAccountAction({
        isClerkLoaded: true,
        snapshotOwnerUserId: "account-a",
        userData: undefined,
        userId: "account-a",
      }),
    ).toBe("idle");
    expect(
      nativeWidgetAccountAction({
        isClerkLoaded: true,
        snapshotOwnerUserId: null,
        userData: undefined,
        userId: "account-a",
      }),
    ).toBe("idle");
  });

  it("clears push, widget, purchase, and Live Activity state", async () => {
    const unregister = vi.fn().mockResolvedValue(undefined);
    await clearNativeAccountState(unregister);

    expect(unregister).toHaveBeenCalledTimes(1);
    expect(clearWidget).toHaveBeenCalledTimes(1);
    expect(logOut).toHaveBeenCalledTimes(1);
    expect(endAll).toHaveBeenCalledTimes(1);
  });
});
