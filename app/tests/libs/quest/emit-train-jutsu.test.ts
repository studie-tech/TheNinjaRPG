import {
  trackerQuest as makeQuest,
  trackerUser as makeUser,
  trackerGoalValue as goalValue,
} from "../../setup/quest";
import { describe, expect, it } from "bun:test";
import { getJutsuLearnedTrackerTasks, getNewTrackers } from "@/libs/quest";

const masteredObjective = (id: string, value = 5) => ({
  id,
  task: "jutsus_mastered" as const,
  value,
  description: "",
  successDescription: "",
});

const trainSpecificObjective = (id: string, ids: string[], value = 1) => ({
  id,
  task: "train_specific_jutsu" as const,
  value,
  trainJutsuIds: ids,
  description: "",
  successDescription: "",
});

const trainEmit = (jutsuId: string) => getJutsuLearnedTrackerTasks(jutsuId, []);

describe("train_specific_jutsu emit", () => {
  it("credits jutsus_mastered and the matching specific jutsu", () => {
    const quest = makeQuest("q", [
      masteredObjective("o-mastered", 5),
      trainSpecificObjective("o-spec", ["jutsuA", "jutsuB"], 2),
    ]);
    const result = getNewTrackers(makeUser([quest]), trainEmit("jutsuA"));
    expect(goalValue(result, "q", "o-mastered")).toBe(1);
    expect(goalValue(result, "q", "o-spec")).toBe(1);
  });

  it("does not credit a specific-jutsu objective for an unlisted jutsu", () => {
    const quest = makeQuest("q", [trainSpecificObjective("o-spec", ["jutsuZ"], 2)]);
    const result = getNewTrackers(makeUser([quest]), trainEmit("jutsuA"));
    expect(goalValue(result, "q", "o-spec")).toBe(0);
  });
});

describe("mastery-filtered jutsu objectives", () => {
  it("combines mastery and specific IDs, and accepts mastery without IDs", () => {
    const quest = makeQuest("q", [
      { ...trainSpecificObjective("both", ["jutsuA"], 3), masteryType: "Ninjutsu" },
      { ...trainSpecificObjective("mastery", [], 3), masteryType: "Ninjutsu" },
    ]);
    const emit = (contentId: string, masteryTypes: ("Ninjutsu" | "Genjutsu")[]) => [
      { task: "train_specific_jutsu" as const, increment: 1, contentId, masteryTypes },
    ];
    const matched = getNewTrackers(makeUser([quest]), emit("jutsuA", ["Ninjutsu"]));
    expect(goalValue(matched, "q", "both")).toBe(1);
    expect(goalValue(matched, "q", "mastery")).toBe(1);
    const wrongId = getNewTrackers(makeUser([quest]), emit("jutsuB", ["Ninjutsu"]));
    expect(goalValue(wrongId, "q", "both")).toBe(0);
    expect(goalValue(wrongId, "q", "mastery")).toBe(1);
    const wrongMastery = getNewTrackers(
      makeUser([quest]),
      emit("jutsuA", ["Genjutsu"]),
    );
    expect(goalValue(wrongMastery, "q", "both")).toBe(0);
  });
  it("counts every matching combat use and applies the PVP/PVE filter", () => {
    const quest = makeQuest("q", [
      {
        id: "use",
        task: "use_specific_jutsu_combat",
        value: 10,
        useJutsuIds: [],
        masteryType: "Ninjutsu",
        combatType: "PVP",
        description: "",
        successDescription: "",
      },
    ]);
    const use = {
      task: "use_specific_jutsu_combat" as const,
      increment: 1,
      contentId: "jutsuA",
      masteryTypes: ["Ninjutsu" as const],
      combatType: "PVP" as const,
    };
    const result = getNewTrackers(makeUser([quest]), [
      use,
      use,
      { ...use, combatType: "PVE" },
    ]);
    expect(goalValue(result, "q", "use")).toBe(2);
  });
});
