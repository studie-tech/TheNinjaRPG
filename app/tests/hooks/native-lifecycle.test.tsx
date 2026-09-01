import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserWithRelations } from "@/routers/profile";
import { ensureDom } from "../setup-dom.mjs";

ensureDom();

interface NativeLifecycleMocks {
  actionListeners: Array<(payload: unknown) => void>;
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
  registrationErrorListeners: Array<(payload: { error: string }) => void>;
  registrationListeners: Array<(payload: { value: string }) => void>;
  registerActivity: ReturnType<typeof vi.fn>;
  registerActivityOptions?: Record<string, unknown>;
  sendToken: ReturnType<typeof vi.fn>;
  stateListeners: Array<(payload: { isActive: boolean }) => void>;
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

import { useLiveActivity } from "@/hooks/useLiveActivity";
import { useNativePush } from "@/hooks/useNativePush";

const TOKEN = "a".repeat(64);
const mocks = getMocks();
const capacitorWindow = window as typeof window & {
  Capacitor?: {
    getPlatform: () => string;
    isNativePlatform: () => boolean;
    Plugins: Record<string, Record<string, unknown>>;
  };
};

const profile = (status: "AWAKE" | "HOSPITALIZED", userId = "user-a") =>
  ({
    regenAt: new Date(),
    status,
    userId,
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

  const listener = <T,>(
    listeners: Array<(payload: T) => void>,
    callback: unknown,
  ) => {
    const remove = subscribe(listeners, callback as (payload: T) => void);
    return { remove: async () => remove() };
  };
  capacitorWindow.Capacitor = {
    getPlatform: () => "ios",
    isNativePlatform: () => true,
    Plugins: {
      App: {
        addListener: (_event: string, callback: unknown) =>
          listener(mocks.stateListeners, callback),
      },
      PushNotifications: {
        addListener: (event: string, callback: unknown) => {
          if (event === "registration") {
            return listener(mocks.registrationListeners, callback);
          }
          if (event === "registrationError") {
            return listener(mocks.registrationErrorListeners, callback);
          }
          return listener(mocks.actionListeners, callback);
        },
        checkPermissions: async () => ({
          receive: await (mocks.pushCheckPermissions as () => Promise<string>)(),
        }),
        register: mocks.pushRegister,
      },
      TNRLiveActivity: {
        addListener: (_event: string, callback: unknown) =>
          listener(mocks.liveTokenListeners, callback),
        end: mocks.endLiveActivity,
        endKind: async (options?: { kind?: string }) =>
          (mocks.endKind as (kind?: string) => Promise<void>)(options?.kind),
        start: mocks.liveStart,
      },
    },
  };
});

afterEach(() => {
  cleanup();
  delete capacitorWindow.Capacitor;
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
    await waitFor(() => expect(mocks.registrationListeners).toHaveLength(1));

    act(() => {
      mocks.registrationListeners[0]?.({ value: TOKEN });
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
    await waitFor(() => expect(mocks.registrationListeners).toHaveLength(1));
    act(() => {
      mocks.registrationListeners[0]?.({ value: TOKEN });
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
    await waitFor(() => expect(mocks.registrationListeners).toHaveLength(1));

    act(() => {
      mocks.registrationListeners[0]?.({ value: TOKEN });
    });
    await waitFor(() => expect(mocks.sendToken).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      mocks.stateListeners[0]?.({ isActive: true });
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
    await waitFor(() => expect(mocks.liveTokenListeners).toHaveLength(1));

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
      mocks.stateListeners[0]?.({ isActive: true });
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
    expect(mocks.endActivity).not.toHaveBeenCalled();

    rerender({ user: profile("AWAKE") });
    expect(mocks.endKind).toHaveBeenCalledTimes(1);
  });

  it("ends only the current device's registered activity after recovery", async () => {
    const { rerender } = renderHook(
      ({ user }) => useLiveActivity(user, 0),
      { initialProps: { user: profile("HOSPITALIZED") } },
    );
    await waitFor(() => expect(mocks.liveStart).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
    });

    rerender({ user: profile("AWAKE") });
    await waitFor(() =>
      expect(mocks.endActivity).toHaveBeenCalledWith({ activityId: "activity-1" }),
    );
  });

  it("ends the previous account's card before starting for a replacement account", async () => {
    mocks.liveStart
      .mockResolvedValueOnce({ activityId: "activity-a" })
      .mockResolvedValueOnce({ activityId: "activity-b" });
    const { rerender } = renderHook(
      ({ user }) => useLiveActivity(user, 0),
      { initialProps: { user: profile("HOSPITALIZED", "user-a") } },
    );
    await waitFor(() => expect(mocks.liveStart).toHaveBeenCalledTimes(1));

    rerender({ user: profile("HOSPITALIZED", "user-b") });
    await waitFor(() => expect(mocks.endKind).toHaveBeenCalledWith("hospital"));
    await waitFor(() => expect(mocks.liveStart).toHaveBeenCalledTimes(2));
  });

  it("starts again when the same account returns after an explicit sign-out", async () => {
    const { rerender } = renderHook(
      ({ user, accountId }) => useLiveActivity(user, 0, accountId),
      {
        initialProps: {
          user: profile("HOSPITALIZED") as UserWithRelations | undefined,
          accountId: "user-a" as string | null,
        },
      },
    );
    await waitFor(() => expect(mocks.liveStart).toHaveBeenCalledTimes(1));

    rerender({ user: undefined, accountId: null });
    await waitFor(() => expect(mocks.endKind).toHaveBeenCalledWith("hospital"));

    rerender({ user: profile("HOSPITALIZED"), accountId: "user-a" });
    await waitFor(() => expect(mocks.liveStart).toHaveBeenCalledTimes(2));
  });
});
