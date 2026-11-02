import { getQueryKey } from "@trpc/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { getVisibleDungeonEntrances } from "@/deltas/dungeonDiscovery";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";
import { useRefreshAt } from "@/hooks/useRefreshAt";

/** Bind admission reconciliation to the sector selected before a dungeon action starts. */
export const useDungeonAvailabilityCache = (sector: number) => {
  const key = useMemo(
    () => getQueryKey(api.coop.dungeon.getAvailable, { sector }, "query"),
    [sector],
  );
  const { prepareUpdate, updateCache } =
    useQueryCacheUpdate<RouterOutputs["coop"]["dungeon"]["getAvailable"]>(key);
  const refreshAvailability = useCallback(
    (snapshot: ReturnType<typeof prepareUpdate>) => updateCache(undefined, snapshot),
    [updateCache],
  );
  return { prepareAvailabilityUpdate: prepareUpdate, refreshAvailability };
};

/** Discover authored entrances through shared map signals, deadlines and bounded recovery reads. */
export const useDungeonAvailability = (
  sector: number,
  enabled: boolean,
  timeDiff: number,
  refreshAdmission = false,
) => {
  const { prepareAvailabilityUpdate, refreshAvailability } =
    useDungeonAvailabilityCache(sector);
  const available = api.coop.dungeon.getAvailable.useQuery(
    { sector },
    {
      enabled,
      staleTime: 0,
      // Map scenery changes on publication signals. Personal admission also changes
      // with inventory, quest completions and cooldowns, so the entry screen polls it.
      refetchInterval: (query) =>
        refreshAdmission || query.state.status === "error" ? 10_000 : 5 * 60_000,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  );
  const [now, setNow] = useState(() => Date.now());
  const deadlines = useMemo(
    () => available.data?.map(({ content }) => content.expiresAt) ?? [],
    [available.data],
  );
  useRefreshAt(deadlines, () => setNow(Date.now()), timeDiff, enabled);
  const refresh = useCallback(
    () => refreshAvailability(prepareAvailabilityUpdate()),
    [prepareAvailabilityUpdate, refreshAvailability],
  );
  const signals = useMemo(() => {
    let nextRefreshAt = 0;
    let pending: ReturnType<typeof setTimeout> | undefined;
    const clear = () => {
      if (pending !== undefined) clearTimeout(pending);
      pending = undefined;
    };
    const read = () => {
      pending = undefined;
      nextRefreshAt = Date.now() + 10_000;
      if (enabled) void refresh();
    };
    return {
      clear,
      onContentUpdated: () => {
        if (!enabled || pending !== undefined) return;
        const wait = nextRefreshAt - Date.now();
        if (wait > 0) pending = setTimeout(read, wait);
        else read();
      },
      onContentSubscribed: () => {
        clear();
        read();
      },
    };
  }, [enabled, refresh]);
  useEffect(() => () => signals.clear(), [signals]);
  const data = useMemo(
    () =>
      enabled
        ? getVisibleDungeonEntrances(
            available.data,
            sector,
            Math.max(now, available.dataUpdatedAt, Date.now()) - timeDiff,
          )
        : undefined,
    [enabled, available.data, sector, now, available.dataUpdatedAt, timeDiff],
  );
  return {
    ...available,
    data,
    onContentUpdated: signals.onContentUpdated,
    onContentSubscribed: signals.onContentSubscribed,
    prepareAvailabilityUpdate,
    refreshAvailability,
  };
};
