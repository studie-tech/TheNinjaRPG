import { describe, expect, it } from "vitest";
import { AllObjectives } from "@/validators/objectives";

// One minimal valid raw input per discriminated-union member family.
// Only the fields without a schema prefault are supplied.
const validObjectives = [
  { id: "o1", task: "pvp_kills" }, // SimpleObjective (z.enum)
  { id: "o2", task: "win_quest" }, // InstantWinLoseObjective (z.enum)
  { id: "o3", task: "reset_quest" }, // ResetQuestObjective (z.literal + prefault)
  { id: "o4", task: "new_quest" }, // InstantNewQuestObjective
  {
    id: "o5",
    task: "start_battle",
    opponentAIs: [{ ids: ["ai1"], number: 100, quantity: 1 }],
  }, // InstantStartBattleObjective (field-level refine: opponentAIs length > 0)
  { id: "o6", task: "move_to_location" }, // MoveToObjective
  { id: "o7", task: "collect_item" }, // CollectItem
  { id: "o8", task: "deliver_item" }, // DeliverItem
  { id: "o9", task: "defeat_opponents" }, // DefeatOpponents
  { id: "o10", task: "dialog" }, // DialogObjective
  { id: "o11", task: "win_encounter_at_location" }, // EncountersAtLocation
  {
    id: "o12",
    task: "open_raid",
    sector: 1,
    opponentAIs: [{ ids: ["ai1"], number: 100, quantity: 1 }],
  }, // RaidObjective (z.enum; sector required, opponentAIs refine)
] as const;

describe("AllObjectives discriminated union", () => {
  it("parses every objective family round-trip with task preserved", () => {
    for (const input of validObjectives) {
      const result = AllObjectives.safeParse(input);
      expect(result.success, `failed to parse ${input.task}`).toBe(true);
      if (result.success) expect(result.data.task).toBe(input.task);
    }
  });

  it("dispatches a member-specific field error to that field's path", () => {
    const result = AllObjectives.safeParse({
      id: "y",
      task: "collect_item",
      collectItemIds: "not-an-array",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.path[0] === "collectItemIds"),
      ).toBe(true);
    }
  });

  it("rejects an unknown task via the task discriminator", () => {
    const result = AllObjectives.safeParse({ id: "x", task: "totally_unknown" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0];
      expect(issue?.path).toEqual(["task"]);
      expect(issue?.message).toMatch(/discriminator/i);
    }
  });
});
