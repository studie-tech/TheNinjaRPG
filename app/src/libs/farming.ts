import {
  type BattleType,
  FARM_CROPS_PER_EXTRACTOR,
  FARM_GOLD_FED_TIME_REDUCTION_PERCENT,
  FARM_GROWTH_STAGES,
  FARM_LEVEL_EXTRACTOR_CAP,
  FARM_MAX_PLOTS,
  FARM_PLOT_PURCHASE_LEVEL_INTERVAL,
  FARM_PLOT_PURCHASE_MIN_LEVEL,
  FARM_PVP_LOSS_TIME_REDUCTION_SECONDS,
  FARM_PVP_WIN_TIME_REDUCTION_SECONDS,
  FARM_SEED_EXTRACTION_SECONDS_PER_CROP,
  FARM_STARTING_PLOTS,
  FARM_WATER_TIME_REDUCTION_SECONDS,
  FARMING_MAX_LEVEL,
  type LetterRank,
  type QuestType,
  WORLD_CYCLE_SECONDS,
} from "@/drizzle/constants";
import type { FarmPlot, Item, UserData } from "@/drizzle/schema";
import { getWorldDayCycleIndex } from "@/libs/dayNight";
import { calcLevelRequirements } from "@/libs/profile";
import { getUserFederalStatus } from "@/utils/paypal";
import type { FarmPlotState } from "@/validators/farming";

export {
  getWorldCycleBrightness as getFarmCycleBrightness,
  getWorldCycleState as getFarmCycleState,
  getWorldDayCycleIndex as getFarmDayCycleIndex,
} from "@/libs/dayNight";

const FARMING_LEVEL_XP_THRESHOLDS = Array.from(
  { length: FARMING_MAX_LEVEL - 1 },
  (_, index) => calcLevelRequirements(index + 1),
);

export const getFarmingLevel = (experience: number) => {
  const normalizedExperience = Number.isFinite(experience)
    ? Math.max(0, experience)
    : 0;
  const nextLevelIndex = FARMING_LEVEL_XP_THRESHOLDS.findIndex(
    (requiredExperience) => normalizedExperience < requiredExperience,
  );
  return nextLevelIndex === -1 ? FARMING_MAX_LEVEL : nextLevelIndex + 1;
};

export const getFarmingLevelProgress = (experience: number) => {
  const level = getFarmingLevel(experience);
  if (level >= FARMING_MAX_LEVEL) {
    return {
      level,
      progress: 100,
      expForCurrentLevel: calcLevelRequirements(FARMING_MAX_LEVEL - 1),
      expForNextLevel: null,
      experienceIntoLevel: 0,
      experienceNeededForLevel: null,
    };
  }
  const expForCurrentLevel = level === 1 ? 0 : calcLevelRequirements(level - 1);
  const expForNextLevel = calcLevelRequirements(level);
  const experienceNeededForLevel = expForNextLevel - expForCurrentLevel;
  const experienceIntoLevel = Math.max(
    0,
    Math.min(experienceNeededForLevel, experience - expForCurrentLevel),
  );
  const progress = (experienceIntoLevel / experienceNeededForLevel) * 100;
  return {
    level,
    progress: Math.max(0, Math.min(100, progress)),
    expForCurrentLevel,
    expForNextLevel,
    experienceIntoLevel,
    experienceNeededForLevel,
  };
};

const getCapForLevel = (
  tiers: { level: number; max: number }[],
  farmingLevel: number,
) => {
  let cap = 0;
  for (const tier of tiers) {
    if (farmingLevel >= tier.level) {
      cap = tier.max;
    }
  }
  return cap;
};

export const getMaxPurchasablePlots = (farmingLevel: number) => {
  if (farmingLevel < FARM_PLOT_PURCHASE_MIN_LEVEL) return 0;
  const unlockedPlots =
    Math.floor(
      (farmingLevel - FARM_PLOT_PURCHASE_MIN_LEVEL) / FARM_PLOT_PURCHASE_LEVEL_INTERVAL,
    ) + 1;
  return Math.min(FARM_MAX_PLOTS - FARM_STARTING_PLOTS, unlockedPlots);
};

export const getMaxExtractors = (farmingLevel: number) =>
  getCapForLevel(FARM_LEVEL_EXTRACTOR_CAP, farmingLevel);

export const getExtractorCropCapacity = (extractorsOwned: number) =>
  Math.max(0, Math.floor(extractorsOwned)) * FARM_CROPS_PER_EXTRACTOR;

export const getSeedExtractionDurationSeconds = (cropQuantity: number) =>
  Math.max(0, Math.floor(cropQuantity)) * FARM_SEED_EXTRACTION_SECONDS_PER_CROP;

export const getTotalFarmPlots = (farmPlotsPurchased: number) =>
  Math.min(FARM_STARTING_PLOTS + farmPlotsPurchased, FARM_MAX_PLOTS);

export const getFarmGrowTimeSeconds = (
  baseGrowTimeSeconds: number,
  user: Pick<UserData, "staffAccount" | "federalStatus">,
) => {
  const multiplier =
    getUserFederalStatus(user) === "GOLD"
      ? 1 - FARM_GOLD_FED_TIME_REDUCTION_PERCENT / 100
      : 1;
  return Math.max(1, Math.ceil(baseGrowTimeSeconds * multiplier));
};

export const qualifiesForFarmActivityReward = (
  questType: QuestType,
  questRank?: LetterRank | null,
) => {
  if (["errand", "medical", "pvp", "war"].includes(questType)) return true;
  if (!["mission", "crime"].includes(questType)) return false;
  return (["D", "C", "B", "A", "S"] as const).some((rank) => rank === questRank);
};

export const getPvpFarmActivityReductionSeconds = (
  battleType: BattleType,
  outcome: "Won" | "Lost" | "Draw" | "Fled",
  hasHumanOpponent: boolean,
) => {
  if (!hasHumanOpponent || !["COMBAT", "RANKED_PVP"].includes(battleType)) {
    return 0;
  }
  if (outcome === "Won") return FARM_PVP_WIN_TIME_REDUCTION_SECONDS;
  if (["Lost", "Draw"].includes(outcome)) {
    return FARM_PVP_LOSS_TIME_REDUCTION_SECONDS;
  }
  return 0;
};

export const getNextWateringAt = (
  lastWateredAt: Date | null | undefined,
  now = new Date(),
) => {
  if (!lastWateredAt) return null;
  if (canWaterPlot(lastWateredAt, now)) return null;
  return new Date(
    (getWorldDayCycleIndex(lastWateredAt) + 1) * WORLD_CYCLE_SECONDS * 1000,
  );
};

export const canWaterPlot = (
  lastWateredAt: Date | null | undefined,
  now = new Date(),
) => {
  if (!lastWateredAt) return true;
  return getWorldDayCycleIndex(now) > getWorldDayCycleIndex(lastWateredAt);
};

export const getWaterCooldownRemainingSeconds = (
  lastWateredAt: Date | null | undefined,
  now = new Date(),
) => {
  const nextWateringAt = getNextWateringAt(lastWateredAt, now);
  if (!nextWateringAt) return 0;
  return Math.max(0, (nextWateringAt.getTime() - now.getTime()) / 1000);
};

export const isPlotReady = (finishAt: Date | null | undefined, now = new Date()) =>
  !!finishAt && finishAt.getTime() <= now.getTime();

export const getPlotGrowthProgress = (
  plantedAt: Date | null | undefined,
  finishAt: Date | null | undefined,
  now = new Date(),
) => {
  if (!plantedAt || !finishAt) return 0;
  const total = finishAt.getTime() - plantedAt.getTime();
  if (total <= 0) return 100;
  const elapsed = now.getTime() - plantedAt.getTime();
  return Math.max(0, Math.min(100, (elapsed / total) * 100));
};

export const getPlotGrowthStage = (
  plantedAt: Date | null | undefined,
  finishAt: Date | null | undefined,
  now = new Date(),
) => {
  if (!plantedAt || !finishAt) return 0;
  if (isPlotReady(finishAt, now)) return FARM_GROWTH_STAGES;
  const progress = getPlotGrowthProgress(plantedAt, finishAt, now);
  const stage = Math.ceil((progress / 100) * FARM_GROWTH_STAGES);
  return Math.max(1, Math.min(FARM_GROWTH_STAGES, stage));
};

export type FarmPlotStatus = "empty" | "growing" | "ready";

export const getFarmPlotStatus = (
  plot: Pick<FarmPlotState, "seedItemId" | "finishAt">,
  now = new Date(),
): FarmPlotStatus => {
  if (!plot.seedItemId) return "empty";
  return isPlotReady(plot.finishAt, now) ? "ready" : "growing";
};

export const summarizeFarmPlots = (plots: FarmPlotState[], now = new Date()) => {
  const summary = { ready: 0, growing: 0, empty: 0, waterable: 0 };
  for (const plot of plots) {
    const status = getFarmPlotStatus(plot, now);
    summary[status] += 1;
    if (status === "growing" && canWaterPlot(plot.lastWateredAt, now)) {
      summary.waterable += 1;
    }
  }
  return summary;
};

type FarmBulkToolAvailabilityInput = {
  selectedSeedId: string;
  selectedFertilizerId: string;
  emptyCount: number;
  waterableCount: number;
  fertilizableCount: number;
  readyCount: number;
  pending: boolean;
};

export const getFarmBulkToolAvailability = ({
  selectedSeedId,
  selectedFertilizerId,
  emptyCount,
  waterableCount,
  fertilizableCount,
  readyCount,
  pending,
}: FarmBulkToolAvailabilityInput) => ({
  canPlantAll: !pending && !!selectedSeedId && emptyCount > 0,
  canWaterAll: !pending && waterableCount > 0,
  canFertilizeAll: !pending && !!selectedFertilizerId && fertilizableCount > 0,
  canHarvestAll: !pending && readyCount > 0,
});

export type FarmPrimaryAction = "plant" | "water" | "fertilize" | "harvest";

export const getFarmPrimaryAction = (
  plot: FarmPlotState,
  hasFertilizer: boolean,
  now = new Date(),
): FarmPrimaryAction => {
  const status = getFarmPlotStatus(plot, now);
  if (status === "empty") return "plant";
  if (status === "ready") return "harvest";
  if (canWaterPlot(plot.lastWateredAt, now)) return "water";
  if (!plot.fertilizerApplied && hasFertilizer) return "fertilize";
  return "water";
};

export const getFarmQuantityPrice = (unitPrice: number, quantity: number) => {
  if (!Number.isInteger(quantity) || quantity < 1) return 0;
  return unitPrice * quantity;
};

export const patchFarmPlot = (plots: FarmPlotState[], updatedPlot: FarmPlotState) =>
  plots.map((plot) => (plot.id === updatedPlot.id ? updatedPlot : plot));

export const applyWaterReduction = (finishAt: Date, now = new Date()) =>
  new Date(
    Math.max(
      now.getTime(),
      finishAt.getTime() - FARM_WATER_TIME_REDUCTION_SECONDS * 1000,
    ),
  );

export const applyFertilizerReduction = (
  finishAt: Date,
  reductionSeconds: number,
  now = new Date(),
) => new Date(Math.max(now.getTime(), finishAt.getTime() - reductionSeconds * 1000));

export type FarmPlotWithSeed = FarmPlot & {
  seedItem?: Item | null;
  yieldItem?: Item | null;
};

export const mapPlotToState = (
  plot: FarmPlotWithSeed,
  now = new Date(),
): FarmPlotState => {
  const finishAt = plot.finishAt ?? null;
  const plantedAt = plot.plantedAt ?? null;
  const isActive = !!plot.seedItemId && !!plantedAt && !!finishAt;
  const canWater =
    isActive && !isPlotReady(finishAt, now) && canWaterPlot(plot.lastWateredAt, now);
  return {
    id: plot.id,
    slotIndex: plot.slotIndex,
    seedItemId: plot.seedItemId ?? null,
    seedName: plot.seedItem?.name ?? null,
    cropName: plot.yieldItem?.name ?? plot.seedItem?.name ?? null,
    cropImage: plot.yieldItem?.image ?? plot.seedItem?.image ?? null,
    plantedAt,
    finishAt,
    lastWateredAt: plot.lastWateredAt ?? null,
    fertilizerApplied: plot.fertilizerApplied,
    isReady: isActive && isPlotReady(finishAt, now),
    canWater,
    nextWateringAt: canWater ? null : getNextWateringAt(plot.lastWateredAt, now),
    growthProgress: isActive ? getPlotGrowthProgress(plantedAt, finishAt, now) : 0,
    growthStage: isActive ? getPlotGrowthStage(plantedAt, finishAt, now) : 0,
    growTimeSeconds: plot.seedItem?.farmGrowTimeSeconds ?? 0,
    yieldQuantity: 1,
    plantExperience: plot.seedItem ? getFarmPlantExperience(plot.seedItem) : 0,
    harvestExperience: plot.yieldItem ? getFarmHarvestExperience(plot.yieldItem) : 0,
  };
};

export const getFarmPlantExperience = (
  seedItem: Pick<Item, "farmPlantExperience" | "farmHarvestExperience">,
) => {
  const plantXp = Number(seedItem.farmPlantExperience) || 0;
  const legacyPlantXp = Number(seedItem.farmHarvestExperience) || 0;
  if (plantXp > 0) return plantXp;
  if (legacyPlantXp > 0) return legacyPlantXp;
  return 0;
};

export const getFarmHarvestExperience = (
  yieldItem: Pick<Item, "farmHarvestExperience">,
) => {
  const harvestXp = Number(yieldItem.farmHarvestExperience) || 0;
  return harvestXp > 0 ? harvestXp : 0;
};

export const getFertilizerExperience = (
  fertilizerItem: Pick<Item, "farmFertilizerExperience">,
) => {
  const applyXp = Number(fertilizerItem.farmFertilizerExperience) || 0;
  return applyXp > 0 ? applyXp : 0;
};
