import { hashKey } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { getEquippedJutsus } from "@/deltas/jutsu";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";
import type { UserJutsuFilteringSchema } from "@/validators/jutsu";

/** Bind jutsu equipment reconciliation to the initiating filter and refresh other memberships. */
export const useJutsuCacheUpdate = (input: UserJutsuFilteringSchema) => {
  const utils = api.useUtils();
  const cache = useQueryCacheUpdate<RouterOutputs["jutsu"]["getUserJutsus"]>(
    getQueryKey(api.jutsu.getUserJutsus, input, "query"),
  );
  const prepareJutsuUpdate = () => ({ query: cache.prepareUpdate(), input });
  const updateJutsus = async (
    userJutsuId: string,
    change: RouterOutputs["jutsu"]["toggleEquip"]["data"],
    snapshot: ReturnType<typeof prepareJutsuUpdate>,
  ) => {
    void utils.jutsu.getUserJutsus.invalidate(undefined, {
      predicate: (query) => hashKey(query.queryKey) !== hashKey(snapshot.query.key),
    });
    await cache.updateCache(
      (rows) => getEquippedJutsus(rows, userJutsuId, change, snapshot.input),
      snapshot.query,
    );
  };
  return { prepareJutsuUpdate, updateJutsus };
};
