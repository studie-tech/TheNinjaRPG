import { describe, expect, it } from "bun:test";
import { getNewTrackers } from "@/libs/quest";
import {
  trackerGoalValue as goalValue,
  trackerQuest as makeQuest,
  trackerUser as makeUser,
} from "../../setup/quest";

const herbsObjective = (id: string, value = 10) => ({
  id,
  task: "herbs_gathered" as const,
  value,
  description: "",
  successDescription: "",
});

// Use items_crafted (a SimpleTask that preserves seeded increment values) so the
// no-clobber assertion is deterministic. `minutes_passed` snapshots from startAt
// and always recomputes, making a fixed expected value unreliable in a unit test.
const itemsCraftedObjective = (id: string, value = 100) => ({
  id,
  task: "items_crafted" as const,
  value,
  description: "",
  successDescription: "",
});

describe("herbs_gathered emit", () => {
  it("increments by the number of gathering-item drops", () => {
    const quest = makeQuest("q-gather", [herbsObjective("o-herbs", 10)]);
    // droppedGatheringItems.length === 4
    const result = getNewTrackers(makeUser([quest]), [
      { task: "herbs_gathered", increment: 4 },
    ]);
    expect(goalValue(result, "q-gather", "o-herbs")).toBe(4);
  });

  it("preserves other quest progress (no-clobber)", () => {
    const gatherQuest = makeQuest("q-gather", [herbsObjective("o-herbs", 10)]);
    const otherQuest = makeQuest("q-other", [itemsCraftedObjective("o-crafted", 100)]);
    // Pre-existing progress on the unrelated quest must survive the herb fold.
    const seeded = [
      { id: "q-other", goals: [{ id: "o-crafted", value: 42, done: false }] },
    ];
    const result = getNewTrackers(makeUser([gatherQuest, otherQuest], seeded), [
      { task: "herbs_gathered", increment: 4 },
    ]);
    expect(goalValue(result, "q-gather", "o-herbs")).toBe(4);
    expect(goalValue(result, "q-other", "o-crafted")).toBe(42);
  });
});
