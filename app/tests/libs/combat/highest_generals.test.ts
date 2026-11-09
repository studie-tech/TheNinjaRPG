import { describe, expect, it } from "bun:test";
import { makeCombatQueryUser, preloadBattle } from "./helpers/preload";

const stats = { strength: 10, intelligence: 40, willpower: 30, speed: 20 };

const highestGenerals = async (overrides: Record<string, unknown>) => {
  const { usersState } = await preloadBattle([
    makeCombatQueryUser("hero", { ...stats, ...overrides }),
  ]);
  return usersState[0]?.highestGenerals;
};

describe("battle highest generals", () => {
  it.each([
    [
      "takes the two highest stats without preferences",
      {},
      ["intelligence", "willpower"],
    ],
    [
      "keeps both preferences as chosen",
      { preferredGeneral1: "Speed", preferredGeneral2: "Strength" },
      ["speed", "strength"],
    ],
    [
      "keeps a repeated preference",
      { preferredGeneral1: "Speed", preferredGeneral2: "Speed" },
      ["speed", "speed"],
    ],
    [
      "fills the second slot from the highest other stat",
      { preferredGeneral1: "Intelligence" },
      ["intelligence", "willpower"],
    ],
    [
      "fills the second slot past an unrelated preference",
      { preferredGeneral1: "Speed" },
      ["speed", "intelligence"],
    ],
    [
      "fills the first slot from the highest other stat",
      { preferredGeneral2: "Intelligence" },
      ["willpower", "intelligence"],
    ],
    [
      "fills the first slot past an unrelated preference",
      { preferredGeneral2: "Strength" },
      ["intelligence", "strength"],
    ],
    [
      "lets an AI's Highest stand beside the top stat",
      { preferredGeneral1: "Highest" },
      ["highest", "intelligence"],
    ],
    [
      "breaks stat ties in general order",
      { strength: 40, intelligence: 40, willpower: 40, speed: 40 },
      ["strength", "intelligence"],
    ],
    [
      "ignores empty preferences",
      { preferredGeneral1: "", preferredGeneral2: "" },
      ["intelligence", "willpower"],
    ],
  ])("%s", async (_label, overrides, expected) => {
    expect(await highestGenerals(overrides)).toEqual(expected as never);
  });
});
