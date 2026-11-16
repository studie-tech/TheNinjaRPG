import { describe, expect, it } from "bun:test";
import {
  tdLevelDamageBonus,
  tdReferenceBounty,
  tdReferenceDamage,
  tdReferenceHealth,
} from "@/libs/towerDefense/balance";
import { tdCheckpoints } from "@/libs/towerDefense/content";
import { formatTdNumber } from "@/libs/towerDefense/format";
import { createRun } from "@/libs/towerDefense/sim";
import { TD_MAX_TICKS } from "@/validators/towerDefense";
import { playBotRun, veteranDojo } from "./bot";

const play = (scale: number, seed: string) =>
  playBotRun(
    { seed, startWave: 1, bestWave: 5000, level: 1, dojo: veteranDojo(scale) },
    { seed: 3, ticks: TD_MAX_TICKS },
  ).state;

describe("tower defense balance", () => {
  it("stops a brand-new ninja early, so the Dojo matters from the first run", () => {
    const state = play(0, "fresh");
    expect(state.over).toBe(true);
    expect(state.wave).toBeLessThan(40);
  });

  // A maxed run plays up to TD_MAX_TICKS, several seconds on a loaded CI runner.
  it("ends even a fully maxed Dojo run within what a claim can replay", () => {
    const state = play(1, "maxed");
    expect(state.over).toBe(true);
    expect(state.tick).toBeLessThan(TD_MAX_TICKS);
  }, 30_000);

  it("keeps enemy health ahead of bounty at every wave", () => {
    let previous = 0;
    for (let wave = 1; wave <= 1500; wave++) {
      const health = tdReferenceHealth(wave);
      expect(health).toBeGreaterThanOrEqual(previous);
      previous = health;
      expect(health / tdReferenceBounty(wave)).toBeGreaterThanOrEqual(12);
      expect(tdReferenceDamage(wave)).toBeLessThanOrEqual(health);
    }
    expect(Number.isFinite(tdReferenceHealth(6000))).toBe(true);
  });

  it("adds damage linearly with character level, doubling it at level 100", () => {
    expect([0, 1, 50, 100, 150, Number.NaN].map(tdLevelDamageBonus)).toEqual([
      0,
      0,
      49 / 99,
      1,
      1,
      0,
    ]);
    const damageAt = (level: number) =>
      createRun({ seed: "lvl", startWave: 1, bestWave: 0, level, dojo: {} }).stats
        .damage;
    expect(damageAt(100)).toBeCloseTo(damageAt(1) * 2);
  });

  it("offers checkpoints just after each boss, up to 70% of the best wave", () => {
    expect(tdCheckpoints(0)).toEqual([1]);
    expect(tdCheckpoints(31)).toEqual([1, 11, 21]);
    expect(tdCheckpoints(480).at(-1)).toBe(331);
    // 70% of 330 is exactly 231, which floating-point multiplication lands just below.
    expect(tdCheckpoints(330).at(-1)).toBe(231);
    expect(tdCheckpoints(480).every((wave) => wave % 10 !== 0)).toBe(true);
  });

  it("formats huge numbers in short scale", () => {
    expect(
      [999, 1000, 1234, 999_999, 1.5e6, 2.04e9, 7.7e13, 1e60, 2.5e40].map(
        formatTdNumber,
      ),
    ).toEqual(["999", "1K", "1.23K", "1M", "1.5M", "2.04B", "77T", "1e60", "2.5e40"]);
  });
});
