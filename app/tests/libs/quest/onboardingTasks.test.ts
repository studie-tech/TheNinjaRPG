import { describe, expect, it } from "bun:test";
import { dailyDutyExperience } from "@/libs/dailyDutyExperience";
import { calcLevelRequirements } from "@/libs/profile";
import { getNewTrackers, hasOpenTask } from "@/libs/quest";
import {
  isTierQuestUnlocked,
  TIER_QUEST_UNLOCK_LEVEL,
} from "@/libs/quest/availability";
import { OnboardingStateTasks } from "@/validators/objectives";
import {
  trackerGoal as goalOf,
  trackerQuest as makeQuest,
  trackerUser as makeUser,
} from "../../setup/quest";

const objective = (task: string, value = 1) => ({
  id: task,
  description: "",
  successDescription: "",
  task,
  value,
});

describe("story onboarding objective tasks", () => {
  it("counts an event only when its action is reported", () => {
    const quest = makeQuest("q1", [objective("bank_deposit", 2)]);
    const user = makeUser([quest]);
    let result = getNewTrackers(user, [{ task: "any" }]);
    expect(goalOf(result, "q1", "bank_deposit")?.value ?? 0).toBe(0);
    user.questData = result.trackers;
    result = getNewTrackers(user, [{ task: "bank_deposit", increment: 1 }]);
    user.questData = result.trackers;
    result = getNewTrackers(user, [{ task: "bank_deposit", increment: 1 }]);
    expect(goalOf(result, "q1", "bank_deposit")?.done).toBe(true);
  });

  it("completes state goals at once when the player already meets them", () => {
    const quest = makeQuest(
      "q1",
      OnboardingStateTasks.map((task) => objective(task)),
    );
    const user = makeUser([quest], [], {
      primaryElement: "Fire",
      senseiId: "sensei-1",
      occupation: "HUNTER",
      clanId: "clan-1",
      items: [{ equipped: "CHEST" }],
      completedQuests: [{ questId: "c1", questType: "hunting", completed: 1 }],
    });
    const result = getNewTrackers(user, [{ task: "any" }]);
    for (const task of OnboardingStateTasks) {
      expect(goalOf(result, "q1", task)?.done).toBe(true);
    }
  });

  it("counts an equipped weapon as gear", () => {
    const quest = makeQuest("q1", [objective("equip_item")]);
    const user = makeUser([quest], [], { items: [{ equipped: "HAND_1" }] });
    const result = getNewTrackers(user, [{ task: "any" }]);
    expect(goalOf(result, "q1", "equip_item")?.done).toBe(true);
  });

  it("counts a sent sensei or clan request without waiting for an answer", () => {
    const quest = makeQuest("q1", [objective("get_sensei"), objective("join_clan")]);
    const user = makeUser([quest], [], { senseiId: null, clanId: null });
    let result = getNewTrackers(user, [{ task: "any" }]);
    user.questData = result.trackers;
    result = getNewTrackers(user, [{ task: "get_sensei", increment: 1 }]);
    user.questData = result.trackers;
    // A later state pass must not undo the request: nobody has accepted yet.
    result = getNewTrackers(user, [{ task: "any" }]);
    expect(goalOf(result, "q1", "get_sensei")?.done).toBe(true);
    expect(goalOf(result, "q1", "join_clan")?.done ?? false).toBe(false);
  });

  it("leaves state goals open until the player meets them", () => {
    const quest = makeQuest(
      "q1",
      OnboardingStateTasks.map((task) => objective(task)),
    );
    const user = makeUser([quest], [], {
      primaryElement: null,
      occupation: null,
      clanId: null,
      // A thrown tool is not gear.
      items: [{ equipped: "THROWN" }],
    });
    const result = getNewTrackers(user, [{ task: "any" }]);
    for (const task of OnboardingStateTasks) {
      expect(goalOf(result, "q1", task)?.done ?? false).toBe(false);
    }
  });
});

describe("open onboarding tasks", () => {
  it("reports a task only while an active quest's objective still asks for it", () => {
    const quest = makeQuest("q1", [objective("cook_meal", 2)]);
    const user = makeUser([quest]);
    expect(hasOpenTask(user, "cook_meal")).toBe(true);
    expect(hasOpenTask(user, "feed_pet")).toBe(false);
    user.questData = getNewTrackers(user, [
      { task: "cook_meal", increment: 2 },
    ]).trackers;
    expect(hasOpenTask(user, "cook_meal")).toBe(false);
  });
});

describe("daily duty experience", () => {
  it("pays a tenth of the next level to Students and Genin only", () => {
    const levelCost = calcLevelRequirements(10) - calcLevelRequirements(9);
    expect(dailyDutyExperience("GENIN", 10)).toBe(Math.round(levelCost / 10));
    expect(dailyDutyExperience("STUDENT", 1)).toBeGreaterThan(0);
    expect(dailyDutyExperience("CHUNIN", 30)).toBe(0);
  });
});

describe("tier quest hold", () => {
  const chapter11 = "ps9Li4LSfWC1wkz3Evvh6";

  it("holds tier quests until level 12 or chapter 11", () => {
    expect(isTierQuestUnlocked({ level: 10, userQuests: [] })).toBe(false);
    expect(isTierQuestUnlocked({ level: TIER_QUEST_UNLOCK_LEVEL })).toBe(true);
    expect(
      isTierQuestUnlocked({ level: 10, userQuests: [{ questId: chapter11 }] }),
    ).toBe(true);
    expect(
      isTierQuestUnlocked({ level: 8, completedQuests: [{ questId: chapter11 }] }),
    ).toBe(true);
  });
});
