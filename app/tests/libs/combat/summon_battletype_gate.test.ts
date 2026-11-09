import { describe, it, expect } from "bun:test";
import { isSummonActionCastable } from "@/libs/combat/summon";
import { BattleTypes, AutoBattleTypes } from "@/drizzle/constants";
import type { Battle } from "@/drizzle/schema";
import type { CombatAction } from "@/libs/combat/types";

/**
 * Guards the AI candidate filter. Without this, deleting the filter outright is
 * invisible to the suite: the AI would pay its turn for a summon that summon()
 * then refuses, and since `does_not_have_summon` stays true it would re-cast
 * every round for the whole fight.
 */

const action = (...effects: unknown[]) =>
  ({ effects }) as unknown as Pick<CombatAction, "effects">;
const bt = (battleType: string) =>
  ({ battleType }) as unknown as Pick<Battle, "battleType">;

const summonAction = action({ type: "summon", aiId: "ai-1" });
const damageAction = action({ type: "damage", power: 10 });
const mixedAction = action({ type: "damage" }, { type: "summon", aiId: "ai-1" });

describe("summon actions in auto-resolved battle types", () => {
  for (const t of AutoBattleTypes) {
    it(`drops a summon action in ${t}`, () => {
      expect(isSummonActionCastable(summonAction, bt(t))).toBe(false);
    });
    it(`drops a mixed action carrying a summon tag in ${t}`, () => {
      expect(isSummonActionCastable(mixedAction, bt(t))).toBe(false);
    });
    it(`keeps non-summon actions in ${t}`, () => {
      expect(isSummonActionCastable(damageAction, bt(t))).toBe(true);
      expect(isSummonActionCastable(action(), bt(t))).toBe(true);
    });
  }
});

describe("every other battle type keeps summon actions", () => {
  it.each(BattleTypes.filter((t) => !AutoBattleTypes.includes(t)))("keeps summon actions in %s", (t) => {
    expect(isSummonActionCastable(summonAction, bt(t))).toBe(true);
    expect(isSummonActionCastable(mixedAction, bt(t))).toBe(true);
  });
});
