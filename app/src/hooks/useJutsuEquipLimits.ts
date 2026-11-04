import { getQueryKey } from "@trpc/react-query";
import { api } from "@/app/_trpc/client";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";

/** Reconcile staff edits against the jutsu equip limit configuration query. */
export const useJutsuEquipLimits = () => {
  const query = api.misc.getJutsuEquipLimits.useQuery();
  const { prepareUpdate, updateCache } = useQueryCacheUpdate(
    getQueryKey(api.misc.getJutsuEquipLimits, undefined, "query"),
  );
  const callbacks = {
    onMutate: prepareUpdate,
    onSuccess: (
      result: { success: boolean },
      _input: unknown,
      snapshot: ReturnType<typeof prepareUpdate> | undefined,
    ) => {
      if (result.success && snapshot) void updateCache(undefined, snapshot);
    },
  };
  const save = api.misc.setJutsuEquipLimit.useMutation(callbacks);
  const remove = api.misc.removeJutsuEquipLimit.useMutation(callbacks);
  return { query, save, remove };
};
