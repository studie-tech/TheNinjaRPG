import { describe, expect, it } from "bun:test";
import {
  AllObjectives,
  allObjectiveTasks,
  getObjectiveSchema,
} from "@/validators/objectives";

const base = (extra: Record<string, unknown>) => ({
  id: "o1",
  description: "",
  successDescription: "",
  ...extra,
});

const NEW_TASKS = [
  "craft_specific_item",
  "train_specific_jutsu",
  "complete_specific_quest",
  "buy_item",
  "use_specific_item_combat",
  "use_specific_jutsu_combat",
  "tag_usage_win",
  "damage_dealt",
] as const;

describe("getObjectiveSchema resolution", () => {
  it("returns the union member that declares each task", () => {
    for (const task of allObjectiveTasks) {
      const schema = getObjectiveSchema(task);
      expect(AllObjectives.options).toContain(schema as never);
      expect(schema.shape.task.safeParse(task).success, task).toBe(true);
    }
  });

  it("rejects an unknown task", () => {
    expect(() => getObjectiveSchema("not_a_task")).toThrow();
  });
});

describe("specific-X / tag / damage objective schemas", () => {
  it("registers each of these tasks in allObjectiveTasks", () => {
    for (const task of NEW_TASKS) {
      expect(allObjectiveTasks).toContain(task);
    }
  });

  it("parses a freshly-added objective (id + task only) so the editor renders its pickers", () => {
    // The editor safeParses the objective and renders fields from the PARSED result; a
    // required field with no default makes parse fail, the raw object is used instead, and
    // that field's picker never renders. Each of these tasks must parse from just id + task
    // (e.g. tag_usage_win's tagType must default to a valid tag).
    for (const task of NEW_TASKS) {
      const result = getObjectiveSchema(task).safeParse(base({ task }));
      expect(result.success, `fresh ${task} must parse for the editor`).toBe(true);
    }
  });

  it("parses a minimal craft_specific_item objective with value defaulting to 1", () => {
    const parsed = getObjectiveSchema("craft_specific_item").parse(
      base({ task: "craft_specific_item", craftItemIds: ["item-1"] }),
    );
    expect(parsed.task).toBe("craft_specific_item");
    expect((parsed as { value: number }).value).toBe(1);
    expect((parsed as { craftItemIds: string[] }).craftItemIds).toEqual(["item-1"]);
  });

  it("parses tag_usage_win and rejects a non-combat tagType", () => {
    const schema = getObjectiveSchema("tag_usage_win");
    expect(
      schema.safeParse(base({ task: "tag_usage_win", tagType: "poison" })).success,
    ).toBe(true);
    expect(
      schema.safeParse(base({ task: "tag_usage_win", tagType: "repair" })).success,
    ).toBe(false);
  });

  it("parses damage_dealt with singleBattle defaulting to false", () => {
    const parsed = getObjectiveSchema("damage_dealt").parse(
      base({ task: "damage_dealt", value: 500 }),
    );
    expect((parsed as { singleBattle: boolean }).singleBattle).toBe(false);
    expect((parsed as { value: number }).value).toBe(500);
  });

  it("accepts each of these objectives through AllObjectives", () => {
    const samples = [
      base({ task: "craft_specific_item", craftItemIds: ["i1"], value: 1 }),
      base({ task: "train_specific_jutsu", trainJutsuIds: ["j1"], value: 1 }),
      base({ task: "complete_specific_quest", completeQuestIds: ["q1"], value: 1 }),
      base({ task: "buy_item", buyItemIds: ["i1"], value: 1 }),
      base({ task: "use_specific_item_combat", useItemIds: ["i1"], value: 1 }),
      base({ task: "use_specific_jutsu_combat", useJutsuIds: ["j1"], value: 1 }),
      base({ task: "tag_usage_win", tagType: "poison", value: 1 }),
      base({ task: "damage_dealt", value: 500, singleBattle: true }),
    ];
    for (const sample of samples) {
      expect(AllObjectives.safeParse(sample).success).toBe(true);
    }
  });
});
