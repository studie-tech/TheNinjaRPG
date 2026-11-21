import { describe, expect, it } from "bun:test";
import { CS_RUN_SECONDS, CS_TPS, csNoTraining } from "@/libs/chakraStorm/content";
import {
  advanceCsReplay,
  type CsRunConfig,
  createCsReplay,
  csRunLength,
} from "@/libs/chakraStorm/sim";
import { playBot } from "./bot";

const config = (seconds?: number): CsRunConfig => ({
  stage: "horizon",
  training: csNoTraining(),
  ...(seconds ? { challenge: { seconds } } : {}),
});

describe("chakra storm challenges", () => {
  it("is won once the survival time has passed", () => {
    const { state } = playBot("challenge", 5 * 60 * CS_TPS, config(60));
    expect(state.over).toBe(true);
    expect(state.won).toBe(true);
    expect(state.tick).toBe(60 * CS_TPS);
  });

  it("lasts the full scouting run without a challenge", () => {
    expect(csRunLength(config())).toBe(CS_RUN_SECONDS);
    expect(csRunLength(config(90))).toBe(90);
    const { state } = playBot("challenge", 61 * CS_TPS, config());
    expect(state.over).toBe(false);
  });

  it("is lost when the hero gives up before the time", () => {
    const { state } = playBot("challenge", 5 * 60 * CS_TPS, config(120), 30 * CS_TPS);
    expect(state.over).toBe(true);
    expect(state.won).toBe(false);
  });

  it("replays a challenge win to the same win, and not under the full run", () => {
    const { state, log } = playBot("replay", 5 * 60 * CS_TPS, config(60));
    expect(state.won).toBe(true);
    const challenge = createCsReplay("replay", config(60), log);
    advanceCsReplay(challenge, state.tick, Number.MAX_SAFE_INTEGER);
    expect(challenge.invalid).toBeNull();
    expect(challenge.state.won).toBe(true);
    expect(challenge.state.tick).toBe(state.tick);
    const endless = createCsReplay("replay", config(), log);
    advanceCsReplay(endless, state.tick, Number.MAX_SAFE_INTEGER);
    expect(endless.state.won).toBe(false);
  });
});
