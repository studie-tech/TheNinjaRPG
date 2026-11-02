import { getQueryKey } from "@trpc/react-query";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { getSectorUserUpdate } from "@/deltas/travel";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";

/** Bind caller-only sector reconciliation to the sector selected before an action starts. */
export const useSectorCacheUpdate = (sector: number | undefined) => {
  const utils = api.useUtils();
  const cache = useQueryCacheUpdate<RouterOutputs["travel"]["getSectorData"]>(
    getQueryKey(api.travel.getSectorData, { sector }, "query"),
  );
  /** Capture the exact sector and revision before movement, arrival or combat settlement. */
  const prepareSectorUpdate = () => ({ query: cache.prepareUpdate(), sector });
  /** Reuse the reconciled profile; uncertain results and world-wide changes retain a sector read. */
  const updateSector = (
    profileApplied: boolean,
    snapshot: ReturnType<typeof prepareSectorUpdate>,
  ) => {
    const user = utils.profile.getUser.getData()?.userData;
    if (snapshot.sector === undefined) return utils.travel.getSectorData.invalidate();
    return cache.updateCache(
      profileApplied && user?.sector === snapshot.sector
        ? (current) => getSectorUserUpdate(current, user)
        : undefined,
      snapshot.query,
    );
  };
  return { prepareSectorUpdate, updateSector };
};
