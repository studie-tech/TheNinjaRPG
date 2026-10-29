import { ensureDom } from "../setup/dom.mjs";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { FarmMarket } from "@/layout/FarmMarket";
import { FarmPlotInspector } from "@/layout/FarmPlotInspector";
import { getActivityBonuses } from "@/libs/activityBonuses";
import { getFarmGrowTimeSeconds } from "@/libs/farming";
import { DecreaseFarmingTime } from "@/validators/combat";
import type { FarmPlotState, FarmStateResponse } from "@/validators/farming";

vi.mock("@/utils/UserContext", () => ({
  useRequiredUserData: () => ({ timeDiff: 0 }),
}));
vi.mock("@/layout/Image", () => ({
  default: (props: { src: string; alt: string }) => (
    // biome-ignore lint/performance/noImgElement: isolated component test stub
    <img src={props.src} alt={props.alt} />
  ),
}));

const plot = (patch: Partial<FarmPlotState> = {}): FarmPlotState => ({
  id: "plot-1",
  slotIndex: 0,
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
  ...patch,
});

const farmState = {
  farmingLevel: 5,
  availableSeeds: [
    {
      itemId: "seed-1",
      name: "Tomato Seed",
      image: "seed.webp",
      quantity: 2,
      minLevel: 1,
      growTimeSeconds: 3600,
      yieldItemId: "crop-1",
      yieldName: "Tomato",
      yieldImage: "crop.webp",
      yieldQuantity: 1,
      plantExperience: 2,
      harvestExperience: 4,
    },
  ],
  availableFertilizers: [
    {
      userItemId: "user-fertilizer-1",
      itemId: "fertilizer-1",
      name: "Compost",
      image: "fertilizer.webp",
      quantity: 1,
      timeReductionSeconds: 600,
    },
  ],
} as unknown as FarmStateResponse;

const handlers = {
  onClose: vi.fn(),
  onPlant: vi.fn(),
  onWater: vi.fn(),
  onFertilize: vi.fn(),
  onHarvest: vi.fn(),
  onBrowseSeeds: vi.fn(),
};

describe("FarmPlotInspector", () => {
  afterEach(cleanup);
  beforeEach(() => {
    ensureDom();
    vi.clearAllMocks();
  });

  it.each([
    { base: 2, power: 60, seconds: 1, display: "1s" },
    { base: 59, power: 0, seconds: 59, display: "59s" },
    { base: 60, power: 0, seconds: 60, display: "1m" },
    { base: 61, power: 0, seconds: 61, display: "2m" },
    { base: 3660, power: 0, seconds: 3660, display: "1h 1m" },
  ])("shows $seconds seconds accurately in both seed estimates", (fixture) => {
    const { farmingReductionPercent } = getActivityBonuses({
      level: 1,
      bloodlineId: "farming-bloodline",
      ninjutsuMastery: 0,
      genjutsuMastery: 0,
      taijutsuMastery: 0,
      bukijutsuMastery: 0,
      bloodlineMastery: 0,
      sageMastery: 0,
      bloodline: { effects: [DecreaseFarmingTime.parse({ power: fixture.power })] },
    });
    const growTimeSeconds = getFarmGrowTimeSeconds(
      fixture.base,
      { staffAccount: false, federalStatus: "NONE" },
      farmingReductionPercent,
    );
    expect(growTimeSeconds).toBe(fixture.seconds);
    const seed = { ...farmState.availableSeeds[0]!, growTimeSeconds };
    const state = {
      ...farmState,
      farmCurrency: 100,
      availableSeeds: [seed],
      shopEntries: [{
        type: "SEED" as const,
        label: seed.name,
        cost: 10,
        minLevel: seed.minLevel,
        itemId: seed.itemId,
        canAfford: true,
        canPurchase: true,
        growTimeSeconds,
        yieldQuantity: seed.yieldQuantity,
        yieldName: seed.yieldName,
      }],
    };
    const inspector = render(
      <FarmPlotInspector
        plot={plot()}
        farmState={state}
        now={new Date()}
        pending={false}
        {...handlers}
      />,
    );
    const inspectorEstimate = inspector.getByText(/→ 1 Tomato/).textContent;
    inspector.unmount();
    const market = render(
      <FarmMarket farmState={state} pendingKeys={new Set()} onBuy={async () => true} />,
    );
    expect({
      inspector: inspectorEstimate,
      market: market.getByText(/→ 1 Tomato/).textContent,
    }).toEqual({
      inspector: `${fixture.display} → 1 Tomato`,
      market: `${fixture.display} → 1 Tomato · +0 XP`,
    });
  });

  it("stays in the layout unless docked", () => {
    const { container } = render(
      <FarmPlotInspector
        plot={plot()}
        farmState={farmState}
        now={new Date()}
        pending={false}
        {...handlers}
      />,
    );
    expect(container.querySelector("[data-mobile-dock]")).toBeNull();
    expect(container.firstElementChild?.className).not.toContain("fixed");
  });

  it("renders the mobile dock and plants only from the explicit primary action", () => {
    const { container, getByRole } = render(
      <FarmPlotInspector
        plot={plot()}
        docked
        farmState={farmState}
        now={new Date()}
        pending={false}
        {...handlers}
      />,
    );

    const mobileDock = container.querySelector(
      '[data-mobile-dock="farm-plot-inspector"]',
    );
    expect(mobileDock).not.toBeNull();
    expect(mobileDock?.className).toContain(
      "bottom-[calc(5rem+env(safe-area-inset-bottom)+0.5rem)]",
    );
    expect(mobileDock?.className).toContain("md:bottom-4");
    const seed = getByRole("radio", { name: /Tomato Seed/i });
    seed.focus();
    expect(document.activeElement).toBe(seed);
    expect(handlers.onPlant).not.toHaveBeenCalled();
    fireEvent.click(getByRole("button", { name: "Plant" }));
    expect(handlers.onPlant).toHaveBeenCalledWith(expect.objectContaining({ id: "plot-1" }), "seed-1");
  });

  it("closes with the Escape key", () => {
    const { getByLabelText } = render(
      <FarmPlotInspector
        plot={plot()}
        farmState={farmState}
        now={new Date()}
        pending={false}
        {...handlers}
      />,
    );
    fireEvent.keyDown(getByLabelText("Farm plot 1 inspector"), { key: "Escape" });
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it("shows growing and pending action states", () => {
    const { getByRole, getByText } = render(
      <FarmPlotInspector
        plot={plot({
          seedItemId: "seed-1",
          seedName: "Tomato Seed",
          cropName: "Tomato",
          cropImage: "crop.webp",
          plantedAt: new Date(Date.now() - 30_000),
          finishAt: new Date(Date.now() + 30_000),
          canWater: true,
          growthProgress: 50,
          growthStage: 2,
        })}
        farmState={farmState}
        now={new Date()}
        pending
        {...handlers}
      />,
    );
    expect(getByText("50% grown")).toBeTruthy();
    expect(
      getByRole("button", { name: "Working…" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("requires an explicit harvest action for ready plots", () => {
    const { getByRole } = render(
      <FarmPlotInspector
        plot={plot({
          seedItemId: "seed-1",
          cropName: "Tomato",
          cropImage: "crop.webp",
          plantedAt: new Date(Date.now() - 60_000),
          finishAt: new Date(Date.now() - 1_000),
          isReady: true,
          growthProgress: 100,
          growthStage: 4,
          harvestExperience: 4,
        })}
        farmState={farmState}
        now={new Date()}
        pending={false}
        {...handlers}
      />,
    );
    expect(handlers.onHarvest).not.toHaveBeenCalled();
    fireEvent.click(getByRole("button", { name: "Harvest" }));
    expect(handlers.onHarvest).toHaveBeenCalledTimes(1);
  });
});
