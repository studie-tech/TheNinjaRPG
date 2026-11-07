import { describe, expect, it } from "bun:test";
import { getExperienceTrackerTasks } from "@/libs/quest/rewards";

const none = {
  reward_medical_experience: 0,
  reward_crafting_experience: 0,
  reward_hunting_experience: 0,
  reward_gathering_experience: 0,
};

describe("getExperienceTrackerTasks", () => {
  it("emits nothing without a positive gain", () => {
    expect(getExperienceTrackerTasks(none)).toEqual([]);
    expect(
      getExperienceTrackerTasks({ ...none, reward_medical_experience: -5 }),
    ).toEqual([]);
  });

  it("emits each profession gain in a fixed order", () => {
    expect(
      getExperienceTrackerTasks({
        reward_gathering_experience: 4,
        reward_hunting_experience: 3,
        reward_crafting_experience: 2,
        reward_medical_experience: 1,
      }),
    ).toEqual([
      { task: "medical_experience_gained", increment: 1 },
      { task: "crafting_experience_gained", increment: 2 },
      { task: "hunting_experience_gained", increment: 3 },
      { task: "gathering_experience_gained", increment: 4 },
    ]);
  });

  it("skips professions the reward does not carry", () => {
    expect(
      getExperienceTrackerTasks({ ...none, reward_hunting_experience: 7 }),
    ).toEqual([{ task: "hunting_experience_gained", increment: 7 }]);
    expect(getExperienceTrackerTasks({} as never)).toEqual([]);
  });
});
