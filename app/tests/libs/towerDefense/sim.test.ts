import { describe, expect, it } from "bun:test";
import { applyAction, createRun, stepRun, type TdState } from "@/libs/towerDefense/sim";

/** A fresh run stepped until its first enemy is on the field. */
const runWithEnemy = (recordEvents = false): TdState => {
  const state = createRun(
    {
      seed: "telegraph",
      startWave: 1,
      bestWave: 0,
      level: 1,
      dojo: {},
    },
    recordEvents,
  );
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

  it("announces a ranged attack when it is fired, landing when the shot does", () => {
    const state = runWithEnemy(true);
    const archer = state.enemies[0];
    if (!archer) throw new Error("No enemy spawned");
    // A sturdy ranged enemy already in range, ready to fire.
    Object.assign(archer, {
      range: 5,
      stop: 5,
      x: state.hero.x + 3,
      y: state.hero.y,
      hp: 1e9,
      maxHp: 1e9,
      attackReadyAt: state.tick,
    });
    state.events.length = 0;
    stepRun(state);
    const shot = state.events.find((event) => event.type === "enemyShot");
    expect(shot).toMatchObject({ sourceId: archer.id });
    expect(state.shots.map((pending) => pending.due)).toContain(
      shot?.type === "enemyShot" ? shot.due : -1,
    );
  });
});
