import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import alea from "alea";
import { decodeTdActions } from "@/libs/towerDefense/actionLog";
import { tdStartingDrafts } from "@/libs/towerDefense/balance";
import {
  TD_SEAL_ART_INFO,
  TD_SEAL_ARTS,
  TD_ULTIMATES,
  type TdEra,
} from "@/libs/towerDefense/content";
import {
  advanceReplay,
  applyAction,
  createReplay,
  createRun,
  stepRun,
  TD_BOSS_MOVES,
  TD_SIM_VERSION,
  type TdAction,
  type TdActionKind,
  type TdEvent,
  type TdRunConfig,
} from "@/libs/towerDefense/sim";
import { botAct, encodeLog, replayRun, tdStateHash, veteranDojo } from "./bot";

interface Recording {
  config: TdRunConfig;
  log: TdAction[];
  hashes: Map<number, string>;
  endTick: number;
  events: TdEvent[];
  final: string;
}

/**
 * Play a run live the way the page does (actions applied before each tick, events
 * recorded), keeping the action log and a state fingerprint every `every` ticks.
 */
const record = (
  config: TdRunConfig,
  options: {
    chaos?: number;
    attention?: number;
    every?: number;
    maxTicks?: number;
    script?: (tick: number) => TdAction[];
  } = {},
): Recording => {
  const random = alea(config.seed.length * 7919 + config.startWave);
  const state = createRun(config, true);
  const log: TdAction[] = [];
  const hashes = new Map<number, string>();
  const events: TdEvent[] = [];
  const every = options.every ?? 1;
  const maxTicks = options.maxTicks ?? 60_000;
  while (!state.over && state.tick < maxTicks) {
    for (const action of options.script?.(state.tick) ?? [])
      if (applyAction(state, [state.tick, ...action.slice(1)] as TdAction))
        log.push([state.tick, ...action.slice(1)] as TdAction);
    log.push(
      ...botAct(state, {
        rng: random,
        chaos: options.chaos,
        attention: options.attention,
      }),
    );
    const before = state.tick;
    stepRun(state);
    events.push(...state.events);
    state.events.length = 0;
    if (state.tick !== before && state.tick % every === 0)
      hashes.set(state.tick, tdStateHash(state));
  }
  if (!state.over) {
    const quit: TdAction = [state.tick, "quit"];
    applyAction(state, quit);
    log.push(quit);
  }
  return {
    config,
    log,
    hashes,
    endTick: state.tick,
    events,
    final: tdStateHash(state),
  };
};

/** Replay through the claim's encoding round trip, comparing every fingerprint. */
const expectReplayMatches = (recording: Recording) => {
  const parsed = decodeTdActions(encodeLog(recording.log));
  if (!parsed) throw new Error("The recorded log does not decode");
  // JSON equality: the wire, like JSON, carries -0 as 0.
  expect(JSON.stringify(parsed)).toBe(JSON.stringify(recording.log));
  let mismatch: number | null = null;
  const result = replayRun(recording.config, parsed, recording.endTick, {
    onTick: (state) => {
      const expected = recording.hashes.get(state.tick);
      if (
        mismatch === null &&
        expected !== undefined &&
        expected !== tdStateHash(state)
      )
        mismatch = state.tick;
    },
  });
  expect(mismatch).toBeNull();
  expect(result.invalidAt).toBeNull();
  expect(result.state.over).toBe(true);
  expect(result.state.tick).toBe(recording.endTick);
  expect(tdStateHash(result.state)).toBe(recording.final);
  return result;
};

describe("tower defense replay", () => {
  it("replays a fresh player's run tick for tick", () => {
    const recording = record({ seed: "fresh-1", startWave: 1, bestWave: 0, dojo: {} });
    expect(recording.endTick).toBeGreaterThan(300);
    expectReplayMatches(recording);
  });

  it("replays veteran runs with every active mechanic tick for tick", () => {
    for (const [seed, startWave, scale] of [
      ["vet-a", 60, 0.25],
      ["vet-b", 150, 0.45],
      ["vet-c", 200, 0.6],
    ] as const) {
      const recording = record(
        { seed, startWave, bestWave: startWave * 2, dojo: veteranDojo(scale) },
        { maxTicks: 12_000 },
      );
      expectReplayMatches(recording);
    }
  });

  it("replays fuzzed logs full of invalid and out-of-place actions identically", () => {
    for (const seed of ["fuzz-1", "fuzz-2", "fuzz-3", "fuzz-4"]) {
      const recording = record(
        { seed, startWave: 30, bestWave: 120, dojo: veteranDojo(0.3) },
        { chaos: 0.35, maxTicks: 8_000 },
      );
      expect(recording.log.length).toBeGreaterThan(200);
      expectReplayMatches(recording);
    }
  });

  it("exercises every action kind, seal art, ultimate and boss move across recordings", () => {
    const kinds = new Set<TdActionKind>();
    const arts = new Set<string>();
    const ultimates = new Set<string>();
    const moves = new Set<string>();
    const eras = new Set<TdEra>();
    const seen = new Set<TdEvent["type"]>();
    let perfectSubstitutions = 0;
    const script = (tick: number): TdAction[] => {
      if (tick === 40)
        return [
          [tick, "aim", "strong"],
          [tick, "auto", 1],
        ];
      if (tick === 300) return [[tick, "sell", 0]];
      if (tick === 900)
        return [
          [tick, "aim", "support"],
          [tick, "auto", 0],
        ];
      if (tick % 211 === 0)
        return [
          [tick, "sub"],
          [tick, "blink", -120, 90],
        ];
      if (tick % 97 === 0) {
        const art = TD_SEAL_ARTS[(tick / 97) % TD_SEAL_ARTS.length] ?? "dragon_flame";
        return TD_SEAL_ART_INFO[art].seals.map(
          (seal) => [tick, "seal", seal, 200, -150] as TdAction,
        );
      }
      return [];
    };
    for (const [seed, startWave, scale] of [
      ["cover-a", 100, 0.2],
      ["cover-b", 220, 0.3],
      ["cover-c", 310, 0.4],
    ] as const) {
      const recording = record(
        { seed, startWave, bestWave: 500, dojo: veteranDojo(scale) },
        { every: 25, maxTicks: 9_000, script },
      );
      expectReplayMatches(recording);
      for (const action of recording.log) kinds.add(action[1]);
      for (const event of recording.events) {
        seen.add(event.type);
        if (event.type === "art") arts.add(event.art);
        if (event.type === "ultimate") ultimates.add(event.ultimate);
        if (event.type === "bossMove") moves.add(event.move);
        if (event.type === "wave") for (const era of event.eras) eras.add(era);
        if (event.type === "substitution" && event.perfect) perfectSubstitutions++;
      }
    }
    for (const kind of [
      "buy",
      "max",
      "spend",
      "build",
      "upgrade",
      "sell",
      "ult",
      "perk",
      "aim",
      "focus",
      "blink",
      "sub",
      "seal",
      "trap",
      "loot",
      "call",
      "auto",
      "quit",
    ] as const)
      expect(kinds).toContain(kind);
    for (const art of TD_SEAL_ARTS) expect(arts).toContain(art);
    for (const ultimate of TD_ULTIMATES) expect(ultimates).toContain(ultimate);
    expect(moves.size).toBeGreaterThanOrEqual(2);
    expect(eras.size).toBeGreaterThanOrEqual(5);
    expect(perfectSubstitutions).toBeGreaterThan(0);
    for (const type of [
      "throw",
      "hit",
      "kill",
      "jutsu",
      "explosion",
      "blink",
      "loot",
      "heroHit",
    ] as const)
      expect(seen).toContain(type);
  });

  it("replays titan and boss fights, which together use every boss move", () => {
    const moves = new Set<string>();
    for (const startWave of [150, 200, 250, 300, 350])
      for (const scale of [0.03, 0.08]) {
        const recording = record(
          {
            seed: `titan-${startWave}`,
            startWave,
            bestWave: 500,
            dojo: veteranDojo(scale),
          },
          { maxTicks: 3_000 },
        );
        expectReplayMatches(recording);
        for (const event of recording.events)
          if (event.type === "bossMove") moves.add(event.move);
      }
    for (const move of TD_BOSS_MOVES) expect(moves).toContain(move);
  });

  it("resumes a replay advanced in slices exactly where it left off", () => {
    const recording = record(
      { seed: "sliced", startWave: 40, bestWave: 200, dojo: veteranDojo(0.3) },
      { maxTicks: 8_000 },
    );
    const replay = createReplay(recording.config, recording.log);
    let result = advanceReplay(replay, recording.endTick, { ticks: 997 });
    let slices = 1;
    while (!result) {
      result = advanceReplay(replay, recording.endTick, { ticks: 997 });
      slices++;
    }
    expect(slices).toBeGreaterThan(2);
    expect(result.state.over).toBe(true);
    expect(result.invalidAt).toBeNull();
    expect(tdStateHash(result.state)).toBe(recording.final);
  });

  it("holds the tick while a perk draft is open and accepts shopping meanwhile", () => {
    const state = createRun({ seed: "draft", startWave: 41, bestWave: 100, dojo: {} });
    expect(state.offer).not.toBeNull();
    const tick = state.tick;
    stepRun(state);
    stepRun(state);
    expect(state.tick).toBe(tick);
    expect(applyAction(state, [tick, "buy", "damage"])).toBe(true);
    expect(applyAction(state, [tick, "blink", 100, 0])).toBe(false);
    expect(applyAction(state, [tick, "perk", 0])).toBe(true);
    while (state.offer) applyAction(state, [tick, "perk", 0]);
    stepRun(state);
    expect(state.tick).toBe(tick + 1);
  });

  it("closes every starting draft of a high checkpoint by taking first offers", () => {
    const state = createRun({
      seed: "drafts",
      startWave: 2001,
      bestWave: 2001,
      dojo: {},
    });
    let picks = 0;
    while (applyAction(state, [state.tick, "perk", 0])) picks++;
    expect(picks).toBe(tdStartingDrafts(2001));
    expect(state.offer).toBeNull();
  });

  it("reports a stalled replay when a draft is never answered", () => {
    const result = replayRun(
      { seed: "stall", startWave: 41, bestWave: 100, dojo: {} },
      [],
      500,
    );
    expect(result.state.over).toBe(false);
    expect(result.state.tick).toBeLessThan(500);
  });

  it("rejects logs whose actions go back in time", () => {
    const result = replayRun(
      { seed: "order", startWave: 1, bestWave: 0, dojo: {} },
      [
        [50, "buy", "damage"],
        [20, "buy", "health"],
      ],
      100,
    );
    expect(result.invalidAt).toBe(1);
  });

  it("changes the outcome when a recorded action is altered", () => {
    const recording = record(
      { seed: "tamper", startWave: 20, bestWave: 60, dojo: veteranDojo(0.15) },
      { maxTicks: 6000 },
    );
    const tampered = recording.log.map((action) =>
      action[1] === "buy" && action[2] === "damage"
        ? ([action[0], "buy", "ryo"] as TdAction)
        : action,
    );
    const result = replayRun(recording.config, tampered, recording.endTick);
    expect(tdStateHash(result.state)).not.toBe(recording.final);
  });

  it("ends the run on quit and keeps the scrolls earned so far", () => {
    const state = createRun({ seed: "quit", startWave: 1, bestWave: 0, dojo: {} });
    for (let i = 0; i < 600; i++) stepRun(state);
    const scrolls = state.scrolls;
    expect(applyAction(state, [state.tick, "quit"])).toBe(true);
    expect(state.over).toBe(true);
    expect(state.scrolls).toBe(scrolls);
    expect(applyAction(state, [state.tick, "buy", "damage"])).toBe(false);
  });

  it("pins how recorded runs replay to TD_SIM_VERSION", () => {
    // A new fingerprint means recorded runs replay differently: bump TD_SIM_VERSION with
    // it, so pages still on the previous rules reload instead of failing their claims.
    expect({ version: TD_SIM_VERSION, fingerprint: rulesFingerprint() }).toEqual({
      version: 1,
      fingerprint: "d7b0663a4580c3cad7e399885bf1487619808dd8cd78727e5d41a92991869808",
    });
  });

  it("keeps engine-dependent maths out of the deterministic modules", () => {
    for (const file of ["sim.ts", "rng.ts", "balance.ts", "content.ts"]) {
      const source = readFileSync(
        join(import.meta.dirname, "../../../src/libs/towerDefense", file),
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

/** A digest of bot runs across the game's stages, their logs and their states. */
const rulesFingerprint = () => {
  const digest = createHash("sha256");
  for (const [seed, startWave, scale, chaos] of [
    ["fresh-1", 1, 0, 0],
    ["vet-a", 60, 0.25, 0],
    ["vet-c", 200, 0.6, 0],
    ["fuzz-1", 30, 0.3, 0.35],
  ] as const) {
    const state = createRun(
      { seed, startWave, bestWave: startWave * 2, dojo: veteranDojo(scale) },
      true,
    );
    const rng = alea(seed.length * 7919 + startWave);
    const log: TdAction[] = [];
    while (!state.over && state.tick < 12_000) {
      log.push(...botAct(state, { rng, chaos }));
      stepRun(state);
      state.events.length = 0;
      if (state.tick % 500 === 0) digest.update(tdStateHash(state));
    }
    digest.update(tdStateHash(state));
    digest.update(encodeLog(log));
  }
  return digest.digest("hex");
};
