import type { Clerk } from "@clerk/nextjs/types";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as navigation from "next/navigation";
import superjson from "superjson";
import type { AppRouter } from "@/api/root";
import * as client from "@/app/_trpc/client";
import type { RouterInputs } from "@/app/_trpc/client";
import { useLiveActivity } from "@/hooks/useLiveActivity";
import { useNativePush } from "@/hooks/useNativePush";
import { createTrpcSession, trpcSessionLink } from "@/libs/trpcSession";
import type { UserWithRelations } from "@/routers/profile";
import { deferred } from "../setup/deferred";
import { capacitorWindow, installCapacitor, removeCapacitor } from "../setup/native";

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

const mocks: NativeLifecycleMocks = {
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

const router = { push: vi.fn() };
const api = {
  push: {
    registerDevice: {
      useMutation: () => ({ mutateAsync: mocks.sendToken }),
    },
    unregisterDevice: {
      useMutation: () => ({ mutateAsync: mocks.detachToken }),
    },
    registerActivity: {
      useMutation: (options?: Record<string, unknown>) => {
        mocks.registerActivityOptions = options;
        return { mutateAsync: mocks.registerActivity };
      },
    },
    endActivity: {
      useMutation: () => ({ mutate: mocks.endActivity }),
    },
  },
};

const TOKEN = "a".repeat(64);
const profile = (status: "AWAKE" | "HOSPITALIZED", userId = "user-a") =>
  ({
    regenAt: new Date(),
    status,
    userId,
    village: { name: "Leaf" },
  }) as unknown as UserWithRelations;

beforeEach(() => {
  vi.spyOn(navigation, "useRouter").mockReturnValue(router as never);
  Object.assign(vi.spyOn(client, "api" as never), api);
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

  const listener = <T,>(listeners: Array<(payload: T) => void>, callback: unknown) => {
    const remove = subscribe(listeners, callback as (payload: T) => void);
    return { remove: async () => remove() };
  };
  installCapacitor({
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
  });
});

afterEach(() => {
  cleanup();
  removeCapacitor();
  vi.restoreAllMocks();
});

describe("native push ownership", () => {
  it("detaches a registration whose response arrives after the account tree unmounts", async () => {
    const clerk: Pick<Clerk, "session"> = {
      session: {
        id: "account-a",
        getToken: async () => "account-a",
      } as NonNullable<Clerk["session"]>,
    };
    const credential = "w".repeat(32);
    let device: { token: string; widgetToken: string } | undefined;
    const { promise: dispatched, resolve: started } = deferred<void>();
    const { promise: responseReady, resolve: finishRegistration } = deferred<void>();
    const requests: { path: string; authorization: string | null }[] = [];
    let exposedWidgetToken: string | null | undefined;
    const createClient = () => {
      const scope = createTrpcSession(clerk);
      return createTRPCClient<AppRouter>({
        links: [
          trpcSessionLink(scope),
          httpBatchLink({
            url: "http://localhost/api/trpc",
            transformer: superjson,
            headers: scope.headers,
            fetch: async (url, init) => {
              const path = new URL(String(url)).pathname.slice("/api/trpc/".length);
              requests.push({
                path,
                authorization: new Headers(init?.headers).get("Authorization"),
              });
              const input = superjson.deserialize<{
                token: string;
                widgetToken?: string;
              }>(JSON.parse(String(init?.body))["0"]);
              if (path === "push.registerDevice") {
                device = { token: input.token, widgetToken: credential };
                started();
                await responseReady;
                return Response.json([
                  {
                    result: {
                      data: superjson.serialize({
                        success: true,
                        widgetToken: credential,
                      }),
                    },
                  },
                ]);
              }
              exposedWidgetToken = localStorage.getItem("native-widget-token");
              if (
                device?.token === input.token &&
                device?.widgetToken === input.widgetToken
              ) {
                device = undefined;
              }
              return Response.json([
                {
                  result: { data: superjson.serialize({ success: true }) },
                },
              ]);
            },
          }),
        ],
      });
    };
    const firstClient = createClient();
    mocks.sendToken.mockImplementation(
      (input: RouterInputs["push"]["registerDevice"]) =>
        firstClient.push.registerDevice.mutate(input),
    );
    const first = renderHook(() =>
      useNativePush({ enabled: true, accountId: "account-a" }),
    );
    await waitFor(() => expect(mocks.registrationListeners).toHaveLength(1));
    act(() => mocks.registrationListeners[0]?.({ value: TOKEN }));
    await dispatched;
    expect(device).toEqual({ token: TOKEN, widgetToken: credential });

    first.unmount();
    clerk.session = null;
    const anonymousClient = createClient();
    mocks.detachToken.mockImplementation(
      (input: { token: string; widgetToken: string }) =>
        anonymousClient.push.unregisterDevice.mutate(input),
    );
    const signedOut = renderHook(() =>
      useNativePush({ enabled: false, accountId: null }),
    );
    await act(async () => {
      const pending = signedOut.result.current.unregister();
      finishRegistration();
      await pending;
    });

    expect(mocks.detachToken).toHaveBeenCalledWith({
      token: TOKEN,
      widgetToken: credential,
    });
    expect(device).toBeUndefined();
    expect(requests).toEqual([
      { path: "push.registerDevice", authorization: "Bearer account-a" },
      { path: "push.unregisterDevice", authorization: null },
    ]);
    expect(exposedWidgetToken).toBeNull();
    expect(signedOut.result.current.widgetToken).toBeUndefined();
    for (const key of [
      "native-push-token",
      "native-push-owner-token",
      "native-push-pending-detach",
      "native-widget-token",
      "native-widget-token-owner",
    ]) {
      expect(localStorage.getItem(key)).toBeNull();
    }
  });

  it("waits for both native listeners before requesting a push token", async () => {
    const plugin = capacitorWindow.Capacitor?.Plugins.PushNotifications;
    if (!plugin) throw new Error("PushNotifications mock is missing");
    const addListener = plugin.addListener as (
      event: string,
      callback: unknown,
    ) => { remove: () => Promise<void> };
    const finishAttach: Array<() => void> = [];
    plugin.addListener = (event: string, callback: unknown) => {
      if (event !== "registration" && event !== "registrationError") {
        return addListener(event, callback);
      }
      return new Promise((resolve) => {
        finishAttach.push(() => resolve(addListener(event, callback)));
      });
    };

    const current = renderHook(() =>
      useNativePush({ enabled: true, accountId: "account-a" }),
    );
    await waitFor(() => expect(finishAttach).toHaveLength(2));
    expect(mocks.pushRegister).not.toHaveBeenCalled();

    act(() => finishAttach[0]?.());
    expect(mocks.pushRegister).not.toHaveBeenCalled();
    act(() => finishAttach[1]?.());
    await waitFor(() => expect(mocks.pushRegister).toHaveBeenCalledTimes(1));
    current.unmount();
  });

  it("exposes a persisted widget token only to its recorded account", async () => {
    localStorage.setItem("native-widget-token", "account-a-widget-token");
    localStorage.setItem("native-widget-token-owner", "account-a");

    const current = renderHook(() =>
      useNativePush({ enabled: true, accountId: "account-a" }),
    );
    expect(current.result.current.widgetToken).toBe("account-a-widget-token");
    current.unmount();

    const replacement = renderHook(() =>
      useNativePush({ enabled: true, accountId: "account-b" }),
    );
    expect(replacement.result.current.widgetToken).toBeUndefined();
  });

  it("withdraws account A's widget token during a direct A-to-B handoff", async () => {
    const { result, rerender } = renderHook(
      ({ accountId }) => useNativePush({ enabled: true, accountId }),
      { initialProps: { accountId: "account-a" } },
    );
    await waitFor(() => expect(mocks.registrationListeners).toHaveLength(1));
    act(() => {
      mocks.registrationListeners[0]?.({ value: TOKEN });
    });
    await waitFor(() => expect(result.current.widgetToken).toBe("widget-token"));

    rerender({ accountId: "account-b" });
    expect(result.current.widgetToken).toBeUndefined();
  });

  it("detaches account A while account B's profile is still disabled", async () => {
    const { rerender } = renderHook(
      ({ accountId, enabled }) => useNativePush({ enabled, accountId }),
      { initialProps: { accountId: "account-a", enabled: true } },
    );
    await waitFor(() => expect(mocks.registrationListeners).toHaveLength(1));
    act(() => {
      mocks.registrationListeners[0]?.({ value: TOKEN });
    });
    await waitFor(() => expect(mocks.sendToken).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(localStorage.getItem("native-push-owner-token")).toBe("widget-token"),
    );

    rerender({ accountId: "account-b", enabled: false });

    await waitFor(() => expect(mocks.detachToken).toHaveBeenCalledTimes(1));
    expect(mocks.detachToken).toHaveBeenCalledWith({
      token: TOKEN,
      widgetToken: "widget-token",
    });
    expect(mocks.pushRegister).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("native-widget-token")).toBeNull();
    expect(localStorage.getItem("native-widget-token-owner")).toBeNull();
  });

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
    await waitFor(() => expect(localStorage.getItem("native-push-token")).toBe(TOKEN));

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
      for (const listener of mocks.stateListeners) listener({ isActive: true });
    });
    await waitFor(() => expect(mocks.pushRegister).toHaveBeenCalledTimes(2));
  });

  it("does not cache a token rejected by the server", async () => {
    mocks.sendToken.mockResolvedValueOnce({
      success: false,
      message: "Character no longer exists",
      widgetToken: null,
    });
    renderHook(() => useNativePush({ enabled: true, accountId: "account-a" }));
    await waitFor(() => expect(mocks.registrationListeners).toHaveLength(1));

    act(() => mocks.registrationListeners[0]?.({ value: TOKEN }));
    await waitFor(() => expect(mocks.sendToken).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(localStorage.getItem("native-push-token")).toBeNull();

    act(() => {
      for (const listener of mocks.stateListeners) listener({ isActive: true });
    });
    await waitFor(() => expect(mocks.pushRegister).toHaveBeenCalledTimes(2));
  });

  it("keeps a newer token when an earlier bind fails", async () => {
    let rejectFirst: ((error: Error) => void) | undefined;
    mocks.sendToken.mockImplementationOnce(
      () => new Promise((_, reject) => (rejectFirst = reject)),
    );
    renderHook(() => useNativePush({ enabled: true, accountId: "account-a" }));
    await waitFor(() => expect(mocks.registrationListeners).toHaveLength(1));

    act(() => {
      mocks.registrationListeners[0]?.({ value: TOKEN });
      mocks.registrationListeners[0]?.({ value: "b".repeat(64) });
    });
    await waitFor(() => expect(mocks.sendToken).toHaveBeenCalledTimes(1));
    rejectFirst?.(new Error("offline"));
    await waitFor(() => expect(mocks.sendToken).toHaveBeenCalledTimes(2));
    act(() => mocks.registrationListeners[0]?.({ value: "b".repeat(64) }));
    expect(mocks.sendToken).toHaveBeenCalledTimes(2);
  });

  it("retries a failed sign-out detach on signed-out resume before clearing proof", async () => {
    mocks.detachToken
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ success: true });
    const { result, rerender } = renderHook(
      ({ enabled, accountId }) => useNativePush({ enabled, accountId }),
      { initialProps: { enabled: true, accountId: "account-a" as string | null } },
    );
    await waitFor(() => expect(mocks.registrationListeners).toHaveLength(1));
    act(() => {
      mocks.registrationListeners[0]?.({ value: TOKEN });
    });
    await waitFor(() =>
      expect(localStorage.getItem("native-push-owner-token")).toBe("widget-token"),
    );

    await act(async () => {
      await result.current.unregister();
    });
    expect(mocks.detachToken).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("native-push-token")).toBe(TOKEN);
    expect(localStorage.getItem("native-push-owner-token")).toBe("widget-token");
    expect(
      JSON.parse(localStorage.getItem("native-push-pending-detach") ?? "{}"),
    ).toEqual({ token: TOKEN, widgetToken: "widget-token" });

    rerender({ enabled: false, accountId: null });
    act(() => {
      for (const listener of [...mocks.stateListeners]) listener({ isActive: true });
    });
    await waitFor(() => expect(mocks.detachToken).toHaveBeenCalledTimes(2));
    expect(mocks.detachToken).toHaveBeenLastCalledWith({
      token: TOKEN,
      widgetToken: "widget-token",
    });
    await waitFor(() =>
      expect(localStorage.getItem("native-push-pending-detach")).toBeNull(),
    );
    expect(localStorage.getItem("native-push-token")).toBeNull();
    expect(localStorage.getItem("native-push-owner-token")).toBeNull();
  });

  it("retries a persisted signed-out detach when connectivity returns", async () => {
    localStorage.setItem("native-push-token", TOKEN);
    localStorage.setItem("native-push-owner-token", "widget-token");
    localStorage.setItem(
      "native-push-pending-detach",
      JSON.stringify({ token: TOKEN, widgetToken: "widget-token" }),
    );
    mocks.detachToken
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ success: true });

    renderHook(() => useNativePush({ enabled: false, accountId: null }));
    await waitFor(() => expect(mocks.detachToken).toHaveBeenCalledTimes(1));
    act(() => window.dispatchEvent(new window.Event("online")));
    await waitFor(() => expect(mocks.detachToken).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(localStorage.getItem("native-push-pending-detach")).toBeNull(),
    );
  });

  it("does not clear a replacement bind when an older conditional detach recovers", async () => {
    localStorage.setItem("native-push-token", TOKEN);
    localStorage.setItem("native-push-owner-token", "widget-token-a");
    localStorage.setItem(
      "native-push-pending-detach",
      JSON.stringify({ token: TOKEN, widgetToken: "widget-token-a" }),
    );
    mocks.detachToken
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ success: true });
    mocks.sendToken.mockResolvedValueOnce({
      success: true,
      widgetToken: "widget-token-b",
    });

    renderHook(() => useNativePush({ enabled: true, accountId: "account-b" }));
    await waitFor(() => expect(mocks.detachToken).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.registrationListeners).toHaveLength(1));
    act(() => {
      mocks.registrationListeners[0]?.({ value: TOKEN });
    });
    await waitFor(() =>
      expect(localStorage.getItem("native-push-owner-token")).toBe("widget-token-b"),
    );

    act(() => {
      for (const listener of mocks.stateListeners) listener({ isActive: true });
    });
    await waitFor(() => expect(mocks.detachToken).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(localStorage.getItem("native-push-pending-detach")).toBeNull(),
    );
    expect(localStorage.getItem("native-push-token")).toBe(TOKEN);
    expect(localStorage.getItem("native-push-owner-token")).toBe("widget-token-b");
  });
});

describe("native Live Activity lifecycle", () => {
  it("does not start or register activities when the shell omits the unsupported plugin", async () => {
    Object.assign(window, {
      Capacitor: {
        isNativePlatform: () => true,
        getPlatform: () => "ios",
        Plugins: {},
      },
    });
    renderHook(() => useLiveActivity(profile("HOSPITALIZED"), 0));
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.liveStart).not.toHaveBeenCalled();
    expect(mocks.registerActivity).not.toHaveBeenCalled();
    expect(mocks.liveTokenListeners).toHaveLength(0);
  });

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
    const { rerender } = renderHook(({ user }) => useLiveActivity(user, 0), {
      initialProps: { user: undefined as UserWithRelations | undefined },
    });
    expect(mocks.endKind).not.toHaveBeenCalled();

    rerender({ user: profile("AWAKE") });
    await waitFor(() => expect(mocks.endKind).toHaveBeenCalledWith("hospital"));
    expect(mocks.endActivity).not.toHaveBeenCalled();

    rerender({ user: profile("AWAKE") });
    expect(mocks.endKind).toHaveBeenCalledTimes(1);
  });

  it("ends only the current device's registered activity after recovery", async () => {
    const { rerender } = renderHook(({ user }) => useLiveActivity(user, 0), {
      initialProps: { user: profile("HOSPITALIZED") },
    });
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
    const { rerender } = renderHook(({ user }) => useLiveActivity(user, 0), {
      initialProps: { user: profile("HOSPITALIZED", "user-a") },
    });
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
