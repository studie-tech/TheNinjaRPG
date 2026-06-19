"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { applyFarmMutationPatch } from "@/libs/farm-state";
import {
  applyFertilizerReduction,
  applyWaterReduction,
  getPlotGrowthProgress,
  getPlotGrowthStage,
  patchFarmPlot,
  summarizeFarmPlots,
} from "@/libs/farming";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserData } from "@/utils/UserContext";
import type {
  FarmEffect,
  FarmMutationResponse,
  FarmPlotState,
  FarmShopEntryState,
  FarmStateResponse,
} from "@/validators/farming";

type FarmQueryData = FarmStateResponse | { success: false; message: string };

const isFarmState = (data: FarmQueryData | undefined): data is FarmStateResponse =>
  !!data && !("success" in data);

export function useFarmController() {
  const utils = api.useUtils();
  const { timeDiff } = useRequiredUserData();
  const [selectedSlotIndex, setSelectedSlotIndex] = useState<number | null>(null);
  const [pendingPlotSlots, setPendingPlotSlots] = useState<Set<number>>(new Set());
  const pendingPlotSlotsRef = useRef<Set<number>>(new Set());
  const [pendingInventoryKeys, setPendingInventoryKeys] = useState<Set<string>>(
    new Set(),
  );
  const [pendingBulkAction, setPendingBulkAction] = useState<string | null>(null);
  const pendingBulkActionRef = useRef<string | null>(null);
  const pendingInventoryKeysRef = useRef<Set<string>>(new Set());
  const [announcement, setAnnouncement] = useState("");
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [effectEvent, setEffectEvent] = useState<{
    id: number;
    slotIndex: number;
    effect: FarmEffect;
  } | null>(null);

  const query = api.farming.getFarmState.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const plantMutation = api.farming.plantSeed.useMutation();
  const waterMutation = api.farming.waterPlot.useMutation();
  const fertilizeMutation = api.farming.applyFertilizer.useMutation();
  const harvestMutation = api.farming.harvestPlot.useMutation();
  const plantAllMutation = api.farming.plantAllEmpty.useMutation();
  const waterAllMutation = api.farming.waterAll.useMutation();
  const fertilizeAllMutation = api.farming.fertilizeAll.useMutation();
  const harvestAllMutation = api.farming.harvestAll.useMutation();
  const buyMutation = api.farming.buyShopItem.useMutation();
  const sellMutation = api.farming.sellCrop.useMutation();
  const extractMutation = api.farming.extractSeeds.useMutation();

  useEffect(() => {
    const interval = window.setInterval(() => setClockNow(Date.now()), 5_000);
    return () => window.clearInterval(interval);
  }, []);

  const farmState = isFarmState(query.data) ? query.data : null;
  const now = useMemo(() => new Date(clockNow - timeDiff), [clockNow, timeDiff]);
  const selectedPlot = useMemo(
    () =>
      selectedSlotIndex === null
        ? null
        : (farmState?.plots.find((plot) => plot.slotIndex === selectedSlotIndex) ??
          null),
    [farmState, selectedSlotIndex],
  );
  const summary = useMemo(
    () => summarizeFarmPlots(farmState?.plots ?? [], now),
    [farmState?.plots, now],
  );

  const setPendingPlot = useCallback((slotIndex: number, pending: boolean) => {
    const next = new Set(pendingPlotSlotsRef.current);
    if (pending) next.add(slotIndex);
    else next.delete(slotIndex);
    pendingPlotSlotsRef.current = next;
    setPendingPlotSlots(next);
  }, []);

  const updateCache = useCallback(
    (updater: (state: FarmStateResponse) => FarmStateResponse) => {
      utils.farming.getFarmState.setData(undefined, (current) =>
        isFarmState(current) ? updater(current) : current,
      );
    },
    [utils],
  );

  const runPlotAction = useCallback(
    async (
      plot: FarmPlotState,
      effect: FarmEffect,
      optimisticPlot: FarmPlotState,
      request: () => Promise<FarmMutationResponse>,
    ) => {
      if (pendingPlotSlotsRef.current.has(plot.slotIndex)) return;
      const snapshot = utils.farming.getFarmState.getData();
      setPendingPlot(plot.slotIndex, true);
      try {
        await utils.farming.getFarmState.cancel();
        updateCache((state) => ({
          ...state,
          plots: patchFarmPlot(state.plots, optimisticPlot),
        }));
        const result = await request();
        showMutationToast(result);
        setAnnouncement(result.message);
        if (!result.success) {
          utils.farming.getFarmState.setData(undefined, snapshot);
          return;
        }
        updateCache((state) => applyFarmMutationPatch(state, result));
        setEffectEvent({ id: Date.now(), slotIndex: plot.slotIndex, effect });
        void utils.farming.getFarmState.invalidate();
      } catch (error) {
        utils.farming.getFarmState.setData(undefined, snapshot);
        const message = error instanceof Error ? error.message : "Farm action failed";
        setAnnouncement(message);
        showMutationToast({ success: false, message });
      } finally {
        setPendingPlot(plot.slotIndex, false);
      }
    },
    [setPendingPlot, updateCache, utils],
  );

  const plant = useCallback(
    (plot: FarmPlotState, seedItemId: string) => {
      if (!farmState) return;
      const seed = farmState.availableSeeds.find(
        (entry) => entry.itemId === seedItemId,
      );
      if (!seed) return;
      const plantedAt = new Date(Date.now() - timeDiff);
      const finishAt = new Date(plantedAt.getTime() + seed.growTimeSeconds * 1000);
      const optimisticPlot: FarmPlotState = {
        ...plot,
        seedItemId,
        seedName: seed.name,
        cropName: seed.yieldName,
        cropImage: seed.yieldImage,
        plantedAt,
        finishAt,
        lastWateredAt: null,
        fertilizerApplied: false,
        isReady: false,
        canWater: true,
        nextWateringAt: null,
        growthProgress: 0,
        growthStage: 1,
        growTimeSeconds: seed.growTimeSeconds,
        yieldQuantity: seed.yieldQuantity,
        plantExperience: seed.plantExperience,
        harvestExperience: seed.harvestExperience,
      };
      void runPlotAction(plot, "plant", optimisticPlot, () =>
        plantMutation.mutateAsync({ plotId: plot.id, seedItemId }),
      );
    },
    [farmState, plantMutation, runPlotAction, timeDiff],
  );

  const water = useCallback(
    (plot: FarmPlotState) => {
      if (!plot.finishAt) return;
      const actionNow = new Date(Date.now() - timeDiff);
      const finishAt = applyWaterReduction(plot.finishAt, actionNow);
      void runPlotAction(
        plot,
        "water",
        {
          ...plot,
          finishAt,
          lastWateredAt: actionNow,
          canWater: false,
          growthProgress: getPlotGrowthProgress(plot.plantedAt, finishAt, actionNow),
          growthStage: getPlotGrowthStage(plot.plantedAt, finishAt, actionNow),
        },
        () => waterMutation.mutateAsync({ plotId: plot.id }),
      );
    },
    [runPlotAction, timeDiff, waterMutation],
  );

  const fertilize = useCallback(
    (plot: FarmPlotState, userItemId: string) => {
      if (!plot.finishAt || !farmState) return;
      const fertilizer = farmState.availableFertilizers.find(
        (entry) => entry.userItemId === userItemId,
      );
      if (!fertilizer) return;
      const actionNow = new Date(Date.now() - timeDiff);
      const finishAt = applyFertilizerReduction(
        plot.finishAt,
        fertilizer.timeReductionSeconds,
        actionNow,
      );
      void runPlotAction(
        plot,
        "fertilize",
        {
          ...plot,
          finishAt,
          fertilizerApplied: true,
          growthProgress: getPlotGrowthProgress(plot.plantedAt, finishAt, actionNow),
          growthStage: getPlotGrowthStage(plot.plantedAt, finishAt, actionNow),
        },
        () => fertilizeMutation.mutateAsync({ plotId: plot.id, userItemId }),
      );
    },
    [farmState, fertilizeMutation, runPlotAction, timeDiff],
  );

  const harvest = useCallback(
    (plot: FarmPlotState) => {
      void runPlotAction(
        plot,
        "harvest",
        {
          ...plot,
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
        },
        () => harvestMutation.mutateAsync({ plotId: plot.id }),
      );
    },
    [harvestMutation, runPlotAction],
  );

  const runBulkAction = useCallback(
    async (key: string, request: () => Promise<FarmMutationResponse>) => {
      if (pendingBulkActionRef.current) return false;
      pendingBulkActionRef.current = key;
      setPendingBulkAction(key);
      try {
        const result = await request();
        showMutationToast(result);
        setAnnouncement(result.message);
        if (!result.success) return false;
        updateCache((state) => applyFarmMutationPatch(state, result));
        await utils.farming.getFarmState.invalidate();
        return true;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Bulk farm action failed";
        setAnnouncement(message);
        showMutationToast({ success: false, message });
        return false;
      } finally {
        pendingBulkActionRef.current = null;
        setPendingBulkAction(null);
      }
    },
    [updateCache, utils],
  );

  const plantAll = useCallback(
    (seedItemId: string) =>
      runBulkAction("plant", () => plantAllMutation.mutateAsync({ seedItemId })),
    [plantAllMutation, runBulkAction],
  );
  const waterAll = useCallback(
    () => runBulkAction("water", () => waterAllMutation.mutateAsync()),
    [runBulkAction, waterAllMutation],
  );
  const fertilizeAll = useCallback(
    (userItemId: string) =>
      runBulkAction("fertilize", () =>
        fertilizeAllMutation.mutateAsync({ userItemId }),
      ),
    [fertilizeAllMutation, runBulkAction],
  );
  const harvestAll = useCallback(
    () => runBulkAction("harvest", () => harvestAllMutation.mutateAsync()),
    [harvestAllMutation, runBulkAction],
  );

  const runInventoryAction = useCallback(
    async (key: string, request: () => Promise<FarmMutationResponse>) => {
      if (pendingInventoryKeysRef.current.has(key)) return false;
      const snapshot = utils.farming.getFarmState.getData();
      const pendingKeys = new Set(pendingInventoryKeysRef.current).add(key);
      pendingInventoryKeysRef.current = pendingKeys;
      setPendingInventoryKeys(pendingKeys);
      try {
        const result = await request();
        showMutationToast(result);
        setAnnouncement(result.message);
        if (!result.success) return false;
        updateCache((state) => applyFarmMutationPatch(state, result));
        void utils.farming.getFarmState.invalidate();
        return true;
      } catch (error) {
        utils.farming.getFarmState.setData(undefined, snapshot);
        const message = error instanceof Error ? error.message : "Transaction failed";
        setAnnouncement(message);
        showMutationToast({ success: false, message });
        return false;
      } finally {
        const next = new Set(pendingInventoryKeysRef.current);
        next.delete(key);
        pendingInventoryKeysRef.current = next;
        setPendingInventoryKeys(next);
      }
    },
    [updateCache, utils],
  );

  const buy = useCallback(
    async (entry: FarmShopEntryState, quantity: number) => {
      const succeeded = await runInventoryAction(
        `buy:${entry.type}:${entry.itemId ?? "upgrade"}`,
        () =>
          buyMutation.mutateAsync({
            type: entry.type,
            itemId: entry.itemId,
            quantity,
          }),
      );
      if (succeeded && entry.type === "PLOT" && farmState) {
        setEffectEvent({
          id: Date.now(),
          slotIndex: farmState.totalPlots,
          effect: "expand",
        });
      }
      return succeeded;
    },
    [buyMutation, farmState, runInventoryAction],
  );

  const sell = useCallback(
    (userItemId: string, quantity: number) =>
      runInventoryAction(`sell:${userItemId}`, () =>
        sellMutation.mutateAsync({ userItemId, quantity }),
      ),
    [runInventoryAction, sellMutation],
  );
  const extract = useCallback(
    (extractorSlot: number, userItemId: string, quantity: number) =>
      runInventoryAction(`extract:${extractorSlot}:${userItemId}`, () =>
        extractMutation.mutateAsync({ extractorSlot, userItemId, quantity }),
      ),
    [extractMutation, runInventoryAction],
  );

  return {
    query,
    farmState,
    selectedSlotIndex,
    selectedPlot,
    setSelectedSlotIndex,
    summary,
    pendingPlotSlots,
    pendingInventoryKeys,
    pendingBulkAction,
    announcement,
    effectEvent,
    timeDiff,
    plant,
    water,
    fertilize,
    harvest,
    plantAll,
    waterAll,
    fertilizeAll,
    harvestAll,
    buy,
    sell,
    extract,
  };
}
