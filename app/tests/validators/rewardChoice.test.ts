import { describe, expect, it } from "bun:test";
import { QuestValidatorRawSchema } from "@/validators/objectives";
import {
  ClaimRewardChoiceSchema,
  PendingRewardChoiceSchema,
} from "@/validators/rewards";

const contentSchema = QuestValidatorRawSchema.shape.content;

describe("quest reward mode", () => {
  it("defaults stored content without a mode to granting every reward", () => {
    const parsed = contentSchema.parse({ objectives: [], reward: {} });
    expect(parsed.rewardMode).toBe("all");
    expect(parsed.rewardPickCount).toBe(1);
  });

  it("accepts choose with 1 to 5 picks and rejects anything outside", () => {
    expect(
      contentSchema.parse({
        objectives: [],
        reward: {},
        rewardMode: "choose",
        rewardPickCount: "5",
      }).rewardPickCount,
    ).toBe(5);
    for (const rewardPickCount of [0, 6, 2.5]) {
      expect(
        contentSchema.safeParse({
          objectives: [],
          reward: {},
          rewardMode: "choose",
          rewardPickCount,
        }).success,
      ).toBe(false);
    }
    expect(
      contentSchema.safeParse({ objectives: [], reward: {}, rewardMode: "some" }).success,
    ).toBe(false);
  });
});

describe("reward choice payloads", () => {
  it("rejects stored offers without cards or with an unknown field", () => {
    expect(PendingRewardChoiceSchema.safeParse({ id: "o", pickCount: 1, cards: [] }).success).toBe(
      false,
    );
    expect(
      PendingRewardChoiceSchema.safeParse({
        id: "o",
        pickCount: 1,
        cards: [{ id: "c", field: "reward_rank", amount: 1 }],
      }).success,
    ).toBe(false);
  });

  it("caps a claim at the maximum pick count", () => {
    const base = { questId: "q", choiceId: "o" };
    // Empty clears an offer whose every card the player already holds.
    expect(ClaimRewardChoiceSchema.safeParse({ ...base, cardIds: [] }).success).toBe(true);
    expect(
      ClaimRewardChoiceSchema.safeParse({ ...base, cardIds: ["1", "2", "3", "4", "5", "6"] })
        .success,
    ).toBe(false);
    expect(ClaimRewardChoiceSchema.safeParse({ ...base, cardIds: ["1"] }).success).toBe(true);
  });
});
