import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserWithRelations } from "@/routers/profile";
import { ensureDom } from "../setup-dom.mjs";

ensureDom();

interface NativeLifecycleMocks {
  actionListeners: Array<(payload: { url?: string }) => void>;
  detachToken: ReturnType<typeof vi.fn>;
  endActivity: ReturnType<typeof vi.fn>;
  endKind: ReturnType<typeof vi.fn>;
  endLiveActivity: ReturnType<typeof vi.fn>;
  liveStart: ReturnType<typeof vi.fn>;
  liveTokenListeners: Array<
    (payload: { activityId: string; pushToken: string }) => void
  >;
  pushCheckPermissions: ReturnType<typeof vi.fn>;
  pushRegister: ReturnType<typeof vi.fn>;
  registrationErrorListeners: Array<(error: string) => void>;
  registrationListeners: Array<
    (payload: { token: string; platform: "ios" | "android" }) => void
  >;
  registerActivity: ReturnType<typeof vi.fn>;
  registerActivityOptions?: Record<string, unknown>;
  sendToken: ReturnType<typeof vi.fn>;
  stateListeners: Array<(isActive: boolean) => void>;
}

function getMocks(): NativeLifecycleMocks {
  const globals = globalThis as typeof globalThis & {
    __nativeLifecycleMocks?: NativeLifecycleMocks;
  };
  globals.__nativeLifecycleMocks ??= {
    actionListeners: [],
    detachToken: vi.fn(),
    endActivity: vi.fn(),
    endKind: vi.fn(),
    endLiveActivity: vi.fn(),
    liveStart: vi.fn(),
    liveTokenListeners: [],
    pushCheckPermissions: vi.fn(),
    pushRegister: vi.fn(),
    registrationErrorListeners: [],
    registrationListeners: [],
    registerActivity: vi.fn(),
    sendToken: vi.fn(),
    stateListeners: [],
  };
  return globals.__nativeLifecycleMocks;
}

const subscribe = <T,>(
  listeners: Array<(payload: T) => void>,
  callback: (payload: T) => void,
) => {
  listeners.push(callback);
  return () => {
    const index = listeners.indexOf(callback);
    if (index >= 0) listeners.splice(index, 1);
  };
};

vi.mock("next/navigation", () => {
  const router = { push: vi.fn() };
  return { useRouter: () => router };
});

vi.mock("@/app/_trpc/client", () => ({
  api: {
    push: {
      registerDevice: {
        useMutation: () => ({ mutateAsync: getMocks().sendToken }),
      },
      unregisterDevice: {
        useMutation: () => ({ mutateAsync: getMocks().detachToken }),
      },
      registerActivity: {
        useMutation: (options?: Record<string, unknown>) => {
          getMocks().registerActivityOptions = options;
          return { mutateAsync: getMocks().registerActivity };
        },
      },
      endActivity: {
        useMutation: () => ({ mutate: getMocks().endActivity }),
      },
    },
  },
}));

vi.mock("@/libs/native", () => ({
  appEvents: {
    onStateChange: (callback: (isActive: boolean) => void) =>
      subscribe(getMocks().stateListeners, callback),
  },
  isNative: () => true,
  liveActivity: {
    end: getMocks().endLiveActivity,
    endKind: getMocks().endKind,
    isSupported: () => true,
    onToken: (
      callback: (payload: { activityId: string; pushToken: string }) => void,
    ) => subscribe(getMocks().liveTokenListeners, callback),
    start: getMocks().liveStart,
  },
  parseNativeUserAgent: () => ({ platform: "ios", version: "1.0.0" }),
  push: {
    checkPermissions: getMocks().pushCheckPermissions,
    onActionPerformed: (callback: (payload: { url?: string }) => void) =>
      subscribe(getMocks().actionListeners, callback),
    onRegistration: (
      callback: (payload: { token: string; platform: "ios" | "android" }) => void,
    ) => subscribe(getMocks().registrationListeners, callback),
    onRegistrationError: (callback: (error: string) => void) =>
      subscribe(getMocks().registrationErrorListeners, callback),
    register: getMocks().pushRegister,
  },
  toSafePath: () => null,
}));

import { useLiveActivity } from "@/hooks/useLiveActivity";
import { useNativePush } from "@/hooks/useNativePush";

const TOKEN = "a".repeat(64);
const mocks = getMocks();

const profile = (status: "AWAKE" | "HOSPITALIZED") =>
  ({
    regenAt: new Date(),
    status,
    userId: "user-a",
    village: { name: "Leaf" },
  }) as unknown as UserWithRelations;

beforeEach(() => {
  localStorage.clear();
  mocks.actionListeners.length = 0;
  mocks.liveTokenListeners.length = 0;
  mocks.registrationErrorListeners.length = 0;
  mocks.registrationListeners.length = 0;
  mocks.stateListeners.length = 0;
  mocks.registerActivityOptions = undefined;
  mocks.detachToken.mockReset().mockResolvedValue({ success: true });
  mocks.endActivity.mockReset();
  mocks.endKind.mockReset().mockResolvedValue(undefined);
  mocks.endLiveActivity.mockReset().mockResolvedValue(undefined);
  mocks.liveStart.mockReset().mockResolvedValue({ activityId: "activity-1" });
  mocks.pushCheckPermissions.mockReset().mockResolvedValue("granted");
  mocks.pushRegister.mockReset().mockResolvedValue(undefined);
  mocks.registerActivity.mockReset().mockResolvedValue({ success: true });
  mocks.sendToken
    .mockReset()
    .mockResolvedValue({ success: true, widgetToken: "widget-token" });
});

afterEach(() => {
  cleanup();
});

describe("native push ownership", () => {
  it("serialises a slow detach ahead of the next account's bind", async () => {
    const events: string[] = [];
    let finishDetach: (() => void) | undefined;
    mocks.sendToken.mockImplementation(async () => {
      events.push("bind");
      return { success: true, widgetToken: "widget-token" };
    });
    mocks.detachToken.mockImplementation(
      () =>
        new Promise<{ success: true }>((resolve) => {
          events.push("detach:start");
          finishDetach = () => {
            events.push("detach:end");
            resolve({ success: true });
          };
        }),
    );

    const { result, rerender } = renderHook(
      ({ accountId }) => useNativePush({ enabled: true, accountId }),
      { initialProps: { accountId: "account-a" } },
    );
    await waitFor(() => expect(mocks.pushRegister).toHaveBeenCalledTimes(1));

    act(() => {
      mocks.registrationListeners[0]?.({ token: TOKEN, platform: "ios" });
    });
    await waitFor(() => expect(mocks.sendToken).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(localStorage.getItem("native-push-token")).toBe(TOKEN),
    );

    let unregister: Promise<void> | undefined;
    act(() => {
      unregister = result.current.unregister();
    });
    await waitFor(() => expect(mocks.detachToken).toHaveBeenCalledTimes(1));
    expect(mocks.detachToken).toHaveBeenCalledWith({
      token: TOKEN,
      widgetToken: "widget-token",
    });

    rerender({ accountId: "account-b" });
    act(() => {
      mocks.registrationListeners[0]?.({ token: TOKEN, platform: "ios" });
    });
    expect(mocks.sendToken).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishDetach?.();
      await unregister;
    });
    await waitFor(() => expect(mocks.sendToken).toHaveBeenCalledTimes(2));
    expect(events).toEqual(["bind", "detach:start", "detach:end", "bind"]);
  });

  it("asks the OS for the token again on resume after a failed bind", async () => {
    mocks.sendToken.mockRejectedValueOnce(new Error("offline"));
    renderHook(() => useNativePush({ enabled: true, accountId: "account-a" }));
    await waitFor(() => expect(mocks.pushRegister).toHaveBeenCalledTimes(1));

    act(() => {
      mocks.registrationListeners[0]?.({ token: TOKEN, platform: "ios" });
    });
    await waitFor(() => expect(mocks.sendToken).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      mocks.stateListeners[0]?.(true);
    });
    await waitFor(() => expect(mocks.pushRegister).toHaveBeenCalledTimes(2));
  });
});

describe("native Live Activity lifecycle", () => {
  it("retains a failed activity token and retries it when the app resumes", async () => {
    mocks.registerActivity
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ success: true });
    renderHook(() => useLiveActivity(profile("HOSPITALIZED"), 0));
    await waitFor(() => expect(mocks.liveStart).toHaveBeenCalledTimes(1));

    act(() => {
      mocks.liveTokenListeners[0]?.({
        activityId: "activity-1",
        pushToken: TOKEN,
      });
    });
    await waitFor(() => expect(mocks.registerActivity).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      mocks.stateListeners[0]?.(true);
    });
    await waitFor(() => expect(mocks.registerActivity).toHaveBeenCalledTimes(2));
    expect(mocks.registerActivityOptions?.retry).toBe(3);
  });

  it("ends an orphaned hospital activity after a recovered profile loads", async () => {
    const { rerender } = renderHook(
      ({ user }) => useLiveActivity(user, 0),
      { initialProps: { user: undefined as UserWithRelations | undefined } },
    );
    expect(mocks.endKind).not.toHaveBeenCalled();

    rerender({ user: profile("AWAKE") });
    await waitFor(() => expect(mocks.endKind).toHaveBeenCalledWith("hospital"));
    expect(mocks.endActivity).toHaveBeenCalledWith({ kind: "hospital" });

    rerender({ user: profile("AWAKE") });
    expect(mocks.endKind).toHaveBeenCalledTimes(1);
  });
});
