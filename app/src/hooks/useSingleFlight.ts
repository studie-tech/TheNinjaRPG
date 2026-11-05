import { useRef, useState } from "react";

/**
 * Lets one submission run at a time. React state only changes on the next render, so a
 * double click or click + Enter in one tick would pass a state check; the claim is held
 * in a ref and refuses that second submission synchronously, while `pending` mirrors it
 * for rendering. Pass the captured request (a snapshot of its target) to keep it available
 * to the UI and to tell it apart from a later one; plain locks claim `true`.
 *
 * - `run(request, task)` claims, awaits `task` and releases on every outcome, resolving
 *   to `task`'s result, or `undefined` without calling it when a request is in flight.
 *   Errors reach the caller: the task keeps its own toast, catch and recovery branches.
 * - `claim(request)` / `release(request)` are the same steps for a flight that does not
 *   fit one awaited task, such as `mutate` settling in `onSettled`.
 * - `release()` without a request abandons the flight, so a late response from it can
 *   check `owns(request)` and stand down. A release naming another request is a no-op.
 * - `current()` reads the held request synchronously. Call it from handlers and effects;
 *   render from `pending` and `isPending`.
 */
export const useSingleFlight = <T = true>() => {
  const held = useRef<T | null>(null);
  const [pending, setPending] = useState<T | null>(null);

  const claim = (request: T = true as T) => {
    if (held.current !== null) return false;
    held.current = request;
    setPending(() => request);
    return true;
  };

  const owns = (request: T = true as T) => held.current === request;

  const release = (request?: T) => {
    if (request !== undefined && held.current !== request) return;
    held.current = null;
    setPending(null);
  };

  const run = async <R>(request: T, task: () => Promise<R>) => {
    if (!claim(request)) return undefined;
    try {
      return await task();
    } finally {
      release(request);
    }
  };

  return {
    pending,
    isPending: pending !== null,
    current: () => held.current,
    claim,
    owns,
    release,
    run,
  };
};
