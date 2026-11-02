import { getQueryKey } from "@trpc/react-query";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { getEquippedJutsuLoadouts, getOrderedJutsuLoadouts } from "@/deltas/loadout";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";

/** Reconcile equipment and ordering against the loadout snapshot captured before a mutation. */
export const useJutsuLoadoutCacheUpdate = () => {
  const cache = useQueryCacheUpdate<RouterOutputs["jutsu"]["getLoadouts"]>(
    getQueryKey(api.jutsu.getLoadouts, undefined, "query"),
  );
  /** Capture the loadout revision before equipment or selection can change. */
  const prepareLoadoutUpdate = cache.prepareUpdate;
  /** Reuse a confirmed equip operation; ambiguous server responses retain the authoritative read. */
  const updateEquippedLoadout = (
    change: RouterOutputs["jutsu"]["toggleEquip"]["data"],
    snapshot: ReturnType<typeof prepareLoadoutUpdate>,
  ) => cache.updateCache((rows) => getEquippedJutsuLoadouts(rows, change), snapshot);
  /** Replace only the requested loadout's confirmed saved order. */
  const updateLoadoutOrder = (
    id: string,
    jutsuIds: string[] | undefined,
    snapshot: ReturnType<typeof prepareLoadoutUpdate>,
  ) =>
    cache.updateCache((rows) => getOrderedJutsuLoadouts(rows, id, jutsuIds), snapshot);
  return { prepareLoadoutUpdate, updateEquippedLoadout, updateLoadoutOrder };
};
