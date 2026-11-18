import { api } from "@/app/_trpc/client";
import { useInventoryCacheUpdate } from "@/hooks/useInventoryCacheUpdate";

/** Refresh open views when a service receipt changes in another tab or player's session. */
export const useCraftingServiceEvents = (refreshUser?: () => Promise<unknown>) => {
  const utils = api.useUtils();
  const { invalidateInventory } = useInventoryCacheUpdate();
  const refreshServiceViews = async () => {
    const profileConfirmed = (await refreshUser?.()) === true;
    await Promise.all([
      // The queue can cross its due time after profile settlement and create inventory.
      utils.occupation.getCraftingQueue.invalidate().then(() => invalidateInventory()),
      utils.occupation.getServiceRequests.invalidate(),
      utils.profile.getSidebarTimers.invalidate(),
    ]);
    return profileConfirmed;
  };
  return { refreshServiceViews };
};
