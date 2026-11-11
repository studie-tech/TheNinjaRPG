import {
  applyWaterReduction,
  EMPTY_PLOT,
  type FarmPlotWithSeed,
  getFarmingLevel,
  getFarmNotifications,
  mapPlotToState,
  patchFarmPlot,
  summarizeFarmPlots,
} from "@/libs/farming";
import type { NavBarDropdownLink } from "@/libs/menus";
import { getPublicQuestUser } from "@/libs/quest/projection";
import type {
  FarmMutationResponse,
  FarmPlotState,
  FarmStateResponse,
} from "@/validators/farming";
import type { UserCachePatch, UserDelta } from "@/validators/userCache";

/** Project confirmed farm counters and the public tracker snapshot saved by its successful claim. */
export const getFarmProfileUpdate = (
  result: Pick<
    FarmMutationResponse,
    | "farmingExperienceDelta"
    | "farmCurrencyDelta"
    | "farmPlotsPurchasedDelta"
    | "farmExtractorsOwnedDelta"
  >,
  questUser?: Parameters<typeof getPublicQuestUser>[0],
  updatedAt?: Date,
): { userPatch: UserCachePatch; userDelta: UserDelta } => ({
  userPatch: {
    ...(questUser ? { questData: getPublicQuestUser(questUser).questData } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  },
  userDelta: {
    ...(result.farmingExperienceDelta !== undefined
      ? { farmingExperience: result.farmingExperienceDelta }
      : {}),
    ...(result.farmCurrencyDelta !== undefined
      ? { farmCurrency: result.farmCurrencyDelta }
      : {}),
    ...(result.farmPlotsPurchasedDelta !== undefined
      ? { farmPlotsPurchased: result.farmPlotsPurchasedDelta }
      : {}),
    ...(result.farmExtractorsOwnedDelta !== undefined
      ? { farmExtractorsOwned: result.farmExtractorsOwnedDelta }
      : {}),
  },
});

/** Publish only plots whose water CAS succeeded, together with their pre-write timelines. */
export const getWateredFarmPlots = (
  plots: FarmPlotWithSeed[],
  watered: boolean[],
  now: Date,
) =>
  plots.flatMap((plot, index) =>
    watered[index] && plot.finishAt
      ? [
          {
            before: {
              id: plot.id,
              seedItemId: plot.seedItemId,
              finishAt: plot.finishAt,
              lastWateredAt: plot.lastWateredAt,
            },
            after: mapPlotToState(
              {
                ...plot,
                finishAt: applyWaterReduction(plot.finishAt, now),
                lastWateredAt: now,
              },
              now,
            ),
          },
        ]
      : [],
  );

/** Clear only the plots confirmed by the bulk harvest write; item grants remain separate. */
export const getHarvestedFarmPlots = (plots: FarmPlotWithSeed[], now: Date) =>
  plots.map((plot) => ({
    before: {
      id: plot.id,
      seedItemId: plot.seedItemId,
      finishAt: plot.finishAt,
      lastWateredAt: plot.lastWateredAt,
    },
    after: mapPlotToState(
      {
        ...plot,
        ...EMPTY_PLOT,
        seedItem: null,
        yieldItem: null,
      },
      now,
    ),
  }));

/** Project complete bulk timelines and existing crop stacks; first collections, new stacks and unlocks refetch. */
export const getFarmBulkMutationUpdate = (
  state: FarmStateResponse,
  result: FarmMutationResponse,
  action: string,
): FarmStateResponse | undefined => {
  if (
    !result.success ||
    !["water", "harvest"].includes(action) ||
    !result.updatedPlots?.length ||
    result.farmingExperienceDelta === undefined ||
    getFarmingLevel(state.farmingExperience + result.farmingExperienceDelta) !==
      state.farmingLevel
  )
    return;
  for (const { before, after } of result.updatedPlots) {
    const current = state.plots.find((plot) => plot.id === before.id);
    if (
      !current ||
      current.seedItemId !== before.seedItemId ||
      current.finishAt?.getTime() !== before.finishAt?.getTime() ||
      current.lastWateredAt?.getTime() !== before.lastWateredAt?.getTime() ||
      after.id !== before.id
    )
      return;
  }
  let next = {
    ...state,
    farmingExperience: state.farmingExperience + result.farmingExperienceDelta,
  };
  if (action === "harvest") {
    // One owned stack can appear in both lists; every cached copy must match its baseline.
    const crops = [...state.extractableCrops, ...state.sellableCrops];
    if (
      !result.inventoryChanges ||
      result.inventoryChanges.some((change) => {
        const rows = crops.filter((row) => row.userItemId === change.id);
        return (
          !state.collectionLog.items.some(
            (item) => item.itemId === change.itemId && item.harvested,
          ) ||
          state.availableSeeds.some((item) => item.itemId === change.itemId) ||
          state.availableFertilizers.some((item) => item.itemId === change.itemId) ||
          rows.length === 0 ||
          rows.some(
            (row) =>
              row.itemId !== change.itemId || row.quantity !== change.beforeQuantity,
          )
        );
      })
    )
      return;
    /** The grant identifies one owned stack, so duplicate item types in other stacks stay untouched. */
    const patch = <T extends { userItemId: string; itemId: string; quantity: number }>(
      rows: T[],
    ): T[] =>
      rows.map((row) => {
        const change = result.inventoryChanges!.find(
          (change) => change.id === row.userItemId,
        );
        return change ? { ...row, quantity: change.quantity } : row;
      });
    next = {
      ...next,
      extractableCrops: patch(state.extractableCrops),
      sellableCrops: patch(state.sellableCrops),
    };
  }
  return {
    ...next,
    plots: state.plots.map((plot) => {
      const update = result.updatedPlots!.find(
        (update) => update.before.id === plot.id,
      );
      if (!update) return plot;
      if (action === "harvest") return update.after;
      // The watering query loads seed data; preserve the crop catalog labels already in this view.
      return {
        ...update.after,
        seedName: plot.seedName,
        cropName: plot.cropName,
        cropImage: plot.cropImage,
        harvestExperience: plot.harvestExperience,
      };
    }),
  };
};

/** Project item-level quantities onto existing inventory lists without creating missing rows. */
const patchInventory = (
  state: FarmStateResponse,
  deltas: NonNullable<FarmMutationResponse["inventoryDeltas"]>,
) => {
  const deltaByItem = new Map(
    deltas.map((delta) => [delta.itemId, delta.quantityDelta]),
  );
  /** Remove depleted stacks from every farm list that represents them. */
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
 * harvest collection progress, extraction jobs and level or shop unlocks return undefined
 * so the query updater requests an authoritative refresh.
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
  // Shop entries include affordability, so crossing a price threshold needs fresh state.
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
    // Item-level deltas cannot identify which of several owned stacks was consumed.
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

/**
 * Replace the farm notices with counts from confirmed plots, keeping their place in the list,
 * so a harvest or watering clears its notice before the next profile refresh.
 */
export const syncFarmNotifications = (
  notifications: NavBarDropdownLink[] | undefined,
  plots: FarmPlotState[],
  now: Date,
) => {
  if (!notifications) return notifications;
  const { ready, waterable } = summarizeFarmPlots(plots, now);
  const farm = getFarmNotifications(ready, waterable);
  const current = notifications.filter((entry) => entry.href === "/farm");
  const isUnchanged =
    current.length === farm.length &&
    current.every(
      (entry, i) => entry.name === farm[i]?.name && entry.color === farm[i]?.color,
    );
  if (isUnchanged) return notifications;
  const index = notifications.findIndex((entry) => entry.href === "/farm");
  const others = notifications.filter((entry) => entry.href !== "/farm");
  const at = index < 0 ? others.length : index;
  return [...others.slice(0, at), ...farm, ...others.slice(at)];
};
