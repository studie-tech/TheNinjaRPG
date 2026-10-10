import { describe, expect, it } from "vitest";
import { MASTERY_RANKS, MASTERY_RANK_CAPS, MasteryNames, TOTAL_MASTERY_CAP } from "@/drizzle/constants";
import { allocateMasteryGains, canPromoteMastery, masteryGainRoom, masteryTotal } from "@/libs/masteryProgression";
import { masteryQuestTemplates } from "@/libs/masteryQuests";
import { jutsuMasteryTypes } from "@/libs/jutsuMastery";
import { isAvailableUserQuests, collapseRewards } from "@/libs/quest";
import { ObjectiveReward } from "@/validators/rewards";
import type { UserData } from "@/drizzle/schema";

const masteries = (value = 0) => Object.fromEntries(MasteryNames.map(stat => [stat, value]));
const user = (patch = {}) => ({ ...masteries(), masteryRanks: {}, role: "USER", level: 50, rank: "JONIN", completedQuests: [], ...patch }) as UserData & { completedQuests: [] };

describe("earned mastery progression", () => {
  it("requires each exam at the soft cap, including the final Legendary exam", () => {
    for (const [index, rank] of MASTERY_RANKS.entries()) {
      const u = user({ masteryRanks: { ninjutsuMastery: rank }, ninjutsuMastery: MASTERY_RANK_CAPS[rank] });
      expect(masteryGainRoom(u, "ninjutsuMastery")).toBe(0);
      if (index < MASTERY_RANKS.length - 1) expect(canPromoteMastery(u, "ninjutsuMastery", MASTERY_RANKS[index + 1]!)).toBe(true);
      expect(canPromoteMastery(u, "ninjutsuMastery", rank)).toBe(false);
    }
  });
  it("allocates only the remaining combined room without lowering legacy totals", () => {
    const u = user({ ...masteries(699999), masteryRanks: Object.fromEntries(MasteryNames.map(stat => [stat, "MASTER"])) });
    const gains = allocateMasteryGains(u, { ninjutsuMastery: 10, genjutsuMastery: 10 });
    expect(gains.ninjutsuMastery).toBe(6);
    expect(gains.genjutsuMastery).toBe(0);
    expect(masteryTotal(u)).toBe(TOTAL_MASTERY_CAP - 6);
    expect(allocateMasteryGains(user(masteries(1500000)), { ninjutsuMastery: 100 }).ninjutsuMastery).toBe(0);
  });
  it("gates exams with stored mastery and the next rank, including grandfathered users", () => {
    const templates = masteryQuestTemplates();
    const novice = { ...templates[0]!, hidden: false };
    expect(isAvailableUserQuests(novice, user({ ninjutsuMastery: 374999 })).check).toBe(false);
    expect(isAvailableUserQuests(novice, user({ ninjutsuMastery: 375000 })).check).toBe(true);
    expect(isAvailableUserQuests(novice, user({ ninjutsuMastery: 375000, baseStatsForModifiers: { ninjutsuMastery: 374999 } })).check).toBe(false);
    const master = { ...templates[2]!, hidden: false };
    expect(isAvailableUserQuests(master, user({ ninjutsuMastery: 1000000, masteryRanks: { ninjutsuMastery: "ADEPT" } })).check).toBe(true);
    expect(isAvailableUserQuests(master, user({ ninjutsuMastery: 1000000 })).check).toBe(false);
    expect(isAvailableUserQuests({ ...novice, previousAttempts: 1 }, user({ ninjutsuMastery: 375000 })).check).toBe(true);
  });
  it("provides four hidden editable templates per mastery without requiring legacy quest history", () => {
    const templates = masteryQuestTemplates();
    expect(templates).toHaveLength(MasteryNames.length * 4);
    expect(new Set(templates.map(t => t.id)).size).toBe(24);
    for (const template of templates) {
      expect(template.hidden).toBe(true);
      expect(template.prerequisiteQuestId).toBeNull();
      expect(template.content.objectives).toHaveLength(3);
    }
  });
  it("keeps discipline XP separate from sage-mode XP while collapsing rewards", () => {
    const reward = collapseRewards([ObjectiveReward.parse({ reward_sage_stat_experience: 30, reward_sage_mastery_experience: 10 }), ObjectiveReward.parse({ reward_sage_stat_experience: 20 })]);
    expect(reward.reward_sage_stat_experience).toBe(50);
    expect(reward.reward_sage_mastery_experience).toBe(10);
  });
  it("classifies bloodline and sage-gated jutsu without duplicate discipline credit", () => {
    expect(jutsuMasteryTypes({ statClassification: "Ninjutsu", bloodlineId: "bloodline", requiredNinjutsuMastery: 10, requiredSageMastery: 20 })).toEqual(["Ninjutsu", "Sage", "Bloodline"]);
  });
});
