import { describe, expect, it } from "bun:test";
import type { Battle } from "@/drizzle/schema";
import { dmgConfig } from "@/libs/combat/constants";
import { clone, damageBarrier, damageCalc, summon } from "@/libs/combat/tags";
import type { BattleUserState, GroundEffect, UserEffect } from "@/libs/combat/types";
import { makeBattleUser, makeDamageEffect } from "./helpers/battleScenario";

// Level 100 with the experience of 8 x 450k per-type stats and 4 x 200k generals,
// merged into one 450k offence and defence.
const makeVeteran = (overrides: Partial<BattleUserState> = {}) =>
  makeBattleUser("veteran", {
    isAi: false,
    level: 100,
    experience: 8 * 450_000 + 4 * 200_000 - 120,
    offence: 450_000,
    defence: 450_000,
    strength: 200_000,
    intelligence: 200_000,
    willpower: 200_000,
    speed: 200_000,
    ...overrides,
  });

// Row _m-X2hsSTRRqwmUZXI2mj in data/ai.sql.
const makeClownOfChaos = (overrides: Partial<BattleUserState> = {}) =>
  makeBattleUser("clown", {
    isAi: true,
    level: 100,
    experience: 3_339_000,
    poolsMultiplier: 3,
    statsMultiplier: 3,
    offence: 834_780,
    defence: 834_780,
    strength: 834_780,
    intelligence: 834_780,
    willpower: 834_780,
    speed: 834_780,
    ...overrides,
  });

const makeCloneEffect = (creatorId: string) =>
  ({
    id: "clone-effect",
    type: "clone",
    creatorId,
    isNew: true,
    castThisRound: true,
    rounds: 3,
    longitude: 2,
    latitude: 2,
    power: 100,
    level: 1,
    powerPerLevel: 0,
    calculation: "percentage",
  }) as unknown as GroundEffect;

const spawnClone = (caster: BattleUserState) => {
  const usersState = [caster];
  clone(usersState, makeCloneEffect(caster.userId), { jutsus: {} });
  const spawned = usersState.find((u) => u.username === `${caster.username} clone`);
  if (!spawned) throw new Error("clone was not spawned");
  return spawned;
};

describe("clone stat scaling", () => {
  it("never makes a migrated veteran's 100% clone stronger than its caster", () => {
    const caster = makeVeteran();
    const spawned = spawnClone(caster);
    expect(spawned.offence).toBeLessThanOrEqual(caster.offence);
    expect(spawned.defence).toBeLessThanOrEqual(caster.defence);
    expect(spawned.strength).toBeLessThanOrEqual(caster.strength);
  });

  it("scales an auto-battle player's clone like any other player's", () => {
    const player = spawnClone(makeVeteran());
    const autoBattle = spawnClone(makeVeteran({ isAi: true, isOriginal: false }));
    expect(autoBattle.offence).toBe(player.offence);
  });

  it("keeps a seeded AI caster's clone at its stored stats", () => {
    const spawned = spawnClone(makeClownOfChaos());
    expect(spawned.offence).toBe(834_780);
    expect(spawned.speed).toBe(834_780);
  });
});

describe("summon stat scaling", () => {
  it("keeps a seeded AI template at its stored stats for a same-level summoner", () => {
    const template = makeClownOfChaos({
      userId: "template-instance",
      controllerId: "clown-db-id",
      isSummon: true,
      isSummonTemplate: true,
      effects: [],
    });
    const summoner = makeVeteran();
    const usersState = [summoner, template];
    const effect = {
      id: "summon-effect",
      type: "summon",
      aiId: "clown-db-id",
      aiHp: 500,
      creatorId: summoner.userId,
      isNew: true,
      castThisRound: true,
      rounds: 3,
      longitude: 2,
      latitude: 2,
      power: 100,
      level: 1,
      powerPerLevel: 0,
      calculation: "percentage",
    } as unknown as GroundEffect;
    const battle = {
      battleType: "COMBAT",
      round: 1,
      extraState: { bloodlines: {} },
    } as unknown as Battle;

    summon(usersState, effect, [], battle);

    const spawned = usersState.find(
      (u) => u.isSummon && !u.isSummonTemplate && u.controllerId === summoner.userId,
    );
    expect(spawned?.offence).toBe(834_780);
    expect(spawned?.defence).toBe(834_780);
  });
});

describe("barrier stand-in scaling", () => {
  it("does not let a migrated veteran's barrier outdefend the veteran", () => {
    const veteran = makeVeteran();
    const barrier = {
      id: "barrier",
      type: "barrier",
      curHealth: 1_000_000_000,
      power: 100,
      level: 0,
      powerPerLevel: 0,
      calculation: "static",
    } as unknown as GroundEffect;
    const effect = makeDamageEffect({
      creatorId: veteran.userId,
      targetId: barrier.id,
      castThisRound: true,
      rounds: 0,
      barrierAbsorb: 1,
    }) as UserEffect;

    const result = damageBarrier([barrier], veteran, effect, dmgConfig);

    const againstSelf = damageCalc(effect, veteran, veteran, dmgConfig);
    expect(1_000_000_000 - (result?.barrier.curHealth ?? 0)).toBeGreaterThanOrEqual(
      againstSelf,
    );
  });
});
