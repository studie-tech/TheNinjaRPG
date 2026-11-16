import { describe, expect, it } from "bun:test";
import { applyAction, createRun, stepRun, type TdState } from "@/libs/towerDefense/sim";

/** A fresh run stepped until its first enemy is on the field. */
const runWithEnemy = (): TdState => {
  const state = createRun({
    seed: "telegraph",
    startWave: 1,
    bestWave: 0,
    level: 1,
    dojo: {},
  });
  applyAction(state, [state.tick, "call"]);
  while (state.enemies.length === 0) stepRun(state);
  return state;
};

describe("tower defense simulation", () => {
  it("cancels a slam when the enemy that raised it dies", () => {
    const state = runWithEnemy();
    const caster = state.enemies[0];
    if (!caster) throw new Error("No enemy spawned");
    const strike = {
      x: state.hero.x,
      y: state.hero.y,
      radius: 2.2,
      start: state.tick,
      due: state.tick + 5,
      damage: state.stats.maxHp * 10,
      enemyDamage: 0,
    };
    state.telegraphs.push(
      { ...strike, id: state.nextId++, sourceId: caster.id, kind: "slam" },
      { ...strike, id: state.nextId++, sourceId: 0, damage: 0, kind: "meteor" },
    );
    caster.hp = 0;
    stepRun(state);
    expect(state.telegraphs.map((telegraph) => telegraph.kind)).toEqual(["meteor"]);
    const health = state.hero.hp;
    for (let tick = 0; tick < 10; tick++) stepRun(state);
    expect(state.over).toBe(false);
    expect(state.hero.hp).toBeGreaterThanOrEqual(health);
  });
});
