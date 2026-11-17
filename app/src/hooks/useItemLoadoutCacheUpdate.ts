import { getQueryKey } from "@trpc/react-query";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { getClearedItemLoadouts, getRenamedLoadouts } from "@/deltas/loadout";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";
import type { RenameLoadoutSchema } from "@/validators/loadout";

/** Reconcile the item loadout list against the snapshot captured before a mutation. */
export const useItemLoadoutCacheUpdate = () => {
  const cache = useQueryCacheUpdate<RouterOutputs["item"]["getItemLoadouts"]>(
    getQueryKey(api.item.getItemLoadouts, undefined, "query"),
  );
  /** Capture the loadout revision before the mutation is sent. */
  const prepareLoadoutUpdate = cache.prepareUpdate;
  /** Apply a confirmed rename; a loadout missing from the loaded list reads it again. */
  const updateRenamedLoadout = (
    input: RenameLoadoutSchema,
    snapshot: ReturnType<typeof prepareLoadoutUpdate>,
  ) => cache.updateCache((rows) => getRenamedLoadouts(rows, input), snapshot);
  /** Empty the loadout an unequip-all cleared; an unknown outcome reads the list again. */
  const updateClearedLoadout = (
    clearedLoadoutId: string | null | undefined,
    snapshot: ReturnType<typeof prepareLoadoutUpdate>,
  ) =>
    cache.updateCache(
      clearedLoadoutId === undefined
        ? undefined
        : (rows) => getClearedItemLoadouts(rows, clearedLoadoutId),
      snapshot,
    );
  return { prepareLoadoutUpdate, updateRenamedLoadout, updateClearedLoadout };
};
