import { getQueryKey } from "@trpc/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";
import { useRefreshAt } from "@/hooks/useRefreshAt";
import { nextUtcDayAt, periodStart } from "@/utils/time";
import { MAP_LOCATION_REFRESH_MS } from "@/validators/mapLocation";

/** Keep public scenery fresh on content revisions, UTC publication boundaries and missed-event recovery. */
export const usePublicQuestLocations = (timeDiff: number) => {
  const [contentRevision, setContentRevision] = useState(0);
  const day = periodStart("daily", new Date(Date.now() - timeDiff)).getTime();
  // A new UTC day must not reuse the preceding day's still-fresh query after navigation.
  const input = useMemo(
    () => ({ revision: Math.max(contentRevision, day) }),
    [contentRevision, day],
  );
  const key = useMemo(
    () => getQueryKey(api.quests.getPublicLocations, input, "query"),
    [input],
  );
  const cache = useQueryCacheUpdate<RouterOutputs["quests"]["getPublicLocations"]>(key);
  const query = api.quests.getPublicLocations.useQuery(input, {
    placeholderData: (previous) => previous,
    staleTime: 5 * 60_000,
    refetchInterval: (query) =>
      query.state.status === "error" ? MAP_LOCATION_REFRESH_MS : 5 * 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
  const current = useRef({ input, cache, timeDiff });
  current.current = { input, cache, timeDiff };

  /** Preserve the server's edit timestamp so another worker cannot return an older cached catalogue. */
  const updatePublicLocations = useCallback((revision: number) => {
    setContentRevision((previous) => Math.max(previous, revision));
  }, []);

  /** Recover missed notifications without allowing a pending pre-subscription read to overwrite them. */
  const recoverPublicLocations = useCallback(() => {
    const { input, cache, timeDiff } = current.current;
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
  );
  return { ...query, updatePublicLocations, recoverPublicLocations };
};
