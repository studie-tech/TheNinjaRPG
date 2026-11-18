import {
  TD_DOJO,
  type TdDojoLevels,
  type TdDojoUpgrade,
} from "@/libs/towerDefense/content";
import { type TdState, tdDojoPurchase, tdRunPoints } from "@/libs/towerDefense/sim";

/**
 * Tower defense progress a standalone build keeps on the player's device: the scrolls
 * banked from finished runs, the furthest wave reached and the Guard Hall levels bought.
 */
export interface TdLocalProgress {
  points: number;
  bestWave: number;
  dojo: TdDojoLevels;
}

export const TD_EMPTY_LOCAL_PROGRESS: TdLocalProgress = {
  points: 0,
  bestWave: 0,
  dojo: {},
};

/** Read stored progress, keeping only valid numbers and known upgrades. */
export const parseLocalProgress = (raw: string | null): TdLocalProgress => {
  if (!raw) return TD_EMPTY_LOCAL_PROGRESS;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return TD_EMPTY_LOCAL_PROGRESS;
    const { points, bestWave, dojo } = value as Record<string, unknown>;
    const levels: TdDojoLevels = {};
    if (dojo && typeof dojo === "object")
      for (const id of TD_DOJO) {
        const level = (dojo as Record<string, unknown>)[id];
        if (typeof level === "number" && Number.isFinite(level) && level > 0)
          levels[id] = Math.floor(level);
      }
    return {
      points: wholeOrZero(points),
      bestWave: wholeOrZero(bestWave),
      dojo: levels,
    };
  } catch {
    return TD_EMPTY_LOCAL_PROGRESS;
  }
};

/** Bank a finished run: its scrolls join the total and its wave may become the best. */
export const settleLocalRun = (
  progress: TdLocalProgress,
  state: TdState,
): { progress: TdLocalProgress; points: number } => {
  const points = tdRunPoints(state);
  return {
    points,
    progress: {
      ...progress,
      points: progress.points + points,
      bestWave: Math.max(progress.bestWave, state.wave),
    },
  };
};

/** Buy the next Guard Hall level with banked scrolls, under the server's own rules. */
export const buyLocalDojoLevel = (
  progress: TdLocalProgress,
  upgradeId: TdDojoUpgrade,
): { progress: TdLocalProgress; level: number } | { message: string } => {
  const purchase = tdDojoPurchase({
    upgradeId,
    level: progress.dojo[upgradeId] ?? 0,
    bestWave: progress.bestWave,
    points: progress.points,
  });
  if ("message" in purchase) return purchase;
  return {
    level: purchase.level,
    progress: {
      ...progress,
      points: progress.points - purchase.cost,
      dojo: { ...progress.dojo, [upgradeId]: purchase.level },
    },
  };
};

const wholeOrZero = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
