import { describe, expect, it } from "bun:test";
import {
  AiActionTypes,
  ConditionDistanceHigherThan,
  ConditionDistanceLowerThan,
  ConditionTargetHasEffect,
  getActionSchema,
  type ZodAllAiAction,
} from "@/validators/ai";

describe("AI enmity rank validation", () => {
  const schemas = [
    ...AiActionTypes.filter((type) => type !== "end_turn").map((type) =>
      getActionSchema(type as ZodAllAiAction["type"]),
    ),
    ConditionDistanceHigherThan,
    ConditionDistanceLowerThan,
    ConditionTargetHasEffect,
  ];
  for (const target of ["HIGHEST_ENMITY_OPPONENT", "LOWEST_ENMITY_OPPONENT"]) {
    it(`${target} accepts ranks on all targeting actions and conditions`, () => {
      for (const schema of schemas) {
        expect(schema.parse({ target, enmityRank: "3" })).toMatchObject({
          target,
          enmityRank: 3,
        });
        expect(schema.safeParse({ target }).success).toBe(true);
      }
    });
    it.each([0, -1, 1.5, NaN, Infinity, "", "abc", null, true])(
      `${target} rejects rank %j`,
      (enmityRank) => {
        for (const schema of schemas) {
          expect(schema.safeParse({ target, enmityRank }).success).toBe(false);
        }
      },
    );
  }
});
