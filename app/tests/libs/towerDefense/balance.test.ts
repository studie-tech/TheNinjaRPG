import { describe, expect, it } from "bun:test";
import {
  tdReferenceBounty,
  tdReferenceDamage,
  tdReferenceHealth,
} from "@/libs/towerDefense/balance";
import { tdCheckpoints } from "@/libs/towerDefense/content";
import { formatTdNumber } from "@/libs/towerDefense/format";
import { TD_MAX_TICKS } from "@/validators/towerDefense";
import { playBotRun, veteranDojo } from "./bot";

const play = (scale: number, seed: string) =>
  playBotRun(
    { seed, startWave: 1, bestWave: 5000, dojo: veteranDojo(scale) },
    { seed: 3, ticks: TD_MAX_TICKS },
  ).state;

describe("tower defense balance", () => {
  it("stops a brand-new ninja early, so the Dojo matters from the first run", () => {
    const state = play(0, "fresh");
    expect(state.over).toBe(true);
    expect(state.wave).toBeLessThan(40);
  });

  it("ends even a fully maxed Dojo run within what a claim can replay", () => {
    const state = play(1, "maxed");
    expect(state.over).toBe(true);
    expect(state.tick).toBeLessThan(TD_MAX_TICKS);
  });

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

  it("offers checkpoints just after each boss, up to 70% of the best wave", () => {
    expect(tdCheckpoints(0)).toEqual([1]);
    expect(tdCheckpoints(31)).toEqual([1, 11, 21]);
    expect(tdCheckpoints(480).at(-1)).toBe(331);
    expect(tdCheckpoints(480).every((wave) => wave % 10 !== 0)).toBe(true);
  });

  it("formats huge numbers in short scale", () => {
    expect(
      [999, 1000, 1234, 999_999, 1.5e6, 2.04e9, 7.7e13].map(formatTdNumber),
    ).toEqual(["999", "1K", "1.23K", "1M", "1.5M", "2.04B", "77T"]);
  });
});
