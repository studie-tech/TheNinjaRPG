import { describe, expect, it } from "bun:test";
import {
  ActionEndTurn,
  ActionSpecificCombo,
  ActionUseRandomJutsu,
  ActionUseSpecificItem,
  ActionUseSpecificJutsu,
  AiRule,
  type AiRuleType,
  countRulesWithUnequippedActions,
  getBackupRules,
} from "@/validators/ai";

const rule = (action: AiRuleType["action"]) => AiRule.parse({ conditions: [], action });

describe("rules naming jutsu or items that are not equipped", () => {
  it("counts each rule that names an action the fighter cannot use", () => {
    const rules = [
      rule(ActionUseSpecificJutsu.parse({ jutsuId: "fire" })),
      rule(ActionUseSpecificJutsu.parse({ jutsuId: "water" })),
      rule(ActionUseSpecificItem.parse({ itemId: "bomb" })),
      rule(ActionUseSpecificItem.parse({ itemId: "pill" })),
      rule(ActionSpecificCombo.parse({ comboIds: ["water", "fire"] })),
      rule(ActionSpecificCombo.parse({ comboIds: ["water", "pill"] })),
      ...getBackupRules(),
    ];
    expect(countRulesWithUnequippedActions(rules, ["water", "pill"])).toBe(3);
  });

  it("does not count rules that name nothing yet or pick from what is equipped", () => {
    const rules = [
      rule(ActionUseSpecificJutsu.parse({})),
      rule(ActionUseSpecificItem.parse({})),
      rule(ActionUseRandomJutsu.parse({})),
      rule(ActionEndTurn.parse({})),
    ];
    expect(countRulesWithUnequippedActions(rules, [])).toBe(0);
  });
});
