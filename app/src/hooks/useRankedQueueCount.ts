import { getQueryKey } from "@trpc/react-query";
import type Pusher from "pusher-js";
import { useCallback, useEffect, useMemo } from "react";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";

/** Reconcile the shared count after a confirmed queue change, including an in-flight cold read. */
export const useRankedQueueCountCache = () => {
  const key = useMemo(
    () => getQueryKey(api.pvpRank.getRankedQueueCount, undefined, "query"),
    [],
  );
  const { prepareUpdate, updateCache } =
    useQueryCacheUpdate<RouterOutputs["pvpRank"]["getRankedQueueCount"]>(key);
  const refreshRankedQueueCount = useCallback(
    () => updateCache(undefined, prepareUpdate()),
    [prepareUpdate, updateCache],
  );
  return { refreshRankedQueueCount };
};

/** Observe queue changes on the existing socket; foreground reads recover missed or failed pushes. */
export const useRankedQueueCount = (enabled: boolean, pusher: Pusher | undefined) => {
  const { refreshRankedQueueCount } = useRankedQueueCountCache();
  const count = api.pvpRank.getRankedQueueCount.useQuery(undefined, {
    enabled,
    staleTime: 0,
    // Changes are signalled without counter deltas: concurrent joins, leaves and
    // matches always reconcile against the database. Polling also covers crashes
    // between a committed write and its notification, including cleanup failures.
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  useEffect(() => {
    if (!enabled || !pusher) return;
    const channel = pusher.subscribe("ranked-queue");
    let nextRefreshAt = 0;
    let pendingRefresh: ReturnType<typeof setTimeout> | undefined;
    /** Start an authoritative read and its throttle window. */
    const refresh = () => {
      pendingRefresh = undefined;
      nextRefreshAt = Date.now() + 30_000;
      void refreshRankedQueueCount();
    };
    /** Keep a fixed trailing deadline so sustained churn cannot postpone the final update. */
    const changed = () => {
      if (pendingRefresh !== undefined) return;
      const wait = nextRefreshAt - Date.now();
      if (wait > 0) pendingRefresh = setTimeout(refresh, wait);
      else refresh();
    };
    /** Reconcile a connection gap immediately and replace any pending trailing read. */
    const recover = () => {
      if (pendingRefresh !== undefined) clearTimeout(pendingRefresh);
      refresh();
    };
    channel.bind("updated", changed);
    // Subscription confirmation closes the initial read/subscribe gap and runs
    // again after socket reconnects, when changes may have been missed.
    channel.bind("pusher:subscription_succeeded", recover);
    return () => {
      if (pendingRefresh !== undefined) clearTimeout(pendingRefresh);
      channel.unbind("updated", changed);
      channel.unbind("pusher:subscription_succeeded", recover);
      pusher.unsubscribe("ranked-queue");
    };
  }, [enabled, pusher, refreshRankedQueueCount]);
  return count;
};
