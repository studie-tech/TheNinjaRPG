import { describe, expect, it } from "bun:test";
import { getJutsuLearnedTrackerTasks, getNewTrackers } from "@/libs/quest";
import {
  trackerGoalValue as goalValue,
  trackerQuest as makeQuest,
  trackerUser as makeUser,
} from "../../setup/quest";

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

describe("train_specific_jutsu ownership", () => {
  const owned = (jutsuId: string, masteryTypes: "Ninjutsu"[] = []) => ({
    jutsuId,
    masteryTypes,
  });
  const dialog = (id: string, next?: string) => ({
    id,
    task: "dialog" as const,
    nextObjectiveId: [{ text: "Next", nextObjectiveId: next }],
    description: "",
    successDescription: "",
  });
  /** The starter quest's shape: the jutsu objective waits behind an earlier one. */
  const chained = () => ({
    ...makeQuest("q", [
      dialog("first", "jutsu"),
      { ...trainSpecificObjective("jutsu", ["jutsuA"]), nextObjectiveId: "brief" },
      dialog("brief"),
    ]),
    consecutiveObjectives: true,
  });
  /** Tracker of a player who already learned the jutsu when the objective opened. */
  const reached = [
    { id: "q", goals: [{ id: "first", done: true, selectedNextObjectiveId: "jutsu" }] },
  ];

  it("completes for a player who learned the jutsu before reaching the objective", () => {
    const user = makeUser([chained() as never], structuredClone(reached));
    const result = getNewTrackers(
      { ...user, ownedObjectiveJutsus: [owned("jutsuA")] },
      [{ task: "any" }],
    );
    const goal = result.trackers
      .find((tracker) => tracker.id === "q")
      ?.goals.find((entry) => entry.id === "jutsu");
    expect(goal?.done).toBe(true);
    expect(goal?.value).toBe(1);
    // Persisted by the profile read, so quest claims see it without hydrating again.
    expect(result.consequences).toContainEqual({
      type: "update_user",
      ids: ["owned_jutsu_update"],
    });
  });

  it("does not complete ahead of the chain, and asks for no write", () => {
    const user = makeUser([chained() as never]);
    const result = getNewTrackers(
      { ...user, ownedObjectiveJutsus: [owned("jutsuA")] },
      [{ task: "any" }],
    );
    expect(goalValue(result, "q", "jutsu")).toBe(0);
    expect(result.consequences).toEqual([]);
  });

  it("needs the hydrated snapshot: an unhydrated pass changes nothing", () => {
    const user = makeUser([chained() as never], structuredClone(reached));
    const result = getNewTrackers(user, [{ task: "any" }]);
    expect(goalValue(result, "q", "jutsu")).toBe(0);
  });

  it("does not credit an unlisted jutsu, or a listed one in the wrong discipline", () => {
    const quest = makeQuest("q", [
      trainSpecificObjective("plain", ["jutsuA"]),
      { ...trainSpecificObjective("filtered", ["jutsuB"]), masteryType: "Ninjutsu" },
    ]);
    const unlisted = getNewTrackers(
      { ...makeUser([quest]), ownedObjectiveJutsus: [owned("other")] },
      [{ task: "any" }],
    );
    expect(goalValue(unlisted, "q", "plain")).toBe(0);
    const wrongDiscipline = getNewTrackers(
      { ...makeUser([quest]), ownedObjectiveJutsus: [owned("jutsuB")] },
      [{ task: "any" }],
    );
    expect(goalValue(wrongDiscipline, "q", "filtered")).toBe(0);
    const rightDiscipline = getNewTrackers(
      { ...makeUser([quest]), ownedObjectiveJutsus: [owned("jutsuB", ["Ninjutsu"])] },
      [{ task: "any" }],
    );
    expect(goalValue(rightDiscipline, "q", "filtered")).toBe(1);
  });

  it("keeps mastery quests about learning something new", () => {
    const quest = makeQuest("q", [
      { ...trainSpecificObjective("mastery", []), masteryType: "Ninjutsu" },
    ]);
    const result = getNewTrackers(
      { ...makeUser([quest]), ownedObjectiveJutsus: [owned("jutsuA", ["Ninjutsu"])] },
      [{ task: "any" }],
    );
    expect(goalValue(result, "q", "mastery")).toBe(0);
  });

  it("does not lower progress or add to what learning already counted", () => {
    const quest = makeQuest("q", [
      trainSpecificObjective("two", ["jutsuA", "jutsuB"], 2),
    ]);
    const tracker = [{ id: "q", goals: [{ id: "two", value: 1 }] }];
    const result = getNewTrackers(
      { ...makeUser([quest], tracker), ownedObjectiveJutsus: [owned("jutsuA")] },
      [{ task: "any" }],
    );
    expect(goalValue(result, "q", "two")).toBe(1);
    expect(result.consequences).toEqual([]);
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
