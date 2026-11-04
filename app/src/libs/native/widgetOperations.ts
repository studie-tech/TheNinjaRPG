import { createSerialQueue } from "@/utils/async";

/**
 * Serialises mutations of the one native widget container shared by every web account.
 *
 * A clear invalidates writes which have not started yet. A write already inside the native
 * bridge is allowed to finish, but the queued clear still runs after it, so completion order
 * can never restore the old account after sign-out or an account handoff.
 */
export const createNativeWidgetOperations = () => {
  const enqueue = createSerialQueue();
  let epoch = 0;
  return {
    /** Queue a snapshot write, declining it if a newer clear claimed the container first. */
    sync: (
      mutate: () => Promise<void>,
      confirmed: () => void,
    ): Promise<"confirmed" | "stale"> => {
      const requestedEpoch = epoch;
      return enqueue(async () => {
        if (requestedEpoch !== epoch) return "stale";
        await mutate();
        confirmed();
        return "confirmed";
      });
    },

    /**
     * Invalidate pending writes immediately, then clear after any mutation already in flight.
     * The confirmation callback is deliberately after the rejecting native call.
     */
    clear: (mutate: () => Promise<void>, confirmed: () => void): Promise<void> => {
      epoch += 1;
      return enqueue(async () => {
        await mutate();
        confirmed();
      });
    },
  };
};
