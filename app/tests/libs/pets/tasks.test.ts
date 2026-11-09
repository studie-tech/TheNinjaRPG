import { describe, expect, it } from "bun:test";
import { PET_TASK_MAX_MINUTES } from "@/drizzle/constants";
import {
  isPetTaskAttempt,
  isPetTaskContract,
  petTaskDispatchBlockMessage,
} from "@/libs/pets/tasks";
import { getNewTrackers, getUserQuests } from "@/libs/quest";
import { getReward } from "@/libs/quest/rewards";
import { DialogObjective, QuestTracker } from "@/validators/objectives";
import { type PetTask, petTaskMinutesSchema } from "@/validators/petTasks";
import { QuestReward } from "@/validators/rewardPackages";

const task: PetTask = {
  petId: "pet",
  questHistoryId: "history",
  questId: "contract",
  startedAt: 1000,
  questVersion: 500,
  finishesAt: 61000,
};
const owner = {
  rank: "CHUNIN" as const,
  status: "AWAKE" as const,
  battleId: null,
  isBanned: false,
  isAi: false,
  petTask: null,
  occupation: "HUNTER" as const,
};
const pet = {
  rank: 5,
  generationStatus: "READY" as const,
  artRank: 5,
  avatar: "/companion.webp",
};

describe("companion profession task contracts", () => {
  it("requires Content opt-in on a supported profession with a bounded whole-minute duration", () => {
    expect(isPetTaskContract({ questType: "hunting", petTaskMinutes: 1 })).toBe(true);
    expect(
      isPetTaskContract({
        questType: "gathering",
        petTaskMinutes: PET_TASK_MAX_MINUTES,
      }),
    ).toBe(true);
    for (const petTaskMinutes of [null, 0, -1, 0.5, PET_TASK_MAX_MINUTES + 1])
      expect(isPetTaskContract({ questType: "hunting", petTaskMinutes })).toBe(false);
    expect(isPetTaskContract({ questType: "story", petTaskMinutes: 1 })).toBe(false);
    expect(petTaskMinutesSchema.parse("")).toBeNull();
    expect(petTaskMinutesSchema.parse("30")).toBe(30);
    expect(petTaskMinutesSchema.safeParse(0).success).toBe(false);
  });

  it("requires ready Hunter rank supported by the owner and one task per account", () => {
    expect(petTaskDispatchBlockMessage(owner, pet)).toBeNull();
    expect(petTaskDispatchBlockMessage(owner, { ...pet, rank: 4 })).toContain(
      "Hunter rank",
    );
    expect(petTaskDispatchBlockMessage({ ...owner, rank: "GENIN" }, pet)).toContain(
      "Your rank",
    );
    expect(petTaskDispatchBlockMessage(owner, { ...pet, artRank: 4 })).toContain(
      "appearance",
    );
    expect(petTaskDispatchBlockMessage({ ...owner, petTask: task }, pet)).toContain(
      "another task",
    );
    expect(
      petTaskDispatchBlockMessage({ ...owner, occupation: "CRAFTING" }, pet),
    ).toContain("Hunter or Gatherer");
    expect(
      petTaskDispatchBlockMessage({ ...owner, battleId: "battle" }, pet),
    ).toContain("out of combat");
  });

  it("distinguishes restarted attempts even when their history row is reused", () => {
    expect(
      isPetTaskAttempt(task, {
        id: "history",
        questId: "contract",
        startedAt: new Date(1000),
      }),
    ).toBe(true);
    expect(
      isPetTaskAttempt(task, {
        id: "history",
        questId: "contract",
        startedAt: new Date(1001),
      }),
    ).toBe(false);
    expect(
      isPetTaskAttempt(task, {
        id: "history",
        questId: "other",
        startedAt: new Date(1000),
      }),
    ).toBe(false);
    expect(isPetTaskAttempt(task, undefined)).toBe(false);
  });

  it("keeps owner activity and ordinary objective consequences away from the delegated attempt", () => {
    const user = taskUser();
    expect(getUserQuests(user)).toEqual([]);
    const result = getNewTrackers(user, [{ task: "any" }, { task: "dialog" }]);
    expect(result.trackers).toEqual([]);
    expect(result.consequences).toEqual([]);
    expect(result.notifications).toEqual([]);
  });

  it("pays only the final configured reward without dialogue or intermediate objective rewards", () => {
    const reward = getReward(taskUser(), task.questId, undefined, [], undefined, true);
    expect(reward.resolved).toBe(true);
    expect(reward.rewards.reward_money).toBe(100);
    expect(reward.rewards.reward_hunting_experience).toBe(40);
    expect(reward.consequences).toEqual([]);
    expect(reward.notifications).toEqual([]);
  });
});

/** A completed intermediate dialogue deliberately carries a reward that delegation must not repeat. */
const taskUser = () => {
  const quest = {
    id: task.questId,
    name: "Contract",
    questType: "hunting",
    hidden: false,
    consecutiveObjectives: false,
    maxAttempts: 100,
    maxCompletes: 100,
    retryDelay: "none",
    requiredVillage: null,
    requiredBloodlineId: null,
    prerequisiteQuestId: null,
    requiredLevel: 1,
    maxLevel: 100,
    huntingRank: "NONE",
    gatheringRank: "NONE",
    medicalRank: "NONE",
    content: {
      objectives: [
        DialogObjective.parse({
          id: "intermediate",
          task: "dialog",
          reward_money: 900,
        }),
      ],
      reward: QuestReward.parse({ reward_money: 100, reward_hunting_experience: 40 }),
      sceneBackground: "",
      sceneCharacters: [],
    },
  };
  return {
    ...owner,
    userId: "owner",
    role: "USER",
    level: 30,
    petTask: task,
    medicalExperience: 0,
    huntingExperience: 0,
    gatheringExperience: 0,
    completedQuests: [],
    village: null,
    clan: null,
    isOutlaw: false,
    dailyMissions: 0,
    questData: [
      QuestTracker.parse({
        id: task.questId,
        goals: [{ id: "intermediate", done: true }],
      }),
    ],
    userQuests: [
      {
        id: task.questHistoryId,
        questId: task.questId,
        questType: "hunting",
        completed: 0,
        endAt: null,
        startedAt: new Date(task.startedAt),
        quest,
      },
    ],
  } as unknown as Parameters<typeof getReward>[0];
};
