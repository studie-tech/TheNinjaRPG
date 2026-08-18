import { describe, it, expect } from "vitest";
import { summonCastBlockedReason } from "@/libs/combat/summon";
import { makeBattleUser } from "./helpers/battleScenario";
import type { BattleUserState, UserEffect } from "@/libs/combat/types";

// Two independent caps: one of each CREATURE (so different summon jutsus can
// coexist, as they did pre-PR), and one PILOTED summon overall (each piloted
// summon grants its owner an extra turn per round).

const DEMON = "ai-demon";
const TIGER = "ai-tiger";
const P = "p1";
const noEffects: UserEffect[] = [];

const player = () => makeBattleUser(P, { curHealth: 100 });

// Templates carry their DB id in controllerId and are parked at curHealth 0.
const template = (aiId: string, username: string) =>
  makeBattleUser(`tmpl-${aiId}`, {
    controllerId: aiId,
    username,
    isAi: true,
    isSummon: true,
    isSummonTemplate: true,
    curHealth: 0,
  });

const spawned = (
  id: string,
  aiId: string,
  username: string,
  over: Partial<BattleUserState> = {},
) =>
  makeBattleUser(id, {
    controllerId: P,
    username,
    isAi: true,
    isSummon: true,
    isOriginal: true,
    summonSourceId: aiId,
    curHealth: 500,
    ...over,
  });

const reason = (state: BattleUserState[], aiId: string, wantsPilot: boolean) =>
  summonCastBlockedReason(state, P, aiId, wantsPilot, noEffects);

describe("per-creature cap", () => {
  it("allows the first cast of a creature", () => {
    expect(reason([player(), template(DEMON, "Demon")], DEMON, false)).toBeNull();
  });

  it("blocks a second copy of the SAME creature", () => {
    const state = [player(), template(DEMON, "Demon"), spawned("s1", DEMON, "Demon")];
    expect(reason(state, DEMON, false)).toContain("already summoned");
  });

  it("allows a DIFFERENT creature alongside an existing summon", () => {
    const state = [
      player(),
      template(DEMON, "Demon"),
      template(TIGER, "Tiger"),
      spawned("s1", DEMON, "Demon"),
    ];
    expect(reason(state, TIGER, false)).toBeNull();
  });

  it("allows re-casting a creature once the prior one is dead", () => {
    const state = [
      player(),
      template(DEMON, "Demon"),
      spawned("s1", DEMON, "Demon", { curHealth: 0 }),
    ];
    expect(reason(state, DEMON, false)).toBeNull();
  });

  it("ignores another player's summon of the same creature", () => {
    const other = spawned("s9", DEMON, "Demon", { controllerId: "p2" });
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
      spawned("s1", DEMON, "Demon", { isPiloted: true }),
    ];
    expect(reason(state, TIGER, true)).toContain("only control one summon");
  });

  it("allows a NON-piloted summon alongside a piloted one", () => {
    const state = [
      player(),
      template(DEMON, "Demon"),
      template(TIGER, "Tiger"),
      spawned("s1", DEMON, "Demon", { isPiloted: true }),
    ];
    expect(reason(state, TIGER, false)).toBeNull();
  });

  it("allows a piloted summon alongside a NON-piloted one", () => {
    const state = [
      player(),
      template(DEMON, "Demon"),
      template(TIGER, "Tiger"),
      spawned("s1", DEMON, "Demon", { isPiloted: false }),
    ];
    expect(reason(state, TIGER, true)).toBeNull();
  });

  it("allows re-piloting once the prior piloted summon is dead", () => {
    const state = [
      player(),
      template(DEMON, "Demon"),
      template(TIGER, "Tiger"),
      spawned("s1", DEMON, "Demon", { isPiloted: true, curHealth: 0 }),
    ];
    expect(reason(state, TIGER, true)).toBeNull();
  });
});

describe("legacy battles without summonSourceId", () => {
  it("still blocks a duplicate by falling back to the template username", () => {
    const legacy = spawned("s1", DEMON, "Demon", { summonSourceId: undefined });
    const state = [player(), template(DEMON, "Demon"), legacy];
    expect(reason(state, DEMON, false)).toContain("already summoned");
  });

  it("does not block a different creature via the username fallback", () => {
    const legacy = spawned("s1", DEMON, "Demon", { summonSourceId: undefined });
    const state = [player(), template(DEMON, "Demon"), template(TIGER, "Tiger"), legacy];
    expect(reason(state, TIGER, false)).toBeNull();
  });
});

describe("clones never trip either cap", () => {
  it("a clone does not count as a summon of its creature", () => {
    const clone = spawned("c1", DEMON, "Demon", {
      isOriginal: false,
      summonSourceId: undefined,
    });
    const state = [player(), template(DEMON, "Demon"), clone];
    expect(reason(state, DEMON, false)).toBeNull();
  });
});
