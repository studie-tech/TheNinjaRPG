import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { addSectorArrivals, getSectorUserUpdate } from "@/deltas/travel";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";

/** Bind caller-only sector reconciliation to the sector selected before an action starts. */
export const useSectorCacheUpdate = (sector: number | undefined) => {
  const utils = api.useUtils();
  const client = useQueryClient();
  const key = getQueryKey(api.travel.getSectorData, { sector }, "query");
  const cache = useQueryCacheUpdate<RouterOutputs["travel"]["getSectorData"]>(key);
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
  /** Whether an unfinished snapshot read, which may predate an arrival, is still pending. */
  const isSectorFetching = () => client.isFetching({ queryKey: key, exact: true }) > 0;
  /** Add newcomers read after the captured revision; a snapshot read since then reloads instead. */
  const addArrivals = (
    snapshot: ReturnType<typeof prepareSectorUpdate>,
    arrivals: RouterOutputs["travel"]["getSectorUsers"],
    positions: ReadonlyMap<string, { longitude: number; latitude: number }>,
  ) =>
    cache.updateCache(
      (current) => addSectorArrivals(current, arrivals, positions),
      snapshot.query,
    );
  return { prepareSectorUpdate, updateSector, isSectorFetching, addArrivals };
};
