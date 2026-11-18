import { getQueryKey } from "@trpc/react-query";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { applyAnbuSquadDelta } from "@/deltas/anbu";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";
import type { AnbuSquadDelta } from "@/validators/anbu";

/**
 * Bind confirmed squad point and level changes to the cached `anbu.get` result of one
 * squad. A response without a squad delta fetches that squad again.
 */
export const useAnbuSquadCacheUpdate = (squadId: string) => {
  const { prepareUpdate, updateCache } = useQueryCacheUpdate<
    RouterOutputs["anbu"]["get"]
  >(getQueryKey(api.anbu.get, { id: squadId }, "query"));
  /** Pin the squad query key and revision when the mutation starts. */
  const prepareSquadUpdate = prepareUpdate;
  /** Apply the confirmed squad delta, or refetch the captured squad when it is missing. */
  const updateSquad = (
    result: { squadDelta?: AnbuSquadDelta } | undefined,
    snapshot: ReturnType<typeof prepareUpdate>,
  ) => {
    const delta = result?.squadDelta;
    return updateCache(
      delta ? (current) => applyAnbuSquadDelta(current, delta) : undefined,
      snapshot,
    );
  };
  return { prepareSquadUpdate, updateSquad };
};
