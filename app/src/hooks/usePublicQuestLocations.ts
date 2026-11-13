import { getQueryKey } from "@trpc/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";
import { useRefreshAt } from "@/hooks/useRefreshAt";
import { nextUtcDayAt, periodStart } from "@/utils/time";
import { MAP_LOCATION_REFRESH_MS } from "@/validators/mapLocation";

/** Prepare destination scenery once; keep visible scenes fresh on publication and recovery signals. */
export const usePublicQuestLocations = (timeDiff: number, isActive = true) => {
  const [contentRevision, setContentRevision] = useState(0);
  const day = periodStart("daily", new Date(Date.now() - timeDiff)).getTime();
  const publicationRecoveryUntil = day + timeDiff + 5 * 60_000;
  // Publication days advance independently of edit timestamps, which may come from a faster worker clock.
  const input = useMemo(
    () => ({ revision: Math.max(contentRevision, day), refreshKey: day }),
    [contentRevision, day],
  );
  // Only the original uncached key prepares a hidden destination; later revisions
  // and publication days wait until its scene becomes active.
  const [initialInput] = useState(input);
  const key = useMemo(
    () => getQueryKey(api.quests.getPublicLocations, input, "query"),
    [input],
  );
  const cache = useQueryCacheUpdate<RouterOutputs["quests"]["getPublicLocations"]>(key);
  const query = api.quests.getPublicLocations.useQuery(input, {
    enabled: (query) =>
      isActive || (input === initialInput && query.state.status === "pending"),
    placeholderData: (previous) => previous,
    trpc: { abortOnUnmount: true },
    staleTime: () => (Date.now() < publicationRecoveryUntil ? 0 : 5 * 60_000),
    // Clock skew and replies crossing midnight can cache the preceding day's projection.
    // Keep ten-second recovery for the first five UTC minutes before resuming quiet polling.
    refetchInterval: (query) =>
      isActive
        ? query.state.status === "error" || Date.now() < publicationRecoveryUntil
          ? MAP_LOCATION_REFRESH_MS
          : 5 * 60_000
        : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: isActive ? "always" : false,
    refetchOnReconnect: isActive ? "always" : false,
  });
  const current = useRef({ input, cache, timeDiff, isActive });
  current.current = { input, cache, timeDiff, isActive };
  const wasActive = useRef(isActive);
  const { refetch } = query;
  useEffect(() => {
    const resumed = isActive && !wasActive.current;
    wasActive.current = isActive;
    // Join the enabled observer's stale read, or refresh a still-fresh cached snapshot.
    if (resumed) void refetch({ cancelRefetch: false });
  }, [isActive, refetch]);

  /** Preserve the server's edit timestamp so another worker cannot return an older cached catalogue. */
  const updatePublicLocations = useCallback((revision: number) => {
    setContentRevision((previous) => Math.max(previous, revision));
  }, []);

  /** Recover missed notifications without allowing a pending pre-subscription read to overwrite them. */
  const recoverPublicLocations = useCallback(() => {
    const { input, cache, timeDiff, isActive } = current.current;
    if (!isActive) return;
    const revision = Math.max(input.revision, Math.floor(Date.now() - timeDiff));
    if (revision > input.revision) updatePublicLocations(revision);
    else void cache.updateCache(undefined, cache.prepareUpdate());
  }, [updatePublicLocations]);

  const boundaries = useMemo(() => [nextUtcDayAt(new Date(day))], [day]);
  useRefreshAt(
    boundaries,
    () =>
      updatePublicLocations(
        periodStart("daily", new Date(Date.now() - timeDiff)).getTime(),
      ),
    timeDiff,
    isActive,
  );
  return { ...query, updatePublicLocations, recoverPublicLocations };
};
