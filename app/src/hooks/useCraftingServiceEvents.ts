import { api } from "@/app/_trpc/client";

/** Refresh open views when a service receipt changes in another tab or player's session. */
export const useCraftingServiceEvents = (refreshUser?: () => Promise<unknown>) => {
  const utils = api.useUtils();
  const refreshServiceViews = () =>
    Promise.all([
      utils.item.getUserItems.invalidate(),
      utils.item.getUserItemsWithVariants.invalidate(),
      utils.occupation.getServiceRequests.invalidate(),
      utils.profile.getSidebarTimers.invalidate(),
      refreshUser?.(),
    ]);
  return { refreshServiceViews };
};
