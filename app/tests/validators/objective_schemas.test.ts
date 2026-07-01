import { describe, expect, it } from "vitest";
import {
  AllObjectives,
  allObjectiveSchema,
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

describe("specific-X / tag / damage objective schemas", () => {
  it("registers every new task in allObjectiveTasks", () => {
    for (const task of NEW_TASKS) {
      expect(allObjectiveTasks).toContain(task);
    }
  });

  it("routes every new task through getObjectiveSchema without throwing", () => {
    for (const task of NEW_TASKS) {
      expect(() => getObjectiveSchema(task)).not.toThrow();
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

  it("accepts each new objective through AllObjectives and allObjectiveSchema", () => {
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
      expect(allObjectiveSchema.safeParse(sample).success).toBe(true);
    }
  });
});
