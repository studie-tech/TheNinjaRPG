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
  /** Capture the filter and query revision before later renders can change the selection. */
  const prepareJutsuUpdate = () => ({ query: cache.prepareUpdate(), input });
  /** Patch the initiating filter and refresh other filters, whose rows may also change. */
  const updateJutsuRows = async (
    update: (
      rows: UserJutsus,
      input: UserJutsuFilteringSchema,
    ) => UserJutsus | undefined,
    snapshot: ReturnType<typeof prepareJutsuUpdate>,
  ) => {
    void utils.jutsu.getUserJutsus.invalidate(undefined, {
      predicate: (query) => hashKey(query.queryKey) !== hashKey(snapshot.query.key),
    });
    await cache.updateCache((rows) => update(rows, snapshot.input), snapshot.query);
  };
  /** Reconcile a confirmed equip change across the jutsu lists. */
  const updateJutsus = (
    userJutsuId: string,
    change: RouterOutputs["jutsu"]["toggleEquip"]["data"],
    snapshot: ReturnType<typeof prepareJutsuUpdate>,
  ) =>
    updateJutsuRows(
      (rows, filter) => getEquippedJutsus(rows, userJutsuId, change, filter),
      snapshot,
    );
  return { prepareJutsuUpdate, updateJutsus, updateJutsuRows };
};

type UserJutsus = RouterOutputs["jutsu"]["getUserJutsus"];
