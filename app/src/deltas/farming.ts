import { getFarmingLevel, patchFarmPlot } from "@/libs/farming";
import type { FarmMutationResponse, FarmStateResponse } from "@/validators/farming";

const patchInventory = (
  state: FarmStateResponse,
  deltas: NonNullable<FarmMutationResponse["inventoryDeltas"]>,
) => {
  const deltaByItem = new Map(
    deltas.map((delta) => [delta.itemId, delta.quantityDelta]),
  );
  const patchQuantity = <T extends { itemId: string; quantity: number }>(items: T[]) =>
    items
      .map((entry) => ({
        ...entry,
        quantity: Math.max(0, entry.quantity + (deltaByItem.get(entry.itemId) ?? 0)),
      }))
      .filter((entry) => entry.quantity > 0);
  return {
    ...state,
    availableSeeds: patchQuantity(state.availableSeeds),
    availableFertilizers: patchQuantity(state.availableFertilizers),
    extractableCrops: patchQuantity(state.extractableCrops),
    sellableCrops: patchQuantity(state.sellableCrops),
  };
};

/** Project represented plot, balance and inventory changes; callers reconcile omitted farm state. */
export const applyFarmMutationPatch = (
  state: FarmStateResponse,
  result: FarmMutationResponse,
): FarmStateResponse => {
  const farmingExperience =
    state.farmingExperience + (result.farmingExperienceDelta ?? 0);
  let next = {
    ...state,
    plots: result.updatedPlot
      ? patchFarmPlot(state.plots, result.updatedPlot)
      : state.plots,
    farmingExperience,
    farmingLevel: getFarmingLevel(farmingExperience),
    farmCurrency: state.farmCurrency + (result.farmCurrencyDelta ?? 0),
    totalPlots: result.totalPlots ?? state.totalPlots,
    farmPlotsPurchased:
      state.farmPlotsPurchased + (result.farmPlotsPurchasedDelta ?? 0),
    farmExtractorsOwned:
      state.farmExtractorsOwned + (result.farmExtractorsOwnedDelta ?? 0),
  };
  if (result.inventoryDeltas) next = patchInventory(next, result.inventoryDeltas);
  return next;
};

/**
 * Reconcile complete single-plot changes and unambiguous crop sales. Bulk plots, new rows,
 * harvest collection progress, extraction jobs and level or shop unlocks require a read.
 */
export const getFarmMutationUpdate = (
  state: FarmStateResponse,
  result: FarmMutationResponse,
  action: string,
  userItemId?: string,
): FarmStateResponse | undefined => {
  if (!result.success || !["plant", "water", "fertilize", "sell"].includes(action))
    return;
  if (
    action === "sell"
      ? result.farmCurrencyDelta === undefined || !result.inventoryDeltas?.length
      : result.farmingExperienceDelta === undefined
  )
    return;
  if (["plant", "fertilize"].includes(action) && !result.inventoryDeltas?.length)
    return;
  if (action === "sell" || action === "fertilize") {
    const rows = action === "sell" ? state.sellableCrops : state.availableFertilizers;
    const target = rows.find((row) => row.userItemId === userItemId);
    if (
      !target ||
      !result.inventoryDeltas?.some((delta) => delta.itemId === target.itemId)
    )
      return;
  }
  const currency = state.farmCurrency + (result.farmCurrencyDelta ?? 0);
  if (
    state.shopEntries.some(
      (entry) => state.farmCurrency >= entry.cost !== currency >= entry.cost,
    )
  )
    return;
  if (
    action !== "sell" &&
    (!result.updatedPlot ||
      !state.plots.some((plot) => plot.id === result.updatedPlot?.id))
  )
    return;
  if (
    getFarmingLevel(state.farmingExperience + (result.farmingExperienceDelta ?? 0)) !==
    state.farmingLevel
  )
    return;
  for (const delta of result.inventoryDeltas ?? []) {
    if (delta.quantityDelta >= 0) return;
    const entries = [
      state.availableSeeds,
      state.availableFertilizers,
      state.extractableCrops,
      state.sellableCrops,
    ].map((rows) => rows.filter((row) => row.itemId === delta.itemId));
    if (
      !entries.some((rows) => rows.length) ||
      entries.some(
        (rows) =>
          rows.length > 1 || rows.some((row) => row.quantity + delta.quantityDelta < 0),
      )
    )
      return;
  }
  return applyFarmMutationPatch(state, result);
};
