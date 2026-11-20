import { nanoid } from "nanoid";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/utils/storage";

const RUN_KEY = "shurikenSiege:run";
/** Tokens of the runs this device banked last, so no run pays out twice. */
const SETTLED_KEY = "shurikenSiege:settled";
const SETTLED_KEPT = 20;
/** Serializes progress changes across the tabs of this origin. */
const PROGRESS_LOCK = "shurikenSiege:progress";
const UNSAVED_MESSAGE =
  "Your progress could not be saved, so it lasts only while this page stays open.";
const UNREADABLE_MESSAGE = "Your saved progress could not be read just now.";

/**
 * Shuriken Siege runs without a server: runs start from the stored Guard Hall levels and
 * checkpoints and bank their scrolls and best wave into the store when they end. The
 * device store also keeps unfinished runs to resume after a reload; a host's cloud save
 * keeps progress only. Progress a store refuses stays in use for the rest of the visit,
 * and a save that could not be read is never overwritten.
 */
export const useShurikenSiegeRun = (
  store: ShurikenSiegeStore,
  onBestWave?: (wave: number) => void,
) => {
  const [progress, setProgress] = useState<TdLocalProgress>(TD_EMPTY_LOCAL_PROGRESS);
  const [isLoaded, setIsLoaded] = useState(false);
  /** The newest progress the store has not kept yet; it wins over what the store holds. */
  const pending = useRef<TdLocalProgress | null>(null);
  /** The saved progress could not be read, so this visit keeps its progress in memory. */
  const isDetached = useRef(false);
  useEffect(() => {
    let cancelled = false;
    void store.read().then(
      (raw) => {
        if (cancelled) return;
        setProgress(parseLocalProgress(raw));
        setIsLoaded(true);
      },
      () => {
        if (cancelled) return;
        isDetached.current = true;
        setIsLoaded(true);
        showMutationToast({
          success: false,
          message: `Your saved progress could not be loaded. ${UNSAVED_MESSAGE}`,
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [store]);
  /**
   * Progress as stored now, which another tab may have written since this one read it;
   * null when the store could not be read, so no change is built on progress it missed.
   */
  const latest = useCallback(async (): Promise<TdLocalProgress | null> => {
    if (pending.current) return pending.current;
    if (isDetached.current) return TD_EMPTY_LOCAL_PROGRESS;
    return store.read().then(parseLocalProgress, () => null);
  }, [store]);
  /** Show and save progress; resolves whether the store kept it. */
  const keep = useCallback(
    async (next: TdLocalProgress) => {
      setProgress(next);
      pending.current = next;
      if (isDetached.current) return false;
      const isSaved = await store.write(JSON.stringify(next));
      if (isSaved && pending.current === next) pending.current = null;
      return isSaved;
    },
    [store],
  );

  const startRun = useCallback<TowerDefenseBackend["startRun"]>(
    async (startWave) => {
      const current = await latest();
      if (!current) {
        showMutationToast({ success: false, message: UNREADABLE_MESSAGE });
        return null;
      }
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
    ({ token, state }) =>
      exclusive(async () => {
        // Another tab holding the same run may have banked it already. Only device saves
        // can be resumed in two tabs; a host's cloud save keeps nothing on the device.
        const settledTokens = store.saveRuns ? readSettledTokens() : [];
        if (settledTokens.includes(token))
          return {
            settled: true,
            claimed: false,
            retryable: false,
            reloadRequired: false,
            points: 0,
            message: "This run was already banked in another tab.",
          };
        const current = await latest();
        // Banking onto progress that could not be read would overwrite the real save.
        if (!current)
          return {
            settled: false,
            claimed: false,
            retryable: true,
            reloadRequired: false,
            message: `${UNREADABLE_MESSAGE} The run is kept; try banking it again.`,
          };
        const settled = settleLocalRun(current, state);
        const isSaved = await keep(settled.progress);
        if (store.saveRuns)
          safeLocalStorageSetItem(
            SETTLED_KEY,
            JSON.stringify([...settledTokens, token].slice(-SETTLED_KEPT)),
          );
        if (isSaved) onBestWave?.(settled.progress.bestWave);
        return {
          settled: true,
          claimed: true,
          retryable: false,
          reloadRequired: false,
          points: settled.points,
          message: isSaved ? null : UNSAVED_MESSAGE,
        };
      }),
    [keep, latest, onBestWave, store.saveRuns],
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
    (upgradeId: TdDojoUpgrade) =>
      exclusive(async () => {
        const current = await latest();
        if (!current) {
          showMutationToast({ success: false, message: UNREADABLE_MESSAGE });
          return;
        }
        const result = buyLocalDojoLevel(current, upgradeId);
        if ("message" in result) {
          showMutationToast({ success: false, message: result.message });
          return;
        }
        if (!(await keep(result.progress)))
          showMutationToast({ success: false, message: UNSAVED_MESSAGE });
      }),
    [keep, latest],
  );

  return { ...session, progress, isLoaded, buyDojo };
};

/**
 * Run a read-change-write of progress while no other tab runs one, so two tabs cannot
 * each write a snapshot that drops the other's change. Browsers without Web Locks run it
 * directly.
 */
const exclusive = <T>(task: () => Promise<T>): Promise<T> =>
  typeof navigator !== "undefined" && navigator.locks
    ? navigator.locks.request(PROGRESS_LOCK, task)
    : task();

const readSettledTokens = (): string[] => {
  try {
    const value: unknown = JSON.parse(safeLocalStorageGetItem(SETTLED_KEY) ?? "[]");
    return Array.isArray(value)
      ? value.filter((token): token is string => typeof token === "string")
      : [];
  } catch {
    return [];
  }
};
