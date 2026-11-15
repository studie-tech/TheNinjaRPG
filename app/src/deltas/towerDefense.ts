import type { TdDojoUpgrade } from "@/libs/towerDefense/content";

/** The `towerDefense.getProgress` shape these patches apply to. */
export interface TowerDefenseProgress {
  points: number;
  bestWave: number;
  dojo: Partial<Record<TdDojoUpgrade, number>>;
}

/** Apply a confirmed Dojo purchase: the new level and the scrolls it cost. */
export const getDojoPurchaseUpdate =
  (upgradeId: TdDojoUpgrade, result: { level: number; pointsSpent: number }) =>
  (current: TowerDefenseProgress): TowerDefenseProgress => ({
    ...current,
    points: current.points - result.pointsSpent,
    dojo: { ...current.dojo, [upgradeId]: result.level },
  });

/** Apply a verified claim: scrolls earned and a best wave that only ever rises. */
export const getRunClaimUpdate =
  (result: { pointsEarned: number; wave: number }) =>
  (current: TowerDefenseProgress): TowerDefenseProgress => ({
    ...current,
    points: current.points + result.pointsEarned,
    bestWave: Math.max(current.bestWave, result.wave),
  });
