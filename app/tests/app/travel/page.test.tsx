import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import * as dynamic from "next/dynamic";
import * as navigation from "next/navigation";
import * as client from "@/app/_trpc/client";
import type { UserUpdate, UserUpdateOptions } from "@/deltas/profile";
import * as lpc from "@/hooks/lpc";
import * as map from "@/hooks/map";
import * as tutorial from "@/hooks/tutorial";
import { useGameMenu } from "@/hooks/useGameMenu";
import * as itemCache from "@/hooks/useItemConsumptionCacheUpdate";
import * as assetLibrary from "@/hooks/useMapAssetLibrary";
import * as sectorCache from "@/hooks/useSectorCacheUpdate";
import * as sectorVillage from "@/hooks/useSectorVillage";
import * as ContentBox from "@/layout/ContentBox";
import * as TravelPosition from "@/layout/TravelPositionLabel";
import type { UserWithRelations } from "@/server/api/routers/profile";
import * as UserContext from "@/utils/UserContext";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import type { BaseServerResponse } from "@/validators/base";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";

const sensoryCapture = vi.spyOn(client, "api" as never);
const sensoryEndpoint = {
  useMutation: (_options: unknown) => ({ mutate: vi.fn(), isPending: false }),
};
Object.assign(sensoryCapture, {
  stealth: {
    useSensory: sensoryEndpoint,
  },
});
const dynamicSpy = vi.spyOn(dynamic, "default").mockReturnValue((() => null) as never);
const { default: TravelPage } = await import("@/app/[shell]/travel/page");
dynamicSpy.mockRestore();
sensoryCapture.mockRestore();
let actor: NonNullable<UserWithRelations>;
const query = { data: undefined, isLoading: false, isFetching: false };
const mutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const stableUtils = new Proxy(
  {},
  {
    get: () =>
      new Proxy(
        {},
        { get: () => ({ fetch: async () => ({}), invalidate: async () => {} }) },
      ),
  },
);
const villageData = [
  {
    id: "destination",
    name: "Home village",
    mapName: "Home village",
    type: "VILLAGE",
    sector: 1539,
    hexColor: "#00ff00",
  },
];
const userRef = { current: undefined as NonNullable<UserWithRelations> | undefined };
const push = vi.fn();
beforeEach(() => {
  mutation.mutate.mockClear();
  mutation.isPending = false;
  installBrowserGlobals();
  actor = {
    userId: "actor",
    status: "AWAKE",
    autoWakeUp: true,
    sector: 1538,
    longitude: 10,
    latitude: 10,
    rank: "JONIN",
    isOutlaw: false,
    questData: [],
    userQuests: [],
    tutorialOn: false,
    villageId: "village",
    village: {
      id: "village",
      sector: 1538,
      type: "VILLAGE",
      structures: [],
      relationshipA: [],
      relationshipB: [],
    },
  } as never;
  userRef.current = actor;
  vi.spyOn(navigation, "usePathname").mockReturnValue("/travel");
  vi.spyOn(navigation, "useRouter").mockReturnValue({
    push,
    replace: vi.fn(),
  } as never);
  vi.spyOn(navigation, "useSearchParams").mockReturnValue(
    new URLSearchParams() as never,
  );
  vi.spyOn(UserContext, "useRequiredUserDataSelector").mockImplementation(
    () =>
      ({
        data: actor,
        timeDiff: 0,
        prepareUserUpdate: () => 1,
        updateUser: async () => {},
        refreshUser: async () => true,
      }) as never,
  );
  vi.spyOn(UserContext, "useUserDataSelector").mockImplementation(
    (select) => ({ data: select(actor) }) as never,
  );
  vi.spyOn(UserContext, "useUserInfo").mockReturnValue({ notifications: [] } as never);
  vi.spyOn(UserContext, "useUserDataRef").mockReturnValue(userRef as never);
  vi.spyOn(sectorVillage, "useSectorVillage").mockReturnValue({
    sectorVillage: actor.village,
    isLoading: false,
  } as never);
  vi.spyOn(map, "useMap").mockReturnValue({
    globe: { tiles: {} },
    mapError: undefined,
  } as never);
  vi.spyOn(lpc, "useLpcCatalogLoader").mockReturnValue(vi.fn() as never);
  vi.spyOn(assetLibrary, "useMapAssetLibrary").mockReturnValue(query as never);
  vi.spyOn(sectorCache, "useSectorCacheUpdate").mockReturnValue({
    prepareSectorUpdate: () => 1,
    updateSector: async () => {},
  } as never);
  vi.spyOn(itemCache, "useItemConsumptionCacheUpdate").mockReturnValue({
    prepareItemConsume: () => 1,
    updateItemConsume: async () => {},
  } as never);
  vi.spyOn(tutorial, "useTutorialStep").mockReturnValue({
    currentStep: undefined,
    completeTutorialAction: vi.fn(),
  } as never);
  vi.spyOn(ContentBox, "default").mockImplementation(
    ({ children, topRightContent }) => (
      <div>
        {topRightContent}
        {children}
      </div>
    ),
  );
  vi.spyOn(TravelPosition, "TravelPositionLabel").mockReturnValue(
    <span>Position</span>,
  );
  const endpoint = { useQuery: () => query, useMutation: () => mutation };
  const router = new Proxy({}, { get: () => endpoint });
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => stableUtils,
    village: new Proxy(
      {},
      {
        get: (_target, key) =>
          key === "getAll"
            ? { useQuery: () => ({ ...query, data: villageData }) }
            : endpoint,
      },
    ),
    travel: router,
    mapTerrain: router,
    worldMap: router,
    bounty: router,
    item: router,
    combat: router,
    clan: router,
    stealth: router,
    hunting: router,
    war: router,
  });
});
afterEach(async () => {
  cleanup();
  await flushRadixFocus();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});
for (const [status, autoWakeUp, expected] of [
  ["AWAKE", true, true],
  ["ASLEEP", true, true],
  ["HOSPITALIZED", true, true],
  ["ASLEEP", false, false],
  ["BATTLE", true, false],
] as const) {
  it(`normal travel menu ${status} enabled=${autoWakeUp} has recoverable destination`, () => {
    Object.assign(actor, { status, autoWakeUp });
    const { result } = renderHook(useGameMenu);
    const travel = result.current.systems.find(
      (entry) => entry.id === "tutorial-travel",
    )!;
    expect(travel.href).toBe(
      expected ? "/travel" : status === "ASLEEP" ? "/home" : "/combat",
    );
  });
  it(`Quick Travel ${status} enabled=${autoWakeUp} admits explicit destination`, async () => {
    Object.assign(actor, { status, autoWakeUp });
    const view = render(<TravelPage />);
    await act(async () =>
      fireEvent.click(view.getByRole("button", { name: "Quick Travel" })),
    );
    const button = view.getByRole("button", {
      name: /Home village/,
    }) as HTMLButtonElement;
    await act(async () =>
      fireEvent.input(view.getByPlaceholderText(/Sector ID/), {
        target: { value: "1539" },
      }),
    );
    const numericButton = view.getByRole("button", {
      name: "Travel to Sector 1539",
    }) as HTMLButtonElement;
    expect({
      villageDisabled: button.disabled,
      numericDisabled: numericButton.disabled,
    }).toEqual({ villageDisabled: !expected, numericDisabled: !expected });
  });
}

it("updates the Travel destination when the saved automatic-wake preference changes", () => {
  actor.status = "ASLEEP";
  actor.autoWakeUp = true;
  const { result, rerender } = renderHook(useGameMenu);
  expect(
    result.current.systems.find((entry) => entry.id === "tutorial-travel")?.href,
  ).toBe("/travel");
  actor.autoWakeUp = false;
  rerender();
  expect(
    result.current.systems.find((entry) => entry.id === "tutorial-travel")?.href,
  ).toBe("/home");
});
it("keeps Quick Travel disabled for the current sector", async () => {
  actor.status = "ASLEEP";
  actor.sector = 1539;
  const view = render(<TravelPage />);
  await act(async () =>
    fireEvent.click(view.getByRole("button", { name: "Quick Travel" })),
  );
  expect(
    (view.getByRole("button", { name: /Home village/ }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(mutation.mutate).not.toHaveBeenCalled();
});

for (const procedure of ["activateStealth", "useSensory"] as const)
  it.each([true, false])(
    `projects confirmed recovery for ${procedure} without action data (success=%p)`,
    async (success) => {
      const cache = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: Infinity } },
      });
      const key = ["profile", "actor"];
      actor.status = "ASLEEP";
      const initial = {
        userData: { ...actor, curHealth: 5, curChakra: 6, curStamina: 7 },
      };
      cache.setQueryData(key, initial);
      const read = vi.fn(async () => initial);
      const observer = new QueryObserver(cache, {
        queryKey: key,
        queryFn: read,
        staleTime: Infinity,
      });
      const unsubscribe = observer.subscribe(() => {});
      vi.spyOn(UserContext, "useRequiredUserDataSelector").mockReturnValue({
        data: actor,
        timeDiff: 0,
        prepareUserUpdate: () => prepareUserUpdate(cache, key),
        updateUser: (patch: UserUpdate | undefined, options?: UserUpdateOptions) =>
          updateUserCache(cache, key, patch, options),
      } as never);
      let callbacks: {
        onMutate: () => number | undefined;
        onSuccess: (
          result: BaseServerResponse,
          input: undefined,
          revision: number | undefined,
        ) => void | Promise<void>;
      };
      Object.assign(client.api, {
        stealth: new Proxy(
          {},
          {
            get: (_target, name) => ({
              useMutation: (options: typeof callbacks) => {
                if (name === procedure) callbacks = options;
                return mutation;
              },
            }),
          },
        ),
      });
      if (procedure === "useSensory")
        vi.spyOn(sensoryEndpoint, "useMutation").mockImplementation((options) => {
          callbacks = options as typeof callbacks;
          return mutation;
        });
      try {
        render(<TravelPage />);
        await act(async () => {
          await callbacks.onSuccess(
            {
              success,
              message: "Recovery confirmed",
              userRecovery: {
                userId: String(actor.userId),
                activity: { status: "AWAKE" },
                userPatch: {
                  status: "AWAKE",
                  curHealth: 100,
                  curChakra: 100,
                  curStamina: 100,
                },
              },
            },
            undefined,
            callbacks.onMutate(),
          );
        });
        expect(cache.getQueryData(key)).toMatchObject({
          userData: {
            status: "AWAKE",
            curHealth: 5,
            curChakra: 6,
            curStamina: 7,
          },
        });
        expect(read).not.toHaveBeenCalled();
        expect(cache.getQueryState(key)?.isInvalidated).toBe(false);
      } finally {
        unsubscribe();
        cache.clear();
      }
    },
  );

for (const outcome of ["transport error", "success", "rejected"] as const)
  it.each([
    "ASLEEP",
    "HOSPITALIZED",
    "missing snapshot",
    "pre-travel refresh",
    "failed recovery read",
    "missing revision",
    "superseded snapshot",
  ] as const)(
    `reconciles global journey ${outcome} from %s without leaving successful admission on a stale profile`,
    async (initialStatus) => {
      const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const key = ["profile", "actor"];
      actor.status = initialStatus === "HOSPITALIZED" ? "HOSPITALIZED" : "ASLEEP";
      actor.travelFinishAt = null;
      const initial = {
        userData: { ...actor, curHealth: 5, curChakra: 6, curStamina: 7 },
        notifications:
          initialStatus === "HOSPITALIZED"
            ? [{ color: "red", href: "/hospital", name: "In hospital" }]
            : [],
      };
      const canonical = {
        ...initial,
        notifications: [],
        userData: {
          ...initial.userData,
          status: "TRAVEL" as const,
          sector: 1539,
          travelFinishAt: new Date(Date.now() + 10000),
          curHealth: 100,
          curChakra: 100,
          curStamina: 100,
        },
      };
      cache.setQueryData(key, initial);
      let failRead = initialStatus === "failed recovery read";
      const read = vi.fn(async () => {
        if (failRead) throw new Error("Profile unavailable");
        return canonical;
      });
      const observer = new QueryObserver(cache, {
        queryKey: key,
        staleTime: Infinity,
        queryFn: read,
      });
      const unsubscribe = observer.subscribe(() => {});
      const updateUser = (patch: UserUpdate | undefined, options?: UserUpdateOptions) =>
        updateUserCache(cache, key, patch, options);
      vi.spyOn(UserContext, "useRequiredUserDataSelector").mockReturnValue({
        data: actor,
        timeDiff: 0,
        prepareUserUpdate: () => prepareUserUpdate(cache, key),
        updateUser,
        refreshUser: async () => {
          await cache.cancelQueries({ queryKey: key, exact: true });
          const refreshed = await observer.refetch();
          return refreshed.isSuccess;
        },
      } as never);
      type Previous =
        | {
            status: typeof actor.status;
            travelFinishAt: Date | null;
            revision: number | undefined;
          }
        | undefined;
      const recovery = {
        userId: String(actor.userId),
        userPatch: {
          status: "AWAKE" as const,
          curHealth: 100,
          curChakra: 100,
          curStamina: 100,
        },
      };
      let callbacks: {
        onMutate: (input: { sector: number }) => Promise<Previous>;
        onError: (
          error: Error,
          input: { sector: number },
          previous: Previous,
        ) => Promise<void>;
        onSuccess: (
          result: {
            success: boolean;
            message: string;
            actionNotice?: string;
            userRecovery?: typeof recovery;
            data?: typeof canonical.userData;
          },
          input: { sector: number },
          previous: Previous,
        ) => Promise<void>;
      };
      const endpoint = { useQuery: () => query, useMutation: () => mutation };
      Object.assign(client.api, {
        useUtils: () => stableUtils,
        travel: new Proxy(
          {},
          {
            get: (_target, name) =>
              name === "startGlobalMove"
                ? {
                    useMutation: (options: typeof callbacks) => {
                      callbacks = options;
                      return mutation;
                    },
                  }
                : endpoint,
          },
        ),
      });
      try {
        const view = render(<TravelPage />);
        let preserved: unknown;
        await act(async () => {
          const previous = await callbacks.onMutate({ sector: 1539 });
          expect(cache.getQueryData<typeof initial>(key)?.userData.status).toBe(
            "TRAVEL",
          );
          const context = initialStatus === "missing snapshot" ? undefined : previous;
          if (context && initialStatus === "missing revision")
            context.revision = undefined;
          if (initialStatus === "superseded snapshot") {
            cache.setQueryData<typeof initial>(
              key,
              (current) =>
                current && {
                  ...current,
                  userData: { ...current.userData, money: 73 },
                },
            );
          }
          if (
            initialStatus === "pre-travel refresh" ||
            initialStatus === "failed recovery read"
          )
            cache.setQueryData(key, initial);
          preserved = cache.getQueryData(key);
          if (outcome === "transport error") {
            await callbacks.onError(
              new Error("Response lost after commit"),
              { sector: 1539 },
              context,
            );
          } else {
            await callbacks.onSuccess(
              outcome === "success"
                ? {
                    success: true,
                    message: "Journey started",
                    actionNotice: "Recovered",
                    userRecovery: recovery,
                    data: canonical.userData,
                  }
                : { success: false, message: "Your status changed. Please try again." },
              { sector: 1539 },
              context,
            );
          }
        });
        const failedRecovery =
          outcome === "success" && initialStatus === "failed recovery read";
        if (failedRecovery) {
          expect(cache.getQueryState(key)?.status).toBe("error");
          expect(view.getByText("Home village")).toBeTruthy();
          expect(view.getByText(/s remaining/)).toBeTruthy();
          expect(
            view.getByText(
              "Your trip has started. Reconnect to confirm your location.",
            ),
          ).toBeTruthy();
          failRead = false;
          await act(async () =>
            fireEvent.click(view.getByRole("button", { name: "Retry connection" })),
          );
          expect(view.queryByRole("button", { name: "Retry connection" })).toBeNull();
        }
        const needsReconciliation =
          outcome === "success" &&
          initialStatus !== "ASLEEP" &&
          initialStatus !== "HOSPITALIZED";
        expect(read).toHaveBeenCalledTimes(
          failedRecovery ? 2 : needsReconciliation ? 1 : 0,
        );
        if (
          needsReconciliation ||
          initialStatus === "ASLEEP" ||
          initialStatus === "HOSPITALIZED"
        ) {
          expect(cache.getQueryData(key)).toMatchObject(
            outcome === "success" ? canonical : initial,
          );
        } else {
          expect(cache.getQueryData(key)).toEqual(preserved);
        }
        expect(cache.getQueryState(key)?.isInvalidated).toBe(false);
      } finally {
        unsubscribe();
        cache.clear();
      }
    },
  );
