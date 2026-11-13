import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { readFileSync } from "node:fs";
import { focusManager, onlineManager, QueryClient } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import type { RouterOutputs } from "@/app/_trpc/client";
import * as client from "@/app/_trpc/client";
import { useDungeonAvailability } from "@/hooks/useDungeonAvailability";
import { useVillageDutyPursuit } from "@/hooks/useVillageDuty";
import { fakeTrpcClient, TrpcTestProviders, testApi } from "../setup/trpc";
import { mockUserContextValue } from "../setup/userContext";

// Exercise the production query and pursuit bindings without mounting the WebGL scene.
const source = readFileSync(
  new URL("../../src/layout/Sector.tsx", import.meta.url),
  "utf8",
);
const transpiler = new (require("bun").Transpiler)({ loader: "ts" }) as {
  transformSync(source: string): string;
};
const start = source.indexOf("  const { data } = api.travel.getSectorData.useQuery(");
const end = source.indexOf("  const villageData = data?.village;", start);
const dungeonStart = source.indexOf("  const {\n    data: sectorDungeons,", end);
const dungeonEnd = source.indexOf("  const dungeonStructures =", dungeonStart);
if (start < 0 || end < 0 || dungeonStart < 0 || dungeonEnd < 0)
  throw new Error("Missing sector query bindings");
const readSector = new Function(
  "scope",
  `with (scope) { ${transpiler.transformSync(source.slice(start, end) + source.slice(dungeonStart, dungeonEnd))}; return data; }`,
);
const parentSource = readFileSync(
  new URL("../../src/app/[shell]/travel/page.tsx", import.meta.url),
  "utf8",
);
const parentStart = parentSource.indexOf("  const { data: sectorVillageName }");
const parentEnd = parentSource.indexOf("  const { data: mapAssets }", parentStart);
if (parentStart < 0 || parentEnd < 0) throw new Error("Missing parent sector query");
const readParent = new Function(
  "scope",
  `with (scope) { ${transpiler.transformSync(parentSource.slice(parentStart, parentEnd))} }`,
);
const updateStart = source.indexOf("  const updateUsersList = async (");
const updateEnd = source.indexOf("  /** Stand the own marker", updateStart);
if (updateStart < 0 || updateEnd < 0) throw new Error("Missing presence merge");
const presenceMerge = new Function(
  "scope",
  `with (scope) { ${transpiler.transformSync(source.slice(updateStart, updateEnd))}; return updateUsersList; }`,
);
const clients: QueryClient[] = [];
let now: number;
beforeEach(() => {
  now = Date.UTC(2026, 10, 13, 12);
  vi.useFakeTimers();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  Object.assign(vi.spyOn(client, "api" as never), {
    travel: testApi.travel,
    coop: testApi.coop,
    villageDuty: testApi.villageDuty,
  });
  mockUserContextValue({
    userId: "actor",
    timeDiff: 0,
    prepareUserUpdate: () => 1,
    updateUser: vi.fn(),
  } as never);
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
const settle = async () => {
  await act(async () => {
    for (let index = 0; index < 30; index++) await Promise.resolve();
    vi.advanceTimersByTime(1);
  });
};
const advance = async (ms: number) => {
  await act(async () => {
    now += ms;
    vi.advanceTimersByTime(ms);
  });
  await settle();
};
/** Mount the actual presence, patrol and dungeon hooks used by the retained sector. */
const setup = (isActive: boolean, observeParent = false) => {
  let generation = 0;
  const read = vi.fn((path: string) => {
    if (path === "travel.getSectorData")
      return {
        users: [],
        protectors: [],
        patrolThreat: true,
        patrolRevision: generation,
      };
    if (path === "coop.dungeon.getAvailable") return [];
    if (path === "villageDuty.patrol")
      return { success: true, message: "Checked patrol" };
    throw new Error(`Unexpected query ${path}`);
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  clients.push(queryClient);
  const trpcClient = fakeTrpcClient(read);
  const wrapper = ({ children }: PropsWithChildren) => (
    <TrpcTestProviders client={trpcClient} queryClient={queryClient}>
      {children}
    </TrpcTestProviders>
  );
  const view = renderHook(
    (props: { isActive: boolean; sector: number }) => {
      const utils = testApi.useUtils();
      if (observeParent)
        readParent({ api: testApi, userData: { sector: props.sector } });
      const data = readSector({
        api: testApi,
        props,
        sector: props.sector,
        profile: { userId: "actor", status: "AWAKE" },
        userData: { sector: props.sector },
        timeDiff: 0,
        useVillageDutyPursuit,
        useDungeonAvailability,
      }) as RouterOutputs["travel"]["getSectorData"];
      const updateRemote = presenceMerge({
        userRef: { current: { userId: "actor" } },
        userData: { userId: "actor" },
        usersRef: { current: [] },
        sectorRef: { current: props.sector },
        actorRevisionRef: { current: 0 },
        isActiveRef: { current: props.isActive },
        isUserCurrentlyStealthed: () => false,
        mapAttackRelation: () => "NEUTRAL",
        warData: undefined,
        publishSurroundings: () => {},
        utils,
      }) as (data: unknown) => Promise<void>;
      return { data, updateRemote };
    },
    { wrapper, initialProps: { isActive, sector: 3 } },
  );
  return {
    ...view,
    queryClient,
    read,
    calls: (path: string) => read.mock.calls.filter(([value]) => value === path).length,
    change: () => {
      generation++;
    },
  };
};

it("prepares hidden destinations once and sleeps through intervals, invalidations, focus and reconnect", async () => {
  const test = setup(false);
  await settle();
  expect(test.calls("travel.getSectorData")).toBe(1);
  for (let index = 0; index < 6; index++) await advance(10_000);
  await act(async () => {
    await test.queryClient.invalidateQueries();
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
  });
  await settle();
  expect(test.calls("travel.getSectorData")).toBe(1);
  expect(test.calls("villageDuty.patrol")).toBe(0);
  expect(test.calls("coop.dungeon.getAvailable")).toBe(0);
  test.rerender({ isActive: false, sector: 4 });
  await settle();
  expect(test.calls("travel.getSectorData")).toBe(2);
  expect(test.calls("villageDuty.patrol")).toBe(0);
});

it("catches up once on stale activation, polls while visible and pauses again on Global", async () => {
  const test = setup(true);
  await settle();
  expect(test.calls("travel.getSectorData")).toBe(1);
  expect(test.calls("villageDuty.patrol")).toBe(1);
  expect(test.calls("coop.dungeon.getAvailable")).toBe(1);
  test.rerender({ isActive: false, sector: 3 });
  for (let index = 0; index < 6; index++) await advance(10_000);
  expect(test.calls("travel.getSectorData")).toBe(1);
  expect(test.calls("villageDuty.patrol")).toBe(1);
  test.change();
  test.rerender({ isActive: true, sector: 3 });
  await settle();
  expect(test.calls("travel.getSectorData")).toBe(2);
  expect(test.result.current.data.patrolRevision).toBe(1);
  expect(test.calls("villageDuty.patrol")).toBe(2);
  expect(test.calls("coop.dungeon.getAvailable")).toBe(2);
  await advance(10_000);
  expect(test.calls("travel.getSectorData")).toBe(3);
  test.rerender({ isActive: false, sector: 3 });
  test.rerender({ isActive: true, sector: 3 });
  await settle();
  expect(test.calls("travel.getSectorData")).toBe(3);
});

it("defers unknown hidden presence with an enabled parent observer and catches up on activation", async () => {
  const test = setup(false, true);
  await settle();
  expect(test.calls("travel.getSectorData")).toBe(1);
  await act(async () => {
    await test.result.current.updateRemote({ userId: "new", sector: 3 });
  });
  await settle();
  expect(test.calls("travel.getSectorData")).toBe(1);
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
  });
  await settle();
  expect(test.calls("travel.getSectorData")).toBe(1);
  test.change();
  test.rerender({ isActive: true, sector: 3 });
  await settle();
  expect(test.calls("travel.getSectorData")).toBe(2);
  expect(test.result.current.data.patrolRevision).toBe(1);
  await act(async () => {
    await test.result.current.updateRemote({ userId: "another", sector: 3 });
  });
  await settle();
  expect(test.calls("travel.getSectorData")).toBe(3);
});
