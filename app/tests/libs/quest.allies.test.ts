import { describe, expect, it } from "bun:test";
import { getNewTrackers } from "@/libs/quest";
import { DefeatOpponents, InstantStartBattleObjective } from "@/validators/objectives";

const makeUser = (objective: unknown) =>
  ({
    userId: "hero",
    status: "AWAKE",
    level: 50,
    rank: "JONIN",
    role: "USER",
    villageId: "home",
    sector: 1,
    longitude: 1,
    latitude: 1,
    activeWars: [],
    completedQuests: [],
    questData: [{ id: "quest", startAt: new Date(), goals: [] }],
    userQuests: [{
      questId: "quest", completed: 0, previousAttempts: 0, previousCompletes: 0,
      quest: {
        id: "quest", name: "Allies", questType: "mission", hidden: false,
        maxAttempts: 100, maxCompletes: 100,
        content: { objectives: [objective] },
      },
    }],
  }) as unknown as Parameters<typeof getNewTrackers>[0];

describe("quest NPC allies", () => {
  for (const schema of [InstantStartBattleObjective, DefeatOpponents]) {
    const task = schema === InstantStartBattleObjective ? "start_battle" : "defeat_opponents";
    it(`${task} defaults existing content to no allies`, () => {
      expect(schema.parse({ id: "fight", task, opponentAIs: [{ ids: ["enemy"], number: 1 }] }).allyAIs).toEqual([]);
    });
    it(`${task} propagates multiple copies separately from enemies`, () => {
      const objective = schema.parse({
        id: "fight", task, sector: 1, longitude: 1, latitude: 1,
        opponentAIs: [{ ids: ["enemy"], number: 2 }],
        allyAIs: [{ ids: ["guide", "guard"], number: 2 }],
      });
      const result = getNewTrackers(makeUser(objective), [{ task: "any", contentId: "fight" }]);
      expect(result.consequences.find((c) => c.type === "combat")).toMatchObject({
        ids: ["enemy", "enemy"], allyAiIds: ["guide", "guard", "guide", "guard"],
      });
    });
  }
  it("uses one ally by default and rejects invalid combatant counts", () => {
    const input = { id: "fight", task: "defeat_opponents", allyAIs: [{ ids: ["guide"] }] };
    expect(DefeatOpponents.parse(input).allyAIs[0]?.number).toBe(1);
    for (const number of [0, -1, 1.5, 101]) {
      expect(DefeatOpponents.safeParse({ ...input, allyAIs: [{ ids: ["guide"], number }] }).success).toBe(false);
    }
  });
});
