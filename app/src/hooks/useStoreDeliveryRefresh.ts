import { api } from "@/app/_trpc/client";

/** Refresh everything a delivered store purchase can change, except the profile. */
export const useStoreDeliveryRefresh = () => {
  const utils = api.useUtils();
  return () =>
    Promise.all([
      utils.paypal.getRecentRepsCount.invalidate(),
      utils.paypal.getPaypalTransactions.invalidate(),
      utils.paypal.getStoreBundles.invalidate(),
      utils.item.getUserItems.invalidate(),
      utils.item.getUserItemsWithVariants.invalidate(),
    ]);
};
