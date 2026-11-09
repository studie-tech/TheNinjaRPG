import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { focusManager, onlineManager, QueryClient } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { getQueryKey } from "@trpc/react-query";
import type { PropsWithChildren } from "react";
import * as client from "@/app/_trpc/client";
import { useMapAssetLibrary } from "@/hooks/useMapAssetLibrary";
import { fakeTrpcClient, TrpcTestProviders, testApi } from "../setup/trpc";

const artwork = {
  id: "tower",
  key: "tower",
  category: "structure",
  licenseDetails: "",
  name: "Tower",
  randomRotation: false,
  renderScale: 1,
  small: false,
  windAffected: false,
};
const clients: QueryClient[] = [];
let now = 0;
beforeEach(() => {
  now = Date.UTC(2026, 10, 2, 12);
  vi.useFakeTimers();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  Object.assign(vi.spyOn(client, "api" as never), { mapAsset: testApi.mapAsset });
  focusManager.setFocused(true);
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((queryClient) => queryClient.clear());
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Flush actual query/transport notifications while keeping the recovery clock controlled. */
const settle = async () => {
  await act(async () => {
    for (let index = 0; index < 30; index++) await Promise.resolve();
    vi.advanceTimersByTime(1);
  });
};
/** Advance one recovery interval at a time so each canonical read can settle. */
const advance = async (ms: number) => {
  await act(async () => {
    now += ms;
    vi.advanceTimersByTime(ms);
  });
  await settle();
};

/** Observe the production library hook through its real typed query key and transport. */
const setup = (enabled = true) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(queryClient);
  let imageUrl = "/old.png";
  let fail = false;
  const read = vi.fn(() => {
    if (fail) throw new Error("Artwork unavailable");
    return [{ ...artwork, imageUrl, createdAt: new Date(0), updatedAt: new Date(now) }];
  });
  const trpc = fakeTrpcClient(() => read());
  const wrapper = ({ children }: PropsWithChildren) => (
    <TrpcTestProviders client={trpc} queryClient={queryClient}>
      {children}
    </TrpcTestProviders>
  );
  const view = renderHook(({ enabled }) => useMapAssetLibrary(enabled), {
    initialProps: { enabled },
    wrapper,
  });
  const key = getQueryKey(testApi.mapAsset.getAll, undefined, "query");
  return {
    view,
    read,
    queryClient,
    key,
    wrapper,
    setImage: (next: string) => {
      imageUrl = next;
    },
    fail: (value: boolean) => {
      fail = value;
    },
  };
};

it("uses37 reads across three quiet hours per tab while retaining scene-only artwork fields", async () => {
  const tabs = [setup(), setup()];
  await settle();
  expect(tabs[0]!.view.result.current.data).toEqual([
    { ...artwork, imageUrl: "/old.png" },
  ]);
  for (let interval = 0; interval < 36; interval++) await advance(5 * 60_000);
  tabs.forEach((tab) => expect(tab.read).toHaveBeenCalledTimes(37));
});

it("refreshes edits immediately through the existing exact-key content/editor invalidation", async () => {
  const t = setup();
  await settle();
  t.setImage("/edited.png");
  await act(async () => {
    await t.queryClient.invalidateQueries({ queryKey: t.key, exact: true });
  });
  await settle();
  expect(t.read).toHaveBeenCalledTimes(2);
  expect(t.view.result.current.data?.[0]?.imageUrl).toBe("/edited.png");
});

it("recovers a missed edit at the bounded foreground interval", async () => {
  const t = setup();
  await settle();
  t.setImage("/missed.png");
  await advance(10_000);
  expect(t.read).toHaveBeenCalledTimes(1);
  await advance(5 * 60_000 - 10_000);
  expect(t.view.result.current.data?.[0]?.imageUrl).toBe("/missed.png");
  expect(t.read).toHaveBeenCalledTimes(2);
});

it("pauses hidden polling and reconciles fresh cached artwork on focus and network recovery", async () => {
  const t = setup();
  await settle();
  await act(async () => focusManager.setFocused(false));
  t.setImage("/focus.png");
  await advance(5 * 60_000);
  expect(t.read).toHaveBeenCalledTimes(1);
  await act(async () => focusManager.setFocused(true));
  await settle();
  expect(t.view.result.current.data?.[0]?.imageUrl).toBe("/focus.png");
  t.setImage("/reconnected.png");
  await act(async () => {
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
  });
  await settle();
  expect(t.view.result.current.data?.[0]?.imageUrl).toBe("/reconnected.png");
});

it("retains artwork across navigation and recovers edits invalidated while the map is unmounted", async () => {
  const t = setup();
  await settle();
  t.view.unmount();
  await advance(10_000);
  const remount = renderHook(() => useMapAssetLibrary(true), { wrapper: t.wrapper });
  await settle();
  expect(t.read).toHaveBeenCalledTimes(1);
  remount.unmount();
  t.setImage("/saved-elsewhere.png");
  await act(async () => {
    await t.queryClient.invalidateQueries({ queryKey: t.key, exact: true });
  });
  const invalidated = renderHook(() => useMapAssetLibrary(true), {
    wrapper: t.wrapper,
  });
  await settle();
  expect(invalidated.result.current.data?.[0]?.imageUrl).toBe("/saved-elsewhere.png");
  expect(t.read).toHaveBeenCalledTimes(2);
});

it("waits for the player and recovers failed reads without losing the library", async () => {
  const t = setup(false);
  await settle();
  expect(t.read).not.toHaveBeenCalled();
  t.view.rerender({ enabled: true });
  await settle();
  t.fail(true);
  await advance(5 * 60_000);
  expect(t.read).toHaveBeenCalledTimes(2);
  expect(t.queryClient.getQueryState(t.key)?.status).toBe("error");
  expect(t.view.result.current.data?.[0]?.imageUrl).toBe("/old.png");
  t.fail(false);
  t.setImage("/recovered.png");
  await advance(10_000);
  expect(t.view.result.current.data?.[0]?.imageUrl).toBe("/recovered.png");
});
