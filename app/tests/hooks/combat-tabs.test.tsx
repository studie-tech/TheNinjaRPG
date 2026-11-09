import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { observable } from "@trpc/server/observable";
import { useEffect, useState } from "react";
import * as client from "@/app/_trpc/client";
import { useCombatUpdates } from "@/hooks/combat";
import { useCombatTabs } from "@/hooks/combatTabs";
import type { BattleState } from "@/libs/combat/types";
import * as userContext from "@/utils/UserContext";
import { deferred } from "../setup/deferred";
import { TrpcTestProviders, testApi } from "../setup/trpc";

const clients: QueryClient[] = [];
const channels = new Set<TestChannel>();
let locksDescriptor: PropertyDescriptor | undefined;
let channelDescriptor: PropertyDescriptor | undefined;

/** Browser boundaries retain queueing, structured cloning and abort semantics across independent query clients. */
class TestChannel {
  onmessage?: (event: { data: unknown }) => void;
  constructor(readonly name: string) {
    channels.add(this);
  }
  postMessage(data: unknown) {
    for (const peer of channels)
      if (peer !== this && peer.name === this.name)
        queueMicrotask(() => {
          if (channels.has(peer)) peer.onmessage?.({ data: structuredClone(data) });
        });
  }
  close() {
    channels.delete(this);
  }
}

beforeEach(() => {
  locksDescriptor = Object.getOwnPropertyDescriptor(navigator, "locks");
  channelDescriptor = Object.getOwnPropertyDescriptor(globalThis, "BroadcastChannel");
  const tails = new Map<string, Promise<void>>();
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (
        name: string,
        options: { signal: AbortSignal },
        callback: () => Promise<void>,
      ) => {
        const previous = tails.get(name) ?? Promise.resolve();
        const { promise: held, resolve: release } = deferred<void>();
        tails.set(
          name,
          previous.then(() => held),
        );
        await previous;
        if (!options.signal.aborted) await callback();
        release();
      },
    },
  });
  Object.defineProperty(globalThis, "BroadcastChannel", {
    configurable: true,
    value: TestChannel,
  });
  Object.assign(vi.spyOn(client, "api" as never), {
    combat: testApi.combat,
    useUtils: testApi.useUtils,
  });
  vi.spyOn(userContext, "useUserData").mockReturnValue({
    data: { userId: "viewer" },
  } as never);
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((value) => value.clear());
  channels.clear();
  vi.restoreAllMocks();
  if (locksDescriptor) Object.defineProperty(navigator, "locks", locksDescriptor);
  else Reflect.deleteProperty(navigator, "locks");
  if (channelDescriptor)
    Object.defineProperty(globalThis, "BroadcastChannel", channelDescriptor);
  else Reflect.deleteProperty(globalThis, "BroadcastChannel");
});

const initial = () =>
  ({
    battle: { id: "shared", version: 1 },
    result: null,
    isPending: false,
  }) as BattleState;
const setup = () => {
  let version = 1;
  const requests: { tab: number; path: string }[] = [];
  const tabs = [0, 1].map((tab) => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    });
    clients.push(queryClient);
    const trpc = testApi.createClient({
      links: [
        () =>
          ({ op }) =>
            observable((observer) => {
              requests.push({ tab, path: op.path });
              const data =
                op.path === "combat.getBattle"
                  ? initial()
                  : {
                      updateClient: true,
                      battleUpdate: { ...initial().battle, version: ++version },
                      result: version >= 3 ? { outcome: "Won" } : null,
                      logEntries: [],
                      updatedQuestIds: [],
                    };
              observer.next({ result: { data } });
              observer.complete();
            }),
      ],
    });
    let controls!: ReturnType<typeof useCombatUpdates>;
    let state = initial();
    let drive!: () => void;
    function Tab() {
      const [current, setCurrent] = useState(initial);
      state = current;
      const { data } = testApi.combat.getBattle.useQuery({ battleId: "shared" });
      useEffect(() => {
        if (data?.battle) setCurrent({ ...data, isPending: false });
      }, [data]);
      controls = useCombatUpdates(current);
      const action = testApi.combat.performAction.useMutation({
        onSuccess: (response) => {
          if (response.battleUpdate) {
            controls.publishBattle({
              battle: response.battleUpdate,
              result: response.result,
              logEntries: response.logEntries,
            });
            setCurrent({
              battle: response.battleUpdate,
              result: response.result,
              isPending: false,
            });
          }
        },
        onSettled: (response, error) =>
          controls.settleAction(
            "shared",
            { battle: response?.battleUpdate, result: response?.result },
            !!error,
          ),
      });
      drive = () => {
        if (!current.result && controls.canDrive() && controls.startAction("shared"))
          action.mutate({ battleId: "shared" });
      };
      return <p>{current.result ? "Result" : current.battle?.version}</p>;
    }
    const view = render(
      <TrpcTestProviders client={trpc} queryClient={queryClient}>
        <Tab />
      </TrpcTestProviders>,
    );
    return {
      view,
      get state() {
        return state;
      },
      drive: () => drive(),
      canDrive: () => controls.canDrive(),
    };
  });
  return { tabs, requests };
};

it("uses one driver for two tabs and shares turns and results without additional battle reads", async () => {
  const { tabs, requests } = setup();
  await waitFor(() => expect(tabs.filter((tab) => tab.canDrive())).toHaveLength(1));
  await waitFor(() =>
    expect(
      requests.filter((request) => request.path === "combat.getBattle"),
    ).toHaveLength(2),
  );
  await act(async () => {
    tabs.forEach((tab) => tab.drive());
  });
  await waitFor(() =>
    expect(tabs.map((tab) => tab.state.battle?.version)).toEqual([2, 2]),
  );
  await act(async () => {
    tabs.forEach((tab) => tab.drive());
  });
  await waitFor(() =>
    expect(tabs.every((tab) => tab.state.result?.outcome === "Won")).toBe(true),
  );
  expect(
    requests.filter((request) => request.path === "combat.performAction"),
  ).toHaveLength(2);
  expect(
    requests.filter((request) => request.path === "combat.getBattle"),
  ).toHaveLength(2);
});

it("promotes a waiting tab when the driver closes without refetching its battle", async () => {
  const { tabs, requests } = setup();
  await waitFor(() => expect(tabs.filter((tab) => tab.canDrive())).toHaveLength(1));
  const leader = tabs.find((tab) => tab.canDrive())!,
    peer = tabs.find((tab) => !tab.canDrive())!;
  await act(async () => leader.drive());
  await waitFor(() => expect(peer.state.battle?.version).toBe(2));
  leader.view.unmount();
  await waitFor(() => expect(peer.canDrive()).toBe(true));
  await act(async () => peer.drive());
  await waitFor(() => expect(peer.state.result?.outcome).toBe("Won"));
  expect(
    requests.filter((request) => request.path === "combat.getBattle"),
  ).toHaveLength(2);
});

it("retains ordinary autonomous combat when browser coordination is unavailable", () => {
  Reflect.deleteProperty(navigator, "locks");
  const hook = renderHook(() => useCombatTabs("battle", "viewer", () => {}));
  expect(hook.result.current.canDrive()).toBe(true);
  expect(channels.size).toBe(0);
});

it("hands manual-combat driving to an active tab when the owner becomes inactive", async () => {
  const first = renderHook(
    ({ enabled }) => useCombatTabs("manual", "viewer", () => {}, enabled),
    { initialProps: { enabled: true } },
  );
  const second = renderHook(() => useCombatTabs("manual", "viewer", () => {}));
  await waitFor(() => expect(first.result.current.canDrive()).toBe(true));
  expect(second.result.current.canDrive()).toBe(false);
  first.rerender({ enabled: false });
  await waitFor(() => expect(second.result.current.canDrive()).toBe(true));
  expect(first.result.current.canDrive()).toBe(false);
  expect(channels.size).toBe(2);
});
