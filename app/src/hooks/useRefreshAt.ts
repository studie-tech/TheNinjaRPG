import { useEffect, useRef, useState } from "react";

/**
 * Refresh at the next server-time boundary without polling between boundaries.
 * The timer follows the boundary values, not the array's identity, so callers may pass
 * a fresh inline array on every render without losing a pending refresh.
 * A response snapshot also catches deadlines crossed in transit, once even if refresh fails.
 */
export const useRefreshAt = (
  dates: readonly (Date | string | number | null | undefined)[],
  onRefresh: () => void,
  timeDiff = 0,
  enabled = true,
  snapshotAt?: Date,
) => {
  const refresh = useRef(onRefresh);
  const refreshedThrough = useRef(Number.NEGATIVE_INFINITY);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const snapshotTime = snapshotAt?.getTime();
  const boundaries = dates
    .map((date) => (date == null ? "" : new Date(date).getTime()))
    .join();
  useEffect(() => {
    refresh.current = onRefresh;
  }, [onRefresh]);
  useEffect(() => {
    if (!enabled) return;
    const after = Math.max(
      snapshotTime === undefined ? Date.now() : snapshotTime + timeDiff,
      refreshedThrough.current,
    );
    const timestamps = boundaries
      .split(",")
      .filter((boundary) => boundary !== "")
      .map((boundary) => Number(boundary) + timeDiff)
      .filter((timestamp) => timestamp > after);
    if (timestamps.length === 0) return;
    const nextBoundary = Math.min(...timestamps);
    const timeout = window.setTimeout(
      () => {
        if (Date.now() >= nextBoundary) {
          refreshedThrough.current = Date.now();
          refresh.current();
        }
        setRefreshVersion((version) => version + 1);
      },
      Math.min(Math.max(0, nextBoundary - Date.now()) + 1000, 2_147_000_000),
    );
    return () => window.clearTimeout(timeout);
  }, [boundaries, timeDiff, enabled, snapshotTime, refreshVersion]);
};
