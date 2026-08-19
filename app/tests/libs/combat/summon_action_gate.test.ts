import { describe, it, expect } from "vitest";
import { summonActionBlockedReason } from "@/libs/combat/summon";
import { makeBattleUser } from "./helpers/battleScenario";
import type { BattleUserState, CombatAction, UserEffect } from "@/libs/combat/types";

/**
 * The router calls this before performBattleAction, which spends pools inside
 * insertAction. Two properties matter and neither was covered: an action with no
 * summon tag must ALWAYS pass (otherwise every ordinary jutsu in the game would
 * be refused), and a capped summon must be refused with a player-facing reason.
 */

const DEMON = "ai-demon";
const TIGER = "ai-tiger";
const P = "p1";
const noEffects: UserEffect[] = [];

const player = () => makeBattleUser(P, { curHealth: 100, isAi: false });

const template = (aiId: string, username: string) =>
  makeBattleUser(`tmpl-${aiId}`, {
    controllerId: aiId, username, isAi: true, isSummon: true,
    isSummonTemplate: true, curHealth: 0,
  });

const spawned = (id: string, aiId: string, over: Partial<BattleUserState> = {}) =>
  makeBattleUser(id, {
    controllerId: P, username: "Demon", isAi: true, isSummon: true,
    isOriginal: true, summonSourceId: aiId, curHealth: 500, ...over,
  });

// Minimal action shapes: only `effects` is read.
const action = (...effects: unknown[]) =>
  ({ effects }) as unknown as Pick<CombatAction, "effects">;
const summonTag = (aiId: string, playerControlled = false) =>
  ({ type: "summon", aiId, playerControlled });

describe("actions carrying no summon tag are never blocked", () => {
  const state = [player(), template(DEMON, "Demon"), spawned("s1", DEMON)];

  it("passes an action with no effects at all", () => {
    expect(summonActionBlockedReason(action(), player(), state, noEffects)).toBeNull();
  });

  it("passes a plain damage action even while the cap is already full", () => {
    const dmg = action({ type: "damage", power: 10 });
    expect(summonActionBlockedReason(dmg, player(), state, noEffects)).toBeNull();
  });

  it("passes a multi-tag action with no summon tag", () => {
    const mixed = action({ type: "damage" }, { type: "heal" }, { type: "clone" });
    expect(summonActionBlockedReason(mixed, player(), state, noEffects)).toBeNull();
  });

  it("ignores an aiId on a NON-summon tag", () => {
    // The tag-type guard is what makes this null. Without it, this clone tag's
    // aiId matches the live summon's source and the action is wrongly refused --
    // which is how a dropped guard would break every action carrying an aiId.
    const cloneWithAiId = action({ type: "clone", aiId: DEMON });
    expect(
      summonActionBlockedReason(cloneWithAiId, player(), state, noEffects),
    ).toBeNull();
  });
});

describe("actions carrying a summon tag go through the caps", () => {
  it("passes when the creature is not out yet", () => {
    const state = [player(), template(DEMON, "Demon")];
    expect(
      summonActionBlockedReason(action(summonTag(DEMON)), player(), state, noEffects),
    ).toBeNull();
  });

  it("blocks a duplicate of a creature already out", () => {
    const state = [player(), template(DEMON, "Demon"), spawned("s1", DEMON)];
    expect(
      summonActionBlockedReason(action(summonTag(DEMON)), player(), state, noEffects),
    ).toContain("already summoned");
  });

  it("blocks a second piloted summon of a different creature", () => {
    const state = [
      player(), template(DEMON, "Demon"), template(TIGER, "Tiger"),
      spawned("s1", DEMON, { isPiloted: true }),
    ];
    expect(
      summonActionBlockedReason(
        action(summonTag(TIGER, true)), player(), state, noEffects),
    ).toContain("only control one summon");
  });

  it("allows a non-piloted summon of a different creature", () => {
    const state = [
      player(), template(DEMON, "Demon"), template(TIGER, "Tiger"),
      spawned("s1", DEMON, { isPiloted: true }),
    ];
    expect(
      summonActionBlockedReason(
        action(summonTag(TIGER, false)), player(), state, noEffects),
    ).toBeNull();
  });

  it("reports the FIRST blocking tag when an action carries several", () => {
    const state = [player(), template(DEMON, "Demon"), spawned("s1", DEMON)];
    const multi = action(summonTag(TIGER), summonTag(DEMON));
    expect(summonActionBlockedReason(multi, player(), state, noEffects)).toContain(
      "already summoned",
    );
  });

  it("does not pilot-block an AI caster (it can never be piloted)", () => {
    const ai = makeBattleUser("ai-caster", { isAi: true, curHealth: 100 });
    const aiSummon = makeBattleUser("s9", {
      controllerId: "ai-caster", username: "Demon", isAi: true, isSummon: true,
      isOriginal: true, summonSourceId: DEMON, curHealth: 500, isPiloted: true,
    });
    const state = [ai, template(DEMON, "Demon"), template(TIGER, "Tiger"), aiSummon];
    // wantsPilot resolves false for an AI caster, so the piloted cap cannot trip.
    expect(
      summonActionBlockedReason(action(summonTag(TIGER, true)), ai, state, noEffects),
    ).toBeNull();
  });
});
