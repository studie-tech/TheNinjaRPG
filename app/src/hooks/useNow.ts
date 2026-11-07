import { useEffect, useState } from "react";

/**
 * Client clock in epoch milliseconds: re-renders every `intervalMs` while `enabled`, and
 * re-reads the clock when it turns on so a paused consumer never shows a stale time.
 * Subtract `timeDiff` at the call site when server time is needed.
 */
export const useNow = (
  intervalMs: number,
  { enabled = true }: { enabled?: boolean } = {},
) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(interval);
  }, [enabled, intervalMs]);

  return now;
};
