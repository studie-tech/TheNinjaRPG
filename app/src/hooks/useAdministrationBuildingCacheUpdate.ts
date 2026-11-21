import { api } from "@/app/_trpc/client";

/** Reconcile the event entry counts and supply stacks that share carried inventory. */
export const useAdministrationBuildingCacheUpdate = () => {
  const utils = api.useUtils();
  const invalidateStock = async () => {
    await Promise.all([
      utils.quests.allianceBuilding.invalidate(),
      utils.occupation.getSupplyRequest.invalidate(),
    ]);
  };
  return { invalidateStock };
};
