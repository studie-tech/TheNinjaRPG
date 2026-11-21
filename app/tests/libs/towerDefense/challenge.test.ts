import { describe, expect, it } from "bun:test";
import {
  createRun,
  stepRun,
  type TdChallenge,
  type TdRunConfig,
  tdCanCallWave,
  tdChallengeFinalWave,
} from "@/libs/towerDefense/sim";
import { playBotRun, replayRun, tdStateHash, veteranDojo } from "./bot";

const config = (challenge?: TdChallenge, startWave = 1): TdRunConfig => ({
  seed: "challenge",
  startWave,
  bestWave: 0,
  level: 50,
  dojo: veteranDojo(0.5),
  ...(challenge ? { challenge } : {}),
});

const easy: TdChallenge = { waves: 3, enemyHealth: 100, enemyDamage: 100 };

/** A run stepped until its first enemy is on the field. */
const firstEnemy = (challenge?: TdChallenge) => {
  const state = createRun(config(challenge));
  while (state.enemies.length === 0) stepRun(state);
  const enemy = state.enemies[0];
  if (!enemy) throw new Error("No enemy spawned");
  return enemy;
};

describe("tower defense challenges", () => {
  it("is won once the last wave is cleared, and never sends another", () => {
    const { state } = playBotRun(config(easy), { seed: 1, ticks: 20_000 });
    expect(state.over).toBe(true);
    expect(state.won).toBe(true);
    expect(state.quit).toBe(false);
    expect(state.wave).toBe(3);
    expect(state.enemies).toHaveLength(0);
    expect(state.spawnQueue).toHaveLength(0);
  });

  it("counts its waves from the start wave", () => {
    expect(tdChallengeFinalWave(config(easy, 11))).toBe(13);
    expect(tdChallengeFinalWave(config({ ...easy, waves: 1 }, 20))).toBe(20);
    expect(tdChallengeFinalWave(config())).toBeNull();
    const { state } = playBotRun(config({ ...easy, waves: 2 }, 11), {
      seed: 2,
      ticks: 20_000,
    });
    expect(state.won).toBe(true);
    expect(state.wave).toBe(12);
  });

  it("holds the last wave open until it is cleared instead of calling the next", () => {
    const state = createRun(config({ ...easy, waves: 1 }));
    // Waves normally advance on a timer whether or not the field is clear.
    for (let i = 0; i < 2000 && !state.over; i++) stepRun(state);
    expect(state.wave).toBe(1);
    expect(tdCanCallWave(state)).toBe(false);
  });

  it("scales enemy health and damage by its percentages", () => {
    const normal = firstEnemy();
    const strong = firstEnemy({ waves: 5, enemyHealth: 250, enemyDamage: 40 });
    expect(strong.kind).toBe(normal.kind);
    expect(strong.maxHp).toBeCloseTo(normal.maxHp * 2.5, 6);
    expect(strong.damage).toBeCloseTo(normal.damage * 0.4, 6);
  });

  it("is lost when the hero falls before the last wave", () => {
    const { state } = playBotRun(
      {
        seed: "challenge",
        startWave: 60,
        bestWave: 0,
        level: 1,
        dojo: {},
        challenge: { waves: 20, enemyHealth: 1000, enemyDamage: 1000 },
      },
      { seed: 3, ticks: 50_000 },
    );
    expect(state.over).toBe(true);
    expect(state.won).toBe(false);
  });

  it("is lost when a hit fells the hero on the tick the last wave clears", () => {
    const state = createRun(config({ ...easy, waves: 1 }));
    while (state.enemies.length === 0) stepRun(state);
    // The last enemy is gone, but a shot it fired lands on the next tick.
    state.enemies = [];
    state.spawnQueue = [];
    state.hero.subUntil = -1;
    const lethal = state.stats.maxHp * 100;
    state.shots = [
      { due: state.tick + 1, damage: lethal, sourceId: 0, telegraphed: false },
    ];
    stepRun(state);
    expect(state.over).toBe(true);
    expect(state.hero.hp).toBe(0);
    expect(state.won).toBe(false);
  });

  it("replays a won challenge to the same win", () => {
    const { state, log } = playBotRun(config(easy), { seed: 4, ticks: 20_000 });
    expect(state.won).toBe(true);
    const replay = replayRun(config(easy), log, state.tick);
    expect(replay.invalidAt).toBeNull();
    expect(replay.state.won).toBe(true);
    expect(tdStateHash(replay.state)).toBe(tdStateHash(state));
  });

  it("does not replay as a win under endless rules", () => {
    const { state, log } = playBotRun(config(easy), { seed: 5, ticks: 20_000 });
    const replay = replayRun(config(), log, state.tick);
    expect(replay.state.won).toBe(false);
  });
});
