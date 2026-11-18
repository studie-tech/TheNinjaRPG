import { nanoid } from "nanoid";
import { useCallback, useMemo, useState } from "react";
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
  type TdLocalProgress,
} from "@/libs/towerDefense/localProgress";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/utils/storage";

const PROGRESS_KEY = "shurikenSiege:progress";
const RUN_KEY = "shurikenSiege:run";

/**
 * Shuriken Siege runs on the player's device: runs start from local Guard Hall levels and
 * checkpoints, are saved and resumed like signed runs, and bank their scrolls and best
 * wave locally when they end. Storage that refuses writes keeps progress for the visit.
 */
export const useShurikenSiegeRun = () => {
  const [progress, setProgress] = useState<TdLocalProgress>(() =>
    parseLocalProgress(safeLocalStorageGetItem(PROGRESS_KEY)),
  );
  const store = useCallback((next: TdLocalProgress) => {
    setProgress(next);
    safeLocalStorageSetItem(PROGRESS_KEY, JSON.stringify(next));
  }, []);
  /** Storage another tab wrote since this one read it, so neither overwrites the other. */
  const latest = useCallback(
    () => parseLocalProgress(safeLocalStorageGetItem(PROGRESS_KEY)),
    [],
  );

  const startRun = useCallback<TowerDefenseBackend["startRun"]>(
    async (startWave) => {
      const current = latest();
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
      const settled = settleLocalRun(latest(), state);
      store(settled.progress);
      return {
        settled: true,
        claimed: true,
        retryable: false,
        reloadRequired: false,
        points: settled.points,
        message: null,
      };
    },
    [latest, store],
  );

  const backend = useMemo<TowerDefenseBackend>(
    () => ({ storageKey: RUN_KEY, isStarting: false, startRun, claimRun }),
    [claimRun, startRun],
  );
  const session = useTowerDefenseSession(backend);

  const buyDojo = useCallback(
    (upgradeId: TdDojoUpgrade) => {
      const result = buyLocalDojoLevel(latest(), upgradeId);
      if ("message" in result) {
        showMutationToast({ success: false, message: result.message });
        return;
      }
      store(result.progress);
    },
    [latest, store],
  );

  return { ...session, progress, buyDojo };
};
