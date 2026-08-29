import { describe, expect, it } from "vitest";
import { WORLD_CYCLE_SECONDS } from "@/drizzle/constants";
import {
  canWaterPlot,
  getExtractorCropCapacity,
  getFarmGrowTimeSeconds,
  getFarmHarvestExperience,
  getFarmPlantExperience,
  getFarmPlotStatus,
  getFarmPrimaryAction,
  getFarmQuantityPrice,
  getFertilizerExperience,
  getFarmingLevel,
  getFarmingLevelProgress,
  getMaxExtractors,
  getMaxPurchasablePlots,
  getPlotGrowthStage,
  getPvpFarmActivityReductionSeconds,
  getSeedExtractionDurationSeconds,
  getTotalFarmPlots,
  isPlotReady,
  qualifiesForFarmActivityReward,
  summarizeFarmPlots,
} from "@/libs/farming";
import { calcLevelRequirements } from "@/libs/profile";
import type { FarmPlotState } from "@/validators/farming";

describe("farming", () => {
  it("calculates farming level from experience", () => {
    for (const level of Array.from({ length: 100 }, (_, index) => index + 1)) {
      const threshold = level === 1 ? 0 : calcLevelRequirements(level - 1);
      expect(getFarmingLevel(threshold)).toBe(level);
      if (level > 1) expect(getFarmingLevel(threshold - 1)).toBe(level - 1);
    }
  });

  it("aligns farming level progress with the player experience curve", () => {
    const progress = getFarmingLevelProgress(650);
    expect(progress.level).toBe(2);
    expect(progress.expForCurrentLevel).toBe(500);
    expect(progress.expForNextLevel).toBe(1500);
    expect(progress.experienceIntoLevel).toBe(150);
    expect(progress.experienceNeededForLevel).toBe(1000);
    expect(progress.progress).toBeCloseTo(15, 0);
  });

  it("resets displayed farming XP at each new level", () => {
    const progress = getFarmingLevelProgress(7500);
    expect(progress.level).toBe(6);
    expect(progress.experienceIntoLevel).toBe(0);
    expect(progress.experienceNeededForLevel).toBe(3000);
    expect(progress.progress).toBe(0);
  });

  it("computes total plots from purchases", () => {
    expect(getTotalFarmPlots(0)).toBe(5);
    expect(getTotalFarmPlots(3)).toBe(8);
  });

  it("reduces Gold Fed grow time by 15 percent", () => {
    expect(
      getFarmGrowTimeSeconds(100, {
        staffAccount: false,
        federalStatus: "GOLD",
      }),
    ).toBe(85);
    expect(
      getFarmGrowTimeSeconds(101, {
        staffAccount: false,
        federalStatus: "GOLD",
      }),
    ).toBe(86);
  });

  it("does not reduce grow time for lower federal tiers", () => {
    for (const federalStatus of ["NONE", "NORMAL", "SILVER"] as const) {
      expect(
        getFarmGrowTimeSeconds(100, { staffAccount: false, federalStatus }),
      ).toBe(100);
    }
  });

  it("applies effective Gold benefits to staff accounts", () => {
    expect(
      getFarmGrowTimeSeconds(100, {
        staffAccount: true,
        federalStatus: "NONE",
      }),
    ).toBe(85);
  });

  it("spreads plot purchases across the full farming progression", () => {
    expect(getMaxPurchasablePlots(1)).toBe(0);
    Array.from({ length: 15 }, (_, index) => 10 + index * 6).forEach(
      (level, index) => {
        expect(getMaxPurchasablePlots(level - 1)).toBe(index);
        expect(getMaxPurchasablePlots(level)).toBe(index + 1);
      },
    );
    expect(getMaxPurchasablePlots(100)).toBe(15);
  });

  it("spreads extractor purchases across the full farming progression", () => {
    expect(getMaxExtractors(9)).toBe(0);
    expect(getMaxExtractors(10)).toBe(1);
    expect(getMaxExtractors(54)).toBe(1);
    expect(getMaxExtractors(55)).toBe(2);
    expect(getMaxExtractors(99)).toBe(2);
    expect(getMaxExtractors(100)).toBe(3);
  });

  it("allows each owned extractor to process ten crops", () => {
    expect(getExtractorCropCapacity(0)).toBe(0);
    expect(getExtractorCropCapacity(1)).toBe(10);
    expect(getExtractorCropCapacity(2)).toBe(20);
    expect(getExtractorCropCapacity(3)).toBe(30);
  });

  it("takes five minutes to extract each crop", () => {
    expect(getSeedExtractionDurationSeconds(1)).toBe(5 * 60);
    expect(getSeedExtractionDurationSeconds(5)).toBe(25 * 60);
  });

  it("rewards the specified activity mission completions", () => {
    expect(qualifiesForFarmActivityReward("errand", "D")).toBe(true);
    expect(qualifiesForFarmActivityReward("medical", "D")).toBe(true);
    expect(qualifiesForFarmActivityReward("pvp", "D")).toBe(true);
    expect(qualifiesForFarmActivityReward("war", "D")).toBe(true);

    for (const rank of ["D", "C", "B", "A", "S"] as const) {
      expect(qualifiesForFarmActivityReward("mission", rank)).toBe(true);
      expect(qualifiesForFarmActivityReward("crime", rank)).toBe(true);
    }
  });

  it("does not reward unrelated quests or H-rank missions and crimes", () => {
    expect(qualifiesForFarmActivityReward("mission", "H")).toBe(false);
    expect(qualifiesForFarmActivityReward("crime", "H")).toBe(false);
    expect(qualifiesForFarmActivityReward("hunting", "S")).toBe(false);
    expect(qualifiesForFarmActivityReward("achievement", "S")).toBe(false);
  });

  it("rewards completed human COMBAT and ranked PvP battles based on outcome", () => {
    expect(getPvpFarmActivityReductionSeconds("COMBAT", "Won", true)).toBe(90);
    expect(getPvpFarmActivityReductionSeconds("COMBAT", "Lost", true)).toBe(60);
    expect(getPvpFarmActivityReductionSeconds("COMBAT", "Draw", true)).toBe(60);
    expect(getPvpFarmActivityReductionSeconds("RANKED_PVP", "Won", true)).toBe(
      90,
    );
    expect(getPvpFarmActivityReductionSeconds("RANKED_PVP", "Lost", true)).toBe(
      60,
    );
    expect(getPvpFarmActivityReductionSeconds("RANKED_PVP", "Draw", true)).toBe(
      60,
    );
  });

  it("does not reward fleeing, other battle types, or AI-only battles", () => {
    expect(getPvpFarmActivityReductionSeconds("COMBAT", "Fled", true)).toBe(0);
    expect(getPvpFarmActivityReductionSeconds("ARENA", "Won", true)).toBe(0);
    expect(getPvpFarmActivityReductionSeconds("SPARRING", "Won", true)).toBe(0);
    expect(getPvpFarmActivityReductionSeconds("KAGE_AI", "Won", true)).toBe(0);
    expect(getPvpFarmActivityReductionSeconds("COMBAT", "Won", false)).toBe(0);
  });

  it("detects ready plots and growth stages", () => {
    const plantedAt = new Date("2026-01-01T00:00:00Z");
    const finishAt = new Date("2026-01-01T02:00:00Z");
    const mid = new Date("2026-01-01T01:00:00Z");

    expect(isPlotReady(finishAt, new Date("2026-01-01T03:00:00Z"))).toBe(true);
    expect(getPlotGrowthStage(plantedAt, finishAt, mid)).toBeGreaterThan(0);
  });

  it("allows one watering per day cycle", () => {
    const cycleMs = WORLD_CYCLE_SECONDS * 1000;
    const dayCycleStart = new Date(cycleMs * 10);
    const wateredAt = new Date(dayCycleStart.getTime() + 10 * 60 * 1000);
    const sameCycle = new Date(dayCycleStart.getTime() + 20 * 60 * 1000);
    const nextCycle = new Date(dayCycleStart.getTime() + cycleMs);

    expect(canWaterPlot(wateredAt, sameCycle)).toBe(false);
    expect(canWaterPlot(null, sameCycle)).toBe(true);
    expect(canWaterPlot(wateredAt, nextCycle)).toBe(true);
  });

  it("uses crop harvest xp only", () => {
    expect(getFarmHarvestExperience({ farmHarvestExperience: 200 })).toBe(200);
    expect(getFarmHarvestExperience({ farmHarvestExperience: 0 })).toBe(0);
  });

  it("uses seed plant xp without affecting harvest xp field on crop", () => {
    expect(
      getFarmPlantExperience({ farmPlantExperience: 10, farmHarvestExperience: 0 }),
    ).toBe(10);
    expect(
      getFarmPlantExperience({ farmPlantExperience: 0, farmHarvestExperience: 10 }),
    ).toBe(10);
    expect(
      getFarmPlantExperience({ farmPlantExperience: 0, farmHarvestExperience: 0 }),
    ).toBe(0);
  });

  it("uses fertilizer apply xp from item config", () => {
    expect(getFertilizerExperience({ farmFertilizerExperience: 25 })).toBe(25);
    expect(getFertilizerExperience({ farmFertilizerExperience: 0 })).toBe(0);
  });

  it("summarizes empty, growing, ready, and waterable plots", () => {
    const now = new Date("2026-01-01T01:00:00Z");
    const plot = (patch: Partial<FarmPlotState>): FarmPlotState => ({
      id: `plot-${patch.slotIndex ?? 0}`,
      slotIndex: patch.slotIndex ?? 0,
      seedItemId: null,
      seedName: null,
      cropName: null,
      cropImage: null,
      plantedAt: null,
      finishAt: null,
      lastWateredAt: null,
      fertilizerApplied: false,
      isReady: false,
      canWater: false,
      nextWateringAt: null,
      growthProgress: 0,
      growthStage: 0,
      ...patch,
    });
    const plots = [
      plot({ slotIndex: 0 }),
      plot({
        slotIndex: 1,
        seedItemId: "seed",
        plantedAt: new Date("2026-01-01T00:00:00Z"),
        finishAt: new Date("2026-01-01T02:00:00Z"),
      }),
      plot({
        slotIndex: 2,
        seedItemId: "seed",
        plantedAt: new Date("2025-12-31T22:00:00Z"),
        finishAt: new Date("2026-01-01T00:30:00Z"),
      }),
    ];

    expect(summarizeFarmPlots(plots, now)).toEqual({
      empty: 1,
      growing: 1,
      ready: 1,
      waterable: 1,
      fertilizable: 1,
    });
    expect(getFarmPlotStatus(plots[2]!, now)).toBe("ready");
    expect(getFarmPrimaryAction(plots[2]!, false, now)).toBe("harvest");
  });

  it("validates quantity pricing without producing partial prices", () => {
    expect(getFarmQuantityPrice(25, 4)).toBe(100);
    expect(getFarmQuantityPrice(25, 0)).toBe(0);
    expect(getFarmQuantityPrice(25, 1.5)).toBe(0);
  });
});
