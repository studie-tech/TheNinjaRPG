import { describe, expect, it } from "bun:test";
import {
  ActionEndTurn,
  AiRule,
  ConditionSpecificRound,
  normalizeAiRuleRounds,
  updateAiProfileSchema,
} from "@/validators/ai";

describe("AI specific rounds", () => {
  it("defaults to one round and sorts and deduplicates selected rounds", () => {
    expect(ConditionSpecificRound.parse({}).value).toEqual([10]);
    expect(ConditionSpecificRound.parse({ value: [5, "1", 3, 1] }).value).toEqual([
      1, 3, 5,
    ]);
  });

  it.each([2, "2"])("normalizes stored scalar %j into a list", (value) => {
    expect(ConditionSpecificRound.parse({ value }).value).toEqual([2]);
  });

  it.each(
    [
      [],
      [0],
      [-1],
      [1.5],
      [NaN],
      [Infinity],
      [""],
      [null],
      [true],
      "",
      null,
      true,
      "1, 3",
      [1, "abc"],
    ].map((value) => ({ value })),
  )("rejects invalid rounds %j", ({ value }) => {
    expect(
      updateAiProfileSchema.safeParse({
        id: "profile",
        includeDefaultRules: false,
        rules: [
          {
            conditions: [{ type: "specific_round", value }],
            action: ActionEndTurn.parse({}),
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("normalizes loaded rules without mutating the source", () => {
    const rules = [
      AiRule.parse({
        conditions: [ConditionSpecificRound.parse({ value: [3, 1] })],
        action: ActionEndTurn.parse({}),
      }),
    ];
    Object.assign(rules[0]!.conditions[0]!, {
      value: 3,
      description: "A specific round number",
    });
    expect(normalizeAiRuleRounds(rules)[0]!.conditions[0]).toMatchObject({
      value: [3],
      description: "One of the specified rounds",
    });
    expect(rules[0]!.conditions[0]).toMatchObject({ value: 3 });
  });
});
