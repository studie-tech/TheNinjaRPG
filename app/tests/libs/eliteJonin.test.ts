import { describe, expect, it } from "bun:test";
import { getUserCaps, MAX_PLAYER_LEVEL } from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import {
  eliteJoninMilestoneBlockMessage,
  eliteJoninMilestoneUpdate,
} from "@/libs/eliteJonin";
import { calcJutsuEquipLimit } from "@/libs/jutsuRequirements";
import {
  calcHP,
  canAssignExperience,
  canAttackBracket,
  eliteJoninExamBlockMessage,
  experienceAssignmentBlockMessage,
  getEffectiveLevel,
  getExpBracket,
  levelUpBlockMessage,
  passesBracketFilter,
} from "@/libs/profile";
import { isAvailableUserQuests } from "@/libs/quest/availability";
import { getReward } from "@/libs/quest/rewards";
import { ItemValidator, JutsuValidator } from "@/validators/combat";
import { QuestFormSchema, QuestValidator } from "@/validators/objectives";
import { bracketSliderSchema } from "@/validators/travel";

const cappedJonin = {
  rank: "JONIN",
  level: 100,
  experience: 999_999_999,
  offence: 1_300_000,
  defence: 1_300_000,
  strength: 400_000,
  speed: 400_000,
  intelligence: 400_000,
  willpower: 400_000,
} as UserData;
const milestone = () =>
  QuestValidator.parse({
    name: "Elite Jonin milestone",
    description: "Complete the objective",
    successDescription: "Complete",
    questType: "starter",
    requiredLevel: 100,
    maxLevel: 100,
    maxCompletes: 1,
    retryDelay: "none",
    content: { objectives: [], reward: { reward_level: 101, reward_stats: 20_000 } },
    hidden: false,
    consecutiveObjectives: false,
    endsAt: null,
    startsAt: null,
    tierLevel: null,
  });

describe("Elite Jonin progression", () => {
  it("raises only Elite Jonin rank caps and adds exactly one jutsu slot", () => {
    expect(getUserCaps("JONIN")).toEqual({
      stats_cap: 1_300_000,
      gens_cap: 400_000,
      lvl_cap: 100,
    });
    expect(getUserCaps("CHUNIN")).toEqual(getUserCaps("JONIN"));
    expect(getUserCaps("ELDER")).toEqual(getUserCaps("JONIN"));
    expect(getUserCaps("ELITE JONIN")).toEqual({
      stats_cap: 1_500_000,
      gens_cap: 600_000,
      lvl_cap: 110,
    });
    const slots = {
      staffAccount: false,
      extraJutsuSlots: 0,
      federalStatus: "NONE" as const,
    };
    expect(calcJutsuEquipLimit({ ...slots, rank: "ELITE JONIN" })).toBe(
      calcJutsuEquipLimit({ ...slots, rank: "JONIN" }) + 1,
    );
  });
  it("requires every stored combat stat to be capped for the exam", () => {
    expect(eliteJoninExamBlockMessage(cappedJonin)).toBeNull();
    for (const stat of [
      "offence",
      "defence",
      "strength",
      "speed",
      "intelligence",
      "willpower",
    ] as const)
      expect(
        eliteJoninExamBlockMessage({ ...cappedJonin, [stat]: cappedJonin[stat] - 1 }),
      ).not.toBeNull();
    expect(
      eliteJoninExamBlockMessage({ ...cappedJonin, rank: "CHUNIN" }),
    ).not.toBeNull();
    expect(
      eliteJoninExamBlockMessage({ ...cappedJonin, rank: "ELDER" }),
    ).not.toBeNull();
    expect(eliteJoninExamBlockMessage({ ...cappedJonin, level: 99 })).not.toBeNull();
    expect(eliteJoninExamBlockMessage({ ...cappedJonin, level: 101 })).not.toBeNull();
  });
  it("blocks all unused XP assignment for Elite Jonin even with stat capacity", () => {
    const elite = { ...cappedJonin, rank: "ELITE JONIN" as const };
    expect(canAssignExperience(elite)).toBe(false);
    expect(experienceAssignmentBlockMessage(elite)).toContain(
      "cannot assign experience",
    );
    expect(experienceAssignmentBlockMessage(cappedJonin)).toBeNull();
  });
  it("keeps ordinary level-100 quests available throughout Elite progression", () => {
    const quest = { ...milestone(), content: { objectives: [], reward: {} } };
    for (const level of [100, 101, 110])
      expect(
        isAvailableUserQuests(quest as never, {
          ...cappedJonin,
          completedQuests: [],
          rank: "ELITE JONIN",
          level,
        }).check,
      ).toBe(true);
    for (const maxLevel of [99, 101])
      expect(
        isAvailableUserQuests({ ...quest, maxLevel } as never, {
          ...cappedJonin,
          completedQuests: [],
          rank: "ELITE JONIN",
          level: 110,
        }).check,
      ).toBe(false);
  });
  it("never derives Elite Jonin levels from assigned XP", () => {
    for (const level of [100, 101, 105, 110]) {
      const user = { ...cappedJonin, rank: "ELITE JONIN" as const, level };
      expect(getEffectiveLevel(user)).toBe(level);
      expect(levelUpBlockMessage(user)).not.toBeNull();
      expect(getEffectiveLevel({ ...user, experience: 0 })).toBe(level);
    }
  });
  it("awards each next milestone once and caps stat gains", () => {
    let user = { ...cappedJonin, rank: "ELITE JONIN" as const };
    for (let level = 101; level <= MAX_PLAYER_LEVEL; level++) {
      expect(eliteJoninMilestoneBlockMessage(user, level)).toBeNull();
      user = { ...user, ...eliteJoninMilestoneUpdate(user, level, 20_000) };
      expect(eliteJoninMilestoneBlockMessage(user, level)).not.toBeNull();
      expect(user.maxHealth).toBe(calcHP(level));
    }
    expect(user).toMatchObject({
      level: 110,
      offence: 1_500_000,
      defence: 1_500_000,
      strength: 600_000,
      speed: 600_000,
      intelligence: 600_000,
      willpower: 600_000,
    });
    expect(eliteJoninMilestoneBlockMessage(user, 111)).not.toBeNull();
    expect(eliteJoninMilestoneUpdate(user, 110, 999_999).offence).toBe(1_500_000);
  });
  it("limits every Elite Jonin bracket matchup to 7 and 8 in both directions", () => {
    expect(getExpBracket(0, "ELITE JONIN")).toBe(8);
    expect(getExpBracket(999_999_999, "ELITE JONIN")).toBe(8);
    for (let bracket = 0; bracket <= 8; bracket++) {
      expect(canAttackBracket(8, bracket)).toBe(bracket >= 7);
      expect(canAttackBracket(bracket, 8)).toBe(bracket >= 7);
    }
    expect(passesBracketFilter({ rank: "ELITE JONIN" }, 8)).toBe(true);
    expect(bracketSliderSchema.safeParse({ value: 8 }).success).toBe(true);
    expect(bracketSliderSchema.safeParse({ value: 9 }).success).toBe(false);
  });
  it("accepts level-110 equipment and jutsu requirements", () => {
    expect(ItemValidator.shape.requiredLevel.safeParse(110).success).toBe(true);
    expect(ItemValidator.shape.requiredLevel.safeParse(111).success).toBe(false);
    expect(JutsuValidator.shape.requiredLevel.safeParse(110).success).toBe(true);
  });
  it("gates milestone discovery by earned rank and the exact preceding level", () => {
    const quest = milestone();
    const user = { ...cappedJonin, completedQuests: [] };
    expect(isAvailableUserQuests(quest as never, user).check).toBe(false);
    expect(
      isAvailableUserQuests(quest as never, { ...user, rank: "ELITE JONIN" }).check,
    ).toBe(true);
    expect(
      isAvailableUserQuests(quest as never, {
        ...user,
        rank: "ELITE JONIN",
        level: 101,
      }).check,
    ).toBe(false);
    const exam = {
      ...quest,
      content: {
        ...quest.content,
        reward: {
          ...quest.content.reward,
          reward_level: 0,
          reward_stats: 0,
          reward_rank: "ELITE JONIN",
        },
      },
    };
    expect(isAvailableUserQuests(exam as never, user).check).toBe(true);
    expect(
      isAvailableUserQuests(exam as never, { ...user, strength: 399_999 }).check,
    ).toBe(false);
    const choiceExam = {
      ...exam,
      content: {
        ...exam.content,
        rewardMode: "choose",
        reward: {
          ...exam.content.reward,
          reward_rank: "NONE",
          reward_packages: [
            {
              id: "exam",
              name: "Promotion",
              description: "",
              rewards: { reward_rank: "ELITE JONIN" },
            },
          ],
        },
      },
    };
    expect(
      isAvailableUserQuests(choiceExam as never, { ...user, strength: 399_999 }).check,
    ).toBe(false);
  });
  it("rejects repeatable, skipped-level, choice and objective-level milestones", () => {
    const quest = milestone();
    for (const change of [
      { questType: "event" },
      { maxCompletes: 2 },
      { retryDelay: "daily" },
      { requiredLevel: 99 },
      { maxLevel: 110 },
      { teamEnabled: true },
    ])
      expect(QuestValidator.safeParse({ ...quest, ...change }).success).toBe(false);
    expect(
      QuestValidator.safeParse({
        ...quest,
        content: { ...quest.content, rewardMode: "choose" },
      }).success,
    ).toBe(false);
    expect(
      QuestValidator.safeParse({
        ...quest,
        content: {
          ...quest.content,
          reward: { ...quest.content.reward, reward_stats: 0 },
        },
      }).success,
    ).toBe(false);
    expect(
      QuestValidator.safeParse({
        ...quest,
        content: {
          ...quest.content,
          objectives: [
            { id: "goal", task: "arena_kills", value: 1, reward_level: 101 },
          ],
        },
      }).success,
    ).toBe(false);
  });
  it("preserves milestone grants when a terminal objective also grants a package", () => {
    const quest = milestone();
    const objective = {
      id: "last",
      task: "user_level",
      value: 100,
      reward_packages: [
        { id: "bonus", name: "Bonus", description: "", rewards: { reward_money: 10 } },
      ],
    };
    const definition = {
      ...quest,
      id: "milestone",
      content: { ...quest.content, objectives: [objective] },
    };
    const user = {
      ...cappedJonin,
      rank: "ELITE JONIN",
      role: "USER",
      userId: "hero",
      villageId: "village",
      village: null,
      userQuests: [
        { id: "history", questId: "milestone", completed: 0, quest: definition },
      ],
      completedQuests: [],
      questData: [
        {
          id: "milestone",
          goals: [{ id: "last", value: 100, done: true, collected: false }],
        },
      ],
    };
    const reward = getReward(user as never, "milestone");
    expect(reward.resolved).toBe(true);
    expect(reward.rewards).toMatchObject({
      reward_level: 101,
      reward_stats: 20_000,
      reward_money: 10,
    });
  });
  it("rejects rank changes hidden in milestone packages", () => {
    const quest = milestone();
    expect(
      QuestValidator.safeParse({
        ...quest,
        content: {
          ...quest.content,
          reward: {
            ...quest.content.reward,
            reward_packages: [
              {
                id: "rank",
                name: "Rank",
                description: "",
                rewards: { reward_rank: "JONIN" },
              },
            ],
          },
        },
      }).success,
    ).toBe(false);
  });
  it("validates the edited milestone fields instead of the saved quest's reward", () => {
    const quest = milestone();
    expect(
      QuestFormSchema.safeParse({
        ...quest,
        ...quest.content.reward,
        reward_level: 102,
      }).success,
    ).toBe(false);
  });
  it("allows clearing saved promotion rewards when editing a quest into a milestone", () => {
    const quest = milestone();
    for (const savedReward of [
      { reward_rank: "ELITE JONIN" },
      {
        reward_packages: [
          {
            id: "promotion",
            name: "Promotion",
            description: "",
            rewards: { reward_rank: "ELITE JONIN" },
          },
        ],
      },
    ]) {
      const saved = QuestValidator.parse({
        ...quest,
        content: {
          ...quest.content,
          reward: { ...savedReward, reward_level: 0, reward_stats: 0 },
        },
      });
      const edited = QuestFormSchema.parse({
        ...saved,
        ...saved.content.reward,
        reward_rank: "NONE",
        reward_packages: [],
        reward_level: 101,
        reward_stats: 20_000,
      });
      expect(edited.content.reward).toMatchObject({
        reward_rank: "NONE",
        reward_packages: [],
        reward_level: 101,
        reward_stats: 20_000,
      });
      expect(QuestValidator.safeParse(edited).success).toBe(true);
    }
  });
  it("rejects edited rank rewards and retained objective ranks in milestone forms", () => {
    const quest = milestone();
    const rankPackage = {
      id: "promotion",
      name: "Promotion",
      description: "",
      rewards: { reward_rank: "ELITE JONIN" },
    };
    const draft = { ...quest, ...quest.content.reward };
    for (const edited of [
      { ...draft, reward_rank: "ELITE JONIN" },
      { ...draft, reward_packages: [rankPackage] },
      {
        ...draft,
        content: {
          ...quest.content,
          objectives: [
            { id: "goal", task: "arena_kills", value: 1, reward_rank: "ELITE JONIN" },
          ],
        },
      },
      {
        ...draft,
        content: {
          ...quest.content,
          objectives: [
            {
              id: "goal",
              task: "arena_kills",
              value: 1,
              reward_packages: [rankPackage],
            },
          ],
        },
      },
    ])
      expect(QuestFormSchema.safeParse(edited).success).toBe(false);
  });
});
