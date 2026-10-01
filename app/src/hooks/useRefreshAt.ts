import { useEffect, useRef, useState } from "react";

/** Refresh at the next server-time boundary without polling between boundaries. */
export const useRefreshAt = (
  dates: readonly (Date | string | number | null | undefined)[],
  onRefresh: () => void,
  timeDiff = 0,
  enabled = true,
) => {
  const refresh = useRef(onRefresh);
  const [refreshVersion, setRefreshVersion] = useState(0);
  useEffect(() => {
    refresh.current = onRefresh;
  }, [onRefresh]);
  useEffect(() => {
    if (!enabled) return;
    const timestamps = dates
      .filter((date) => date != null)
      .map((date) => new Date(date).getTime() + timeDiff)
      .filter((timestamp) => timestamp > Date.now());
    if (timestamps.length === 0) return;
    const nextBoundary = Math.min(...timestamps);
    const timeout = window.setTimeout(
      () => {
        if (Date.now() >= nextBoundary) refresh.current();
        setRefreshVersion((version) => version + 1);
      },
      Math.min(nextBoundary - Date.now() + 1000, 2_147_000_000),
    );
    return () => window.clearTimeout(timeout);
  }, [dates, timeDiff, enabled, refreshVersion]);
};
