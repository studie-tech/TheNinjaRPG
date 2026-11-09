import { describe, expect, it } from "bun:test";
import {
  MASTERY_RANK_CAPS,
  MASTERY_RANKS,
  MasteryNames,
  TOTAL_MASTERY_CAP,
} from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import { jutsuMasteryTypes } from "@/libs/jutsuMastery";
import {
  allocateMasteryGains,
  canPromoteMastery,
  masteryGainRoom,
  masteryTotal,
} from "@/libs/masteryProgression";
import { isAvailableUserQuests } from "@/libs/quest/availability";
import { collapseRewards } from "@/libs/rewards";
import { QuestReward } from "@/validators/rewardPackages";
import { ObjectiveReward } from "@/validators/rewards";
import { masteryQuestTemplates } from "../setup/mastery";

const masteries = (value = 0) =>
  Object.fromEntries(MasteryNames.map((stat) => [stat, value]));
const user = (patch = {}) =>
  ({
    ...masteries(),
    masteryRanks: {},
    role: "USER",
    level: 50,
    rank: "JONIN",
    completedQuests: [],
    ...patch,
  }) as UserData & { completedQuests: [] };

describe("earned mastery progression", () => {
  it("stops gains at the current rank cap and allows only the next promotion", () => {
    for (const [index, rank] of MASTERY_RANKS.entries()) {
      const player = user({
        masteryRanks: { ninjutsuMastery: rank },
        ninjutsuMastery: MASTERY_RANK_CAPS[rank],
      });
      expect(masteryGainRoom(player, "ninjutsuMastery")).toBe(0);
      if (index < MASTERY_RANKS.length - 1)
        expect(
          canPromoteMastery(player, "ninjutsuMastery", MASTERY_RANKS[index + 1]!),
        ).toBe(true);
      expect(canPromoteMastery(player, "ninjutsuMastery", rank)).toBe(false);
    }
  });
  it("allocates only the remaining combined room without lowering legacy totals", () => {
    const player = user({
      ...masteries(699999),
      masteryRanks: Object.fromEntries(MasteryNames.map((stat) => [stat, "MASTER"])),
    });
    const gains = allocateMasteryGains(player, {
      ninjutsuMastery: 10,
      genjutsuMastery: 10,
    });
    expect(gains.ninjutsuMastery).toBe(6);
    expect(gains.genjutsuMastery).toBe(0);
    expect(masteryTotal(player)).toBe(TOTAL_MASTERY_CAP - 6);
    expect(
      allocateMasteryGains(user(masteries(1500000)), { ninjutsuMastery: 100 })
        .ninjutsuMastery,
    ).toBe(0);
  });
  it("gates exams with stored mastery and the next rank, including grandfathered users", () => {
    const templates = masteryQuestTemplates();
    const novice = { ...templates[0]!, hidden: false };
    expect(isAvailableUserQuests(novice, user({ ninjutsuMastery: 374999 })).check).toBe(
      false,
    );
    expect(isAvailableUserQuests(novice, user({ ninjutsuMastery: 375000 })).check).toBe(
      true,
    );
    expect(
      isAvailableUserQuests(
        novice,
        user({
          ninjutsuMastery: 375000,
          baseStatsForModifiers: { ninjutsuMastery: 374999 },
        }),
      ).check,
    ).toBe(false);
    const master = { ...templates[2]!, hidden: false };
    expect(
      isAvailableUserQuests(
        master,
        user({ ninjutsuMastery: 1000000, masteryRanks: { ninjutsuMastery: "ADEPT" } }),
      ).check,
    ).toBe(true);
    expect(
      isAvailableUserQuests(master, user({ ninjutsuMastery: 1000000 })).check,
    ).toBe(false);
    expect(
      isAvailableUserQuests(
        { ...novice, previousAttempts: 1 },
        user({ ninjutsuMastery: 375000 }),
      ).check,
    ).toBe(true);
  });
  it("uses configured minimums for rank rewards instead of adding an implicit soft cap gate", () => {
    const adept = {
      ...masteryQuestTemplates()[1]!,
      hidden: false,
      questType: "event" as const,
      requiredNinjutsuMastery: 500000,
    };
    const novice = user({
      ninjutsuMastery: 599999.85,
      masteryRanks: { ninjutsuMastery: "NOVICE" },
    });
    expect(isAvailableUserQuests(adept, novice).check).toBe(true);
    expect(
      isAvailableUserQuests(adept, { ...novice, ninjutsuMastery: 499999 }).check,
    ).toBe(false);
    expect(
      isAvailableUserQuests(
        adept,
        user({ ...novice, baseStatsForModifiers: { ninjutsuMastery: 499999 } }),
      ).check,
    ).toBe(false);
    expect(
      isAvailableUserQuests(
        { ...adept, requiredNinjutsuMastery: 0 },
        { ...novice, ninjutsuMastery: 0 },
      ).check,
    ).toBe(true);
    expect(
      isAvailableUserQuests(adept, {
        ...novice,
        masteryRanks: { ninjutsuMastery: "ADEPT" },
      }).check,
    ).toBe(false);
    expect(isAvailableUserQuests(adept, { ...novice, masteryRanks: {} }).check).toBe(
      false,
    );
  });
  it("applies the same predecessor and configured minimum gates to packaged promotions", () => {
    const template = masteryQuestTemplates()[1]!;
    const direct = { ...template, hidden: false, requiredNinjutsuMastery: 0 };
    const packaged = {
      ...direct,
      content: {
        ...direct.content,
        reward: QuestReward.parse({
          reward_packages: [
            {
              id: "adept-snapshot",
              packageId: "adept-package",
              name: "Adept promotion",
              description: "",
              rewards: direct.content.reward,
            },
          ],
        }),
      },
    };
    for (const rank of ["NONE", "NOVICE", "ADEPT", "MASTER"] as const) {
      const player = user({ masteryRanks: { ninjutsuMastery: rank } });
      const result = isAvailableUserQuests(packaged, player);
      expect(result).toEqual(isAvailableUserQuests(direct, player));
      expect(result.check).toBe(rank === "NOVICE");
      if (rank !== "NOVICE") expect(result.message).toContain("previous mastery rank");
    }
    expect(
      isAvailableUserQuests(
        { ...packaged, requiredNinjutsuMastery: 500000 },
        user({ ninjutsuMastery: 499999, masteryRanks: { ninjutsuMastery: "NOVICE" } }),
      ).check,
    ).toBe(false);
    expect(
      isAvailableUserQuests(
        { ...packaged, requiredNinjutsuMastery: 500000 },
        user({
          ninjutsuMastery: 599999.85,
          masteryRanks: { ninjutsuMastery: "NOVICE" },
          baseStatsForModifiers: { ninjutsuMastery: 499999 },
        }),
      ).check,
    ).toBe(false);
  });
  it("checks the promotion selected by completion's direct and package merge order", () => {
    const template = masteryQuestTemplates()[1]!;
    const rewards = [
      ObjectiveReward.parse({
        reward_mastery_stat: "genjutsuMastery",
        reward_mastery_rank: "NOVICE",
      }),
      template.content.reward,
      ObjectiveReward.parse({ reward_money: 10 }),
    ];
    const packaged = {
      ...template,
      hidden: false,
      requiredNinjutsuMastery: 0,
      content: {
        ...template.content,
        reward: QuestReward.parse({
          reward_mastery_stat: "ninjutsuMastery",
          reward_mastery_rank: "MASTER",
          reward_packages: rewards.map((reward, index) => ({
            id: `snapshot-${index}`,
            packageId: `package-${index}`,
            name: "Promotion package",
            description: "",
            rewards: reward,
          })),
        }),
      },
    };
    expect(
      isAvailableUserQuests(
        packaged,
        user({
          masteryRanks: { ninjutsuMastery: "NOVICE", genjutsuMastery: "NOVICE" },
        }),
      ).check,
    ).toBe(true);
    expect(
      isAvailableUserQuests(
        packaged,
        user({ masteryRanks: { ninjutsuMastery: "ADEPT" } }),
      ).check,
    ).toBe(false);
  });

  it("keeps alternative choice promotions out of the fixed completion gate", () => {
    const template = masteryQuestTemplates()[1]!;
    const packages = ["ninjutsuMastery", "genjutsuMastery"].map((stat) => ({
      id: stat,
      packageId: stat,
      name: stat,
      description: "",
      rewards: ObjectiveReward.parse({
        reward_mastery_stat: stat,
        reward_mastery_rank: "ADEPT",
      }),
    }));
    const player = user({ masteryRanks: { genjutsuMastery: "NOVICE" } });
    const choice = {
      ...template,
      hidden: false,
      requiredNinjutsuMastery: 0,
      content: {
        ...template.content,
        rewardMode: "choose" as const,
        reward: QuestReward.parse({ reward_packages: packages }),
      },
    };
    for (const alternatives of [packages, [...packages].reverse()]) {
      const quest = {
        ...choice,
        content: {
          ...choice.content,
          reward: QuestReward.parse({ reward_packages: alternatives }),
        },
      };
      expect(isAvailableUserQuests(quest, player).check).toBe(true);
      const fixed = {
        ...quest,
        content: {
          ...quest.content,
          reward: QuestReward.parse({
            reward_mastery_stat: "ninjutsuMastery",
            reward_mastery_rank: "ADEPT",
            reward_packages: alternatives,
          }),
        },
      };
      expect(isAvailableUserQuests(fixed, player).check).toBe(false);
      expect(
        isAvailableUserQuests(
          fixed,
          user({ masteryRanks: { ninjutsuMastery: "NOVICE" } }),
        ).check,
      ).toBe(true);
    }
  });

  it("keeps discipline XP separate from sage-mode XP while collapsing rewards", () => {
    const reward = collapseRewards([
      ObjectiveReward.parse({
        reward_sage_stat_experience: 30,
        reward_sage_mastery_experience: 10,
      }),
      ObjectiveReward.parse({ reward_sage_stat_experience: 20 }),
    ]);
    expect(reward.reward_sage_stat_experience).toBe(50);
    expect(reward.reward_sage_mastery_experience).toBe(10);
  });
  it("classifies bloodline and sage-gated jutsu without duplicate discipline credit", () => {
    expect(
      jutsuMasteryTypes({
        statClassification: "Ninjutsu",
        bloodlineId: "bloodline",
        requiredNinjutsuMastery: 10,
        requiredSageMastery: 20,
      }),
    ).toEqual(["Ninjutsu", "Sage", "Bloodline"]);
  });
});
