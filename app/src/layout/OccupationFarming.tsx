"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFarmController } from "@/hooks/farm-controller";
import ContentBox from "@/layout/ContentBox";
import { FarmCanvas, type FarmCanvasHandle } from "@/layout/FarmCanvas";
import { FarmCollectionLog } from "@/layout/FarmCollectionLog";
import { FarmHUD } from "@/layout/FarmHUD";
import { FarmInventory } from "@/layout/FarmInventory";
import { FarmMarket } from "@/layout/FarmMarket";
import { FarmPlotInspector } from "@/layout/FarmPlotInspector";
import Loader from "@/layout/Loader";
import type { FarmVisualState } from "@/validators/farming";

type OccupationFarmingProps = {
  defaultBackHref?: string;
};

export default function OccupationFarming({
  defaultBackHref = "/home",
}: OccupationFarmingProps) {
  const canvasRef = useRef<FarmCanvasHandle>(null);
  const previousTotalPlotsRef = useRef(0);
  const [isCollectionOpen, setIsCollectionOpen] = useState(false);
  const controller = useFarmController();
  const { farmState, selectedSlotIndex, selectedPlot } = controller;

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

  const browseSeeds = useCallback(() => {
    controller.setSelectedSlotIndex(null);
    document.getElementById("farm-market")?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "start",
    });
  }, [controller.setSelectedSlotIndex]);

  if (controller.query.isLoading || !controller.query.data) {
    return <Loader explanation="Loading farm..." />;
  }

  if (!farmState) {
    return (
      <ContentBox
        title="Farming"
        subtitle="Grow crops for cooking ingredients"
        defaultBackHref={defaultBackHref}
        initialBreak
      >
        <p className="text-destructive text-sm">
          {"message" in controller.query.data
            ? controller.query.data.message
            : "Could not load the farm."}
        </p>
      </ContentBox>
    );
  }

  const initialVisual: FarmVisualState = {
    plots: farmState.plots,
    totalPlots: farmState.totalPlots,
    selectedPlotIndex: selectedSlotIndex,
  };

  return (
    <>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {controller.announcement}
      </div>
      <ContentBox
        title="Your Farm"
        subtitle="Select a plot, then choose its action"
        defaultBackHref={defaultBackHref}
        initialBreak
        padding={false}
      >
        <FarmHUD
          state={farmState}
          summary={controller.summary}
          pendingAction={controller.pendingBulkAction}
          onPlantAll={controller.plantAll}
          onWaterAll={controller.waterAll}
          onFertilizeAll={controller.fertilizeAll}
          onHarvestAll={controller.harvestAll}
          onOpenCollection={() => setIsCollectionOpen(true)}
        />
        <div className="grid items-start gap-4 p-2 pb-24 lg:grid-cols-[minmax(0,1fr)_320px] lg:p-4">
          <FarmCanvas
            ref={canvasRef}
            initialState={initialVisual}
            onPlotClick={(slotIndex) => controller.setSelectedSlotIndex(slotIndex)}
          />
          <FarmPlotInspector
            plot={selectedPlot}
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
            onBrowseSeeds={browseSeeds}
          />
        </div>
      </ContentBox>

      <ContentBox title="Farm Market" initialBreak>
        <FarmMarket
          farmState={farmState}
          pendingKeys={controller.pendingInventoryKeys}
          onBuy={controller.buy}
        />
      </ContentBox>

      <ContentBox title="Farm Inventory" initialBreak>
        <FarmInventory
          farmState={farmState}
          pendingKeys={controller.pendingInventoryKeys}
          onSell={controller.sell}
          onExtract={controller.extract}
          onBrowseSeeds={browseSeeds}
          onExtractionFinished={() => void controller.query.refetch()}
          timeDiff={controller.timeDiff}
        />
      </ContentBox>

      <FarmCollectionLog
        collectionLog={farmState.collectionLog}
        isOpen={isCollectionOpen}
        setIsOpen={setIsCollectionOpen}
      />
    </>
  );
}
