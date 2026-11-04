import { getQueryKey } from "@trpc/react-query";
import { api } from "@/app/_trpc/client";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";

/** Reconcile staff edits against the shared cooldown configuration query. */
export const useSharedCooldowns = () => {
  const query = api.misc.getSharedCooldowns.useQuery();
  const { prepareUpdate, updateCache } = useQueryCacheUpdate(
    getQueryKey(api.misc.getSharedCooldowns, undefined, "query"),
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
  const save = api.misc.setSharedCooldown.useMutation(callbacks);
  const remove = api.misc.removeSharedCooldown.useMutation(callbacks);
  return { query, save, remove };
};
