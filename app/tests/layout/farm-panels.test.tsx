import { ensureDom } from "../setup/dom.mjs";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { FarmInventory } from "@/layout/FarmInventory";
import { FarmMarket } from "@/layout/FarmMarket";
import { FarmOverview } from "@/layout/FarmOverview";
import type { FarmPlotState, FarmStateResponse } from "@/validators/farming";

vi.mock("@/layout/Image", () => ({
  default: (props: { src: string; alt: string }) => (
    // biome-ignore lint/performance/noImgElement: isolated component test stub
    <img src={props.src} alt={props.alt} />
  ),
}));

const now = new Date("2026-10-29T12:00:00Z");
const minutesFromNow = (minutes: number) => new Date(now.getTime() + minutes * 60_000);

const plot = (patch: Partial<FarmPlotState>): FarmPlotState => ({
  id: `plot-${patch.slotIndex ?? 0}`,
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

const seed = {
  itemId: "seed-1",
  name: "Tomato Seed",
  image: "seed.webp",
  quantity: 3,
  minLevel: 1,
  growTimeSeconds: 3600,
  yieldItemId: "crop-1",
  yieldName: "Tomato",
  yieldImage: "crop.webp",
  yieldQuantity: 1,
  plantExperience: 2,
  harvestExperience: 4,
};

const baseState = {
  farmingLevel: 5,
  farmCurrency: 100,
  totalPlots: 5,
  farmExtractorsOwned: 0,
  plots: [],
  availableSeeds: [seed],
  availableFertilizers: [],
  shopEntries: [],
  sellableCrops: [],
  extractableCrops: [],
  activeSeedExtractions: [],
  collectionLog: { collected: 0, total: 3, items: [] },
} as unknown as FarmStateResponse;

const handlers = {
  onPlantAll: vi.fn(),
  onWaterAll: vi.fn(),
  onFertilizeAll: vi.fn(),
  onHarvestAll: vi.fn(),
  onOpenMarket: vi.fn(),
};

const summary = (patch: Partial<Record<string, number>> = {}) => ({
  ready: 0,
  growing: 0,
  empty: 0,
  waterable: 0,
  fertilizable: 0,
  ...patch,
});

beforeEach(() => {
  ensureDom();
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("FarmOverview", () => {
  it("offers only the bulk actions that can run now", () => {
    const view = render(
      <FarmOverview
        state={baseState}
        summary={summary({ ready: 2, empty: 1 })}
        now={now}
        timeDiff={0}
        pendingAction={null}
        {...handlers}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Harvest all (2)" }));
    expect(handlers.onHarvestAll).toHaveBeenCalledTimes(1);
    fireEvent.click(view.getByRole("button", { name: "Plant 1 plot" }));
    expect(handlers.onPlantAll).toHaveBeenCalledWith("seed-1");
    expect(view.queryByRole("button", { name: /Water all/ })).toBeNull();
    expect(view.queryByRole("button", { name: /Fertilize all/ })).toBeNull();
  });

  it("counts bulk planting and fertilizing from the selected stack", () => {
    const view = render(
      <FarmOverview
        state={{
          ...baseState,
          availableSeeds: [seed, { ...seed, itemId: "seed-2", name: "Onion Seed", quantity: 1 }],
          availableFertilizers: [
            { userItemId: "fert-big", itemId: "f1", name: "Compost", image: "f.webp", quantity: 9, timeReductionSeconds: 60 },
            { userItemId: "fert-small", itemId: "f2", name: "Ash", image: "f.webp", quantity: 1, timeReductionSeconds: 60 },
          ],
        } as unknown as FarmStateResponse}
        summary={summary({ empty: 5, growing: 4, fertilizable: 4 })}
        now={now}
        timeDiff={0}
        pendingAction={null}
        {...handlers}
      />,
    );
    expect(view.getByRole("button", { name: "Plant 3 plots" })).toBeTruthy();
    fireEvent.change(view.getByLabelText("Seed to plant in empty plots"), {
      target: { value: "seed-2" },
    });
    fireEvent.click(view.getByRole("button", { name: "Plant 1 plot" }));
    expect(handlers.onPlantAll).toHaveBeenCalledWith("seed-2");
    expect(view.getByRole("button", { name: "Fertilize 4 crops" })).toBeTruthy();
    fireEvent.change(view.getByLabelText("Fertilizer for growing crops"), {
      target: { value: "fert-small" },
    });
    fireEvent.click(view.getByRole("button", { name: "Fertilize 1 crop" }));
    expect(handlers.onFertilizeAll).toHaveBeenCalledWith("fert-small");
  });

  it("shows the next harvest and says when nothing can be done", () => {
    const growing = plot({
      seedItemId: "seed-1",
      plantedAt: minutesFromNow(-10),
      finishAt: minutesFromNow(50),
      lastWateredAt: now,
    });
    const view = render(
      <FarmOverview
        state={{ ...baseState, plots: [growing] }}
        summary={summary({ growing: 1 })}
        now={now}
        timeDiff={0}
        pendingAction={null}
        {...handlers}
      />,
    );
    expect(view.getByText(/Next harvest in/)).toBeTruthy();
    expect(view.getByText(/Nothing to do right now/)).toBeTruthy();
    expect(view.queryAllByRole("button")).toHaveLength(0);
  });

  it("walks a new farm through its first crop", () => {
    const view = render(
      <FarmOverview
        state={{ ...baseState, availableSeeds: [] }}
        summary={summary({ empty: 5 })}
        now={now}
        timeDiff={0}
        pendingAction={null}
        {...handlers}
      />,
    );
    expect(view.getAllByRole("listitem").map((item) => item.textContent)).toContain(
      "Buy seeds in the market.",
    );
    fireEvent.click(view.getByRole("button", { name: "Buy seeds" }));
    expect(handlers.onOpenMarket).toHaveBeenCalledTimes(1);
  });

  it("points a returning farmer without seeds to the market instead of the first steps", () => {
    const view = render(
      <FarmOverview
        state={{
          ...baseState,
          availableSeeds: [],
          collectionLog: { collected: 2, total: 3, items: [] },
        } as unknown as FarmStateResponse}
        summary={summary({ empty: 5 })}
        now={now}
        timeDiff={0}
        pendingAction={null}
        {...handlers}
      />,
    );
    expect(view.queryByText("Start your first crop")).toBeNull();
    expect(view.getByText(/5 empty plots, no\s+seeds to plant/)).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Buy seeds" }));
    expect(handlers.onOpenMarket).toHaveBeenCalledTimes(1);
  });

  it("marks the running bulk action and blocks the others", () => {
    const view = render(
      <FarmOverview
        state={baseState}
        summary={summary({ ready: 1, waterable: 1, growing: 1 })}
        now={now}
        timeDiff={0}
        pendingAction="harvest"
        {...handlers}
      />,
    );
    expect(view.getByRole("button", { name: "Working…" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(
      view.getByRole("button", { name: "Water all (1)" }).hasAttribute("disabled"),
    ).toBe(true);
  });
});

describe("FarmMarket", () => {
  const entry = {
    type: "SEED" as const,
    label: "Tomato Seed",
    cost: 10,
    minLevel: 1,
    itemId: "seed-1",
    canAfford: true,
    canPurchase: true,
    growTimeSeconds: 3600,
    yieldQuantity: 1,
    yieldName: "Tomato",
    experience: 4,
  };

  it("puts the total price on the purchase button", () => {
    const onBuy = vi.fn(async () => true);
    const view = render(
      <FarmMarket
        farmState={{ ...baseState, shopEntries: [entry] }}
        pendingKeys={new Set()}
        onBuy={onBuy}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Increase tomato seed quantity" }));
    fireEvent.click(view.getByRole("button", { name: "Buy 2 for 20" }));
    expect(onBuy).toHaveBeenCalledWith(entry, 2);
  });

  it("explains empty filter results and clears the filters", () => {
    const view = render(
      <FarmMarket
        farmState={{ ...baseState, shopEntries: [{ ...entry, canAfford: false }] }}
        pendingKeys={new Set()}
        onBuy={async () => true}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Affordable" }));
    expect(view.getAllByText("Nothing matches these filters.")).toHaveLength(2);
    fireEvent.click(view.getAllByRole("button", { name: "Clear filters" })[0]!);
    expect(view.getByText("Tomato Seed")).toBeTruthy();
  });
});

describe("FarmInventory", () => {
  it("sells crops from the crop list", () => {
    const onSell = vi.fn(async () => true);
    const view = render(
      <FarmInventory
        view="crops"
        farmState={{
          ...baseState,
          sellableCrops: [
            { userItemId: "crop-stack", name: "Tomato", image: "crop.webp", quantity: 4, sellValue: 6 },
          ],
        } as unknown as FarmStateResponse}
        pendingKeys={new Set()}
        onSell={onSell}
        onSellAll={async () => true}
        onExtract={async () => true}
        onOpenMarket={vi.fn()}
        onOpenUpgrades={vi.fn()}
        onExtractionFinished={vi.fn()}
        timeDiff={0}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Sell for 6" }));
    expect(onSell).toHaveBeenCalledWith("crop-stack", 1);
  });

  it("sells every crop after confirming", () => {
    const onSellAll = vi.fn(async () => true);
    const crops = [
      { userItemId: "a", name: "Tomato", image: "a.webp", quantity: 4, sellValue: 6 },
      { userItemId: "b", name: "Onion", image: "b.webp", quantity: 2, sellValue: 5 },
    ];
    const view = render(
      <FarmInventory
        view="crops"
        farmState={{ ...baseState, sellableCrops: crops } as unknown as FarmStateResponse}
        pendingKeys={new Set()}
        onSell={async () => true}
        onSellAll={onSellAll}
        onExtract={async () => true}
        onOpenMarket={vi.fn()}
        onOpenUpgrades={vi.fn()}
        onExtractionFinished={vi.fn()}
        timeDiff={0}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: /Sell all/ }));
    expect(onSellAll).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "Sell 6 for 34" }));
    expect(onSellAll).toHaveBeenCalledWith(crops);
  });

  it("extracts with the first idle extractor and waits when all are busy", () => {
    const onExtract = vi.fn(async () => true);
    const crop = { userItemId: "c", name: "Tomato", image: "c.webp", quantity: 3, seedCount: 2 };
    const busy = (extractorSlot: number) => ({
      extractorSlot, cropName: "Onion", cropQuantity: 1, seedName: "Onion Seed",
      seedQuantity: 2, seedImage: "s.webp", finishAt: new Date(Date.now() + 60_000),
    });
    const props = {
      view: "extraction" as const,
      pendingKeys: new Set<string>(),
      onSell: async () => true,
      onSellAll: async () => true,
      onExtract,
      onOpenMarket: vi.fn(),
      onOpenUpgrades: vi.fn(),
      onExtractionFinished: vi.fn(),
      timeDiff: 0,
    };
    const state = (active: ReturnType<typeof busy>[]) =>
      ({ ...baseState, farmExtractorsOwned: 2, extractableCrops: [crop], activeSeedExtractions: active }) as unknown as FarmStateResponse;
    const view = render(<FarmInventory {...props} farmState={state([busy(0)])} />);
    fireEvent.click(view.getByRole("button", { name: "Extract" }));
    expect(onExtract).toHaveBeenCalledWith(1, "c", 1);
    view.rerender(<FarmInventory {...props} farmState={state([busy(0), busy(1)])} />);
    expect(view.getByText(/All extractors are busy/)).toBeTruthy();
    expect(view.getByRole("button", { name: "Extract" }).hasAttribute("disabled")).toBe(true);
  });

  it("points to upgrades when no seed extractor is owned", () => {
    const onOpenUpgrades = vi.fn();
    const view = render(
      <FarmInventory
        view="extraction"
        farmState={baseState}
        pendingKeys={new Set()}
        onSell={async () => true}
        onSellAll={async () => true}
        onExtract={async () => true}
        onOpenMarket={vi.fn()}
        onOpenUpgrades={onOpenUpgrades}
        onExtractionFinished={vi.fn()}
        timeDiff={0}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "See upgrades" }));
    expect(onOpenUpgrades).toHaveBeenCalledTimes(1);
  });
});
