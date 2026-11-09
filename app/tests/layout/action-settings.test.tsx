import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { RouterInputs, RouterOutputs } from "@/app/_trpc/client";
import * as client from "@/app/_trpc/client";
import type { UserCache } from "@/deltas/profile";
import { useActionPreferenceCacheUpdate } from "@/hooks/useActionPreferenceCacheUpdate";
import { ActionSettings } from "@/layout/ActionSettings";
import { canAttemptAwakeAction } from "@/libs/actionReadiness";
import * as toast from "@/libs/toast";
import * as UserContext from "@/utils/UserContext";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { deferred } from "../setup/deferred";

type Input = RouterInputs["profile"]["updatePreferences"];
type Result = RouterOutputs["profile"]["updatePreferences"];
type Controller = ReturnType<typeof useActionPreferenceCacheUpdate>;
type Snapshot = ReturnType<Controller["prepareUpdate"]>;
type Options = {
  onMutate: (input: Input) => Snapshot;
  onSuccess: (
    result: Result,
    input: Input,
    snapshot: Snapshot | undefined,
  ) => Promise<void>;
  onError: (error: Error) => void;
  onSettled: (
    result: Result | undefined,
    error: Error | null,
    input: Input,
    snapshot: Snapshot | undefined,
  ) => void;
};
const key = [["profile", "getUser"], { type: "query" }];
const saved: Result = {
  success: true,
  message: "Updated preferences",
  userPatch: { autoWakeUp: true },
};
const profile = (patch: Record<string, unknown> = {}): UserCache => ({
  userData: {
    userId: "actor",
    status: "ASLEEP",
    autoWakeUp: false,
    money: 10,
    rank: "NONE",
    ...patch,
  } as NonNullable<UserCache["userData"]>,
  notifications: [],
});
let cache: QueryClient;
let actor = "actor";
let controller: Controller;
let save: (input: Input) => Promise<Result>;
const announce = vi.fn();

beforeEach(() => {
  actor = "actor";
  cache = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
        queryFn: () => {
          throw new Error("Unexpected profile read");
        },
      },
      mutations: { retry: false },
    },
  });
  cache.setQueryData(key, profile());
  save = async () => saved;
  announce.mockClear();
  Object.assign(vi.spyOn(client, "api" as never), {
    profile: {
      updatePreferences: {
        useMutation: (options: Options) =>
          useMutation<Result, Error, Input, Snapshot>({
            mutationFn: (input) => save(input),
            ...options,
          }),
      },
    },
  });
  vi.spyOn(UserContext, "useRequiredUserData").mockImplementation(() => {
    controller = useActionPreferenceCacheUpdate(cache, key, actor);
    const { data } = useQuery<UserCache>({ queryKey: key, enabled: false });
    return { data: data?.userData, actionPreferences: controller } as never;
  });
  vi.spyOn(toast, "showMutationToast").mockImplementation(announce);
});
afterEach(() => {
  cleanup();
  cache.clear();
  vi.restoreAllMocks();
});
const show = () =>
  render(
    <QueryClientProvider client={cache}>
      <ActionSettings />
    </QueryClientProvider>,
  );
const toggle = async (view: ReturnType<typeof show>) => {
  await act(async () => {
    fireEvent.click(view.getByRole("switch"));
  });
};
const settle = async (view: ReturnType<typeof show>) => {
  await waitFor(() => expect(view.queryByRole("status")).toBeNull());
};

it("retains the confirmed preference after an already-running stale profile read without another read", async () => {
  const view = show();
  const read = deferred<UserCache>();
  const readFn = vi.fn(() => read.promise);
  const cancel = vi.spyOn(cache, "cancelQueries");
  const invalidate = vi.spyOn(cache, "invalidateQueries");
  const fetching = cache.fetchQuery({ queryKey: key, staleTime: 0, queryFn: readFn });
  expect(prepareUserUpdate(cache, key)).toBeUndefined();
  await toggle(view);
  await waitFor(() => expect(view.getByRole("status").textContent).toContain("Saving"));
  expect((view.getByRole("switch") as HTMLButtonElement).disabled).toBe(true);
  expect(announce).not.toHaveBeenCalled();
  await act(async () => {
    read.resolve(profile({ money: 99 }));
    await fetching;
  });
  await settle(view);
  expect(view.getByRole("switch").getAttribute("aria-checked")).toBe("true");
  const user = cache.getQueryData<UserCache>(key)?.userData;
  expect(user).toMatchObject({ autoWakeUp: true, status: "ASLEEP", money: 99 });
  expect(canAttemptAwakeAction(user)).toBe(true);
  expect(readFn).toHaveBeenCalledTimes(1);
  expect(cancel).not.toHaveBeenCalled();
  expect(invalidate).not.toHaveBeenCalled();
  expect(announce).toHaveBeenCalledWith(saved);
});

it("preserves an unrelated settled projection made while the preference write runs", async () => {
  const write = deferred<Result>();
  save = () => write.promise;
  const view = show();
  await toggle(view);
  await act(async () => {
    await updateUserCache(cache, key, { money: 77 });
  });
  await act(async () => {
    write.resolve(saved);
  });
  await settle(view);
  expect(cache.getQueryData<UserCache>(key)?.userData).toMatchObject({
    autoWakeUp: true,
    money: 77,
  });
  expect(announce).toHaveBeenCalledTimes(1);
});

it("applies an ordinary successful save and leaves the control usable", async () => {
  const view = show();
  await toggle(view);
  await settle(view);
  expect(view.getByRole("switch").getAttribute("aria-checked")).toBe("true");
  expect((view.getByRole("switch") as HTMLButtonElement).disabled).toBe(false);
  expect(announce).toHaveBeenCalledTimes(1);
});

it.each(["rejected", "network"] as const)(
  "shows %s failures beside the unchanged setting and allows retry",
  async (kind) => {
    save = async () => {
      if (kind === "network") throw new Error("Connection failed");
      return { success: false, message: "Failed to update preferences" };
    };
    const view = show();
    await toggle(view);
    await settle(view);
    expect(view.getByRole("alert").textContent).toBe(
      kind === "network" ? "Connection failed" : "Failed to update preferences",
    );
    expect(view.getByRole("switch").getAttribute("aria-checked")).toBe("false");
    expect((view.getByRole("switch") as HTMLButtonElement).disabled).toBe(false);
    expect(announce).not.toHaveBeenCalled();
    save = async () => saved;
    await toggle(view);
    await settle(view);
    expect(view.queryByRole("alert")).toBeNull();
    expect(view.getByRole("switch").getAttribute("aria-checked")).toBe("true");
  },
);

it("does not apply an old actor's save after an account switch", async () => {
  const write = deferred<Result>();
  save = () => write.promise;
  const view = show();
  await toggle(view);
  actor = "other";
  await act(async () => {
    cache.setQueryData(key, profile({ userId: "other" }));
  });
  view.rerender(
    <QueryClientProvider client={cache}>
      <ActionSettings />
    </QueryClientProvider>,
  );
  await act(async () => {
    write.resolve(saved);
  });
  await settle(view);
  expect(cache.getQueryData<UserCache>(key)?.userData).toMatchObject({
    userId: "other",
    autoWakeUp: false,
  });
  expect(announce).not.toHaveBeenCalled();
});

it("does not overwrite a newer preference projection, even after a stale read restores its baseline", async () => {
  const view = show();
  const read = deferred<UserCache>();
  const fetching = cache.fetchQuery({
    queryKey: key,
    staleTime: 0,
    queryFn: () => read.promise,
  });
  await toggle(view);
  await act(async () => {
    cache.setQueryData(key, profile({ autoWakeUp: true }));
    cache.setQueryData(key, profile({ autoWakeUp: false }));
  });
  await act(async () => {
    read.resolve(profile());
    await fetching;
  });
  await settle(view);
  expect(cache.getQueryData<UserCache>(key)?.userData?.autoWakeUp).toBe(false);
  expect(announce).not.toHaveBeenCalled();
  expect(view.getByRole("alert").textContent).toContain("could not be applied");
});

it("lets a newer save supersede an earlier captured preference", async () => {
  show();
  const earlier = controller.prepareUpdate({ autoWakeUp: true });
  const newer = controller.prepareUpdate({ autoWakeUp: false });
  expect(
    await controller.updateCache({ ...saved, userPatch: { autoWakeUp: false } }, newer),
  ).toBe(true);
  expect(await controller.updateCache(saved, earlier)).toBe(false);
  expect(cache.getQueryData<UserCache>(key)?.userData?.autoWakeUp).toBe(false);
  newer.release();
});

it("leaves a failed existing read intact and displays reconciliation feedback", async () => {
  const view = show();
  const read = deferred<UserCache>();
  const fetching = cache
    .fetchQuery({ queryKey: key, staleTime: 0, queryFn: () => read.promise })
    .catch(() => {});
  await toggle(view);
  await act(async () => {
    read.reject(new Error("Profile unavailable"));
    await fetching;
  });
  await settle(view);
  expect(view.getByRole("alert").textContent).toContain("could not be applied");
  expect(announce).not.toHaveBeenCalled();
  expect(cache.getQueryData<UserCache>(key)?.userData?.autoWakeUp).toBe(false);
});

it("retains the preference when an existing read settles before the write response", async () => {
  const write = deferred<Result>();
  save = () => write.promise;
  const view = show();
  const read = deferred<UserCache>();
  const fetching = cache.fetchQuery({
    queryKey: key,
    staleTime: 0,
    queryFn: () => read.promise,
  });
  await toggle(view);
  await act(async () => {
    read.resolve(profile({ money: 55 }));
    await fetching;
  });
  await act(async () => {
    write.resolve(saved);
  });
  await settle(view);
  expect(cache.getQueryData<UserCache>(key)?.userData).toMatchObject({
    autoWakeUp: true,
    money: 55,
  });
  expect(announce).toHaveBeenCalledTimes(1);
});

it("waits for a profile read that starts while the preference write is pending", async () => {
  const write = deferred<Result>();
  save = () => write.promise;
  const view = show();
  await toggle(view);
  const read = deferred<UserCache>();
  const fetching = cache.fetchQuery({
    queryKey: key,
    staleTime: 0,
    queryFn: () => read.promise,
  });
  await act(async () => {
    write.resolve(saved);
  });
  expect(announce).not.toHaveBeenCalled();
  await act(async () => {
    read.resolve(profile({ money: 42 }));
    await fetching;
  });
  await settle(view);
  expect(cache.getQueryData<UserCache>(key)?.userData).toMatchObject({
    autoWakeUp: true,
    money: 42,
  });
  expect(announce).toHaveBeenCalledTimes(1);
});

it("releases captured writes on unmount without changing the profile", async () => {
  const view = show();
  const earlier = controller.prepareUpdate({ autoWakeUp: true });
  view.unmount();
  expect(await controller.updateCache(saved, earlier)).toBe(false);
  expect(cache.getQueryData<UserCache>(key)?.userData?.autoWakeUp).toBe(false);
});

it("rejects a response that does not confirm the captured scalar", async () => {
  show();
  const earlier = controller.prepareUpdate({ autoWakeUp: true });
  expect(
    await controller.updateCache(
      {
        success: true,
        message: "Updated preferences",
        userPatch: { autoWakeUp: false },
      },
      earlier,
    ),
  ).toBe(false);
  expect(
    await controller.updateCache(
      { success: true, message: "Updated preferences" },
      earlier,
    ),
  ).toBe(false);
  expect(cache.getQueryData<UserCache>(key)?.userData?.autoWakeUp).toBe(false);
  earlier.release();
});
