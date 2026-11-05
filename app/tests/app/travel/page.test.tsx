import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as dynamic from "next/dynamic";
import * as navigation from "next/navigation";
import * as client from "@/app/_trpc/client";
import * as UserContext from "@/utils/UserContext";
import * as sectorVillage from "@/hooks/useSectorVillage";
import * as map from "@/hooks/map";
import * as lpc from "@/hooks/lpc";
import * as assetLibrary from "@/hooks/useMapAssetLibrary";
import * as sectorCache from "@/hooks/useSectorCacheUpdate";
import * as itemCache from "@/hooks/useItemConsumptionCacheUpdate";
import * as tutorial from "@/hooks/tutorial";
import * as ContentBox from "@/layout/ContentBox";
import * as TravelPosition from "@/layout/TravelPositionLabel";
import type { UserWithRelations } from "@/server/api/routers/profile";
import { useGameMenu } from "@/libs/menus";

const sensoryCapture = vi.spyOn(client, "api" as never);
Object.assign(sensoryCapture, {
  stealth: {
    useSensory: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
  },
});
const dynamicSpy = vi.spyOn(dynamic, "default").mockReturnValue((() => null) as never);
const { default: TravelPage } = await import("@/app/[shell]/travel/page");
dynamicSpy.mockRestore();
sensoryCapture.mockRestore();
let actor: NonNullable<UserWithRelations>;
const oldEvent = globalThis.Event;
const oldCustomEvent = globalThis.CustomEvent;
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
  globalThis.Event = window.Event;
  globalThis.CustomEvent = window.CustomEvent;
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
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.restoreAllMocks();
  globalThis.Event = oldEvent;
  globalThis.CustomEvent = oldCustomEvent;
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
