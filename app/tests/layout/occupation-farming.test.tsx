import { ensureDom } from "../setup/dom.mjs";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import OccupationFarming from "@/layout/OccupationFarming";
import type { FarmPlotState, FarmStateResponse } from "@/validators/farming";

const refetch = vi.fn(async () => undefined);
const query = {
  data: undefined as { success: false; message: string } | undefined,
  isLoading: false,
  isFetching: false,
  refetch,
};
const setSelectedSlotIndex = vi.fn();
const controller = {
  farmState: null as FarmStateResponse | null,
  summary: { ready: 0, growing: 0, empty: 0, waterable: 0, fertilizable: 0 },
};

// The controller's transport is isolated so load failures and farm states can be set directly.
vi.mock("@/hooks/farm-controller", () => ({
  useFarmController: () => ({
    farmState: controller.farmState,
    selectedSlotIndex: null,
    selectedPlot: null,
    setSelectedSlotIndex,
    query,
    summary: controller.summary,
    now: new Date(),
    timeDiff: 0,
    pendingBulkAction: null,
    pendingPlotSlots: new Set(),
    pendingInventoryKeys: new Set(),
    announcement: "",
    effectEvent: null,
  }),
}));
// WebGL rendering and the day/night clock are outside this layout's contract.
vi.mock("@/layout/FarmCanvas", () => ({
  FarmCanvas: () => <div data-testid="farm-canvas" />,
}));
vi.mock("@/layout/FarmHUD", () => ({
  FarmHUD: () => <div data-testid="farm-hud" />,
}));

const router = {
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  bfcacheId: "farm-test",
};

const renderFarm = () =>
  render(
    <AppRouterContext.Provider value={router}>
      <OccupationFarming embedded />
    </AppRouterContext.Provider>,
  );

const emptyPlot = (slotIndex: number): FarmPlotState => ({
  id: `plot-${slotIndex}`,
  slotIndex,
  seedItemId: null,
  seedName: null,
  cropName: null,
  cropImage: null,
  plantedAt: null,
  finishAt: null,
  lastWateredAt: null,
  fertilizerApplied: false,
  isReady: false,
  canWater: false,
  nextWateringAt: null,
  growthProgress: 0,
  growthStage: 0,
});

const newFarm = {
  farmingLevel: 1,
  farmingExperience: 0,
  farmCurrency: 50,
  totalPlots: 2,
  farmExtractorsOwned: 0,
  plots: [emptyPlot(0), emptyPlot(1)],
  availableSeeds: [],
  availableFertilizers: [],
  shopEntries: [],
  sellableCrops: [],
  extractableCrops: [],
  activeSeedExtractions: [],
  collectionLog: { collected: 0, total: 3, items: [] },
} as unknown as FarmStateResponse;

beforeEach(() => {
  ensureDom();
  vi.clearAllMocks();
  query.data = undefined;
  query.isFetching = false;
  controller.farmState = null;
  window.matchMedia = ((media: string) => ({
    matches: false,
    media,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollBy = vi.fn() as unknown as typeof window.scrollBy;
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

/** Initial farm failures must leave loading and remain recoverable inside a residence. */
describe("OccupationFarming load recovery", () => {
  it("offers retry when the initial request fails without farm data", () => {
    const view = renderFarm();
    expect(view.getByRole("alert").textContent).toContain("Could not load the farm.");
    expect(view.queryByText("Loading farm...")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("shows prerequisite rejection feedback and blocks duplicate retries", () => {
    query.data = { success: false, message: "You must be awake to use your farm." };
    query.isFetching = true;
    const view = renderFarm();
    expect(view.getByRole("alert").textContent).toContain(query.data.message);
    fireEvent.click(view.getByRole("button", { name: "Retry" }));
    expect(refetch).not.toHaveBeenCalled();
  });
});

describe("OccupationFarming layout", () => {
  it("leaves the residence dialog's title as the only farm heading", () => {
    controller.farmState = newFarm;
    controller.summary = { ready: 0, growing: 0, empty: 2, waterable: 0, fertilizable: 0 };
    const view = renderFarm();
    expect(view.queryByText("Your Farm")).toBeNull();
    expect(view.getByRole("heading", { name: "Your fields" })).toBeTruthy();
    expect(view.getByRole("tab", { name: "Market" }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("guides a new farm to the market from the overview", () => {
    controller.farmState = newFarm;
    controller.summary = { ready: 0, growing: 0, empty: 2, waterable: 0, fertilizable: 0 };
    const view = renderFarm();
    fireEvent.mouseDown(view.getByRole("tab", { name: "Upgrades" }));
    expect(view.getByRole("tab", { name: "Upgrades" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    fireEvent.click(view.getByRole("button", { name: "Buy seeds" }));
    expect(view.getByRole("tab", { name: "Market" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(setSelectedSlotIndex).toHaveBeenCalledWith(null);
    // Only scrolling containers move; scrollIntoView would also shift a clipped dialog frame.
    expect(window.scrollBy).toHaveBeenCalled();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});
