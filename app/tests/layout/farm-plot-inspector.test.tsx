import { cleanupDom } from "../setup-dom.mjs";
import { fireEvent, render } from "@testing-library/react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FarmPlotInspector } from "@/layout/FarmPlotInspector";
import type { FarmPlotState, FarmStateResponse } from "@/validators/farming";

vi.mock("@/utils/UserContext", () => ({
  useRequiredUserData: () => ({ timeDiff: 0 }),
}));
vi.mock("@/layout/Countdown", () => ({
  default: () => <span>10 minutes</span>,
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
  beforeEach(() => vi.clearAllMocks());
  afterAll(cleanupDom);

  it("renders the mobile dock and plants only from the explicit primary action", () => {
    const { container, getByRole } = render(
      <FarmPlotInspector
        plot={plot()}
        farmState={farmState}
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
    expect(mobileDock?.className).toContain("md:bottom-2");
    const seed = getByRole("radio", { name: /Tomato Seed/i });
    seed.focus();
    expect(document.activeElement).toBe(seed);
    expect(handlers.onPlant).not.toHaveBeenCalled();
    fireEvent.click(getByRole("button", { name: "Plant" }));
    expect(handlers.onPlant).toHaveBeenCalledWith(expect.objectContaining({ id: "plot-1" }), "seed-1");
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
        pending={false}
        {...handlers}
      />,
    );
    expect(handlers.onHarvest).not.toHaveBeenCalled();
    fireEvent.click(getByRole("button", { name: "Harvest" }));
    expect(handlers.onHarvest).toHaveBeenCalledTimes(1);
  });
});
