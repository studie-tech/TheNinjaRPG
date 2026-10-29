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
    fireEvent.click(view.getByRole("button", { name: "Plant all (1)" }));
    expect(handlers.onPlantAll).toHaveBeenCalledWith("seed-1");
    expect(view.queryByRole("button", { name: /Water all/ })).toBeNull();
    expect(view.queryByRole("button", { name: /Fertilize all/ })).toBeNull();
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
    fireEvent.click(view.getByRole("button", { name: /Buy for 20/ }));
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

  it("points to upgrades when no seed extractor is owned", () => {
    const onOpenUpgrades = vi.fn();
    const view = render(
      <FarmInventory
        view="extraction"
        farmState={baseState}
        pendingKeys={new Set()}
        onSell={async () => true}
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
