import { describe, expect, it } from "bun:test";
import { TD_DOJO_INFO } from "@/libs/towerDefense/content";
import {
  buyLocalDojoLevel,
  parseLocalProgress,
  settleLocalRun,
  TD_EMPTY_LOCAL_PROGRESS,
} from "@/libs/towerDefense/localProgress";
import { createRun, tdDojoCost } from "@/libs/towerDefense/sim";

describe("tower defense local progress", () => {
  it("reads only valid numbers and known upgrades from storage", () => {
    expect(parseLocalProgress(null)).toEqual(TD_EMPTY_LOCAL_PROGRESS);
    expect(parseLocalProgress("not json")).toEqual(TD_EMPTY_LOCAL_PROGRESS);
    expect(
      parseLocalProgress(
        JSON.stringify({
          points: 12.7,
          bestWave: -3,
          dojo: { dmg: 2, bogus: 4, rate: "1" },
        }),
      ),
    ).toEqual({ points: 12, bestWave: 0, dojo: { dmg: 2 } });
  });

  it("banks a run's scrolls and keeps the best wave", () => {
    const state = createRun({
      seed: "s",
      startWave: 12,
      bestWave: 30,
      level: 1,
      dojo: {},
    });
    state.scrolls = 41.9;
    const progress = { points: 10, bestWave: 30, dojo: {} };
    const settled = settleLocalRun(progress, state);
    expect(settled.points).toBe(41);
    expect(settled.progress).toEqual({ points: 51, bestWave: 30, dojo: {} });
    state.wave = 44;
    expect(settleLocalRun(progress, state).progress.bestWave).toBe(44);
  });

  it("buys Guard Hall levels under the server's rules", () => {
    const cost = tdDojoCost("dmg", 0);
    const bought = buyLocalDojoLevel(
      { points: cost + 5, bestWave: 0, dojo: {} },
      "dmg",
    );
    expect(bought).toEqual({
      level: 1,
      progress: { points: 5, bestWave: 0, dojo: { dmg: 1 } },
    });
    expect(
      buyLocalDojoLevel({ points: cost - 1, bestWave: 0, dojo: {} }, "dmg"),
    ).toEqual({
      message: "Not enough scrolls.",
    });
    const maxed = { points: 1e12, bestWave: 1e4, dojo: { dmg: TD_DOJO_INFO.dmg.max } };
    expect(buyLocalDojoLevel(maxed, "dmg")).toEqual({
      message: "Already at max level.",
    });
    const locked = Object.entries(TD_DOJO_INFO).find(([, info]) => info.unlockWave > 1);
    if (!locked) throw new Error("Every upgrade is unlocked from the start");
    expect(
      buyLocalDojoLevel({ points: 1e12, bestWave: 0, dojo: {} }, locked[0] as "dmg"),
    ).toEqual({ message: `Reach wave ${locked[1].unlockWave} to unlock this.` });
  });
});
