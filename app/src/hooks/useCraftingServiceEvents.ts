import { useCraftingServiceReconciliation } from "@/hooks/useCraftingServices";

/** Refresh open views when a service receipt changes in another tab or player's session. */
export const useCraftingServiceEvents = (refreshUser?: () => Promise<unknown>) => {
  const { refreshServiceViews } = useCraftingServiceReconciliation(refreshUser);
  return { refreshServiceViews };
};
