import { describe, expect, it } from "bun:test";
import { TD_COORD_SCALE } from "@/libs/towerDefense/balance";
import {
  applyAction,
  createRun,
  stepRun,
  type TdEvent,
  type TdState,
} from "@/libs/towerDefense/sim";

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

  it("sets off a tag a raider walks onto as a ground blast", () => {
    const state = runWithEnemy(true);
    const raider = state.enemies[0];
    if (!raider) throw new Error("No raider on the field");
    // Lay the tag a step ahead of the raider, on its way to the hero.
    const ahead = 0.6 / Math.max(0.01, Math.hypot(raider.x, raider.y));
    const at = [raider.x * (1 - ahead), raider.y * (1 - ahead)].map((value) =>
      Math.round(value * TD_COORD_SCALE),
    );
    expect(applyAction(state, [state.tick, "trap", at[0] ?? 0, at[1] ?? 0])).toBe(true);
    const blasts: TdEvent[] = [];
    for (let i = 0; i < 400 && state.traps.length > 0; i++) {
      stepRun(state);
      blasts.push(...state.events.filter((event) => event.type === "explosion"));
      state.events.length = 0;
    }
    expect(state.traps).toHaveLength(0);
    expect(blasts).toContainEqual(
      expect.objectContaining({ cause: "tag", element: "fire" }),
    );
  });

  it("lands mortar shells as ground blasts and lists what a frost pulse chills", () => {
    const state = createRun(
      { seed: "sentries", startWave: 1, bestWave: 0, level: 1, dojo: { st_slots: 2 } },
      true,
    );
    state.ryo = 10_000;
    expect(applyAction(state, [state.tick, "build", 0, "mortar"])).toBe(true);
    expect(applyAction(state, [state.tick, "build", 1, "frost"])).toBe(true);
    applyAction(state, [state.tick, "call"]);
    const events: TdEvent[] = [];
    for (let i = 0; i < 3000 && !state.over; i++) {
      stepRun(state);
      events.push(...state.events);
      state.events.length = 0;
      const landed = events.some((e) => e.type === "explosion" && e.cause === "mortar");
      const pulsed = events.some((e) => e.type === "frostPulse");
      if (landed && pulsed) break;
    }
    expect(events).toContainEqual(
      expect.objectContaining({ type: "explosion", cause: "mortar", element: "fire" }),
    );
    const pulse = events.find((event) => event.type === "frostPulse");
    expect(pulse?.type === "frostPulse" && pulse.ids.length).toBeGreaterThan(0);
  });
});
