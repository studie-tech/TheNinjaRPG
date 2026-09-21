import { describe, expect, it } from "vitest";
import {
  advanceFishingSimulation,
  createFishingSimulation,
  type FishingSimulationInput,
} from "@/libs/fishing/simulation";

const modifiers = { attractionBonus: 8, controlBonus: 5, socialBonus: 6 };
const input = (sequence: number, overrides?: Partial<FishingSimulationInput>) => ({
  sequence,
  durationMs: 200,
  rodX: 0.4,
  rodY: -0.2,
  reel: false,
  hook: false,
  ...overrides,
});

describe("fishing simulation", () => {
  it("replays identical inputs deterministically", () => {
    const initial = createFishingSimulation({
      sessionId: "session-a",
      behavior: "DARTING",
      castTarget: { x: 420, y: 300 },
      schoolPoint: { x: 450, y: 320 },
      modifiers,
    });
    const replay = () =>
      Array.from({ length: 40 }, (_, index) => input(index + 1)).reduce(
        (state, frame) => advanceFishingSimulation(state, frame, "DARTING", modifiers),
        initial,
      );
    expect(replay()).toEqual(replay());
  });

  it("ignores duplicate and out-of-order input sequences", () => {
    const initial = createFishingSimulation({
      sessionId: "session-b",
      behavior: "HEAVY",
      castTarget: { x: 500, y: 240 },
      modifiers,
    });
    const advanced = advanceFishingSimulation(initial, input(2), "HEAVY", modifiers);
    expect(advanceFishingSimulation(advanced, input(2), "HEAVY", modifiers)).toBe(
      advanced,
    );
    expect(advanceFishingSimulation(advanced, input(1), "HEAVY", modifiers)).toBe(
      advanced,
    );
  });

  it("produces the same motion for equivalent fixed-step frame batching", () => {
    const initial = createFishingSimulation({
      sessionId: "session-frames",
      behavior: "ERRATIC",
      castTarget: { x: 460, y: 280 },
      modifiers,
    });
    const batched = advanceFishingSimulation(
      initial,
      input(1, { durationMs: 200 }),
      "ERRATIC",
      modifiers,
    );
    const stepped = Array.from({ length: 4 }, (_, index) =>
      input(index + 1, { durationMs: 50 }),
    ).reduce(
      (state, frame) => advanceFishingSimulation(state, frame, "ERRATIC", modifiers),
      initial,
    );
    expect({ ...stepped, lastInputSequence: 0 }).toEqual({
      ...batched,
      lastInputSequence: 0,
    });
  });

  it("reaches a bite within an ordinary gentle-lure window", () => {
    let state = createFishingSimulation({
      sessionId: "session-bite-window",
      behavior: "CAUTIOUS",
      castTarget: { x: 500, y: 300 },
      schoolPoint: { x: 510, y: 305 },
      modifiers,
    });
    for (let sequence = 1; sequence <= 150 && state.phase === "ATTRACT"; sequence++)
      state = advanceFishingSimulation(
        state,
        input(sequence, { rodX: 0.08, rodY: 0, durationMs: 200 }),
        "CAUTIOUS",
        modifiers,
      );
    expect(state.elapsedMs).toBeLessThanOrEqual(30_000);
    expect(state.phase).toBe("BITE");
  });

  it("requires a hook input to convert a bite into a fight", () => {
    let state = createFishingSimulation({
      sessionId: "session-c",
      behavior: "CAUTIOUS",
      castTarget: { x: 530, y: 330 },
      schoolPoint: { x: 530, y: 330 },
      modifiers,
    });
    state.fish.x = state.lure.x;
    state.fish.y = state.lure.y;
    state.fish.interest = 99.9;
    state = advanceFishingSimulation(state, input(1), "CAUTIOUS", modifiers);
    expect(state.phase).toBe("BITE");
    state = advanceFishingSimulation(
      state,
      input(state.lastInputSequence + 1, { hook: true }),
      "CAUTIOUS",
      modifiers,
    );
    expect(state.phase).toBe("FIGHT");
  });
});
