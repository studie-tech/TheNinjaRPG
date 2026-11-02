"use client";

import { getQueryKey } from "@trpc/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { getFarmBulkMutationUpdate, getFarmMutationUpdate } from "@/deltas/farming";
import { FARM_MAX_CROP_SELL_QUANTITY } from "@/drizzle/constants";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";
import { summarizeFarmPlots } from "@/libs/farming";
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

/** Coordinate farm actions and keep controls pending until confirmed changes are reconciled. */
export function useFarmController() {
  const utils = api.useUtils();
  const farmCache = useQueryCacheUpdate<RouterOutputs["farming"]["getFarmState"]>(
    getQueryKey(api.farming.getFarmState, undefined, "query"),
  );
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

  /** Prevent overlapping plot actions and reconcile the revision captured before each write. */
  const runPlotAction = useCallback(
    async (
      plot: FarmPlotState,
      effect: FarmEffect,
      request: () => Promise<FarmMutationResponse>,
      userItemId?: string,
    ) => {
      if (pendingPlotSlotsRef.current.has(plot.slotIndex)) return;
      const snapshot = farmCache.prepareUpdate();
      setPendingPlot(plot.slotIndex, true);
      try {
        const result = await request();
        showMutationToast(result);
        setAnnouncement(result.message);
        if (!result.success) return;
        await farmCache.updateCache(
          (current) =>
            isFarmState(current)
              ? getFarmMutationUpdate(current, result, effect, userItemId)
              : undefined,
          snapshot,
        );
        setEffectEvent({ id: Date.now(), slotIndex: plot.slotIndex, effect });
      } catch (error) {
        void utils.farming.getFarmState.invalidate();
        const message = error instanceof Error ? error.message : "Farm action failed";
        setAnnouncement(message);
        showMutationToast({ success: false, message });
      } finally {
        setPendingPlot(plot.slotIndex, false);
      }
    },
    [setPendingPlot, farmCache, utils],
  );

  const plant = useCallback(
    (plot: FarmPlotState, seedItemId: string) => {
      void runPlotAction(plot, "plant", () =>
        plantMutation.mutateAsync({ plotId: plot.id, seedItemId }),
      );
    },
    [plantMutation, runPlotAction],
  );
  const water = useCallback(
    (plot: FarmPlotState) => {
      void runPlotAction(plot, "water", () =>
        waterMutation.mutateAsync({ plotId: plot.id }),
      );
    },
    [waterMutation, runPlotAction],
  );
  const fertilize = useCallback(
    (plot: FarmPlotState, userItemId: string) => {
      void runPlotAction(
        plot,
        "fertilize",
        () => fertilizeMutation.mutateAsync({ plotId: plot.id, userItemId }),
        userItemId,
      );
    },
    [fertilizeMutation, runPlotAction],
  );
  const harvest = useCallback(
    (plot: FarmPlotState) => {
      void runPlotAction(plot, "harvest", () =>
        harvestMutation.mutateAsync({ plotId: plot.id }),
      );
    },
    [harvestMutation, runPlotAction],
  );

  const runBulkAction = useCallback(
    async (key: string, request: () => Promise<FarmMutationResponse>) => {
      if (pendingBulkActionRef.current) return false;
      const snapshot = farmCache.prepareUpdate();
      pendingBulkActionRef.current = key;
      setPendingBulkAction(key);
      try {
        const result = await request();
        showMutationToast(result);
        setAnnouncement(result.message);
        // Partial bulk failures may already have changed plots or granted crops.
        await farmCache.updateCache(
          (current) =>
            isFarmState(current)
              ? getFarmBulkMutationUpdate(current, result, key)
              : undefined,
          snapshot,
        );
        return result.success;
      } catch (error) {
        void utils.farming.getFarmState.invalidate();
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
    [farmCache, utils],
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

  /** Reconcile inventory actions without restoring snapshots that could undo another action. */
  const runInventoryAction = useCallback(
    async (
      key: string,
      request: () => Promise<FarmMutationResponse>,
      userItemId?: string,
    ) => {
      if (pendingInventoryKeysRef.current.has(key)) return false;
      const snapshot = farmCache.prepareUpdate();
      const pendingKeys = new Set(pendingInventoryKeysRef.current).add(key);
      pendingInventoryKeysRef.current = pendingKeys;
      setPendingInventoryKeys(pendingKeys);
      try {
        const result = await request();
        showMutationToast(result);
        setAnnouncement(result.message);
        if (!result.success) return false;
        await farmCache.updateCache(
          (current) =>
            isFarmState(current)
              ? getFarmMutationUpdate(
                  current,
                  result,
                  key.split(":")[0] ?? "",
                  userItemId,
                )
              : undefined,
          snapshot,
        );
        return true;
      } catch (error) {
        void utils.farming.getFarmState.invalidate();
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
    [farmCache, utils],
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
      runInventoryAction(
        `sell:${userItemId}`,
        () => sellMutation.mutateAsync({ userItemId, quantity }),
        userItemId,
      ),
    [runInventoryAction, sellMutation],
  );
  /**
   * Sells every listed crop stack through the per-stack sale, in chunks of the sale
   * limit, stopping at the first rejection; reports one summary instead of a toast per sale.
   */
  const sellAll = useCallback(
    async (crops: { userItemId: string; quantity: number; sellValue: number }[]) => {
      const key = "sell:all";
      if (pendingInventoryKeysRef.current.has(key)) return false;
      const pendingKeys = new Set(pendingInventoryKeysRef.current).add(key);
      pendingInventoryKeysRef.current = pendingKeys;
      setPendingInventoryKeys(pendingKeys);
      let sold = 0;
      let earned = 0;
      let failure: string | null = null;
      try {
        for (const crop of crops) {
          let remaining = crop.quantity;
          while (remaining > 0 && !failure) {
            const quantity = Math.min(FARM_MAX_CROP_SELL_QUANTITY, remaining);
            const snapshot = farmCache.prepareUpdate();
            const result = await sellMutation.mutateAsync({
              userItemId: crop.userItemId,
              quantity,
            });
            if (!result.success) {
              failure = result.message;
              break;
            }
            await farmCache.updateCache(
              (current) =>
                isFarmState(current)
                  ? getFarmMutationUpdate(current, result, "sell", crop.userItemId)
                  : undefined,
              snapshot,
            );
            remaining -= quantity;
            sold += quantity;
            earned += quantity * crop.sellValue;
          }
          if (failure) break;
        }
      } catch (error) {
        failure = error instanceof Error ? error.message : "Transaction failed";
      } finally {
        const next = new Set(pendingInventoryKeysRef.current);
        next.delete(key);
        pendingInventoryKeysRef.current = next;
        setPendingInventoryKeys(next);
        if (failure) void utils.farming.getFarmState.invalidate();
      }
      const summary = `Sold ${sold} ${sold === 1 ? "crop" : "crops"} for ${earned.toLocaleString()} farm coins`;
      const message = failure
        ? sold > 0
          ? `${summary}. ${failure}`
          : failure
        : summary;
      showMutationToast({ success: !failure, message });
      setAnnouncement(message);
      return !failure;
    },
    [sellMutation, farmCache, utils],
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
    now,
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
    sellAll,
    extract,
  };
}
