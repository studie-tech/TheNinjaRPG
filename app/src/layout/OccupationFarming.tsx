"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFarmController } from "@/hooks/farm-controller";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import ContentBox from "@/layout/ContentBox";
import { FarmCanvas, type FarmCanvasHandle } from "@/layout/FarmCanvas";
import { FarmCollectionLog } from "@/layout/FarmCollectionLog";
import { FarmHUD } from "@/layout/FarmHUD";
import { FarmInventory } from "@/layout/FarmInventory";
import { FarmMarket } from "@/layout/FarmMarket";
import { FarmOverview } from "@/layout/FarmOverview";
import { FarmPlotInspector } from "@/layout/FarmPlotInspector";
import Loader from "@/layout/Loader";
import type { FarmVisualState } from "@/validators/farming";

/**
 * Farm width at which the action panel moves beside the scene. Measured on the farm
 * itself, because the farm sits in page columns and dialogs of different widths.
 * Matches the `@[760px]` container variant used in the markup.
 */
const FARM_WIDE_LAYOUT_PX = 760;
/** Viewports where a selected plot's panel floats above the bottom navigation. */
const FARM_DOCKED_PANEL_QUERY = "(max-width: 767px)";

/** Reuses the farm's plots, market, and inventory on its page or inside a residence. */
export default function OccupationFarming({
  defaultBackHref = "/home",
  embedded = false,
}: OccupationFarmingProps) {
  const canvasRef = useRef<FarmCanvasHandle>(null);
  const previousTotalPlotsRef = useRef(0);
  const [isCollectionOpen, setIsCollectionOpen] = useState(false);
  const [tab, setTab] = useState<FarmTab>("market");
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [isWide, setIsWide] = useState(false);
  const isPhone = useMediaQuery(FARM_DOCKED_PANEL_QUERY);
  const controller = useFarmController();
  const { farmState, selectedSlotIndex, selectedPlot } = controller;
  const isDocked = !isWide && isPhone;

  const visualState = useMemo<FarmVisualState | null>(
    () =>
      farmState
        ? {
            plots: farmState.plots,
            totalPlots: farmState.totalPlots,
            selectedPlotIndex: selectedSlotIndex,
          }
        : null,
    [farmState, selectedSlotIndex],
  );

  useEffect(() => {
    if (!visualState) return;
    const previousTotal = previousTotalPlotsRef.current;
    if (previousTotal > 0 && visualState.totalPlots > previousTotal) {
      for (let slot = previousTotal; slot < visualState.totalPlots; slot++) {
        canvasRef.current?.expandGrid(visualState.totalPlots, slot);
      }
    }
    canvasRef.current?.updateState(visualState);
    previousTotalPlotsRef.current = visualState.totalPlots;
  }, [visualState]);

  useEffect(() => {
    const event = controller.effectEvent;
    if (event && event.effect !== "expand") {
      canvasRef.current?.playEffect(event.slotIndex, event.effect);
    }
  }, [controller.effectEvent]);

  useEffect(() => {
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      setIsWide((entry?.contentRect.width ?? 0) >= FARM_WIDE_LAYOUT_PX);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [container]);

  // Below the scene, the selected plot's panel can start off screen; bring it into view.
  useEffect(() => {
    if (selectedSlotIndex === null || isWide || isDocked) return;
    revealElement("farm-panel", "nearest");
  }, [selectedSlotIndex, isWide, isDocked]);

  const openTab = useCallback(
    (next: FarmTab) => {
      controller.setSelectedSlotIndex(null);
      setTab(next);
      revealElement("farm-storehouse", "start");
    },
    [controller.setSelectedSlotIndex],
  );

  if (controller.query.isLoading) {
    return <Loader explanation="Loading farm..." />;
  }

  if (!farmState) {
    // Failed requests and prerequisite rejections must leave loading with a recovery action.
    return (
      <ContentBox
        title="Farming"
        subtitle="Grow crops for cooking ingredients"
        defaultBackHref={embedded ? undefined : defaultBackHref}
        initialBreak={!embedded}
        alreadyHasH1={embedded}
      >
        <div role="alert" className="space-y-2">
          <p className="text-destructive text-sm">
            {controller.query.data && "message" in controller.query.data
              ? controller.query.data.message
              : "Could not load the farm."}
          </p>
          <Button
            variant="outline"
            disabled={controller.query.isFetching}
            onClick={() => void controller.query.refetch()}
          >
            Retry
          </Button>
        </div>
      </ContentBox>
    );
  }

  const initialVisual: FarmVisualState = {
    plots: farmState.plots,
    totalPlots: farmState.totalPlots,
    selectedPlotIndex: selectedSlotIndex,
  };
  const cropCount = farmState.sellableCrops.reduce(
    (total, crop) => total + crop.quantity,
    0,
  );
  const renderInspector = (docked: boolean) =>
    selectedPlot && (
      <FarmPlotInspector
        plot={selectedPlot}
        docked={docked}
        farmState={farmState}
        now={controller.now}
        pending={
          selectedSlotIndex !== null &&
          controller.pendingPlotSlots.has(selectedSlotIndex)
        }
        onClose={() => controller.setSelectedSlotIndex(null)}
        onPlant={controller.plant}
        onWater={controller.water}
        onFertilize={controller.fertilize}
        onHarvest={controller.harvest}
        onBrowseSeeds={() => openTab("market")}
      />
    );

  const farm = (
    <div ref={setContainer} className="@container space-y-3">
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {controller.announcement}
      </div>
      <FarmHUD state={farmState} onOpenCollection={() => setIsCollectionOpen(true)} />
      <div className="grid items-start gap-3 @[760px]:grid-cols-[minmax(0,1fr)_300px]">
        <FarmCanvas
          ref={canvasRef}
          initialState={initialVisual}
          onPlotClick={(slotIndex) => controller.setSelectedSlotIndex(slotIndex)}
        />
        <div id="farm-panel">
          {selectedPlot && !isDocked ? (
            renderInspector(false)
          ) : (
            <FarmOverview
              state={farmState}
              summary={controller.summary}
              now={controller.now}
              timeDiff={controller.timeDiff}
              pendingAction={controller.pendingBulkAction}
              onPlantAll={controller.plantAll}
              onWaterAll={controller.waterAll}
              onFertilizeAll={controller.fertilizeAll}
              onHarvestAll={controller.harvestAll}
              onOpenMarket={() => openTab("market")}
            />
          )}
        </div>
      </div>
      {isDocked && renderInspector(true)}

      <section
        id="farm-storehouse"
        aria-label="Market and storage"
        className="rounded-lg border bg-card p-3"
      >
        <Tabs value={tab} onValueChange={(value) => setTab(value as FarmTab)}>
          <TabsList className="mb-3 grid w-full grid-cols-4">
            <TabsTrigger value="market">Market</TabsTrigger>
            <TabsTrigger value="crops">
              Crops{cropCount > 0 ? ` (${cropCount})` : ""}
            </TabsTrigger>
            <TabsTrigger value="extraction">Extraction</TabsTrigger>
            <TabsTrigger value="upgrades">Upgrades</TabsTrigger>
          </TabsList>
          <TabsContent value="market" className="mt-0">
            <FarmMarket
              farmState={farmState}
              pendingKeys={controller.pendingInventoryKeys}
              onBuy={controller.buy}
            />
          </TabsContent>
          {(["crops", "extraction"] as const).map((view) => (
            <TabsContent key={view} value={view} className="mt-0">
              <FarmInventory
                view={view}
                farmState={farmState}
                pendingKeys={controller.pendingInventoryKeys}
                onSell={controller.sell}
                onExtract={controller.extract}
                onOpenMarket={() => openTab("market")}
                onOpenUpgrades={() => openTab("upgrades")}
                onExtractionFinished={() => void controller.query.refetch()}
                timeDiff={controller.timeDiff}
              />
            </TabsContent>
          ))}
          <TabsContent value="upgrades" className="mt-0">
            <FarmMarket
              section="upgrades"
              farmState={farmState}
              pendingKeys={controller.pendingInventoryKeys}
              onBuy={controller.buy}
            />
          </TabsContent>
        </Tabs>
      </section>

      <FarmCollectionLog
        collectionLog={farmState.collectionLog}
        isOpen={isCollectionOpen}
        setIsOpen={setIsCollectionOpen}
      />
    </div>
  );

  // Inside a residence the dialog already titles the farm.
  if (embedded) return farm;
  return (
    <ContentBox
      title="Your Farm"
      subtitle="Grow crops for cooking ingredients"
      defaultBackHref={defaultBackHref}
      initialBreak
    >
      {farm}
    </ContentBox>
  );
}

/** Space kept above an element revealed by scrolling. */
const REVEAL_MARGIN_PX = 16;

/**
 * Scrolls an element into view inside its nearest scrolling ancestor, or the page.
 * `scrollIntoView` would also scroll clipped ancestors such as a dialog frame,
 * shifting the frame's own header out of view.
 */
const revealElement = (id: string, block: "start" | "nearest") => {
  const element = document.getElementById(id);
  if (!element) return;
  let scroller = element.parentElement;
  while (
    scroller &&
    !(
      ["auto", "scroll"].includes(getComputedStyle(scroller).overflowY) &&
      scroller.scrollHeight > scroller.clientHeight + 1
    )
  ) {
    scroller = scroller.parentElement;
  }
  const viewTop = scroller ? scroller.getBoundingClientRect().top : 0;
  const viewHeight = scroller ? scroller.clientHeight : window.innerHeight;
  const rect = element.getBoundingClientRect();
  const top = rect.top - viewTop;
  const bottom = rect.bottom - viewTop;
  let delta = top - REVEAL_MARGIN_PX;
  if (block === "nearest") {
    if (top >= 0 && bottom <= viewHeight) return;
    if (top >= 0) delta = Math.min(delta, bottom - viewHeight + REVEAL_MARGIN_PX);
  }
  const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
  (scroller ?? window).scrollBy({ top: delta, behavior });
};

type FarmTab = "market" | "crops" | "extraction" | "upgrades";

/** Embedded farms preserve their enclosing residence dialog's heading and navigation. */
type OccupationFarmingProps = {
  defaultBackHref?: string;
  embedded?: boolean;
};
