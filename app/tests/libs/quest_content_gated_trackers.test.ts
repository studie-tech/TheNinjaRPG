import { describe, expect, it } from "vitest";
import { getNewTrackers } from "@/libs/quest";

const baseObjective = (id: string) => ({
  id,
  description: "",
  successDescription: "",
});

const craftObjective = (id: string, ids: string[], value = 1) => ({
  ...baseObjective(id),
  task: "craft_specific_item" as const,
  craftItemIds: ids,
  value,
});

const buyObjective = (id: string, ids: string[], value = 1) => ({
  ...baseObjective(id),
  task: "buy_item" as const,
  buyItemIds: ids,
  value,
});

const tagObjective = (id: string, tagType: string, value = 1) => ({
  ...baseObjective(id),
  task: "tag_usage_win" as const,
  tagType,
  value,
});

const damageObjective = (id: string, value: number, singleBattle = false) => ({
  ...baseObjective(id),
  task: "damage_dealt" as const,
  singleBattle,
  value,
});

const makeQuest = (id: string, objectives: object[]) => ({
  id,
  name: `Quest ${id}`,
  questType: "daily",
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
  content: { objectives, reward: {}, sceneBackground: "", sceneCharacters: [] },
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
    craftingExperience: 0,
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

const goalOf = (
  result: ReturnType<typeof getNewTrackers>,
  questId: string,
  objId: string,
) =>
  result.trackers
    .find((t) => t.id === questId)
    ?.goals.find((g) => g.id === objId);

describe("content-gated objective matcher", () => {
  it("credits a matching contentId exactly once (no double-count via the generic path)", () => {
    const quest = makeQuest("q1", [craftObjective("o1", ["item-A"], 5)]);
    const result = getNewTrackers(makeUser([quest]), [
      { task: "craft_specific_item", increment: 1, contentId: "item-A" },
    ]);
    // 1 (content matcher) — NOT 2 (would mean the generic path also ran).
    expect(goalOf(result, "q1", "o1")?.value).toBe(1);
    expect(goalOf(result, "q1", "o1")?.done).toBe(false);
  });

  it("does not credit when the contentId is not in the objective's id-list", () => {
    const quest = makeQuest("q1", [craftObjective("o1", ["item-A"], 5)]);
    const result = getNewTrackers(makeUser([quest]), [
      { task: "craft_specific_item", increment: 1, contentId: "item-B" },
    ]);
    expect(goalOf(result, "q1", "o1")?.value).toBe(0);
  });

  it("is a no-op when the emitted update carries no contentId", () => {
    const quest = makeQuest("q1", [craftObjective("o1", ["item-A"], 5)]);
    const result = getNewTrackers(makeUser([quest]), [
      { task: "craft_specific_item", increment: 1 },
    ]);
    expect(goalOf(result, "q1", "o1")?.value).toBe(0);
  });

  it("credits two same-task objectives independently by their own id-lists", () => {
    const quest = makeQuest("q1", [
      craftObjective("o1", ["item-A"], 5),
      craftObjective("o2", ["item-B"], 5),
    ]);
    const result = getNewTrackers(makeUser([quest]), [
      { task: "craft_specific_item", increment: 1, contentId: "item-A" },
    ]);
    expect(goalOf(result, "q1", "o1")?.value).toBe(1);
    expect(goalOf(result, "q1", "o2")?.value).toBe(0);
  });

  it("defaults increment to 1 and auto-completes at value", () => {
    const quest = makeQuest("q1", [craftObjective("o1", ["item-A"], 1)]);
    const result = getNewTrackers(makeUser([quest]), [
      { task: "craft_specific_item", contentId: "item-A" },
    ]);
    expect(goalOf(result, "q1", "o1")?.value).toBe(1);
    expect(goalOf(result, "q1", "o1")?.done).toBe(true);
  });

  it("uses each task's own id-list field (buy_item -> buyItemIds, stack increment)", () => {
    const quest = makeQuest("q1", [buyObjective("o1", ["item-Z"], 3)]);
    const result = getNewTrackers(makeUser([quest]), [
      { task: "buy_item", increment: 2, contentId: "item-Z" },
    ]);
    expect(goalOf(result, "q1", "o1")?.value).toBe(2);
  });

  it("tag_usage_win matches the single tagType and ignores other applied tags", () => {
    const quest = makeQuest("q1", [tagObjective("o1", "poison", 1)]);

    const match = getNewTrackers(makeUser([quest]), [
      { task: "tag_usage_win", increment: 1, contentId: "poison" },
    ]);
    expect(goalOf(match, "q1", "o1")?.done).toBe(true);

    const noMatch = getNewTrackers(makeUser([quest]), [
      { task: "tag_usage_win", increment: 1, contentId: "stun" },
    ]);
    expect(goalOf(noMatch, "q1", "o1")?.value).toBe(0);
  });
});

describe("damage_dealt engine branch", () => {
  it("accumulates across battles when singleBattle is false", () => {
    const quest = makeQuest("q1", [damageObjective("o1", 100, false)]);
    const user = makeUser([quest]);

    let result = getNewTrackers(user, [{ task: "damage_dealt", increment: 40 }]);
    user.questData = result.trackers;
    expect(goalOf(result, "q1", "o1")?.value).toBe(40);
    expect(goalOf(result, "q1", "o1")?.done).toBe(false);

    result = getNewTrackers(user, [{ task: "damage_dealt", increment: 70 }]);
    expect(goalOf(result, "q1", "o1")?.value).toBe(110);
    expect(goalOf(result, "q1", "o1")?.done).toBe(true);
  });

  it("takes the max single-battle value (monotonic) when singleBattle is true", () => {
    const quest = makeQuest("q1", [damageObjective("o1", 100, true)]);
    const user = makeUser([quest]);

    let result = getNewTrackers(user, [{ task: "damage_dealt", increment: 60 }]);
    user.questData = result.trackers;
    expect(goalOf(result, "q1", "o1")?.value).toBe(60);

    // a smaller battle must not reduce progress
    result = getNewTrackers(user, [{ task: "damage_dealt", increment: 30 }]);
    user.questData = result.trackers;
    expect(goalOf(result, "q1", "o1")?.value).toBe(60);

    // a bigger battle reaches the threshold
    result = getNewTrackers(user, [{ task: "damage_dealt", increment: 120 }]);
    expect(goalOf(result, "q1", "o1")?.value).toBe(120);
    expect(goalOf(result, "q1", "o1")?.done).toBe(true);
  });
});
