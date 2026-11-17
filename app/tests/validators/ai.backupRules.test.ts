import { describe, expect, it } from "bun:test";
import {
  ActionEndTurn,
  AiRule,
  type AiRuleType,
  countCustomRules,
  endsWithBackupRules,
  enforceExtraRules,
  getBackupRules,
} from "@/validators/ai";

const custom = (count: number): AiRuleType[] =>
  Array.from({ length: count }, () =>
    AiRule.parse({ conditions: [], action: ActionEndTurn.parse({}) }),
  );

describe("backup rules", () => {
  it("recognises the backup rules at the end of a profile, whatever their labels", () => {
    const labelled = getBackupRules().map((rule) => ({
      ...rule,
      group: { id: "g", name: "Fallback", note: "" },
    }));
    expect(endsWithBackupRules([...custom(2), ...labelled])).toBe(true);
    expect(endsWithBackupRules(custom(7))).toBe(false);
    expect(endsWithBackupRules(getBackupRules().slice(1))).toBe(false);
  });

  it("counts custom rules without the trailing backup rules", () => {
    expect(countCustomRules([...custom(20), ...getBackupRules()])).toBe(20);
    expect(countCustomRules(custom(21))).toBe(21);
    expect(countCustomRules(getBackupRules())).toBe(0);
  });

  it("appends the backup rules only when they are missing", () => {
    const withTail = [...custom(1), ...getBackupRules()];
    enforceExtraRules(withTail, getBackupRules());
    expect(withTail).toHaveLength(1 + getBackupRules().length);
    const without = custom(1);
    enforceExtraRules(without, getBackupRules());
    expect(endsWithBackupRules(without)).toBe(true);
  });
});
