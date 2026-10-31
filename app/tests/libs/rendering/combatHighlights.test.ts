import { describe, expect, it } from "bun:test";
import { Grid, rectangle } from "honeycomb-grid";
import type { CombatAction, ReturnedBattle } from "@/libs/combat/types";
import { defineHex } from "@/libs/hexgrid";
import { combatHighlightEdges, combatHighlightPlan } from "@/libs/rendering/combatHighlights";
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


describe("combat targeting surface edges", () => {
  const pair = () => {
    const { grid } = fixture();
    return [grid.getHex({ col: 1, row: 1 })!, grid.getHex({ col: 1, row: 2 })!] as const;
  };
  const segments = (batches: ReturnType<typeof combatHighlightEdges>) => batches.flatMap(({ layer, color, points }) =>
    Array.from({ length: points.length / 4 }, (_, i) => ({ layer, color, points: points.slice(i * 4, i * 4 + 4) })));
  const shared = (a: ReturnType<typeof pair>[0], b: ReturnType<typeof pair>[1], offset = 0) => {
    const corners = a.corners.filter(p => b.corners.some(q => Math.hypot(p.x - q.x, p.y - q.y) < 0.0001));
    expect(corners).toHaveLength(2);
    return corners.flatMap(p => [p.x, p.y + offset]);
  };
  const matches = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]!) < 0.0001) ||
    a.every((v, i) => Math.abs(v - b[(i + 2) % 4]!) < 0.0001);
  it.each([0, -4])("draws shared edges once on a flat or recessed surface at %s", (offset) => {
    const [a, b] = pair(), offsets = new Map([["1,1", offset], ["1,2", offset]]);
    const edges = segments(combatHighlightEdges([{ tile: a, color: 1 }, { tile: b, color: 1 }], offsets));
    expect(edges).toHaveLength(11);
    expect(edges.filter(e => matches(e.points, shared(a, b, offset)))).toHaveLength(1);
    expect(edges.every(e => e.layer === (offset < 0 ? -0.5 : 0))).toBe(true);
  });
  it("omits both rims of internal shoreline steps within a continuous range", () => {
    const [a, b] = pair(), offsets = new Map([["1,1", 0], ["1,2", -4]]);
    for (const selections of [[a, b], [b, a], [a, b, a]]) {
      const edges = segments(combatHighlightEdges(selections.map(tile => ({ tile, color: 1 })), offsets));
      expect(edges).toHaveLength(10);
      for (const offset of [0, -4]) expect(edges.some(e => matches(e.points, shared(a, b, offset)))).toBe(false);
    }
  });
  it.each([0, 1])("gives the selected tile %s sole ownership of its coastal border", (selectedIndex) => {
    const tiles = pair(), [a, b] = tiles, selected = tiles[selectedIndex]!;
    const offsets = new Map([["1,1", 0], ["1,2", -4]]), offset = offsets.get(`${selected.col},${selected.row}`)!;
    const edges = segments(combatHighlightEdges([
      { tile: a, color: 1 }, { tile: b, color: 1 }, { tile: selected, color: 2 },
    ], offsets));
    expect(edges).toHaveLength(11);
    expect(edges.filter(e => e.color === 2)).toHaveLength(6);
    const seam = edges.filter(e => matches(e.points, shared(a, b, offset)));
    expect(seam).toHaveLength(1); expect(seam[0]).toMatchObject({ color: 2, layer: offset < 0 ? -0.5 : 0 });
    expect(edges.some(e => matches(e.points, shared(a, b, offset === 0 ? -4 : 0)))).toBe(false);
  });
  it("removes every outline when targeting clears", () => {
    expect(combatHighlightEdges([], new Map())).toEqual([]);
  });
});
