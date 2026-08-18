import { describe, it, expect } from "vitest";
import { applyEffects } from "@/libs/combat/process";
import { spliceOrphanedSummons } from "@/libs/combat/summon";
import { clone, summon } from "@/libs/combat/tags";
import type { CompleteBattle } from "@/libs/combat/types";
import type { BattleUserState, GroundEffect, UserEffect } from "@/libs/combat/types";

// Drives the REAL applyEffects pipeline to settle whether a *blocked* summon
// re-cast (player already has a live summon) can tear down the existing summon
// on a later pass. The teardown path keys on controllerId, so the concern is a
// genuine regression risk — this pins the actual behavior.

const AI_DB_ID = "ai-demon-db-id";
const PLAYER_ID = "player1";

const mkTemplate = (): BattleUserState =>
  ({
    userId: "battle-instance-nanoid",
    controllerId: AI_DB_ID,
    username: "Demon",
    isAi: true,
    isSummon: true,
    isSummonTemplate: true,
    isOriginal: true,
    level: 10,
    poolsMultiplier: 1,
    statsMultiplier: 1,
    bloodlineId: null,
    effects: [],
    curHealth: 0,
    maxHealth: 100,
    fledBattle: false,
    leftBattle: false,
    longitude: 0,
    latitude: 0,
    ninjutsuOffence: 100,
    ninjutsuDefence: 100,
    genjutsuOffence: 100,
    genjutsuDefence: 100,
    taijutsuOffence: 100,
    taijutsuDefence: 100,
    bukijutsuOffence: 100,
    bukijutsuDefence: 100,
    strength: 100,
    intelligence: 100,
    willpower: 100,
    speed: 100,
  }) as unknown as BattleUserState;

const mkPlayer = (): BattleUserState =>
  ({
    userId: PLAYER_ID,
    controllerId: PLAYER_ID,
    username: "Player",
    isAi: false,
    isSummon: false,
    isOriginal: true,
    level: 10,
    villageId: "v1",
    direction: "left",
    longitude: 1,
    latitude: 1,
    curHealth: 100,
    maxHealth: 100,
    fledBattle: false,
    leftBattle: false,
    effects: [],
  }) as unknown as BattleUserState;

// A clone owned by the player: shares isSummon + controllerId with a summon,
// but isOriginal=false marks it a clone (it must never be the un-summon target).
const mkClone = (): BattleUserState =>
  ({
    userId: "clone-id",
    controllerId: PLAYER_ID,
    username: "Player clone",
    isAi: true,
    isSummon: true,
    isOriginal: false,
    isSummonTemplate: false,
    level: 10,
    longitude: 3,
    latitude: 3,
    curHealth: 100,
    maxHealth: 100,
    fledBattle: false,
    leftBattle: false,
    effects: [],
  }) as unknown as BattleUserState;

// An already-live summon owned by the player (a real summon, isOriginal=true).
const mkLiveSummon = (): BattleUserState =>
  ({
    userId: "live-summon-id",
    controllerId: PLAYER_ID,
    username: "Demon",
    isAi: true,
    isSummon: true,
    isOriginal: true,
    isSummonTemplate: false,
    summonSourceId: AI_DB_ID,
    level: 10,
    longitude: 2,
    latitude: 2,
    curHealth: 500,
    maxHealth: 500,
    fledBattle: false,
    leftBattle: false,
    effects: [],
  }) as unknown as BattleUserState;

const mkSummonGroundEffect = (over: Partial<GroundEffect> = {}): GroundEffect =>
  ({
    id: "ge-summon-1",
    type: "summon",
    aiId: AI_DB_ID,
    aiHp: 500,
    creatorId: PLAYER_ID,
    isNew: true,
    castThisRound: true,
    rounds: 3,
    longitude: 5,
    latitude: 5,
    power: 100,
    level: 1,
    powerPerLevel: 0,
    calculation: "percentage",
    createdRound: 1,
    ...over,
  }) as unknown as GroundEffect;

const mkBattle = (
  usersState: BattleUserState[],
  groundEffects: GroundEffect[],
): CompleteBattle =>
  ({
    id: "battle-1",
    activeUserId: PLAYER_ID,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    roundStartAt: new Date("2026-01-01T00:00:00Z"),
    background: "default",
    width: 10,
    height: 10,
    battleType: "COMBAT",
    version: 1,
    round: 2,
    rewardScaling: 1,
    forceKeepPools: false,
    usersState,
    usersEffects: [] as UserEffect[],
    groundEffects,
    extraState: { bloodlines: {}, jutsus: {}, items: {} },
  }) as unknown as CompleteBattle;

const liveSummonsOf = (state: BattleUserState[]) =>
  state.filter((u) => u.isSummon && u.controllerId === PLAYER_ID);

describe("summon teardown — positive control", () => {
  it("an EXPIRED summon effect (rounds=0, not new) tears down the live summon", () => {
    const battle = mkBattle(
      [mkPlayer(), mkLiveSummon(), mkTemplate()],
      [mkSummonGroundEffect({ isNew: false, castThisRound: false, rounds: 0 })],
    );

    const { newBattle } = applyEffects(battle, PLAYER_ID);

    // Confirms the harness actually exercises the teardown branch.
    expect(liveSummonsOf(newBattle.usersState)).toHaveLength(0);
  });
});

describe("blocked summon re-cast does NOT remove the existing live summon", () => {
  it("keeps the live summon across the blocked cast and the next action", () => {
    const battle = mkBattle(
      [mkPlayer(), mkLiveSummon(), mkTemplate()],
      // createdRound === round so castThisRound is true and the spawn/block path fires.
      [mkSummonGroundEffect({ createdRound: 2 })],
    );

    const pass1 = applyEffects(battle, PLAYER_ID).newBattle;
    // Block returns "already summoned" without tearing down anything.
    expect(liveSummonsOf(pass1.usersState)).toHaveLength(1);
    // The blocked effect (rounds set to 0) is swept out in this same pass, so no
    // later alignBattle can retain it to drive the rounds===0 teardown.
    expect(pass1.groundEffects.filter((e) => e.type === "summon")).toHaveLength(0);
    // The existing summon therefore survives the next action.
    const pass2 = applyEffects(pass1, PLAYER_ID).newBattle;
    expect(liveSummonsOf(pass2.usersState)).toHaveLength(1);
  });
});

describe("summon expiry teardown targets the summon, not a clone", () => {
  it("unsummons the real summon and leaves the player's clone intact", () => {
    // Clone placed BEFORE the summon so a controllerId-only fallback (which a
    // clone also satisfies) would wrongly pick the clone first.
    const usersState = [mkPlayer(), mkClone(), mkLiveSummon(), mkTemplate()];
    // An expired summon effect (rounds=0, not new) drives the teardown path.
    const expiry = mkSummonGroundEffect({
      isNew: false,
      castThisRound: false,
      rounds: 0,
    });

    const res = summon(usersState, expiry, [], mkBattle(usersState, []));

    expect(res?.txt).toContain("was unsummoned");
    expect(usersState.some((u) => u.userId === "clone-id")).toBe(true);
    expect(usersState.some((u) => u.userId === "live-summon-id")).toBe(false);
  });
});

describe("orphan cleanup vs clone lifecycle", () => {
  // clone() rebinds effect.creatorId to the spawned clone, so if orphan cleanup
  // removes the clone the effect can never be expired by its own tag function.
  // clone() used to throw in that state, which failed every subsequent action in
  // the battle for every participant.
  const mkCloner = (): BattleUserState =>
    ({
      ...mkPlayer(),
      jutsus: [],
      items: [],
      effects: [],
      poolsMultiplier: 1,
      statsMultiplier: 1,
      ninjutsuOffence: 100,
      ninjutsuDefence: 100,
      genjutsuOffence: 100,
      genjutsuDefence: 100,
      taijutsuOffence: 100,
      taijutsuDefence: 100,
      bukijutsuOffence: 100,
      bukijutsuDefence: 100,
      strength: 100,
      intelligence: 100,
      willpower: 100,
      speed: 100,
    }) as unknown as BattleUserState;

  const mkAlly = (): BattleUserState =>
    ({
      ...mkCloner(),
      userId: "ally1",
      controllerId: "ally1",
      username: "Ally",
    }) as unknown as BattleUserState;

  const mkCloneGroundEffect = (): GroundEffect =>
    ({
      id: "ge-clone-1",
      type: "clone",
      creatorId: PLAYER_ID,
      isNew: true,
      castThisRound: true,
      rounds: 3,
      longitude: 4,
      latitude: 4,
      power: 100,
      level: 1,
      powerPerLevel: 0,
      createdRound: 2,
    }) as unknown as GroundEffect;

  it("keeps a live clone when its creator flees, and the battle keeps processing", () => {
    const battle = mkBattle([mkCloner(), mkAlly()], [mkCloneGroundEffect()]);

    // Pass 1 spawns the clone and rebinds creatorId to it.
    const pass1 = applyEffects(battle, PLAYER_ID).newBattle;
    const spawned = pass1.usersState.find((u) => u.username === "Player clone");
    expect(spawned).toBeDefined();
    const cloneEffect = pass1.groundEffects.find((e) => e.type === "clone");
    expect(cloneEffect?.creatorId).toBe(spawned?.userId);

    // The creator flees. Orphan cleanup must leave the clone in place.
    const cloner = pass1.usersState.find((u) => u.userId === PLAYER_ID);
    if (cloner) cloner.fledBattle = true;
    expect(spliceOrphanedSummons(pass1.usersState, pass1.usersEffects)).toEqual([]);
    expect(pass1.usersState.some((u) => u.userId === spawned?.userId)).toBe(true);

    // The ally's next action still resolves.
    expect(() => applyEffects(pass1, "ally1")).not.toThrow();
  });

  it("expires the clone effect instead of throwing when the clone is gone", () => {
    const usersState = [mkCloner(), mkAlly()];
    const effect = mkCloneGroundEffect();

    clone(usersState, effect, { jutsus: {} });
    const spawnedId = effect.creatorId;
    // Remove the clone by some other route than its own tag function.
    const idx = usersState.findIndex((u) => u.userId === spawnedId);
    usersState.splice(idx, 1);
    effect.isNew = false;

    expect(() => clone(usersState, effect, { jutsus: {} })).not.toThrow();
    // rounds<=0 lets applyEffects drop the effect instead of retaining it forever.
    expect(effect.rounds).toBe(0);
  });
});
