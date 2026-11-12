"use client";

import { getQueryKey } from "@trpc/react-query";
import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import {
  getFarmBulkMutationUpdate,
  getFarmMutationUpdate,
  syncFarmNotifications,
} from "@/deltas/farming";
import { FARM_MAX_CROP_SELL_QUANTITY } from "@/drizzle/constants";
import { useNow } from "@/hooks/useNow";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";
import { summarizeFarmPlots } from "@/libs/farming";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserData } from "@/utils/UserContext";
import type {
  FarmEffect,
  FarmMutationResponse,
  FarmPlotState,
  FarmShopEntryState,
} from "@/validators/farming";

/** Coordinate farm actions and keep controls pending until confirmed changes are reconciled. */
export function useFarmController() {
  const utils = api.useUtils();
  const farmCache = useQueryCacheUpdate<RouterOutputs["farming"]["getFarmState"]>(
    getQueryKey(api.farming.getFarmState, undefined, "query"),
  );
  const { timeDiff, prepareUserUpdate, updateUser, updateNotifications } =
    useRequiredUserData();
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
  const clockNow = useNow(5_000);
  const [effectEvent, setEffectEvent] = useState<{
    id: number;
    slotIndex: number;
    effect: FarmEffect;
  } | null>(null);

  const query = api.farming.getFarmState.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const mutationOptions = {
    onMutate: prepareUserUpdate,
    onSuccess: async (
      result: FarmMutationResponse,
      _input: unknown,
      revision: number | undefined,
    ) => {
      if (result.success || result.userRecovery || result.userDelta !== undefined)
        await updateUser(result, { revision, refetch: false });
    },
  };
  const plantMutation = api.farming.plantSeed.useMutation(mutationOptions);
  const waterMutation = api.farming.waterPlot.useMutation(mutationOptions);
  const fertilizeMutation = api.farming.applyFertilizer.useMutation(mutationOptions);
  const harvestMutation = api.farming.harvestPlot.useMutation(mutationOptions);
  const plantAllMutation = api.farming.plantAllEmpty.useMutation(mutationOptions);
  const waterAllMutation = api.farming.waterAll.useMutation(mutationOptions);
  const fertilizeAllMutation = api.farming.fertilizeAll.useMutation(mutationOptions);
  const harvestAllMutation = api.farming.harvestAll.useMutation(mutationOptions);
  const buyMutation = api.farming.buyShopItem.useMutation(mutationOptions);
  const sellMutation = api.farming.sellCrop.useMutation(mutationOptions);
  const extractMutation = api.farming.extractSeeds.useMutation(mutationOptions);

  const farmState = query.data ?? null;
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
    togglePending(pendingPlotSlotsRef, setPendingPlotSlots, slotIndex, pending);
  }, []);

  const setPendingInventoryKey = useCallback((key: string, pending: boolean) => {
    togglePending(pendingInventoryKeysRef, setPendingInventoryKeys, key, pending);
  }, []);

  const showResult = useCallback((result: FarmMutationResponse) => {
    showMutationToast(result);
    setAnnouncement(result.message);
  }, []);

  /** Report a transport failure, reconciling plots it may or may not have changed. */
  const showFailure = useCallback(
    (error: unknown, fallback: string) => {
      void utils.farming.getFarmState.invalidate();
      const message = error instanceof Error ? error.message : fallback;
      setAnnouncement(message);
      showMutationToast({ success: false, message });
    },
    [utils],
  );

  /** Clear farm notices the confirmed plots no longer warrant, from the latest profile list. */
  const syncNotifications = useCallback(async () => {
    await updateNotifications((current) => {
      const plots = utils.farming.getFarmState.getData()?.plots;
      return plots
        ? syncFarmNotifications(current, plots, new Date(Date.now() - timeDiff))
        : current;
    });
  }, [utils, timeDiff, updateNotifications]);

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
        if (!result.success) {
          if (result.userRecovery || result.userDelta !== undefined)
            await farmCache.updateCache(undefined, snapshot);
          return;
        }
        await farmCache.updateCache(
          (current) =>
            current
              ? getFarmMutationUpdate(current, result, effect, userItemId)
              : undefined,
          snapshot,
        );
        await syncNotifications();
        setEffectEvent({ id: Date.now(), slotIndex: plot.slotIndex, effect });
      } catch (error) {
        showFailure(error, "Farm action failed");
      } finally {
        setPendingPlot(plot.slotIndex, false);
      }
    },
    [setPendingPlot, farmCache, showFailure, showResult, syncNotifications],
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
        showResult(result);
        // Partial bulk failures may already have changed plots or granted crops.
        await farmCache.updateCache(
          (current) =>
            current ? getFarmBulkMutationUpdate(current, result, key) : undefined,
          snapshot,
        );
        await syncNotifications();
        return result.success;
      } catch (error) {
        showFailure(error, "Bulk farm action failed");
        return false;
      } finally {
        pendingBulkActionRef.current = null;
        setPendingBulkAction(null);
      }
    },
    [farmCache, showFailure, showResult, syncNotifications],
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
      setPendingInventoryKey(key, true);
      try {
        const result = await request();
        showResult(result);
        if (!result.success) {
          if (result.userRecovery || result.userDelta !== undefined)
            await farmCache.updateCache(undefined, snapshot);
          return false;
        }
        await farmCache.updateCache(
          (current) =>
            current
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
        showFailure(error, "Transaction failed");
        return false;
      } finally {
        setPendingInventoryKey(key, false);
      }
    },
    [farmCache, setPendingInventoryKey, showFailure, showResult],
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
      setPendingInventoryKey(key, true);
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
                current
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
        setPendingInventoryKey(key, false);
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

/** Replace a pending set so its ref and rendered state always hold the same members. */
const togglePending = <T>(
  pendingRef: RefObject<Set<T>>,
  setPending: (next: Set<T>) => void,
  key: T,
  pending: boolean,
) => {
  const next = new Set(pendingRef.current);
  if (pending) next.add(key);
  else next.delete(key);
  pendingRef.current = next;
  setPending(next);
};
