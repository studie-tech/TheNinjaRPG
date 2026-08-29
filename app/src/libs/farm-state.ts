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
