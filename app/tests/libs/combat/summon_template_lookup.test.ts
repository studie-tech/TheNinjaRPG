import { describe, it, expect } from "vitest";
import { clone, summon } from "@/libs/combat/tags";
import { spliceOrphanedSummons } from "@/libs/combat/summon";
import type { Battle } from "@/drizzle/schema";
import type { BattleUserState, GroundEffect, UserEffect } from "@/libs/combat/types";

// The summon AI template is loaded into battle state via processUsersForBattle
// (routers/combat.ts), which for every isAi user sets:
//   controllerId = <DB userId> (== effect.aiId)
//   userId       = nanoid()    (a fresh battle-instance id, NOT the DB id)
// summon() must therefore find the template by controllerId, never by userId.
const AI_DB_ID = "ai-demon-db-id"; // what effect.aiId carries
const PLAYER_ID = "player1";

const mkTemplate = (): BattleUserState =>
  ({
    // Mirrors the real loader: random instance id, DB id lives in controllerId.
    userId: "battle-instance-nanoid",
    controllerId: AI_DB_ID,
    username: "Demon",
    isAi: true,
    isSummon: true,
    isSummonTemplate: true,
    level: 10,
    poolsMultiplier: 1,
    statsMultiplier: 1,
    bloodlineId: null,
    effects: [],
    // Loaded via hide:true, which parks the template at (0,0) with curHealth 0.
    curHealth: 0,
    maxHealth: 100,
    fledBattle: false,
    leftBattle: false,
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
    level: 10,
    villageId: "v1",
    direction: "left",
    curHealth: 100,
    fledBattle: false,
    leftBattle: false,
  }) as unknown as BattleUserState;

const mkSummonEffect = (): GroundEffect =>
  ({
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
  }) as unknown as GroundEffect;

const mkBattle = (): Battle =>
  ({
    battleType: "COMBAT",
    round: 1,
    extraState: { bloodlines: {} },
  }) as unknown as Battle;

describe("summon() template lookup", () => {
  it("finds the template by controllerId (the loaded aiId) and spawns the summon", () => {
    const usersState = [mkPlayer(), mkTemplate()];
    const userEffects: UserEffect[] = [];

    const result = summon(usersState, mkSummonEffect(), userEffects, mkBattle());

    // Must spawn, not fall through to the "Failed to create summon!" branch.
    expect(result?.color).toBe("blue");
    expect(result?.txt).toContain("was summoned");

    // A new summon owned by the casting player must now be on the battlefield.
    const spawned = usersState.find(
      (u) => u.isSummon && u.controllerId === PLAYER_ID,
    );
    expect(spawned).toBeDefined();
    expect(spawned?.curHealth).toBe(500); // pools set from effect.aiHp
  });

  it("survives orphan cleanup so a re-cast after the summon disappears still works", () => {
    const usersState = [mkPlayer(), mkTemplate()];
    const userEffects: UserEffect[] = [];

    // First cast spawns a summon.
    const first = summon(usersState, mkSummonEffect(), userEffects, mkBattle());
    expect(first?.color).toBe("blue");

    // Round progression runs orphan cleanup. The hidden clone-source template
    // (curHealth 0, controllerId = aiId with no matching combatant) must NOT be
    // spliced, or every future re-cast loses its template.
    spliceOrphanedSummons(usersState, userEffects);

    // The summon disappears (dies / expires), clearing the one-per-controller cap.
    const spawned = usersState.find(
      (u) => u.isSummon && u.controllerId === PLAYER_ID,
    );
    if (spawned) spawned.curHealth = 0;

    // effect.aiId still points at the template, so a fresh cast must find it
    // again and spawn a second summon.
    const second = summon(usersState, mkSummonEffect(), userEffects, mkBattle());
    expect(second?.color).toBe("blue");
    expect(second?.txt).toContain("was summoned");
  });
});

describe("spliceOrphanedSummons vs the clone-source template", () => {
  it("keeps the hidden template (curHealth 0, controller absent)", () => {
    const template = mkTemplate(); // isSummon, controllerId = aiId, curHealth 0
    const usersState = [mkPlayer(), template];

    spliceOrphanedSummons(usersState, []);

    expect(usersState).toContain(template);
  });

  it("still removes a LIVE summon whose controller is gone", () => {
    const liveOrphan = {
      userId: "s9",
      controllerId: "ghost", // no such combatant
      isSummon: true,
      curHealth: 50,
      fledBattle: false,
      leftBattle: false,
    } as unknown as BattleUserState;
    const usersState = [mkPlayer(), liveOrphan];

    const removed = spliceOrphanedSummons(usersState, []).map((u) => u.userId);

    expect(removed).toContain("s9");
    expect(usersState).not.toContain(liveOrphan);
  });
});

describe("summon flag hygiene", () => {
  it("spawned summon clears the inherited isSummonTemplate flag", () => {
    const usersState = [mkPlayer(), mkTemplate()]; // template has isSummonTemplate: true
    const userEffects: UserEffect[] = [];

    const res = summon(usersState, mkSummonEffect(), userEffects, mkBattle());
    expect(res?.color).toBe("blue");

    const spawned = usersState.find(
      (u) => u.isSummon && u.controllerId === PLAYER_ID,
    );
    // structuredClone would inherit the template's flag; summon() must clear it.
    expect(spawned?.isSummonTemplate).toBe(false);
  });
});

describe("summon failure message", () => {
  it("gives a diagnosable message when the template AI is missing", () => {
    const usersState = [mkPlayer()]; // no template present
    const userEffects: UserEffect[] = [];
    const res = summon(usersState, mkSummonEffect(), userEffects, mkBattle());
    expect(res?.color).toBe("red");
    expect(res?.txt?.toLowerCase()).toContain("could not be found");
  });
});

describe("summon turn-order placement", () => {
  // Turn order IS the usersState array order (calcActiveUser walks it as a ring),
  // and initiateBattle establishes that array as initiative-sorted descending.
  // The summon inherits its summoner's initiative and is inserted at the matching
  // sorted position, so the invariant holds and the pair still acts back to back.
  const mkCombatant = (userId: string, initiative: number): BattleUserState =>
    ({
      userId,
      controllerId: userId,
      username: userId,
      isAi: true,
      isSummon: false,
      initiative,
      curHealth: 100,
      fledBattle: false,
      leftBattle: false,
    }) as unknown as BattleUserState;

  const summonOf = (usersState: BattleUserState[]) =>
    usersState.findIndex((u) => u.isSummon && u.controllerId === PLAYER_ID);

  it("gives the summon its summoner's initiative", () => {
    const player = { ...mkPlayer(), initiative: 15 } as BattleUserState;
    const usersState = [player, mkCombatant("enemy1", 5), mkTemplate()];

    expect(summon(usersState, mkSummonEffect(), [], mkBattle())?.color).toBe("blue");
    expect(usersState[summonOf(usersState)]?.initiative).toBe(15);
  });

  it("lands directly after the summoner when nobody shares their initiative", () => {
    const player = { ...mkPlayer(), initiative: 15 } as BattleUserState;
    const usersState = [player, mkCombatant("enemy1", 5), mkTemplate()];

    summon(usersState, mkSummonEffect(), [], mkBattle());

    const playerIdx = usersState.findIndex((u) => u.userId === PLAYER_ID);
    const enemyIdx = usersState.findIndex((u) => u.userId === "enemy1");
    expect(summonOf(usersState)).toBe(playerIdx + 1);
    expect(summonOf(usersState)).toBeLessThan(enemyIdx);
  });

  it("keeps the array initiative-sorted when a faster enemy exists", () => {
    // A summoner slower than one enemy must NOT jump its summon ahead of them.
    const fast = mkCombatant("fast", 20);
    const player = { ...mkPlayer(), initiative: 10 } as BattleUserState;
    const slow = mkCombatant("slow", 3);
    const usersState = [fast, player, slow, mkTemplate()];

    summon(usersState, mkSummonEffect(), [], mkBattle());

    const order = usersState
      .filter((u) => !u.isSummonTemplate)
      .map((u) => u.initiative as number);
    expect(order).toEqual([...order].sort((a, b) => b - a));
    expect(summonOf(usersState)).toBeGreaterThan(
      usersState.findIndex((u) => u.userId === "fast"),
    );
  });

  it("appends when the summoner is the slowest combatant", () => {
    const player = { ...mkPlayer(), initiative: 1 } as BattleUserState;
    const usersState = [mkCombatant("enemy1", 9), player, mkTemplate()];

    summon(usersState, mkSummonEffect(), [], mkBattle());

    const order = usersState
      .filter((u) => !u.isSummonTemplate)
      .map((u) => u.initiative as number);
    expect(order).toEqual([...order].sort((a, b) => b - a));
  });
});

describe("summons blocked in auto-resolved battle types", () => {
  it("does not spawn a summon in KAGE_AI even with a valid template", () => {
    const usersState = [mkPlayer(), mkTemplate()];
    const userEffects: UserEffect[] = [];
    const lenBefore = usersState.length;
    const kageBattle = {
      battleType: "KAGE_AI",
      round: 1,
      extraState: { bloodlines: {} },
    } as unknown as Battle;

    const res = summon(usersState, mkSummonEffect(), userEffects, kageBattle);

    // Nothing spawned, no blue "was summoned" effect.
    expect(usersState.length).toBe(lenBefore);
    expect(
      usersState.find((u) => u.isSummon && u.controllerId === PLAYER_ID),
    ).toBeUndefined();
    expect(res?.color).not.toBe("blue");
  });
});

describe("summon teardown after a re-cast", () => {
  it("removes the expired dead summon, not the freshly re-cast live one", () => {
    // A re-cast inserts the new live summon at summoner+1, ahead of the older
    // dead one. When the old effect expires, teardown must remove the dead
    // summon, not the live one a plain first-match would hit.
    const liveS2 = {
      userId: "s2",
      controllerId: PLAYER_ID,
      username: "Live",
      isSummon: true,
      curHealth: 500,
      fledBattle: false,
      leftBattle: false,
    } as unknown as BattleUserState;
    const deadS1 = {
      userId: "s1",
      controllerId: PLAYER_ID,
      username: "Dead",
      isSummon: true,
      curHealth: 0,
      fledBattle: false,
      leftBattle: false,
    } as unknown as BattleUserState;
    const usersState = [mkPlayer(), liveS2, deadS1]; // live ahead of dead
    const userEffects: UserEffect[] = [];
    const expireEffect = {
      type: "summon",
      aiId: AI_DB_ID,
      creatorId: PLAYER_ID,
      rounds: 0,
      isNew: false,
      castThisRound: false,
    } as unknown as GroundEffect;

    // No summonedUserId -> legacy branch, which prefers the non-live summon.
    summon(usersState, expireEffect, userEffects, mkBattle());

    expect(usersState.find((u) => u.userId === "s2")).toBeDefined(); // live kept
    expect(usersState.find((u) => u.userId === "s1")).toBeUndefined(); // dead removed
  });

  it("removes the summon the effect actually spawned, even if it is the live one", () => {
    // The legacy heuristic always prefers the non-live summon, so it removes the
    // dead one no matter which effect expired. With summonedUserId the effect
    // that spawned the LIVE summon correctly tears down that one instead.
    const liveS2 = {
      userId: "s2",
      controllerId: PLAYER_ID,
      username: "Live",
      isSummon: true,
      curHealth: 500,
      fledBattle: false,
      leftBattle: false,
    } as unknown as BattleUserState;
    const deadS1 = {
      userId: "s1",
      controllerId: PLAYER_ID,
      username: "Dead",
      isSummon: true,
      curHealth: 0,
      fledBattle: false,
      leftBattle: false,
    } as unknown as BattleUserState;
    const usersState = [mkPlayer(), liveS2, deadS1];
    const expireEffect = {
      type: "summon",
      aiId: AI_DB_ID,
      creatorId: PLAYER_ID,
      summonedUserId: "s2",
      rounds: 0,
      isNew: false,
      castThisRound: false,
    } as unknown as GroundEffect;

    summon(usersState, expireEffect, [], mkBattle());

    expect(usersState.find((u) => u.userId === "s2")).toBeUndefined(); // its own summon
    expect(usersState.find((u) => u.userId === "s1")).toBeDefined(); // other one kept
  });

  it("records summonedUserId on the effect at spawn", () => {
    const usersState = [mkPlayer(), mkTemplate()];
    const effect = mkSummonEffect();

    const res = summon(usersState, effect, [], mkBattle());
    expect(res?.color).toBe("blue");

    const spawned = usersState.find(
      (u) => u.isSummon && u.controllerId === PLAYER_ID,
    );
    expect(effect.summonedUserId).toBe(spawned?.userId);
  });
});

describe("summon piloting flag wiring (effect.playerControlled -> isPiloted)", () => {
  const findSpawn = (usersState: BattleUserState[], controllerId: string) =>
    usersState.find((u) => u.isSummon && u.controllerId === controllerId);

  it("pilots the spawned summon when a human casts a playerControlled jutsu in an interactive battle", () => {
    const usersState = [mkPlayer(), mkTemplate()];
    const effect = {
      ...mkSummonEffect(),
      playerControlled: true,
    } as unknown as GroundEffect;

    const res = summon(usersState, effect, [], mkBattle());
    expect(res?.color).toBe("blue");
    expect(findSpawn(usersState, PLAYER_ID)?.isPiloted).toBe(true);
  });

  it("leaves the spawned summon AI-driven when the jutsu is not playerControlled", () => {
    const usersState = [mkPlayer(), mkTemplate()];
    const effect = {
      ...mkSummonEffect(),
      playerControlled: false,
    } as unknown as GroundEffect;

    const res = summon(usersState, effect, [], mkBattle());
    expect(res?.color).toBe("blue");
    expect(findSpawn(usersState, PLAYER_ID)?.isPiloted).toBe(false);
  });

  it("never pilots an AI-cast summon even when the jutsu is playerControlled", () => {
    // A player-shaped combatant flipped to AI, used as the summon's caster.
    const aiCaster = {
      ...mkPlayer(),
      userId: "ai-caster",
      controllerId: "ai-caster",
      isAi: true,
    } as unknown as BattleUserState;
    const usersState = [aiCaster, mkTemplate()];
    const effect = {
      ...mkSummonEffect(),
      creatorId: "ai-caster",
      playerControlled: true,
    } as unknown as GroundEffect;

    const res = summon(usersState, effect, [], mkBattle());
    expect(res?.color).toBe("blue");
    expect(findSpawn(usersState, "ai-caster")?.isPiloted).toBe(false);
  });
});

describe("clone() never produces a piloted clone", () => {
  it("clears isPiloted when cloning a piloted summon (clones are AI-driven)", () => {
    // A live, human-piloted summon (isAi stays true for accounting, isPiloted true
    // for turn routing). structuredClone would carry isPiloted onto the clone,
    // stranding it (isAi && isPiloted && controllerId !== the human) — clone() must
    // clear it so the clone is plain AI-driven.
    const pilotedSummon = {
      ...mkTemplate(),
      userId: "summon1",
      controllerId: PLAYER_ID,
      isSummonTemplate: false,
      isPiloted: true,
      curHealth: 500,
      jutsus: [],
    } as unknown as BattleUserState;
    const usersState = [mkPlayer(), pilotedSummon];
    const cloneEffect = {
      type: "clone",
      creatorId: "summon1",
      isNew: true,
      rounds: 3,
      longitude: 6,
      latitude: 6,
      power: 100,
      level: 1,
      powerPerLevel: 0,
    } as unknown as GroundEffect;

    const res = clone(usersState, cloneEffect);
    expect(res?.color).toBe("blue");

    const cloned = usersState.find(
      (u) => u.isSummon && u.userId !== "summon1" && u.controllerId === "summon1",
    );
    expect(cloned).toBeDefined();
    expect(cloned?.isPiloted).toBeUndefined();
  });
});
