import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CS_ENDLESS_SECONDS,
  CS_JUTSU,
  CS_JUTSU_INFO,
  CS_KILLS_PER_TOUGHNESS,
  CS_PASSIVE_INFO,
  CS_RUN_SECONDS,
  CS_SLOTS,
  CS_STAGES,
  CS_TPS,
  CS_TRAINING,
  CS_TRAINING_INFO,
  CS_WADE_SPEED,
  csBossSeconds,
  csExperienceFor,
  csHealthScale,
  csLevelCost,
  csNoTraining,
  csPaced,
  csRunSeconds,
  csSpawnPressure,
  csSwarmSeconds,
  csToughness,
  csTrainingCost,
  csUpgradeText,
} from "@/libs/chakraStorm/content";
import {
  buyCsTraining,
  CS_EMPTY_PROGRESS,
  csNextUnlock,
  csStageUnlocked,
  parseCsProgress,
  settleCsRun,
} from "@/libs/chakraStorm/progress";
import {
  applyCsAction,
  CS_DIRECTIONS,
  type CsRunConfig,
  createCsRun,
  csAwakenable,
  csGroundLayout,
  csSicklePositions,
  draftOptions,
  replayCs,
  stepCs,
} from "@/libs/chakraStorm/sim";
import { playBot } from "./bot";

const HORIZON: CsRunConfig = { stage: "horizon", training: csNoTraining() };

describe("Chakra Storm simulation", () => {
  it("replays a recorded log to the same night", () => {
    for (const [seed, stage] of [
      ["alpha", "horizon"],
      ["beta", "akikaze"],
    ] as const) {
      const config: CsRunConfig = { stage, training: csNoTraining() };
      const { state, log } = playBot(seed, 4 * 60 * CS_TPS, config);
      const replay = replayCs(seed, config, log, state.tick);
      expect(replay.tick).toBe(state.tick);
      expect(replay.kills).toBe(state.kills);
      expect(replay.hero).toEqual(state.hero);
      expect(replay.jutsu).toEqual(state.jutsu);
      expect(replay.passives).toEqual(state.passives);
      expect(
        replay.enemies.map((enemy) => [enemy.id, enemy.x, enemy.y, enemy.hp]),
      ).toEqual(state.enemies.map((enemy) => [enemy.id, enemy.x, enemy.y, enemy.hp]));
    }
  });

  it("plays the same seed differently on different stages", () => {
    const a = playBot("stage", 60 * CS_TPS, HORIZON).state;
    const b = playBot("stage", 60 * CS_TPS, {
      stage: "mei",
      training: csNoTraining(),
    }).state;
    expect(a.enemies.map((enemy) => enemy.x)).not.toEqual(
      b.enemies.map((enemy) => enemy.x),
    );
  });

  it("rejects a log that skips a draft", () => {
    const { state, log } = playBot("gamma", 3 * 60 * CS_TPS);
    expect(state.hero.level).toBeGreaterThan(1);
    const withoutPicks = log.filter(([, action]) => action[0] !== "pick");
    expect(() => replayCs("gamma", HORIZON, withoutPicks, state.tick)).toThrow(
      /draft open/,
    );
  });

  it("holds time still while a draft is open, and lets it be rerolled or skipped", () => {
    const state = createCsRun("draft");
    state.hero.experience = state.hero.next - 1;
    state.orbs.push({
      id: 999,
      kind: "experience",
      x: state.hero.x,
      y: state.hero.y + 0.3,
      value: 1,
      flying: true,
    });
    stepCs(state);
    expect(state.draft).toHaveLength(3);
    const tick = state.tick;
    stepCs(state);
    expect(state.tick).toBe(tick);
    // One reroll comes with every run.
    expect(applyCsAction(state, ["reroll"])).toBe(true);
    expect(applyCsAction(state, ["reroll"])).toBe(false);
    expect(applyCsAction(state, ["skip"])).toBe(true);
    expect(state.draft).toBeNull();
    stepCs(state);
    expect(state.tick).toBe(tick + 1);
  });

  it("offers only arts that fit the open slots and their masteries", () => {
    const state = createCsRun("slots");
    state.jutsu = CS_JUTSU.slice(0, CS_SLOTS).map((id) => ({
      id,
      level: CS_JUTSU_INFO[id].levels.length,
      readyAt: 0,
      awakened: false,
    }));
    state.passives = (
      ["swiftFeet", "ironBody", "battleFocus", "expansion", "fortune"] as const
    ).map((id) => ({ id, level: CS_PASSIVE_INFO[id].maxLevel }));
    // Everything held is mastered and every slot is full: only a heal is left.
    expect(draftOptions(state)).toEqual([{ type: "heal" }]);
    state.passives.pop();
    const options = draftOptions(state);
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      expect(option.type).toBe("passive");
      if (option.type === "passive") expect(option.level).toBe(1);
    }
  });

  it("awakens a mastered jutsu with its partner when a scroll is picked up", () => {
    const state = createCsRun("awaken");
    state.jutsu[0] = {
      id: "shuriken",
      level: CS_JUTSU_INFO.shuriken.levels.length,
      readyAt: 0,
      awakened: false,
    };
    expect(csAwakenable(state)).toHaveLength(0);
    state.passives.push({ id: CS_JUTSU_INFO.shuriken.awakening.partner, level: 1 });
    expect(csAwakenable(state)).toHaveLength(1);
    state.orbs.push({
      id: 999,
      kind: "scroll",
      x: state.hero.x,
      y: state.hero.y + 0.3,
      value: 3,
      flying: true,
    });
    stepCs(state);
    expect(state.jutsu[0]?.awakened).toBe(true);
    // The awakening took one of the scroll's three picks; the other two open drafts.
    expect(state.draft).not.toBeNull();
    expect(state.draftsQueued).toBe(1);
  });

  it("raises a hero with Second Wind once", () => {
    const training = { ...csNoTraining(), revival: 1 };
    const state = createCsRun("revive", { stage: "horizon", training });
    state.hero.hp = 0;
    stepCs(state);
    expect(state.over).toBe(false);
    expect(state.hero.hp).toBe(state.hero.maxHp / 2);
    state.hero.hp = 0;
    stepCs(state);
    expect(state.over).toBe(true);
    expect(state.won).toBe(false);
  });

  it("wins the run when the reinforcements arrive", () => {
    const state = createCsRun("reinforcements");
    state.tick = CS_RUN_SECONDS * CS_TPS - 1;
    state.hero.hp = 1_000_000;
    state.hero.maxHp = 1_000_000;
    stepCs(state);
    expect(state.over).toBe(true);
    expect(state.won).toBe(true);
  });

  it("keeps gale sickles evenly spaced on their orbit", () => {
    const state = createCsRun("sickles");
    state.jutsu.push({ id: "gale", level: 1, readyAt: 0, awakened: false });
    const sickles = csSicklePositions(state);
    expect(sickles).toHaveLength(CS_JUTSU_INFO.gale.levels[0]?.count ?? 0);
    const [a, b] = sickles;
    expect(a && b && Math.hypot(a.x + b.x, a.y + b.y)).toBeCloseTo(0, 6);
  });

  it("lays out the same field for the same seed, with a clear start", () => {
    const a = csGroundLayout("field", "horizon");
    const b = csGroundLayout("field", "horizon");
    expect(a.obstacles).toEqual(b.obstacles);
    expect(a.ponds).toEqual(b.ponds);
    expect(a.obstacles.length).toBeGreaterThan(10);
    expect(a.ponds.length).toBeGreaterThan(0);
    for (const obstacle of a.obstacles)
      expect(Math.hypot(obstacle.x, obstacle.y)).toBeGreaterThanOrEqual(4.5);
    expect(csGroundLayout("field", "mei").obstacles).not.toEqual(a.obstacles);
  });

  it("never lets the hero walk through a tree or rock", () => {
    const state = createCsRun("trees");
    const obstacle = state.ground.obstacles[0];
    if (!obstacle) throw new Error("The field has no obstacles");
    // Stand just west of it and walk east into it for a second.
    state.hero.x = obstacle.x - obstacle.radius - 1;
    state.hero.y = obstacle.y;
    applyCsAction(state, ["move", 0]);
    for (let i = 0; i < CS_TPS; i++) {
      state.enemies = [];
      stepCs(state);
      const dx = state.hero.x - obstacle.x,
        dy = state.hero.y - obstacle.y;
      expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(obstacle.radius + 0.3 - 1e-9);
    }
  });

  it("slows the hero while wading through a pond", () => {
    const state = createCsRun("wade");
    const pond = state.ground.ponds[0];
    if (!pond) throw new Error("The field has no ponds");
    state.ground.obstacles = [];
    state.ground.cells.clear();
    const walk = (x: number) => {
      state.hero.x = x;
      state.hero.y = pond.y;
      state.enemies = [];
      applyCsAction(state, ["move", 0]);
      stepCs(state);
      return state.hero.x - x;
    };
    const wading = walk(pond.x - 0.1);
    const dry = walk(pond.x - pond.radius - 3);
    expect(wading).toBeCloseTo(dry * CS_WADE_SPEED, 6);
  });

  it("builds unit directions from square roots", () => {
    for (const direction of CS_DIRECTIONS)
      expect(direction.x * direction.x + direction.y * direction.y).toBeCloseTo(1, 12);
  });

  it("keeps engine-dependent maths out of the deterministic modules", () => {
    for (const file of ["sim.ts", "content.ts"]) {
      const source = readFileSync(
        join(import.meta.dirname, "../../../src/libs/chakraStorm", file),
        "utf8",
      ).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(source).not.toMatch(
        /Math\.(pow|exp|log|log2|log10|sin|cos|tan|atan2|atan|hypot|random|cbrt|expm1|log1p)\b/,
      );
      expect(source).not.toMatch(
        /[\w)\]]\s*\*\*\s*[\w(]|Date\.now|performance\.now|new Date/,
      );
    }
  });
});

describe("Chakra Storm progress", () => {
  it("opens each stage after ten minutes on the one before", () => {
    expect(csStageUnlocked(CS_EMPTY_PROGRESS, "horizon")).toBe(true);
    expect(csStageUnlocked(CS_EMPTY_PROGRESS, "akasumi")).toBe(false);
    const run = {
      stage: "horizon" as const,
      seconds: 600,
      kills: 900,
      level: 40,
      won: false,
      bosses: 2,
    };
    const settled = settleCsRun(CS_EMPTY_PROGRESS, run);
    expect(settled.unlocked).toBe("akasumi");
    expect(settled.intel).toBeGreaterThan(0);
    expect(settled.progress.intel).toBe(settled.intel);
    expect(csStageUnlocked(settled.progress, "akasumi")).toBe(true);
    expect(csStageUnlocked(settled.progress, "akikaze")).toBe(false);
    // A shorter night afterwards banks intel but keeps the record.
    const again = settleCsRun(settled.progress, { ...run, seconds: 100 });
    expect(again.isBest).toBe(false);
    expect(again.progress.stages.horizon?.seconds).toBe(600);
  });

  it("gives every jutsu level a change its draft card can name", () => {
    for (const id of CS_JUTSU) {
      const { levels } = CS_JUTSU_INFO[id];
      for (let level = 2; level <= levels.length; level++) {
        expect(csUpgradeText(id, level)).not.toBe("Stronger");
        const before = levels[level - 2];
        const after = levels[level - 1];
        // A level never trades damage per hit away for more casts.
        expect(after?.damage).toBeGreaterThanOrEqual(before?.damage ?? 0);
      }
    }
  });

  it("toughens raiders with the clock and every raider defeated", () => {
    const scale = csHealthScale(600);
    expect(csToughness(600, 0)).toBe(scale);
    expect(csToughness(600, CS_KILLS_PER_TOUGHNESS)).toBeCloseTo(scale * 2);
    expect(csToughness(900, 0)).toBeGreaterThan(scale);
  });

  it("names the region a run would open until it is open", () => {
    expect(csNextUnlock(CS_EMPTY_PROGRESS, "horizon")).toEqual({
      stage: "akasumi",
      seconds: 600,
    });
    // Once the next region is open, or in the last region, a run opens nothing.
    const opened = settleCsRun(CS_EMPTY_PROGRESS, {
      stage: "horizon",
      seconds: 600,
      kills: 900,
      level: 40,
      won: false,
      bosses: 2,
    }).progress;
    expect(csNextUnlock(opened, "horizon")).toBeNull();
    expect(csNextUnlock(opened, "akasumi")?.stage).toBe("akikaze");
    expect(csNextUnlock(CS_EMPTY_PROGRESS, "undercover")).toBeNull();
  });

  it("prices training so every level costs more and the hall grows dearer", () => {
    const levels = csNoTraining();
    const first = csTrainingCost("might", levels);
    expect(first).toBe(CS_TRAINING_INFO.might.baseCost + 20);
    const bought = { ...levels, vitality: 2 };
    expect(csTrainingCost("might", bought)).toBeGreaterThan(first ?? 0);
    const maxed = { ...levels, revival: 1 };
    expect(csTrainingCost("revival", maxed)).toBeNull();
    expect(buyCsTraining({ ...CS_EMPTY_PROGRESS, intel: 10 }, "might")).toBeNull();
    const bought2 = buyCsTraining({ ...CS_EMPTY_PROGRESS, intel: 1000 }, "might");
    expect(bought2?.training.might).toBe(1);
    expect(bought2?.intel).toBe(1000 - (first ?? 0));
  });

  it("reads stored progress defensively", () => {
    expect(parseCsProgress("not json")).toEqual(CS_EMPTY_PROGRESS);
    const parsed = parseCsProgress(
      JSON.stringify({
        intel: 12.7,
        training: { might: 99, unknown: 3, luck: -2 },
        stages: {
          horizon: { seconds: 99999, kills: 4, level: 0, won: true },
          nowhere: {},
        },
      }),
    );
    expect(parsed.intel).toBe(12);
    expect(parsed.training.might).toBe(CS_TRAINING_INFO.might.maxLevel);
    expect(parsed.training.luck).toBe(0);
    expect(Object.keys(parsed.training)).toEqual([...CS_TRAINING]);
    expect(parsed.stages.horizon).toEqual({
      seconds: CS_RUN_SECONDS,
      kills: 4,
      level: 1,
      won: true,
    });
    expect(Object.keys(parsed.stages)).toEqual(["horizon"]);
  });

  it("names every stage in order", () => {
    expect(CS_STAGES[0]).toBe("horizon");
    expect(CS_STAGES.at(-2)).toBe("mei");
    expect(CS_STAGES.at(-1)).toBe("undercover");
  });
});

describe("Undercover", () => {
  it("runs on past the scouting run's end", () => {
    const state = createCsRun("cover", {
      stage: "undercover",
      training: csNoTraining(),
    });
    state.hero.hp = state.hero.maxHp = 1e9;
    state.tick = CS_RUN_SECONDS * CS_TPS - 1;
    stepCs(state);
    expect(state.over).toBe(false);
    expect(csRunSeconds("undercover")).toBe(CS_ENDLESS_SECONDS);
    expect(csRunSeconds("horizon")).toBe(CS_RUN_SECONDS);
  });

  it("keeps sending hunters and ambushes only in Undercover", () => {
    expect(csBossSeconds("horizon", 3)).toBeNull();
    expect(csSwarmSeconds("horizon", 5)).toBeNull();
    expect(csBossSeconds("undercover", 2)).toBe(csBossSeconds("horizon", 2));
    const fourth = csBossSeconds("undercover", 3) ?? 0;
    const fifth = csBossSeconds("undercover", 4) ?? 0;
    expect(fourth).toBeGreaterThan(csBossSeconds("undercover", 2) ?? 0);
    expect(fifth - fourth).toBe(fourth - (csBossSeconds("undercover", 2) ?? 0));
    expect(csSwarmSeconds("undercover", 6)).toBeGreaterThan(
      csSwarmSeconds("undercover", 5) ?? 0,
    );
  });

  it("opens like Horizon, then slows its clock and its levels", () => {
    expect(csPaced("undercover", 120)).toBe(120);
    expect(csPaced("horizon", 3 * 3600)).toBe(3 * 3600);
    // Three hours feel like half an hour.
    expect(csPaced("undercover", 3 * 3600)).toBeCloseTo(1800);
    expect(csLevelCost("undercover", 1)).toBe(csExperienceFor(1));
    expect(csLevelCost("undercover", 30)).toBe(Math.round(csExperienceFor(30) * 3));
  });

  it("drops the refill for a steadily rising arrival rate", () => {
    expect(csSpawnPressure(180, "undercover")).toEqual(csSpawnPressure(180, "horizon"));
    const early = csSpawnPressure(600, "undercover");
    const late = csSpawnPressure(1800, "undercover");
    expect(late.minimum).toBe(early.minimum);
    expect(late.interval).toBeLessThan(early.interval);
  });

  it("is open to every scout from the start", () => {
    expect(csStageUnlocked(CS_EMPTY_PROGRESS, "undercover")).toBe(true);
    // The City of Mei still opens after Hyorin, and opens nothing further.
    expect(csStageUnlocked(CS_EMPTY_PROGRESS, "mei")).toBe(false);
    expect(csNextUnlock(CS_EMPTY_PROGRESS, "mei")).toBeNull();
    expect(csNextUnlock(CS_EMPTY_PROGRESS, "undercover")).toBeNull();
  });
});
