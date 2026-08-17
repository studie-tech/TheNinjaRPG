import { describe, it, expect } from "vitest";
import { wantsHumanActionSet } from "@/libs/combat/util";
import type { BattleUserState } from "@/libs/combat/types";

const actor = (o: Partial<BattleUserState>): BattleUserState =>
  ({ userId: "x", isAi: false, isSummon: false, ...o }) as unknown as BattleUserState;

describe("wantsHumanActionSet", () => {
  it("human player -> human set", () => {
    expect(wantsHumanActionSet(actor({ isAi: false }))).toBe(true);
  });
  it("AI NPC -> AI set", () => {
    expect(wantsHumanActionSet(actor({ isAi: true }))).toBe(false);
  });
  it("AI (non-piloted) summon -> AI set", () => {
    expect(
      wantsHumanActionSet(actor({ isAi: true, isSummon: true })),
    ).toBe(false);
  });
  it("piloted summon -> human set", () => {
    expect(
      wantsHumanActionSet(actor({ isAi: true, isSummon: true, isPiloted: true })),
    ).toBe(true);
  });
});
