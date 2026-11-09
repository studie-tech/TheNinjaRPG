import { useEffect, useRef, useState } from "react";

/**
 * Refresh at the next server-time boundary without polling between boundaries.
 * The timer follows the boundary values, not the array's identity, so callers may pass
 * a fresh inline array on every render without losing a pending refresh.
 */
export const useRefreshAt = (
  dates: readonly (Date | string | number | null | undefined)[],
  onRefresh: () => void,
  timeDiff = 0,
  enabled = true,
) => {
  const refresh = useRef(onRefresh);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const boundaries = dates
    .map((date) => (date == null ? "" : new Date(date).getTime()))
    .join();
  useEffect(() => {
    refresh.current = onRefresh;
  }, [onRefresh]);
  useEffect(() => {
    if (!enabled) return;
    const timestamps = boundaries
      .split(",")
      .filter((boundary) => boundary !== "")
      .map((boundary) => Number(boundary) + timeDiff)
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
  }, [boundaries, timeDiff, enabled, refreshVersion]);
};
