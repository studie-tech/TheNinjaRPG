import { advanceEncounterWave } from "@/libs/combat/encounters";
import { availableUserActions, calcActiveUser } from "@/libs/combat/actions";
import type { ReturnedBattle } from "@/libs/combat/types";
import { describe, expect, it } from "bun:test";
import { periodStart } from "@/utils/time";
import { dungeonEntryError, dungeonBattleOutcome, dungeonNextState } from "@/libs/dungeon";
import { alignBattle, calcBattleResult, findUser, maskBattle } from "@/libs/combat/util";
import { applyEffects } from "@/libs/combat/process";
import { getBattleSpawnLocations } from "@/libs/combat/participants";
import { dungeonContentSchema } from "@/validators/dungeon";
import { dungeonBattleState, encounterWaveState, dungeonContent } from "../setup/dungeon";
import { makeCompleteBattle, makeEffect, makeUser } from "./combat/helpers/battleScenario";

const floorBattle = () => makeCompleteBattle({
  battleType: "QUEST", round: 0, width: 12, height: 10,
  usersState: [makeUser({userId: "a", controllerId: "a", direction: "left"}), makeUser({userId: "b", controllerId: "b", direction: "left"}), makeUser({userId: "c", controllerId: "c", direction: "left"}), makeUser({userId: "enemy", isAi: true, direction: "right"})],
  extraState: {dungeon: dungeonBattleState(), encounter: encounterWaveState()},
});
describe("dungeon combat rules", () => {
  it("advances rounds for a lone survivor waiting for the next wave", () => {
    const battle = floorBattle();
    battle.activeUserId = "a"; battle.roundStartAt = new Date(0);
    battle.usersState.slice(1).forEach((u) => {u.curHealth = 0;});
    battle.extraState.encounter!.pendingWaves.push({users: [makeUser({userId:"next", isAi:true, direction:"right"})],effects:[],delayRounds:2});
    expect(calcActiveUser(battle as unknown as ReturnedBattle, "a").progressRound).toBe(true);
    alignBattle(battle, [], "a");
    expect(battle.round).toBe(1);
    expect(alignBattle(battle, [], "a").progressRound).toBe(false);
  });
  it("keeps defeated members in a live party battle until team settlement", () => {
    const battle = floorBattle(); battle.usersState[0]!.curHealth = 0;
    expect(calcBattleResult(battle, "a")).toBeNull();
    battle.usersState[3]!.curHealth = 0;
    expect(calcBattleResult(battle, "a")?.outcome).toBe("Won");
    expect(calcBattleResult(battle, "a")?.money).toBe(0);
  });
  it("spawns preloaded waves only after defeat and the minimum round delay", () => {
    const battle = floorBattle();
    battle.extraState.encounter!.pendingWaves.push({users: [makeUser({userId: "next", isAi: true, direction: "right"})], effects: [], delayRounds: 2});
    battle.usersState[3]!.curHealth = 0;
    expect(calcBattleResult(battle, "a")).toBeNull();
    expect(advanceEncounterWave(battle)).toBe(false);
    battle.round = 2;
    expect(advanceEncounterWave(battle)).toBe(true);
    expect(battle.extraState.encounter!.wave).toBe(2);
    expect(battle.usersState.some((u) => u.userId === "next" && u.curHealth > 0)).toBe(true);
  });
  it("retains hidden summon sources across wave transitions", () => {
    const battle = floorBattle();
    battle.usersState.push(makeUser({userId: "template", controllerId: "summon-ai", isAi: true, isSummon: true, isSummonTemplate: true, direction: "right", curHealth: 0}));
    battle.usersState[3]!.curHealth = 0;
    battle.extraState.encounter!.pendingWaves.push({users: [makeUser({userId: "next", isAi: true, direction: "right"})], effects: [], delayRounds: 0});
    advanceEncounterWave(battle);
    expect(battle.usersState.some((u) => u.userId === "template")).toBe(true);
  });
  it("retains active ground traps when clearing barriers for the next wave", () => {
    const battle = floorBattle();
    battle.round = 1;
    battle.usersState[3]!.curHealth = 0;
    const spawn = getBattleSpawnLocations(battle.width, battle.height, "right")[0]!;
    const location = {longitude: spawn.x, latitude: spawn.y, creatorId: "a", createdRound: 0, fromType: "jutsu" as const};
    const trap = makeEffect("damage", {calculation: "static", power: 100, rounds: 5, friendlyFire: "ENEMIES"}, {...location, targetType: "user"});
    const barrier = makeEffect("barrier", {rounds: 5}, location);
    battle.groundEffects.push(trap, barrier);
    battle.extraState.encounter!.pendingWaves.push({users: [makeUser({userId: "next", isAi: true, direction: "right"})], effects: [], delayRounds: 0});

    expect(advanceEncounterWave(battle)).toBe(true);
    expect(battle.groundEffects).toEqual([trap]);
    const processed = applyEffects(battle, "next").newBattle;
    expect(processed.usersState.find((u) => u.userId === "next")?.curHealth).toBe(4920);
    expect(processed.groundEffects).toEqual([expect.objectContaining({id: trap.id, rounds: 5})]);
  });
  it("keeps defeated enemy effects active and visible through the next wave", () => {
    const battle = floorBattle();
    battle.round = 1;
    battle.activeUserId = "enemy";
    battle.roundStartAt = new Date();
    const spawn = getBattleSpawnLocations(battle.width, battle.height, "right")[0]!;
    Object.assign(battle.usersState[3]!, {curHealth: 0, longitude: spawn.x, latitude: spawn.y});
    battle.usersEffects.push(makeEffect("damage", {calculation: "static", power: 100, rounds: 5}, {creatorId: "enemy", targetId: "a", targetType: "user", fromType: "jutsu", createdRound: 0}));
    battle.extraState.encounter!.pendingWaves.push({users: [makeUser({userId: "next", isAi: true, direction: "right"})], effects: [], delayRounds: 0});
    expect(applyEffects(structuredClone(battle), "a").newBattle.usersState[0]?.curHealth).toBe(4920);
    expect(advanceEncounterWave(battle)).toBe(true);
    expect(applyEffects(structuredClone(battle), "a").newBattle.usersState[0]?.curHealth).toBe(4920);
    expect(dungeonBattleOutcome(battle)).toBeNull();
    expect(calcBattleResult(battle, "a")).toBeNull();
    const masked = maskBattle(battle, "a");
    expect(masked.usersEffects).toEqual(expect.arrayContaining([expect.objectContaining({creatorId: "enemy", targetId: "a", rounds: 5})]));
    expect(findUser(masked.usersState, spawn.x, spawn.y, masked.usersEffects)?.userId).toBe("next");
    expect(calcActiveUser(masked, "a").actor.userId).toBe("a");
    battle.usersState.at(-1)!.curHealth = 0;
    expect(dungeonBattleOutcome(battle)).toBe("won");
  });
  it("hides future enemy state and removes the flee action from the masked client", () => {
    const battle=floorBattle();battle.extraState.encounter!.pendingWaves.push({users:[makeUser({userId:"secret-enemy",isAi:true,direction:"right"})],effects:[],delayRounds:0});
    const masked=maskBattle(battle,"a");expect(masked.extraState.encounter).not.toHaveProperty("pendingWaves");
    expect(JSON.stringify(masked)).not.toContain("secret-enemy");expect(availableUserActions(masked,"a").some((a)=>a.id==="flee")).toBe(false);
  });
  it("ends at the exact deadline", () => {
    const battle = floorBattle();
    expect(dungeonBattleOutcome(battle, battle.extraState.dungeon!.expiresAt)).toBe("ended");
  });
  it.each([0, 5])("waits for three completed missed rounds after action round %s", (lastActionRound) => {
    const battle = floorBattle();
    battle.round = lastActionRound + 1;
    battle.activeUserId = "a";
    battle.usersState.forEach((user) => { user.round = lastActionRound; });
    battle.extraState.dungeon!.lastActionRound = {a: lastActionRound, b: lastActionRound, c: lastActionRound};

    for (let turn = 0; turn < battle.usersState.length * 3; turn++) {
      expect(dungeonBattleOutcome(battle)).toBeNull();
      battle.roundStartAt = new Date(Date.now() - 60000);
      alignBattle(battle, [], "a");
    }

    expect(battle.round).toBe(lastActionRound + 4);
    expect(dungeonBattleOutcome(battle)).toBe("ended");
    expect(battle.extraState.dungeon!.failedReason).toContain("took no actions for 3 rounds");
  });
  it("excludes defeated members and summons from inactivity checks", () => {
    const battle = floorBattle();
    battle.round = 8;
    battle.usersState[0]!.curHealth = 0;
    battle.extraState.dungeon!.lastActionRound = {a: 0, b: 5, c: 5};
    battle.usersState.push(makeUser({userId: "summon", controllerId: "b", isSummon: true, direction: "left"}));
    expect(dungeonBattleOutcome(battle)).toBeNull();
  });
  it("retries the current tier on ordinary wipes and the same room on mini-boss wipes", () => {
    const state = {...dungeonBattleState().runState, floor: 7};
    expect(dungeonNextState(state, "wipe", "floor").floor).toBe(5);
    expect(dungeonNextState({...state, floor: 9}, "wipe", "mini-boss").floor).toBe(9);
    expect(dungeonNextState({...state, floor: 19}, "wipe", "boss").floor).toBe(15);
  });
  it("defaults existing drop quantities to one and rejects invalid quantities", () => {
    const content = dungeonContent();
    const raw = { ...content, rewards: { ...content.rewards, drops: [{type: "item", id: "loot", chance: 100}] } };
    expect(dungeonContentSchema.parse(raw).rewards.drops[0]?.quantity).toBe(1);
    for (const quantity of [0, -1, 1.5, 101, Number.NaN]) {
      expect(dungeonContentSchema.safeParse({ ...raw, rewards: { ...raw.rewards, drops: [{type: "item", id: "loot", chance: 100, quantity}] } }).success).toBe(false);
    }
    expect(dungeonContentSchema.safeParse({ ...raw, rewards: { ...raw.rewards, drops: [{type: "jutsu", id: "technique", chance: 100, quantity: 2}] } }).success).toBe(false);
  });
  it("rejects a sixth room, more than ten enemies and delayed initial waves", () => {
    const content = dungeonContent();
    content.tiers[0]!.push(content.tiers[0]![0]!);
    expect(dungeonContentSchema.safeParse(content).success).toBe(false);
    const next = dungeonContent(); next.tiers[0]![0]!.waves[0]!.aiIds = Array(11).fill("enemy");
    expect(dungeonContentSchema.safeParse(next).success).toBe(false);
    const delayed = dungeonContent(); delayed.tiers[0]![0]!.waves[0]!.delayRounds = 1;
    expect(dungeonContentSchema.safeParse(delayed).success).toBe(false);
  });
});

describe("dungeon admission limits", () => {
  const now = new Date("2026-10-30T12:00:00Z");
  const evidence = () => ({ requirements: dungeonContent().requirements, level: 50, questCompleted: true, itemQuantity: 3, attempts: [] as number[], completions: [] as number[] });
  it("keeps default dungeons unlimited and checks level, historical quest and each player's items", () => {
    const info = evidence();
    expect(dungeonEntryError(info, now)).toBeNull();
    info.requirements.requiredLevel = 51;
    expect(dungeonEntryError(info, now)).toContain("level 51");
    info.requirements.requiredLevel = 1;
    info.requirements.prerequisiteQuestId = "quest"; info.questCompleted = false;
    expect(dungeonEntryError(info, now)).toContain("prerequisite");
    info.questCompleted = true; info.requirements.requiredItemId = "ticket"; info.requirements.requiredItemQuantity = 4;
    expect(dungeonEntryError(info, now)).toContain("4 entry");
  });
  it("uses quest lifetime attempt caps independently of calendar attempt cooldowns", () => {
    const info = evidence(); info.attempts = [Date.parse("2026-10-29T23:59:59Z")];
    info.requirements.maxAttempts = 1;
    expect(dungeonEntryError(info, now)).toContain("maximum dungeon attempts");
    info.requirements.maxAttempts = null; info.requirements.attemptDelay = "daily";
    expect(dungeonEntryError(info, now)).toBeNull();
    info.attempts.push(now.getTime());
    expect(dungeonEntryError(info, now)).toContain("daily");
  });
  it.each(["daily", "weekly", "monthly"] as const)("resets completion caps on the %s UTC quest boundary", (delay) => {
    const info = evidence(); info.requirements.maxCompletes = 1; info.requirements.retryDelay = delay;
    const start = periodStart(delay, now).getTime();
    info.completions = [start - 1]; expect(dungeonEntryError(info, now)).toBeNull();
    info.completions.push(start); expect(dungeonEntryError(info, now)).toContain("maximum dungeon completions");
  });
});
