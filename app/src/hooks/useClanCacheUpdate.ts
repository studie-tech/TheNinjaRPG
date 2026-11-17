import { getQueryKey } from "@trpc/react-query";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { applyClanDelta } from "@/deltas/clan";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";
import type { ClanDelta } from "@/validators/clan";

/**
 * Bind confirmed clan treasury, point and boost changes to the cached `clan.get` result of
 * one clan. A response without a clan delta fetches that clan again.
 */
export const useClanCacheUpdate = (clanId: string) => {
  const { prepareUpdate, updateCache } = useQueryCacheUpdate<
    RouterOutputs["clan"]["get"]
  >(getQueryKey(api.clan.get, { clanId }, "query"));
  /** Pin the clan query key and revision when the mutation starts. */
  const prepareClanUpdate = prepareUpdate;
  /** Apply the confirmed clan delta, or refetch the captured clan when it is missing. */
  const updateClan = (
    result: { clanDelta?: ClanDelta } | undefined,
    snapshot: ReturnType<typeof prepareUpdate>,
  ) => {
    const delta = result?.clanDelta;
    return updateCache(
      delta ? (current) => applyClanDelta(current, delta) : undefined,
      snapshot,
    );
  };
  return { prepareClanUpdate, updateClan };
};
