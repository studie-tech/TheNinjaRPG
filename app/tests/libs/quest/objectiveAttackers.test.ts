import { describe, expect, it } from "bun:test";
import { getActiveObjectives, rollObjectiveAttackers } from "@/libs/quest";
import type { UserWithRelations } from "@/routers/profile";
import { EncountersAtLocation, MoveToObjective } from "@/validators/objectives";

// "Collect the Scrolls" from The Chunin Exams: a move objective with a 10% ambush.
const ambushMove = MoveToObjective.parse({
  id: "scrolls",
  task: "move_to_location",
  sectorType: "random",
  locationType: "random",
  attackers: [{ ids: ["enemy-chunin"], number: 10, quantity: 1 }],
});

const fixedRandom = (value: number) => () => value;

describe("rollObjectiveAttackers", () => {
  it("starts a random encounter when the roll is within the attacker chance", () => {
    expect(rollObjectiveAttackers([ambushMove], 1, fixedRandom(0.05))).toEqual({
      type: "random_encounter",
      ids: ["enemy-chunin"],
      scaleStats: false,
      scaleGains: 1,
    });
  });

  it("attributes the encounter to the quest resolved for its objective", () => {
    expect(
      rollObjectiveAttackers([ambushMove], 1, fixedRandom(0.05), () => "team-quest"),
    ).toMatchObject({ questId: "team-quest" });
    expect(
      rollObjectiveAttackers([ambushMove], 1, fixedRandom(0.05), () => undefined),
    ).not.toHaveProperty("questId");
  });

  it("does not attack when the roll is outside the attacker chance", () => {
    expect(rollObjectiveAttackers([ambushMove], 1, fixedRandom(0.5))).toBeUndefined();
  });

  it("ignores objectives without attackers", () => {
    const quietMove = MoveToObjective.parse({ id: "quiet", task: "move_to_location" });
    expect(rollObjectiveAttackers([quietMove], 1, fixedRandom(0))).toBeUndefined();
  });

  it("only ambushes inside the resolved target sector without changing the authored encounter", () => {
    const encounter = EncountersAtLocation.parse({
      id: "encounter",
      task: "win_encounter_at_location",
      sector: 42,
      longitude: 4,
      latitude: 5,
      attackers: [{ ids: ["bandit"], number: 100, quantity: 1 }],
    });
    const actor = {
      userQuests: [
        {
          quest: {
            id: "q",
            consecutiveObjectives: false,
            content: { objectives: [encounter] },
          },
        },
      ],
      questData: [
        {
          id: "q",
          goals: [
            { id: "encounter", done: false, sector: 7, longitude: 0, latitude: 0 },
          ],
        },
      ],
    } as unknown as NonNullable<UserWithRelations>;
    const objectives = getActiveObjectives(actor);
    expect(objectives[0]).toMatchObject({ sector: 7, longitude: 0, latitude: 0 });
    expect(rollObjectiveAttackers(objectives, 42, fixedRandom(0))).toBeUndefined();
    expect(rollObjectiveAttackers(objectives, 7, fixedRandom(0))?.ids).toEqual([
      "bandit",
    ]);
    expect(encounter).toMatchObject({ sector: 42, longitude: 4, latitude: 5 });
  });

  it("caps the encounter at attackers_max_per_battle", () => {
    const crowd = MoveToObjective.parse({
      id: "crowd",
      task: "move_to_location",
      attackers: [
        { ids: ["a"], number: 100, quantity: 1 },
        { ids: ["b"], number: 100, quantity: 1 },
        { ids: ["c"], number: 100, quantity: 1 },
      ],
      attackers_max_per_battle: 2,
    });
    expect(rollObjectiveAttackers([crowd], 1, fixedRandom(0))?.ids).toHaveLength(2);
  });

  it("lets the first objective that rolls attackers decide the encounter", () => {
    const second = MoveToObjective.parse({
      id: "second",
      task: "move_to_location",
      attackers: [{ ids: ["other"], number: 100, quantity: 1 }],
    });
    expect(
      rollObjectiveAttackers([ambushMove, second], 1, fixedRandom(0))?.ids,
    ).toEqual(["enemy-chunin"]);
  });
});
