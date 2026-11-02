import { hashKey } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import {
  getJutsuTrainingTimers,
  getTrainingJutsus,
  getUnchangedJutsuTrainingQueue,
} from "@/deltas/jutsu";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";

/** Bind confirmed single-level training to ownership, waiting jobs and sidebar timers. */
export const useJutsuTrainingCacheUpdate = () => {
  const utils = api.useUtils();
  const owned = useQueryCacheUpdate<RouterOutputs["jutsu"]["getUserJutsus"]>(
    getQueryKey(api.jutsu.getUserJutsus, {}, "query"),
  );
  const queue = useQueryCacheUpdate<RouterOutputs["jutsu"]["getTrainingQueue"]>(
    getQueryKey(api.jutsu.getTrainingQueue, undefined, "query"),
  );
  const timers = useQueryCacheUpdate<RouterOutputs["profile"]["getSidebarTimers"]>(
    getQueryKey(api.profile.getSidebarTimers, undefined, "query"),
  );
  /** Capture all three query revisions before starting training. */
  const prepareTrainingUpdate = () => ({
    owned: owned.prepareUpdate(),
    queue: queue.prepareUpdate(),
    timers: timers.prepareUpdate(),
  });
  /** Preserve queue settlement ordering when learned jutsus, successors or uncertain writes require reads. */
  const updateTraining = async (
    result: RouterOutputs["jutsu"]["startTraining"] | undefined,
    snapshot: ReturnType<typeof prepareTrainingUpdate>,
  ) => {
    const update = result?.success ? result.trainingUpdate : undefined;
    if (!update) {
      // serial-invalidation-ok: the queue read starts successors before ownership and timer recovery.
      await utils.jutsu.getTrainingQueue.invalidate();
      await Promise.all([
        utils.jutsu.getUserJutsus.invalidate(),
        utils.profile.getSidebarTimers.invalidate(),
      ]);
      return;
    }
    void utils.jutsu.getUserJutsus.invalidate(undefined, {
      predicate: (query) => hashKey(query.queryKey) !== hashKey(snapshot.owned.key),
    });
    // A queue recovery can start a successor; its dependent views must then read afterwards.
    const queueApplied = await queue.updateCache(
      getUnchangedJutsuTrainingQueue,
      snapshot.queue,
    );
    const ownedApplied = await owned.updateCache(
      queueApplied ? (rows) => getTrainingJutsus(rows, update) : undefined,
      snapshot.owned,
    );
    await timers.updateCache(
      queueApplied && ownedApplied
        ? (current) => getJutsuTrainingTimers(current, update)
        : undefined,
      snapshot.timers,
    );
  };
  return { prepareTrainingUpdate, updateTraining };
};
