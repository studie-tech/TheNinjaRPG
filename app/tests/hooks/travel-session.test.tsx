import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import * as client from "@/app/_trpc/client";
import { MAP_WAKE_ISLAND_SECTOR } from "@/drizzle/constants";
import * as lpc from "@/hooks/lpc";
import * as map from "@/hooks/map";
import * as navigation from "@/hooks/navigation";
import * as tutorial from "@/hooks/tutorial";
import * as items from "@/hooks/useItemActions";
import * as sectorCache from "@/hooks/useSectorCacheUpdate";
import { useTravelSession } from "@/hooks/useTravelSession";
import type { GlobalMapData } from "@/libs/sector-map/world-types";
import * as toast from "@/libs/toast";
import type { UserWithRelations } from "@/routers/profile";
import * as userContext from "@/utils/UserContext";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";
import { deferred } from "../setup/deferred";
import { sectorMap } from "../setup/sectorMap";
import { fakeTrpcClient, TrpcTestProviders, testApi } from "../setup/trpc";
import { mockUserContextValue } from "../setup/userContext";

const clients: QueryClient[] = [];
const globe = {
  tiles: Array.from({ length: 16 }, () => ({})),
} as unknown as GlobalMapData;
const completeTutorialAction = vi.fn(async () => undefined);
const navigate = vi.fn();
const snapshot = { sector: 1, query: 7 };
const updateSector = vi.fn(async () => true);
const announce = vi.fn();
let user: UserWithRelations;
let currentStep: ReturnType<typeof tutorial.useTutorialStep>["currentStep"];
const updateUser = vi.fn(async (patch: unknown, _options?: unknown) => {
  if (user && typeof patch === "object" && patch) Object.assign(user, patch);
  return true;
});
const refreshUser = vi.fn(async () => true);

beforeEach(() => {
  vi.clearAllMocks();
  installBrowserGlobals();
  localStorage.clear();
  user = {
    userId: "traveller",
    username: "Traveller",
    sector: 1,
    longitude: 0,
    latitude: 0,
    status: "AWAKE",
    rank: "STUDENT",
    isOutlaw: false,
    tutorialOn: false,
    tutorialStep: 0,
    travelFinishAt: null,
    userQuests: [],
    questData: [],
  } as unknown as NonNullable<UserWithRelations>;
  currentStep = undefined;
  mockUserContextValue(() => ({
    data: user,
    timeDiff: 0,
    updateUser,
    refreshUser,
    prepareUserUpdate: () => 11,
  }));
  vi.spyOn(userContext, "useUserDataRef").mockImplementation(() => ({ current: user }));
  vi.spyOn(map, "useMap").mockReturnValue({ globe, mapError: false });
  vi.spyOn(lpc, "useLpcCatalogLoader").mockReturnValue(vi.fn());
  vi.spyOn(tutorial, "useTutorialStep").mockImplementation(
    () => ({ currentStep, completeTutorialAction }) as never,
  );
  vi.spyOn(items, "useConsumeItem").mockReturnValue({
    consume: vi.fn(),
    isConsuming: false,
  } as never);
  vi.spyOn(sectorCache, "useSectorCacheUpdate").mockReturnValue({
    prepareSectorUpdate: () => snapshot,
    updateSector,
  } as never);
  vi.spyOn(navigation, "useNavigationRouter").mockReturnValue({
    push: navigate,
    replace: navigate,
  } as never);
  vi.spyOn(toast, "showMutationToast").mockImplementation(announce);
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: testApi.useUtils,
    village: testApi.village,
    travel: testApi.travel,
    mapAsset: testApi.mapAsset,
    mapTerrain: testApi.mapTerrain,
    worldMap: testApi.worldMap,
    bounty: testApi.bounty,
    item: testApi.item,
    clan: testApi.clan,
    combat: testApi.combat,
  });
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((queryClient) => queryClient.clear());
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

const setup = (
  respond?: (path: string, input: unknown) => unknown,
  readWorld?: (path: string, input: unknown) => unknown,
) => {
  const read = vi.fn((path: string, input: unknown) => {
    if (readWorld && path.startsWith("worldMap.")) return readWorld(path, input);
    if (path === "village.getAll")
      return [{ id: "home", name: "Horizon", type: "SAFEZONE", sector: 1 }];
    if (path === "travel.getSectorData") return { sectorData: { village: null } };
    if (path === "worldMap.getSectorWindow") {
      const { sector } = input as { sector: number };
      return {
        center: sector,
        windowLayouts: [{ center: sector, entries: [{ sector, dx: 0, dy: 0 }] }],
        sectors: [
          { sector, dx: 0, dy: 0, map: sectorMap(3, 3, undefined, { sector }) },
        ],
      };
    }
    if (
      [
        "mapAsset.getAll",
        "mapTerrain.getAll",
        "bounty.getTrackedBounties",
        "item.getUserItems",
      ].includes(path)
    )
      return [];
    if (respond) return respond(path, input);
    throw new Error(`Unexpected travel operation: ${path}`);
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
  return {
    ...renderHook((isInteractive: boolean = true) => useTravelSession(isInteractive), {
      wrapper,
    }),
    read,
  };
};

const ready = async (test: ReturnType<typeof setup>) => {
  await waitFor(() =>
    expect(test.result.current.currentSectorMap?.sector).toBe(user?.sector),
  );
};

const admission = (sector = 2) => ({
  success: true,
  message: "Travelling",
  fromSector: 1,
  durationMs: 5000,
  data: {
    sector,
    longitude: 2,
    latitude: 2,
    status: "TRAVEL" as const,
    travelFinishAt: new Date(Date.now() + 5000),
  },
});

describe("travel session ownership", () => {
  it("loads without a view or route, retaining its selection across host renders", async () => {
    const test = setup();
    await ready(test);
    act(() => test.result.current.setFocusSector(2));
    test.rerender();
    expect(test.result.current.focusSector).toBe(2);
    expect(test.result.current.activeTab).toBe("You");
    expect(
      test.read.mock.calls.filter(([path]) => path === "worldMap.getSectorWindow"),
    ).toHaveLength(1);
    expect(navigate).not.toHaveBeenCalled();
    expect(test.read.mock.calls.every(([path]) => !path.endsWith("Move"))).toBe(true);
  });

  it("keeps hook ordering through profile loading and leaves status redirects to its host", async () => {
    const loaded = user as NonNullable<UserWithRelations>;
    user = undefined;
    const test = setup();
    expect(test.result.current.userData).toBeUndefined();
    user = loaded;
    test.rerender();
    await ready(test);
    for (const status of ["ASLEEP", "HOSPITALIZED", "BATTLE"] as const) {
      user = { ...loaded, status };
      test.rerender();
      expect(test.result.current.userData?.status).toBe(status);
    }
    expect(navigate).not.toHaveBeenCalled();
  });

  it("waits for admission before applying destination coordinates and clears local movement", async () => {
    const pending = deferred<ReturnType<typeof admission>>();
    const test = setup((path) => {
      if (path === "travel.startGlobalMove") return pending.promise;
      throw new Error(path);
    });
    await ready(test);
    act(() => {
      test.result.current.setTargetPosition({ x: 1, y: 1 });
      test.result.current.setWorldExpanded(true);
    });
    act(() => test.result.current.handleGlobalMove(2));
    await waitFor(() => expect(test.result.current.isStartingTravel).toBe(true));
    expect(test.result.current.targetPosition).toBeNull();
    expect(test.result.current.isWorldExpanded).toBe(false);
    expect(user).toMatchObject({
      sector: 1,
      longitude: 0,
      latitude: 0,
      status: "TRAVEL",
    });
    expect(updateUser.mock.calls[0]?.[0]).not.toHaveProperty("sector");
    await act(async () => pending.resolve(admission()));
    await waitFor(() => expect(test.result.current.isStartingTravel).toBe(false));
    expect(user).toMatchObject({
      sector: 2,
      longitude: 2,
      latitude: 2,
      status: "TRAVEL",
    });
    expect(test.result.current.isGlobal).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("restores the prior status and deadline after a rejected admission", async () => {
    const test = setup(() => ({ success: false, message: "Not available" }));
    await ready(test);
    act(() => test.result.current.handleGlobalMove(2));
    await waitFor(() => expect(announce).toHaveBeenCalled());
    await waitFor(() => expect(test.result.current.isStartingTravel).toBe(false));
    expect(user).toMatchObject({ status: "AWAKE", travelFinishAt: null, sector: 1 });
    expect(completeTutorialAction).not.toHaveBeenCalled();
  });

  it("keeps confirmed travel recoverable when profile reconciliation fails", async () => {
    const test = setup(() => admission());
    await ready(test);
    updateUser.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    refreshUser.mockResolvedValueOnce(false);
    act(() => test.result.current.handleGlobalMove(2));
    await waitFor(() => expect(test.result.current.admissionRecovery?.sector).toBe(2));
    expect(test.result.current.travelState?.sector).toBe(2);
    expect(test.result.current.canTravelTo(3)).toBe(false);
    refreshUser.mockImplementationOnce(async () => {
      user = { ...user!, ...admission().data };
      return true;
    });
    await act(async () => test.result.current.retryAdmission());
    expect(test.result.current.admissionRecovery).toBeNull();
    expect(test.result.current.travelState).toMatchObject({
      sector: 2,
      status: "TRAVEL",
    });
    expect(refreshUser).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])(
    "reassembles a cached bootstrap after walking beyond its ring, neighbor published: %s",
    async (neighborPublished) => {
      user = { ...user!, sector: 10 };
      const layout = (center: number) => ({
        center,
        entries: [center - 1, center, center + 1].map((sector) => ({
          sector,
          dx: sector - center,
          dy: 0,
        })),
      });
      const entry = (sector: number) => ({
        sector,
        map: sectorMap(3, 3, undefined, { sector }),
      });
      const isPublished = (sector: number) => neighborPublished || sector !== 9;
      const test = setup(undefined, (path, input) => {
        if (path === "worldMap.getSectorWindow") {
          const { sector: center } = input as { sector: number };
          return {
            center,
            windowLayouts: [center - 1, center, center + 1].map(layout),
            sectors: [center - 1, center, center + 1]
              .filter(isPublished)
              .map((sector) => ({ ...entry(sector), dx: sector - center, dy: 0 })),
          };
        }
        const { center, known } = input as { center: number; known: number[] };
        const sectors = Array.from({ length: 5 }, (_, index) => center - 2 + index);
        return {
          windowLayouts: sectors.map(layout),
          entries: sectors
            .filter((s) => !known.includes(s) && isPublished(s))
            .map(entry),
          missingSectors: sectors.filter((s) => !known.includes(s) && !isPublished(s)),
        };
      });
      await ready(test);
      for (const sector of [11, 12]) {
        user = { ...user!, sector };
        test.rerender();
        await ready(test);
        await waitFor(() =>
          expect(test.read).toHaveBeenCalledWith(
            "worldMap.getSectorEntries",
            expect.objectContaining({ center: sector }),
          ),
        );
      }
      user = { ...user!, sector: 10 };
      test.rerender();
      await ready(test);
      expect(
        test.read.mock.calls.filter(([path]) => path === "worldMap.getSectorWindow"),
      ).toHaveLength(1);
      expect(test.result.current.sectorWindow?.sectors.map((s) => s.sector)).toEqual(
        neighborPublished ? [9, 10, 11] : [10, 11],
      );
    },
  );

  it("keeps a revealed-player attack queued until the live position reaches its target", async () => {
    const test = setup(() => ({ success: false, message: "Not close enough" }));
    await ready(test);
    act(() => test.result.current.setQuickTravelOpen(true));
    act(() => test.result.current.setQuickTravelOpen(false));
    user = { ...user!, longitude: 2, latitude: 2 };
    test.rerender();
    await act(async () =>
      test.result.current.setPendingAttackTarget({
        userId: "target",
        username: "Target",
        longitude: 0,
        latitude: 0,
      }),
    );
    expect(
      test.read.mock.calls.filter(([path]) => path === "combat.attackUser"),
    ).toHaveLength(0);
    expect(test.result.current.pendingAttackTarget?.userId).toBe("target");
    user = { ...user!, longitude: 0, latitude: 0 };
    act(() => test.result.current.setScenePosition({ x: 0, y: 0 }));
    await waitFor(() =>
      expect(test.read).toHaveBeenCalledWith(
        "combat.attackUser",
        expect.objectContaining({ userId: "target", longitude: 0, latitude: 0 }),
      ),
    );
    expect(test.result.current.pendingAttackTarget).toBeNull();
  });

  it("retains an attack after a paused arrival and executes it once when interaction resumes", async () => {
    const test = setup(() => ({ success: false, message: "Not close enough" }));
    await ready(test);
    act(() =>
      test.result.current.setPendingAttackTarget({
        userId: "target",
        username: "Target",
        longitude: 2,
        latitude: 2,
      }),
    );
    test.rerender(false);
    user = { ...user!, longitude: 2, latitude: 2 };
    await act(async () => test.result.current.setScenePosition({ x: 2, y: 2 }));
    expect(
      test.read.mock.calls.filter(([path]) => path === "combat.attackUser"),
    ).toHaveLength(0);
    expect(test.result.current.pendingAttackTarget?.userId).toBe("target");

    test.rerender(true);
    await waitFor(() =>
      expect(test.read).toHaveBeenCalledWith(
        "combat.attackUser",
        expect.objectContaining({ userId: "target", longitude: 2, latitude: 2 }),
      ),
    );
    expect(test.result.current.pendingAttackTarget).toBeNull();
    test.rerender(false);
    test.rerender(true);
    expect(
      test.read.mock.calls.filter(([path]) => path === "combat.attackUser"),
    ).toHaveLength(1);
  });

  it("validates a same-sector destination before issuing a walking target", async () => {
    const test = setup();
    await ready(test);
    act(() =>
      test.result.current.setAutoDestination({ sector: 1, longitude: 2, latitude: 1 }),
    );
    await waitFor(() =>
      expect(test.result.current.targetPosition).toEqual({ x: 2, y: 1 }),
    );
    act(() =>
      test.result.current.setAutoDestination({
        sector: 1,
        longitude: 99,
        latitude: 99,
      }),
    );
    await waitFor(() =>
      expect(announce).toHaveBeenCalledWith(
        expect.objectContaining({ id: "auto-travel-unreachable" }),
      ),
    );
    expect(test.result.current.targetPosition).toEqual({ x: 2, y: 1 });
  });

  it("only completes tutorial arrival after a successful settlement at its target", async () => {
    currentStep = { advanceOn: "travelArrive", relatedValue: 2 } as never;
    user = { ...user!, sector: 2, status: "TRAVEL", tutorialOn: true };
    let succeeds = false;
    const test = setup(() => ({
      success: succeeds,
      message: succeeds ? "Arrived" : "Try again",
    }));
    await ready(test);
    act(() => test.result.current.finishGlobalMove());
    await waitFor(() => expect(test.result.current.isArrivalRejected).toBe(true));
    expect(completeTutorialAction).not.toHaveBeenCalled();
    expect(updateSector).not.toHaveBeenCalled();
    succeeds = true;
    act(() => test.result.current.finishGlobalMove());
    await waitFor(() =>
      expect(completeTutorialAction).toHaveBeenCalledWith("travelArrive"),
    );
    expect(updateSector).toHaveBeenCalledWith(true, snapshot);
    expect(test.result.current.isArrivalRejected).toBe(false);
  });

  it("does not attach an optimistic arrival timer to instant Wake Island travel", async () => {
    const pending = deferred<ReturnType<typeof admission>>();
    const test = setup(() => pending.promise);
    await ready(test);
    act(() => test.result.current.handleGlobalMove(MAP_WAKE_ISLAND_SECTOR));
    await waitFor(() => expect(test.result.current.isStartingTravel).toBe(true));
    expect(updateUser.mock.calls[0]?.[0]).toEqual({ status: "TRAVEL" });
    await act(async () => pending.resolve(admission(MAP_WAKE_ISLAND_SECTOR)));
    await waitFor(() => expect(test.result.current.isStartingTravel).toBe(false));
  });
});
