import { describe, expect, it } from "bun:test";
import { summonCastBlockedReason } from "@/libs/combat/summon";
import type { BattleUserState } from "@/libs/combat/types";
import { makeBattleUser } from "../../setup/combat";
import {
  DEMON,
  SUMMON_OWNER,
  makeSpawnedSummon as spawned,
  TIGER,
  makeSummonTemplate as template,
} from "./helpers/summon";

// Two independent caps: one of each CREATURE (so different summon jutsus can
// coexist), and one PILOTED summon overall (each piloted
// summon grants its owner an extra turn per round).

const P = SUMMON_OWNER;

const player = () => makeBattleUser(P, { curHealth: 100 });

const reason = (state: BattleUserState[], aiId: string, wantsPilot: boolean) =>
  summonCastBlockedReason(state, P, aiId, wantsPilot);

describe("per-creature cap", () => {
  it("allows the first cast of a creature", () => {
    expect(reason([player(), template(DEMON, "Demon")], DEMON, false)).toBeNull();
  });

  it("blocks a second copy of the SAME creature", () => {
    const state = [player(), template(DEMON, "Demon"), spawned("s1", DEMON)];
    expect(reason(state, DEMON, false)).toContain("already summoned");
  });

  it("allows a DIFFERENT creature alongside an existing summon", () => {
    const state = [
      player(),
      template(DEMON, "Demon"),
      template(TIGER, "Tiger"),
      spawned("s1", DEMON),
    ];
    expect(reason(state, TIGER, false)).toBeNull();
  });

  it("allows re-casting a creature once the prior one is dead", () => {
    const state = [
      player(),
      template(DEMON, "Demon"),
      spawned("s1", DEMON, { curHealth: 0 }),
    ];
    expect(reason(state, DEMON, false)).toBeNull();
  });

  it("ignores another player's summon of the same creature", () => {
    const other = spawned("s9", DEMON, { controllerId: "p2" });
    const state = [player(), template(DEMON, "Demon"), other];
    expect(reason(state, DEMON, false)).toBeNull();
  });
});

describe("one-piloted-summon cap", () => {
  it("blocks a second PILOTED summon even of a different creature", () => {
    const state = [
      player(),
      template(DEMON, "Demon"),
      template(TIGER, "Tiger"),
      spawned("s1", DEMON, { isPiloted: true }),
    ];
    expect(reason(state, TIGER, true)).toContain("only control one summon");
  });

  it("allows a NON-piloted summon alongside a piloted one", () => {
    const state = [
      player(),
      template(DEMON, "Demon"),
      template(TIGER, "Tiger"),
      spawned("s1", DEMON, { isPiloted: true }),
    ];
    expect(reason(state, TIGER, false)).toBeNull();
  });

  it("allows a piloted summon alongside a NON-piloted one", () => {
    const state = [
      player(),
      template(DEMON, "Demon"),
      template(TIGER, "Tiger"),
      spawned("s1", DEMON, { isPiloted: false }),
    ];
    expect(reason(state, TIGER, true)).toBeNull();
  });

  it("allows re-piloting once the prior piloted summon is dead", () => {
    const state = [
      player(),
      template(DEMON, "Demon"),
      template(TIGER, "Tiger"),
      spawned("s1", DEMON, { isPiloted: true, curHealth: 0 }),
    ];
    expect(reason(state, TIGER, true)).toBeNull();
  });
});

describe("clones never trip either cap", () => {
  it("a clone does not count as a summon of its creature", () => {
    const clone = spawned("c1", DEMON, {
      isOriginal: false,
      summonSourceId: undefined,
    });
    const state = [player(), template(DEMON, "Demon"), clone];
    expect(reason(state, DEMON, false)).toBeNull();
  });
});
