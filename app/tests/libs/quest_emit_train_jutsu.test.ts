import { describe, expect, it } from "bun:test";
import { getNewTrackers } from "@/libs/quest";

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

const makeQuest = (id: string, objectives: Record<string, unknown>[]) => ({
  id,
  name: `Quest ${id}`,
  questType: "daily" as const,
  hidden: false,
  consecutiveObjectives: false,
  maxAttempts: 100,
  maxCompletes: 100,
  requiredVillage: null,
  requiredBloodlineId: null,
  prerequisiteQuestId: null,
  requiredLevel: null,
  maxLevel: null,
  medicalRank: null,
  huntingRank: null,
  gatheringRank: null,
  endsAt: null,
  content: {
    objectives,
    reward: {},
    sceneBackground: "",
    sceneCharacters: [],
  },
});

const makeUser = (quests: ReturnType<typeof makeQuest>[]) =>
  ({
    userId: "u1",
    level: 50,
    rank: "JONIN",
    role: "USER",
    villageId: "v1",
    isOutlaw: false,
    bloodlineId: null,
    medicalExperience: 0,
    huntingExperience: 0,
    gatheringExperience: 0,
    sector: 1,
    village: { id: "v1", sector: 1 },
    activeWars: [],
    completedQuests: [],
    questData: [],
    userQuests: quests.map((q) => ({
      id: `uq-${q.id}`,
      questId: q.id,
      completed: 0,
      previousAttempts: 0,
      previousCompletes: 0,
      quest: q,
    })),
  }) as unknown as Parameters<typeof getNewTrackers>[0];

const goalValue = (
  result: ReturnType<typeof getNewTrackers>,
  questId: string,
  objectiveId: string,
) =>
  result.trackers
    .find((t) => t.id === questId)
    ?.goals.find((g) => g.id === objectiveId)?.value;

// Exact array both jutsu sites emit (train-new / evolve) for a given jutsuId.
const trainEmit = (jutsuId: string) => [
  { task: "jutsus_mastered" as const, increment: 1 },
  { task: "train_specific_jutsu" as const, increment: 1, contentId: jutsuId },
];

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
    const emit = (contentId: string, masteryTypes: ("Ninjutsu" | "Genjutsu")[]) => [{ task: "train_specific_jutsu" as const, increment: 1, contentId, masteryTypes }];
    const matched = getNewTrackers(makeUser([quest]), emit("jutsuA", ["Ninjutsu"]));
    expect(goalValue(matched, "q", "both")).toBe(1);
    expect(goalValue(matched, "q", "mastery")).toBe(1);
    const wrongId = getNewTrackers(makeUser([quest]), emit("jutsuB", ["Ninjutsu"]));
    expect(goalValue(wrongId, "q", "both")).toBe(0);
    expect(goalValue(wrongId, "q", "mastery")).toBe(1);
    const wrongMastery = getNewTrackers(makeUser([quest]), emit("jutsuA", ["Genjutsu"]));
    expect(goalValue(wrongMastery, "q", "both")).toBe(0);
  });
  it("counts every matching combat use and applies the PVP/PVE filter", () => {
    const quest = makeQuest("q", [{ id: "use", task: "use_specific_jutsu_combat", value: 10, useJutsuIds: [], masteryType: "Ninjutsu", combatType: "PVP", description: "", successDescription: "" }]);
    const use = { task: "use_specific_jutsu_combat" as const, increment: 1, contentId: "jutsuA", masteryTypes: ["Ninjutsu" as const], combatType: "PVP" as const };
    const result = getNewTrackers(makeUser([quest]), [use, use, { ...use, combatType: "PVE" }]);
    expect(goalValue(result, "q", "use")).toBe(2);
  });
});
