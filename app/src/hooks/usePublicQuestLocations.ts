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
  const [needsRecovery, setNeedsRecovery] = useState(false);
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
      isActive
        ? !needsRecovery
        : input === initialInput && query.state.status === "pending",
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

  /** Preserve the server's edit timestamp so another worker cannot return an older cached catalogue. */
  const updatePublicLocations = useCallback((revision: number) => {
    setContentRevision((previous) => Math.max(previous, revision));
  }, []);

  /** Recover missed notifications without allowing a pending pre-subscription read to overwrite them. */
  const recoverPublicLocations = useCallback(() => {
    const { input, cache, timeDiff, isActive } = current.current;
    if (!isActive) {
      // Keep initial asset preparation running; reconcile missed edits when visible.
      setNeedsRecovery(true);
      return;
    }
    const revision = Math.max(input.revision, Math.floor(Date.now() - timeDiff));
    if (revision > input.revision) {
      updatePublicLocations(revision);
      setNeedsRecovery(false);
    } else
      void cache.updateCache(undefined, cache.prepareUpdate()).then(() => {
        if (current.current.isActive) setNeedsRecovery(false);
      });
  }, [updatePublicLocations]);

  useEffect(() => {
    const resumed = isActive && !wasActive.current;
    wasActive.current = isActive;
    if (!resumed) return;
    if (!needsRecovery) {
      // An ordinary activation can join another observer's pending catch-up read.
      void refetch({ cancelRefetch: false });
      return;
    }
    // Install the recovered revision or reject the pre-event read before enabling this observer.
    recoverPublicLocations();
  }, [isActive, needsRecovery, recoverPublicLocations, refetch]);

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
