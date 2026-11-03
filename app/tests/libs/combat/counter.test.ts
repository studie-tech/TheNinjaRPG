import { describe, expect, it } from "bun:test";
import type { Jutsu } from "@/drizzle/schema";
import { performBattleAction } from "@/libs/combat/actions";
import { expireCounters } from "@/libs/combat/counter";
import { applyEffects } from "@/libs/combat/process";
import type { CombatAction, UserEffect } from "@/libs/combat/types";
import { alignBattle, getBattleGrid, maskBattle } from "@/libs/combat/util";
import { CounterTag } from "@/validators/combat";
import { makeBattleUser, makeCompleteBattle, makeEffect } from "./helpers/battleScenario";

const counter = (createdRound = 2) => makeEffect("counter", { power: 75, calculation: "static", rounds: 1 }, {
  creatorId: "defender", targetId: "defender", targetType: "user", createdRound,
  fromType: "jutsu", counterName: "Hidden Reversal",
});
const hit = (overrides: Partial<UserEffect> = {}) => makeEffect("damage", { power: 100, calculation: "static", rounds: 0 }, {
  creatorId: "attacker", targetId: "defender", targetType: "user", fromType: "jutsu",
  createdRound: 3, isNew: true, ...overrides,
});
const battle = (effects: UserEffect[]) => makeCompleteBattle({ round: 3, width: 12, height: 10, createdAt: new Date(0), roundStartAt: new Date(), usersState: [
  makeBattleUser("attacker", { curHealth: 1000, maxHealth: 1000 }),
  makeBattleUser("defender", { curHealth: 1000, maxHealth: 1000 }),
], usersEffects: effects });
const hp = (state: ReturnType<typeof battle>, id: string) => state.usersState.find((user) => user.userId === id)!.curHealth;

describe("Counter", () => {
  it("uses active stat buffs in retaliation's damage formula", () => {
    const formula = { ...counter(), calculation: "formula", statTypes: ["Ninjutsu"] } as UserEffect;
    const buff = makeEffect("increasestat", { power: 100, calculation: "percentage", statTypes: ["Ninjutsu"], rounds: 3 }, {
      creatorId: "defender", targetId: "defender", targetType: "user", createdRound: 1,
    });
    const unbuffed = battle([structuredClone(formula), hit()]);
    const buffed = battle([structuredClone(formula), buff, hit()]);
    unbuffed.usersState[1]!.offence = 10000;
    buffed.usersState[1]!.offence = 10000;
    const normalResult = applyEffects(unbuffed, "attacker").newBattle;
    const buffedResult = applyEffects(buffed, "attacker").newBattle;
    expect(hp(buffedResult, "attacker")).toBeLessThan(hp(normalResult, "attacker"));
  });
  it("activates next round and expires at the following boundary", () => {
    const state = battle([counter(3)]);
    state.usersEffects[0]!.castThisRound = true;
    const advance = () => {
      state.activeUserId = "defender";
      state.roundStartAt = new Date(0);
      state.usersState.forEach((user) => { user.round = state.round; });
      return alignBattle(state, []);
    };
    expect(advance().expiredEffects).toEqual([]);
    expect(state.round).toBe(4);
    expect(state.usersEffects[0]?.rounds).toBe(1);
    expect(advance().expiredEffects[0]?.txt).toContain("expires without triggering");
    expect(state.round).toBe(5);
    expect(state.usersEffects).toEqual([]);
  });
  it("leaves other AoE targets exposed and cannot recursively counter retaliation", () => {
    const opposingCounter = { ...counter(), id: "opposing-counter", creatorId: "attacker", targetId: "attacker" };
    const state = battle([counter(), opposingCounter, hit(), hit({ id: "aoe", targetId: "ally" })]);
    state.usersState.push(makeBattleUser("ally", { curHealth: 1000, maxHealth: 1000 }));
    const result = applyEffects(state, "attacker").newBattle;
    expect(hp(result, "ally")).toBe(920);
    expect(hp(result, "defender")).toBe(1000);
    expect(hp(result, "attacker")).toBe(940);
    expect(result.usersEffects.filter((effect) => effect.type === "counter")).toHaveLength(1);
  });
  it("uses normal lethal damage credit", () => {
    const state = battle([counter(), hit()]);
    state.usersState[0]!.curHealth = 1;
    const result = applyEffects(state, "attacker").newBattle;
    expect(hp(result, "attacker")).toBe(0);
    expect(result.usersState[1]?.damageDealt).toBe(60);
  });
  it("Clear removes Counter without claiming it expired", () => {
    const removal = makeEffect("clear", { power: 100, rounds: 0 }, {
      creatorId: "attacker", targetId: "defender", targetType: "user", createdRound: 3, isNew: true,
    });
    const result = applyEffects(battle([counter(), removal, hit()]), "attacker");
    expect(hp(result.newBattle, "defender")).toBe(920);
    expect(result.newBattle.usersEffects.some((effect) => effect.type === "counter")).toBe(false);
    expect(expireCounters(result.newBattle)).toEqual([]);
  });
  it("requires a positive duration", () => {
    expect(CounterTag.safeParse({ rounds: 0 }).success).toBe(false);
  });
  it("does not protect during the casting round", () => {
    const result = applyEffects(battle([counter(3), hit()]), "attacker");
    expect(hp(result.newBattle, "defender")).toBe(920);
    expect(hp(result.newBattle, "attacker")).toBe(1000);
  });
  it("negates every damage tag in the cast, retaliates once, and is consumed", () => {
    const pierce = { ...hit(), type: "pierce", id: "pierce" } as UserEffect;
    const result = applyEffects(battle([counter(), hit(), pierce]), "attacker");
    expect(hp(result.newBattle, "defender")).toBe(1000);
    expect(hp(result.newBattle, "attacker")).toBe(940);
    expect(result.newBattle.usersEffects.some((effect) => effect.type === "counter")).toBe(false);
    expect(result.actionEffects.filter((effect) => effect.txt.includes("counters attacker"))).toHaveLength(1);
    expect(result.newBattle.extraState.revealedActions?.jutsuIds).toContain("counter-action");
    expect(expireCounters(result.newBattle)).toEqual([]);
  });
  it.each(["basic", "item"] as const)("does not trigger on %s damage", (fromType) => {
    const result = applyEffects(battle([counter(), hit({ fromType })]), "attacker");
    expect(hp(result.newBattle, "defender")).toBe(920);
    expect(hp(result.newBattle, "attacker")).toBe(1000);
  });
  it("does not trigger on an ongoing damage tick", () => {
    const residual = hit({ createdRound: 1, isNew: false });
    residual.rounds = 3;
    const result = applyEffects(battle([counter(), residual]), "defender");
    expect(hp(result.newBattle, "defender")).toBe(920);
    expect(hp(result.newBattle, "attacker")).toBe(1000);
  });
  it("does not consume shields or generate lifesteal from the negated hit", () => {
    const shield = makeEffect("shield", { power: 100, health: 500, rounds: 3 }, {
      creatorId: "defender", targetId: "defender", targetType: "user", createdRound: 1,
    });
    const leech = makeEffect("lifesteal", { power: 100, calculation: "percentage", rounds: 3 }, {
      creatorId: "attacker", targetId: "attacker", targetType: "user", createdRound: 1,
    });
    const result = applyEffects(battle([counter(), hit(), shield, leech]), "attacker");
    expect(hp(result.newBattle, "defender")).toBe(1000);
    expect(hp(result.newBattle, "attacker")).toBe(940);
    expect(result.newBattle.usersEffects.find((effect) => effect.id === shield.id)?.power).toBe(100);
  });
  it("keeps the armed effect private", () => {
    const state = battle([counter()]);
    expect(maskBattle(state, "attacker").usersEffects).toEqual([]);
    expect(maskBattle(state, "spectator").usersEffects).toEqual([]);
    expect(maskBattle(state, "defender").usersEffects).toHaveLength(1);
    expect(state.usersEffects).toHaveLength(1);
  });
  it("announces unused expiry only once", () => {
    const state = battle([counter()]);
    state.usersEffects[0]!.rounds = 0;
    expect(expireCounters(state)[0]?.txt).toContain("Hidden Reversal expires without triggering");
    expect(expireCounters(state)).toEqual([]);
  });
  it("casts silently while spending resources", () => {
    const state = battle([]);
    const action: CombatAction = {
      id: "counter-jutsu", name: "Hidden Reversal", image: "", battleDescription: "%user prepares a reversal",
      type: "jutsu", target: "SELF", method: "SINGLE", range: 0,
      healthCost: 0, chakraCost: 10, staminaCost: 0, actionCostPerc: 60,
      updatedAt: Date.now(), cooldown: 2, originalCooldown: 2,
      effects: [CounterTag.parse({ power: 75, calculation: "static", appearAnimation: "secret-animation" })],
    };
    state.extraState.jutsus = { [action.id]: { ...action } as unknown as Jutsu };
    state.usersState[1]!.jutsus.push({ id: "owned-counter", jutsuId: action.id,
      level: 1, experience: 0, equipped: true, lastUsedRound: -1, originalCooldown: 2 });
    const result = performBattleAction({ battle: state, action, grid: getBattleGrid(100, state),
      contextUserId: "defender", actorId: "defender", longitude: 1, latitude: 0 });
    expect(action.battleDescription).toBe("");
    expect(result.actionEffects).toEqual([]);
    expect(result.newBattle.groundEffects).toEqual([]);
    expect(result.newBattle.extraState.revealedActions?.jutsuIds ?? []).not.toContain(action.id);
    expect(result.newBattle.usersState[1]!.curChakra).toBeLessThan(5000);
    expect(result.newBattle.usersState[1]!.actionPoints).toBeLessThan(100);
    expect(maskBattle(result.newBattle, "attacker").usersEffects).toEqual([]);
    expect(maskBattle(result.newBattle, "attacker").extraState.jutsus).toEqual({});
    expect(maskBattle(result.newBattle, "defender").extraState.jutsus).toHaveProperty(action.id);
    expect(result.newBattle.usersState[1]?.jutsus[0]?.lastUsedRound).toBe(3);
  });
});
