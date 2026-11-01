import { type QueryKey, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  prepareQueryUpdate,
  type QueryCacheUpdate,
  updateQueryCache,
} from "@/utils/queryCache";

type QuerySnapshot = { key: QueryKey; revision: number | undefined };

/** Bind mutation reconciliation to one exact tRPC query key, including its input. */
export const useQueryCacheUpdate = <T>(key: QueryKey) => {
  const client = useQueryClient();
  const prepareUpdate = useCallback(
    (): QuerySnapshot => ({ key, revision: prepareQueryUpdate<T>(client, key) }),
    [client, key],
  );
  const updateCache = useCallback(
    (update: QueryCacheUpdate<T> | undefined, snapshot: QuerySnapshot) =>
      // A mutation may finish after the component switches query inputs.
      updateQueryCache(client, snapshot.key, update, { revision: snapshot.revision }),
    [client],
  );
  return { prepareUpdate, updateCache };
};
