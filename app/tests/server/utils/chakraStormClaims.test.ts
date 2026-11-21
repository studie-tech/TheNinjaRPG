import { describe, expect, it } from "bun:test";
import { nanoid } from "nanoid";
import { decodeCsActions, encodeCsActions } from "@/libs/chakraStorm/actionLog";
import { CS_TPS, csNoTraining } from "@/libs/chakraStorm/content";
import type { CsAction } from "@/libs/chakraStorm/sim";
import {
  CS_TOKEN_LIFETIME_MS,
  chakraStormReplayCost,
  checkChakraStormClaimTiming,
  verifyChakraStormRun,
} from "@/server/utils/chakraStormClaims";
import { signRunToken, verifyRunToken } from "@/server/utils/runTokens";
import {
  type ChakraStormRunToken,
  CS_MAX_ACTIONS,
  chakraStormRunTokenSchema,
} from "@/validators/chakraStorm";
import { towerDefenseRunTokenSchema } from "@/validators/towerDefense";
import { playBot } from "../../libs/chakraStorm/bot";

const token = (overrides: Partial<ChakraStormRunToken> = {}): ChakraStormRunToken => ({
  game: "chakraStorm",
  v: 1,
  userId: "cs-user",
  nonce: nanoid(),
  seed: "claim-seed",
  stage: "horizon",
  training: csNoTraining(),
  issuedAt: 1_000_000,
  ...overrides,
});

/** Play the token's run with the test bot, giving up at `quitAt` when given. */
const play = (run: ChakraStormRunToken, quitAt?: number) =>
  playBot(
    run.seed,
    20 * 60 * CS_TPS,
    { stage: run.stage, training: { ...csNoTraining(), ...run.training } },
    quitAt,
  );

describe("Chakra Storm run tokens", () => {
  it("round-trips a signed payload and refuses another game's or an altered one", () => {
    const payload = token();
    const signed = signRunToken(payload);
    expect(verifyRunToken(signed, chakraStormRunTokenSchema)).toEqual(payload);
    // A Chakra Storm token never passes for a tower defense run.
    expect(verifyRunToken(signed, towerDefenseRunTokenSchema)).toBeNull();
    const [body, mac] = signed.split(".");
    const forged = Buffer.from(JSON.stringify({ ...payload, stage: "mei" })).toString(
      "base64url",
    );
    expect(verifyRunToken(`${forged}.${mac}`, chakraStormRunTokenSchema)).toBeNull();
    expect(verifyRunToken(`${body}`, chakraStormRunTokenSchema)).toBeNull();
  });
});

describe("Chakra Storm action log", () => {
  it("round-trips every action kind and refuses malformed text", () => {
    const log: [number, CsAction][] = [
      [0, ["move", 3]],
      [4, ["move", -1]],
      [4, ["pick", 2]],
      [9, ["reroll"]],
      [9, ["skip"]],
      [120, ["quit"]],
    ];
    const text = encodeCsActions(log);
    expect(decodeCsActions(text, CS_MAX_ACTIONS)).toEqual(log);
    expect(decodeCsActions("", CS_MAX_ACTIONS)).toEqual([]);
    expect(decodeCsActions("3x", CS_MAX_ACTIONS)).toBeNull();
    expect(decodeCsActions("1m3;2m4;3m5", 2)).toBeNull();
  });
});

describe("Chakra Storm claims", () => {
  it("pays a replayed run what it earned", async () => {
    const run = token();
    const { state, log } = play(run, 3 * 60 * CS_TPS);
    expect(state.over).toBe(true);
    const actions = decodeCsActions(encodeCsActions(log), CS_MAX_ACTIONS);
    if (!actions) throw new Error("The log did not decode");
    const result = await verifyChakraStormRun({
      token: run,
      actions,
      endTick: state.tick,
      sliceTicks: 500,
    });
    expect(result).toMatchObject({
      ok: true,
      kills: state.kills,
      level: state.hero.level,
      won: false,
    });
    if (result.ok) expect(result.intel).toBeGreaterThan(0);
  });

  it("refuses a log that does not replay, or a run that has not ended", async () => {
    const run = token();
    const { state, log } = play(run, 2 * 60 * CS_TPS);
    // A pick the replay never offered.
    const forged: [number, CsAction][] = [...log.slice(0, -1), [5, ["pick", 0]]];
    forged.sort((a, b) => a[0] - b[0]);
    expect(
      await verifyChakraStormRun({ token: run, actions: forged, endTick: state.tick }),
    ).toMatchObject({ ok: false });
    // Claiming at an earlier tick leaves the run unfinished there.
    expect(
      await verifyChakraStormRun({
        token: run,
        actions: log.filter(([tick]) => tick < state.tick - 20),
        endTick: state.tick - 20,
      }),
    ).toMatchObject({ ok: false, message: "This run has not ended yet." });
    // The same log under another seed is a different run.
    expect(
      await verifyChakraStormRun({
        token: { ...run, seed: "another-seed" },
        actions: log,
        endTick: state.tick,
      }),
    ).toMatchObject({ ok: false });
  });

  it("refuses runs claimed faster than real time and expired tokens", () => {
    const run = token({ issuedAt: 0 });
    const minute = 60 * CS_TPS;
    expect(
      checkChakraStormClaimTiming({ token: run, endTick: 5 * minute, now: 60_000 }),
    ).toMatchObject({ permanent: false });
    expect(
      checkChakraStormClaimTiming({ token: run, endTick: 5 * minute, now: 300_000 }),
    ).toBeNull();
    expect(
      checkChakraStormClaimTiming({
        token: run,
        endTick: minute,
        now: CS_TOKEN_LIFETIME_MS + 1,
      }),
    ).toMatchObject({ permanent: true });
  });

  it("charges more replay budget for longer runs", () => {
    expect(chakraStormReplayCost(100)).toBe(1);
    expect(chakraStormReplayCost(15 * 60 * CS_TPS)).toBe(3);
  });
});
