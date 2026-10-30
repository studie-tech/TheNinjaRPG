import { describe, expect, it } from "bun:test";
import { Grid, rectangle } from "honeycomb-grid";
import type { CombatAction, ReturnedBattle } from "@/libs/combat/types";
import { defineHex } from "@/libs/hexgrid";
import { combatHighlightPlan } from "@/libs/rendering/combatHighlights";
import { makeBattleUser, makeCompleteBattle } from "../combat/helpers/battleScenario";

const fixture = () => {
  const grid = new Grid(defineHex(), rectangle({ width: 3, height: 3 }));
  const user = makeBattleUser("actor", { longitude: 0, latitude: 0, actionPoints: 100 });
  const action = { id: "wide", name: "Wide range", image: "", battleDescription: "", type: "basic", target: "GROUND", method: "SINGLE", range: 10, healthCost: 0, chakraCost: 0, staminaCost: 0, actionCostPerc: 10, updatedAt: 0, cooldown: 0, originalCooldown: 0, effects: [] } as CombatAction;
  const battle = makeCompleteBattle({ activeUserId: user.userId, usersState: [user] }) as unknown as ReturnedBattle;
  return { grid, user, battle, action, actions: [action], hovered: null, canUse: true, timeDiff: 0 };
};

describe("combat targeting colors", () => {
  it("colors the full range on its first snapshot and newly reachable tiles when range grows", () => {
    const info = fixture();
    const narrow = combatHighlightPlan({ ...info, action: { ...info.action, range: 0 } });
    expect(narrow.tints.size).toBe(1);
    const wide = combatHighlightPlan(info);
    expect(wide.tints.size).toBe(9);
    expect([...wide.tints.values()].every((tint) => tint.color === "#505050" && tint.strength === 0.7)).toBe(true);
  });
  it("places the selected valid color and edge above the range on the first snapshot", () => {
    const info = fixture(), hovered = info.grid.getHex({ col: 1, row: 1 })!;
    const selected = combatHighlightPlan({ ...info, hovered });
    expect(selected.valid).toBe(true);
    expect(selected.tints.get("1,1")).toEqual({ color: "#00ff64", strength: 0.8 });
    expect(selected.edges.at(-1)).toEqual({ tile: hovered, color: 0x00ff64 });
    expect(combatHighlightPlan(info).tints.get("1,1")).toEqual({ color: "#505050", strength: 0.7 });
  });
  it("restores terrain and removes outlines when an action is deselected or unusable", () => {
    const info = fixture();
    for (const plan of [combatHighlightPlan({ ...info, action: undefined }), combatHighlightPlan({ ...info, canUse: false })]) {
      expect(plan.tints.size).toBe(0); expect(plan.edges).toHaveLength(0); expect(plan.valid).toBe(false);
    }
  });
  it("uses explicit authoring footprints without requiring a playable action", () => {
    const info = fixture(), target = info.grid.getHex({ col: 2, row: 2 })!;
    const plan = combatHighlightPlan({ ...info, action: undefined, targetTiles: [target] });
    expect([...plan.tints.keys()]).toEqual(["2,2"]); expect(plan.tints.get("2,2")).toEqual({ color: "#ff3232", strength: 0.8 }); expect(plan.edges).toHaveLength(0);
  });
});
