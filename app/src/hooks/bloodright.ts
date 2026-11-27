import { getQueryKey } from "@trpc/react-query";
import type { z } from "zod";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { getConfirmedBloodright } from "@/deltas/bloodright";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserDataSelector } from "@/utils/UserContext";
import type { userDeltaResponseSchema } from "@/validators/userCache";

/** Reconcile the Bloodright allocation and Silver balances after confirmed mutations. */
export const useBloodrightMutations = () => {
  const utils = api.useUtils();
  const cache = useQueryCacheUpdate<RouterOutputs["bloodright"]["get"]>(
    getQueryKey(api.bloodright.get, undefined, "query"),
  );
  const { prepareUserUpdate, updateUser } = useRequiredUserDataSelector((user) => ({
    userId: user.userId,
  }));
  const onMutate = () => ({
    userRevision: prepareUserUpdate(),
    allocation: cache.prepareUpdate(),
  });
  const onSuccess = async (
    result: z.infer<typeof userDeltaResponseSchema>,
    _input: unknown,
    snapshot: ReturnType<typeof onMutate> | undefined,
  ) => {
    showMutationToast(result);
    if (result.success)
      await Promise.all([
        snapshot
          ? cache.updateCache(
              (current) =>
                getConfirmedBloodright(current, result.userPatch?.bloodright),
              snapshot.allocation,
            )
          : utils.bloodright.get.invalidate(),
        updateUser(result.userPatch, {
          revision: snapshot?.userRevision,
          delta: result.userPatch?.bloodright ? result.userDelta : undefined,
        }),
      ]);
  };
  const purchase = api.bloodright.purchase.useMutation({ onMutate, onSuccess });
  const refund = api.bloodright.refund.useMutation({ onMutate, onSuccess });
  const reset = api.bloodright.reset.useMutation({
    onMutate,
    onSuccess: async (result, input, snapshot) => {
      await onSuccess(result, input, snapshot);
      if (result.success) await utils.skillTree.getResetInfo.invalidate();
    },
  });
  return { purchase, refund, reset };
};

/** Refresh all catalog views whose options or source jutsu may have changed. */
export const useBloodrightCatalogInvalidation = () => {
  const utils = api.useUtils();
  return () =>
    Promise.all([
      utils.bloodright.catalog.invalidate(),
      utils.bloodright.get.invalidate(),
    ]);
};
