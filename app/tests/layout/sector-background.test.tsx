import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { readFileSync } from "node:fs";
import { focusManager, onlineManager, QueryClient } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { type PropsWithChildren, useRef } from "react";
import type { RouterOutputs } from "@/app/_trpc/client";
import * as client from "@/app/_trpc/client";
import { useDungeonAvailability } from "@/hooks/useDungeonAvailability";
import { useSectorCacheUpdate } from "@/hooks/useSectorCacheUpdate";
import { useVillageDutyPursuit } from "@/hooks/useVillageDuty";
import {
  isSectorPresenceStatus,
  SECTOR_ARRIVAL_BATCH_LIMIT,
  SECTOR_ARRIVAL_BATCH_MS,
} from "@/libs/travel";
import { deferred } from "../setup/deferred";
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
  `with (scope) { ${transpiler.transformSync(source.slice(updateStart, updateEnd))}; return { updateUsersList, cancelArrival }; }`,
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
    useUtils: testApi.useUtils,
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
const setup = (
  isActive: boolean,
  observeParent = false,
  arrivalRead?: (userIds: string[]) => Promise<unknown[]>,
) => {
  let generation = 0;
  const read = vi.fn((path: string, input?: unknown) => {
    if (path === "travel.getSectorData")
      return {
        users: [],
        protectors: [],
        patrolThreat: true,
        patrolRevision: generation,
      };
    if (path === "travel.getSectorUsers") {
      const { userIds } = input as { userIds: string[] };
      return arrivalRead
        ? arrivalRead(userIds)
        : userIds.map((userId) => ({ userId, username: userId, sector: 3 }));
    }
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
      const arrivalsRef = useRef({
        wanted: new Map<
          string,
          { movement?: { longitude: number; latitude: number } }
        >(),
        queued: new Set<string>(),
        timer: undefined as ReturnType<typeof setTimeout> | undefined,
      });
      const { prepareSectorUpdate, isSectorFetching, addArrivals } =
        useSectorCacheUpdate(props.sector);
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
      const { updateUsersList: updateRemote, cancelArrival } = presenceMerge({
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
        props,
        mountedRef: { current: true },
        arrivalsRef,
        prepareSectorUpdate,
        isSectorFetching,
        addArrivals,
        isSectorPresenceStatus,
        SECTOR_ARRIVAL_BATCH_LIMIT,
        SECTOR_ARRIVAL_BATCH_MS,
      }) as {
        updateUsersList: (data: unknown) => Promise<void>;
        cancelArrival: (userId: string) => void;
      };
      return { data, updateRemote, cancelArrival, arrivals: arrivalsRef.current };
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

it("defers unknown hidden presence and resolves visible arrivals without a sector reread", async () => {
  const test = setup(false, true);
  await settle();
  expect(test.calls("travel.getSectorData")).toBe(1);
  await act(async () => {
    await test.result.current.updateRemote({
      userId: "new",
      sector: 3,
      status: "AWAKE",
    });
  });
  await advance(SECTOR_ARRIVAL_BATCH_MS);
  expect(test.calls("travel.getSectorData")).toBe(1);
  expect(test.calls("travel.getSectorUsers")).toBe(0);
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
  // A departing traveller's status never appears on the map, so it reads nothing.
  await act(async () => {
    await test.result.current.updateRemote({
      userId: "away",
      sector: 3,
      status: "TRAVEL",
    });
  });
  await advance(SECTOR_ARRIVAL_BATCH_MS);
  expect(test.calls("travel.getSectorUsers")).toBe(0);
  // A burst of visible arrivals shares one narrow read and joins the snapshot.
  await act(async () => {
    await test.result.current.updateRemote({
      userId: "another",
      sector: 3,
      status: "AWAKE",
    });
    await test.result.current.updateRemote({
      userId: "another",
      sector: 3,
      status: "AWAKE",
    });
    await test.result.current.updateRemote({
      userId: "third",
      sector: 3,
      status: "BATTLE",
    });
  });
  await advance(SECTOR_ARRIVAL_BATCH_MS);
  expect(test.calls("travel.getSectorUsers")).toBe(1);
  expect(
    test.read.mock.calls.find(([path]) => path === "travel.getSectorUsers")?.[1],
  ).toEqual({ sector: 3, userIds: ["another", "third"] });
  expect(test.calls("travel.getSectorData")).toBe(2);
  expect(test.result.current.data.users.map((user) => user.userId)).toEqual([
    "another",
    "third",
  ]);
});

it("keeps newer movement but server-formatted identities when an arrival read settles", async () => {
  const pending = deferred<unknown[]>();
  const test = setup(true, false, () => pending.promise);
  await settle();
  await act(async () =>
    test.result.current.updateRemote({
      userId: "arrival",
      sector: 3,
      status: "AWAKE",
      longitude: 1,
      latitude: 1,
    }),
  );
  await advance(SECTOR_ARRIVAL_BATCH_MS);
  await act(async () =>
    test.result.current.updateRemote({
      userId: "arrival",
      sector: 3,
      status: "AWAKE",
      longitude: 2,
      latitude: 3,
      username: "Unmasked name",
      avatar: "unmasked.webp",
    }),
  );
  pending.resolve([
    {
      userId: "arrival",
      sector: 3,
      longitude: 1,
      latitude: 1,
      username: "ANBU",
      avatar: "mask.webp",
    },
  ]);
  await settle();
  expect(test.result.current.data.users).toEqual([
    expect.objectContaining({
      userId: "arrival",
      longitude: 2,
      latitude: 3,
      username: "ANBU",
      avatar: "mask.webp",
    }),
  ]);
});

it.each([false, true])(
  "does not consume a returning player's arrival with an earlier response (failure: %s)",
  async (fail) => {
    const first = deferred<unknown[]>();
    let reads = 0;
    const test = setup(true, false, async () => {
      if (++reads === 1) return first.promise;
      return [{ userId: "arrival", sector: 3, longitude: 7, latitude: 7 }];
    });
    await settle();
    await act(async () =>
      test.result.current.updateRemote({
        userId: "arrival",
        sector: 3,
        status: "AWAKE",
        longitude: 1,
        latitude: 1,
      }),
    );
    await advance(SECTOR_ARRIVAL_BATCH_MS);
    test.result.current.cancelArrival("arrival");
    await act(async () =>
      test.result.current.updateRemote({
        userId: "arrival",
        sector: 3,
        status: "AWAKE",
        longitude: 7,
        latitude: 7,
      }),
    );
    if (fail) first.reject(new Error("Arrival read failed"));
    else first.resolve([{ userId: "arrival", sector: 3, longitude: 1, latitude: 1 }]);
    await settle();
    expect(test.result.current.data.users).toEqual([]);
    expect(test.result.current.arrivals.wanted.has("arrival")).toBe(true);
    await advance(SECTOR_ARRIVAL_BATCH_MS);
    expect(test.result.current.data.users).toEqual([
      expect.objectContaining({
        userId: "arrival",
        longitude: 7,
        latitude: 7,
      }),
    ]);
  },
);
