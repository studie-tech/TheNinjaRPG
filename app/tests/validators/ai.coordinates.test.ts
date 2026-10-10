import { describe, expect, it } from "bun:test";
import { AiRule, getActionSchema, AiActionTypes, type ZodAllAiAction, ConditionDistanceHigherThan, updateAiProfileSchema } from "@/validators/ai";

describe("AI coordinate validation", () => {
  it.each(AiActionTypes.filter((type) => type !== "end_turn"))("accepts coordinates for %s", (type) => {
    const action = getActionSchema(type as ZodAllAiAction["type"]).parse({ target: "COORDINATE", coordinates: { longitude: "0", latitude: "4" } });
    expect(AiRule.parse({ conditions: [], action }).action).toMatchObject({ coordinates: { longitude: 0, latitude: 4 } });
  });
  it.each([undefined, {}, { longitude: 1 }, { longitude: -1, latitude: 0 }, { longitude: 1.5, latitude: 0 }, { longitude: "", latitude: 0 }, { longitude: null, latitude: 0 }, { longitude: Infinity, latitude: 0 }, { longitude: 0, latitude: NaN }])("rejects missing or invalid pair %j", (coordinates) => {
    expect(updateAiProfileSchema.safeParse({ id: "ai", includeDefaultRules: true, rules: [{ conditions: [], action: { type: "move_towards_opponent", target: "COORDINATE", coordinates } }] }).success).toBe(false);
  });
  it("keeps old rules valid without coordinates", () => {
    expect(AiRule.safeParse({ conditions: [], action: getActionSchema("move_towards_opponent").parse({}) }).success).toBe(true);
  });
  it("keeps coordinate targeting out of condition selectors", () => {
    expect(ConditionDistanceHigherThan.safeParse({ target: "COORDINATE" }).success).toBe(false);
  });
});
