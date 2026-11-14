import { useSyncExternalStore } from "react";

/**
 * Client clock in epoch milliseconds: re-renders every `intervalMs` while `enabled`, and
 * re-reads the clock when it turns on so a paused consumer never shows a stale time.
 * Consumers with the same interval share one ticker aligned to interval boundaries, so
 * every clock on the page commits together. Subtract `timeDiff` at the call site when
 * server time is needed.
 */
export const useNow = (
  intervalMs: number,
  { enabled = true }: { enabled?: boolean } = {},
) => {
  const clock = clockFor(intervalMs);
  return useSyncExternalStore(
    enabled ? clock.subscribe : ignoreSubscription,
    clock.read,
    clock.read,
  );
};

const clocks = new Map<number, SharedClock>();

/** One ticker per interval; it runs only while a consumer is subscribed. */
const clockFor = (intervalMs: number) => {
  const existing = clocks.get(intervalMs);
  if (existing) return existing;
  const listeners = new Set<() => void>();
  let now = Date.now();
  let timer: number | undefined;
  /** Publish one shared timestamp, then align the next wakeup to the interval boundary. */
  const tick = () => {
    now = Date.now();
    for (const listener of listeners) listener();
    timer = window.setTimeout(tick, intervalMs - (Date.now() % intervalMs));
  };
  const clock: SharedClock = {
    read: () => {
      // Without a running ticker, a read starts from the current time; it stays cached
      // for the interval so repeated reads within one render agree.
      if (listeners.size === 0 && Math.abs(Date.now() - now) >= intervalMs)
        now = Date.now();
      return now;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      if (listeners.size === 1) {
        // The first consumer after a pause reads the current time, not the last tick.
        now = Date.now();
        timer = window.setTimeout(tick, intervalMs - (now % intervalMs));
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0) return;
        window.clearTimeout(timer);
        timer = undefined;
      };
    },
  };
  clocks.set(intervalMs, clock);
  return clock;
};

/** Let disabled consumers read the clock without keeping its ticker alive. */
const ignoreSubscription = () => () => {};

type SharedClock = {
  read: () => number;
  subscribe: (listener: () => void) => () => void;
};
