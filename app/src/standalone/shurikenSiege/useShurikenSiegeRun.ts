import { nanoid } from "nanoid";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type TowerDefenseBackend,
  useTowerDefenseSession,
} from "@/hooks/useTowerDefenseSession";
import { showMutationToast } from "@/libs/toast";
import type { TdDojoUpgrade } from "@/libs/towerDefense/content";
import { tdCheckpoints } from "@/libs/towerDefense/content";
import {
  buyLocalDojoLevel,
  parseLocalProgress,
  settleLocalRun,
  TD_EMPTY_LOCAL_PROGRESS,
  type TdLocalProgress,
} from "@/libs/towerDefense/localProgress";
import type { ShurikenSiegeStore } from "@/standalone/shurikenSiege/portal";

const RUN_KEY = "shurikenSiege:run";

/**
 * Shuriken Siege runs without a server: runs start from the stored Guard Hall levels and
 * checkpoints and bank their scrolls and best wave into the store when they end. The
 * device store also keeps unfinished runs to resume after a reload; a host's cloud save
 * keeps progress only. A store that refuses writes keeps progress for the visit.
 */
export const useShurikenSiegeRun = (
  store: ShurikenSiegeStore,
  onBestWave?: (wave: number) => void,
) => {
  const [progress, setProgress] = useState<TdLocalProgress>(TD_EMPTY_LOCAL_PROGRESS);
  const [isLoaded, setIsLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void store.read().then((raw) => {
      if (cancelled) return;
      setProgress(parseLocalProgress(raw));
      setIsLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [store]);
  /** Progress as stored now, which another tab may have written since this one read it. */
  const latest = useCallback(
    async () => parseLocalProgress(await store.read()),
    [store],
  );
  const keep = useCallback(
    async (next: TdLocalProgress) => {
      setProgress(next);
      await store.write(JSON.stringify(next));
    },
    [store],
  );

  const startRun = useCallback<TowerDefenseBackend["startRun"]>(
    async (startWave) => {
      const current = await latest();
      if (!tdCheckpoints(current.bestWave).includes(startWave)) {
        showMutationToast({
          success: false,
          message: "That checkpoint is not unlocked yet.",
        });
        return null;
      }
      return {
        config: {
          seed: nanoid(),
          startWave,
          bestWave: current.bestWave,
          level: 1,
          dojo: current.dojo,
        },
        token: `local:${nanoid()}`,
      };
    },
    [latest],
  );

  const claimRun = useCallback<TowerDefenseBackend["claimRun"]>(
    async ({ state }) => {
      const settled = settleLocalRun(await latest(), state);
      await keep(settled.progress);
      onBestWave?.(settled.progress.bestWave);
      return {
        settled: true,
        claimed: true,
        retryable: false,
        reloadRequired: false,
        points: settled.points,
        message: null,
      };
    },
    [keep, latest, onBestWave],
  );

  const backend = useMemo<TowerDefenseBackend>(
    () => ({
      storageKey: RUN_KEY,
      saveRuns: store.saveRuns,
      isStarting: false,
      startRun,
      claimRun,
    }),
    [claimRun, startRun, store.saveRuns],
  );
  const session = useTowerDefenseSession(backend);

  const buyDojo = useCallback(
    async (upgradeId: TdDojoUpgrade) => {
      const result = buyLocalDojoLevel(await latest(), upgradeId);
      if ("message" in result) {
        showMutationToast({ success: false, message: result.message });
        return;
      }
      await keep(result.progress);
    },
    [keep, latest],
  );

  return { ...session, progress, isLoaded, buyDojo };
};
