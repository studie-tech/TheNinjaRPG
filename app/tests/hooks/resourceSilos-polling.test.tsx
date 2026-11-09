import { focusManager, onlineManager, QueryClient } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import type { PropsWithChildren } from "react";
import * as appClient from "@/app/_trpc/client";
import { useResourceSilo } from "@/hooks/useResourceSilos";
import * as userContext from "@/utils/UserContext";
import { getResourceSiloWindow } from "@/utils/time";
import { fakeTrpcClient, testApi, TrpcTestProviders } from "../setup/trpc";

const clients: QueryClient[] = [];
let now = 0;
beforeEach(() => {
  now = Date.UTC(2026, 10, 9, 12);
  vi.useFakeTimers();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  Object.assign(vi.spyOn(appClient, "api" as never), {
    resourceSilos: testApi.resourceSilos, item: testApi.item, jutsu: testApi.jutsu,
    bloodline: testApi.bloodline, profile: testApi.profile, useUtils: testApi.useUtils,
  });
  focusManager.setFocused(true);
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Settle the real tRPC observer without moving the server clock across a deadline. */
const settle = async () => act(async () => {
  for (let wave = 0; wave < 3; wave++) {
    for (let index = 0; index < 30; index++) await Promise.resolve();
    vi.advanceTimersByTime(1);
  }
});
const advance = async (ms: number) => {
  await act(async () => { now += ms; vi.advanceTimersByTime(ms); });
  await settle();
};

/** Exercise the production hook with infinite freshness and controlled server responses. */
const setup = ({ offset = 0, deferFirst = false, failInitially = false } = {}) => {
  let points = 0;
  let claimed = false;
  let configured = true;
  let fail = failInitially;
  let finishFirst: (() => void) | undefined;
  vi.spyOn(userContext, "useRequiredUserData").mockReturnValue({
    data: { userId: "viewer" }, timeDiff: offset,
    prepareUserUpdate: () => undefined, updateUser: async () => false,
  } as never);
  const read = vi.fn(() => {
    if (fail) throw new Error("Status unavailable");
    const data = { window: getResourceSiloWindow(new Date(now - offset)), points, claimed, configured };
    if (deferFirst && read.mock.calls.length === 1)
      return new Promise<typeof data>(resolve => { finishFirst = () => resolve(data); });
    return data;
  });
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  clients.push(client);
  const trpc = fakeTrpcClient(path => {
    expect(path).toBe("resourceSilos.getStatus");
    return read();
  });
  const wrapper = ({ children }: PropsWithChildren) => <TrpcTestProviders client={trpc} queryClient={client}>{children}</TrpcTestProviders>;
  return {
    ...renderHook(() => {
      const silo = useResourceSilo();
      // The shrine consumes loading/error flags as well as the server data.
      return { ...silo, status: { ...silo.status } };
    }, { wrapper }), read,
    finish: () => finishFirst?.(),
    fail: (value: boolean) => { fail = value; },
    set: (value: { points: number; claimed: boolean; configured: boolean }) => { ({ points, claimed, configured } = value); },
  };
};

it("polls future closed windows every five minutes", async () => {
  const tab = setup();
  await settle();
  await advance(299_000);
  expect(tab.read).toHaveBeenCalledTimes(1);
  await advance(1_000);
  expect(tab.read).toHaveBeenCalledTimes(2);
  expect(tab.result.current.status.data?.window.active).toBe(false);
});

it("keeps the fifteen-second active cadence for points and configuration after a claim", async () => {
  now = Date.UTC(2026, 10, 13, 12);
  const tab = setup();
  await settle();
  for (let interval = 0; interval < 3; interval++) {
    tab.set({ points: interval * 10, claimed: true, configured: interval % 2 === 0 });
    await advance(15_000);
    expect(tab.result.current.status.data).toMatchObject({ points: interval * 10, claimed: true, configured: interval % 2 === 0 });
  }
  expect(tab.read).toHaveBeenCalledTimes(4);
});

it.each([-120_000, 0, 120_000])("refreshes opening and closing boundaries with clock offset %s", async offset => {
  now = Date.UTC(2026, 10, 13, 11, 59, 55) + offset;
  const tab = setup({ offset });
  await settle();
  await advance(4_000);
  expect(tab.read).toHaveBeenCalledTimes(1);
  await advance(2_000);
  expect(tab.read).toHaveBeenCalledTimes(2);
  expect(tab.result.current.status.data?.window.active).toBe(true);
  // Deliver an active snapshot shortly before its end, then let the deadline refresh it.
  now = Date.UTC(2026, 10, 13, 12, 59, 55) + offset;
  await act(async () => { await tab.result.current.status.refetch(); });
  await settle();
  const reads = tab.read.mock.calls.length;
  await advance(6_000);
  expect(tab.read).toHaveBeenCalledTimes(reads + 1);
  expect(tab.result.current.status.data?.window.active).toBe(false);
  await advance(15_000);
  expect(tab.read).toHaveBeenCalledTimes(reads + 1);
});

it("recovers a closed response that arrives after its opening deadline in fifteen seconds", async () => {
  now = Date.UTC(2026, 10, 13, 11, 59, 55);
  const tab = setup({ deferFirst: true });
  await settle();
  await advance(6_000);
  await act(async () => tab.finish());
  await settle();
  expect(tab.result.current.status.data?.window.active).toBe(false);
  await advance(15_000);
  expect(tab.read).toHaveBeenCalledTimes(2);
  expect(tab.result.current.status.data?.window.active).toBe(true);
});

it.each([false, true])("recovers errors every fifteen seconds with cached closed data=%s", async cached => {
  const tab = setup({ failInitially: !cached });
  await settle();
  if (cached) {
    tab.fail(true);
    await act(async () => { await tab.result.current.status.refetch(); });
    await settle();
  }
  expect(tab.result.current.status.isError).toBe(true);
  const reads = tab.read.mock.calls.length;
  await advance(15_000);
  expect(tab.read).toHaveBeenCalledTimes(reads + 1);
  tab.fail(false);
  await advance(15_000);
  expect(tab.result.current.status.isError).toBe(false);
  await advance(15_000);
  expect(tab.read).toHaveBeenCalledTimes(reads + 2);
  await advance(285_000);
  expect(tab.read).toHaveBeenCalledTimes(reads + 3);
});

it("refreshes on focus and reconnect despite infinite freshness and pauses background polling", async () => {
  const tab = setup();
  await settle();
  await act(async () => focusManager.setFocused(false));
  await advance(300_000);
  expect(tab.read).toHaveBeenCalledTimes(1);
  tab.set({ points: 10, claimed: false, configured: false });
  await act(async () => focusManager.setFocused(true));
  await settle();
  expect(tab.read).toHaveBeenCalledTimes(2);
  expect(tab.result.current.status.data?.configured).toBe(false);
  await act(async () => { onlineManager.setOnline(false); onlineManager.setOnline(true); });
  await settle();
  expect(tab.read).toHaveBeenCalledTimes(3);
});
