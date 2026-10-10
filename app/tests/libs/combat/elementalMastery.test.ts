import { describe, expect, it } from "bun:test";
import { ELEMENTAL_MASTERY_BOOST, ELEMENTAL_MASTERY_CAP } from "@/drizzle/constants";
import type { AiProfile } from "@/drizzle/schema";
import { applyEffects, computeDamagePacket, emptyPreBattleGearModifiers } from "@/libs/combat/process";
import { clear, copy } from "@/libs/combat/tags";
import type { CombatQueryUser, UserEffect } from "@/libs/combat/types";
import { isEffectActive } from "@/libs/combat/util";
import { activeTrainedElement, elementalGainRoom } from "@/libs/elementalMastery";
import { processUsersForBattle } from "@/server/api/routers/combat";
import type { DrizzleClient } from "@/server/db";
import { DamageTag } from "@/validators/combat";
import { getUserElements } from "@/validators/user";
import { makeCompleteBattle, makeEffect } from "./helpers/battleScenario";

const user = (patch: Partial<CombatQueryUser> = {}): CombatQueryUser => ({
  userId: "caster", username: "caster", villageId: "village", level: 50, experience: 0,
  regenAt: new Date(), regeneration: 0, money: 0, longitude: 0, latitude: 0,
  curHealth: 1000, maxHealth: 1000, curChakra: 1000, maxChakra: 1000,
  curStamina: 1000, maxStamina: 1000, strength: 100, speed: 100, intelligence: 100, willpower: 100,
  offence: 100, defence: 100, ninjutsuMastery: 100, genjutsuMastery: 100, taijutsuMastery: 100,
  bukijutsuMastery: 100, bloodlineMastery: 100, sageMastery: 100,
  items: [], jutsus: [], effects: [], bloodright: [], userSkills: [], primaryElement: "Fire", secondaryElement: "Water",
  elementalMastery: { Wind: ELEMENTAL_MASTERY_CAP, Earth: ELEMENTAL_MASTERY_CAP }, activeTrainedElement: "Wind", ...patch,
}) as unknown as CombatQueryUser;

const preload = (caster: CombatQueryUser, battleType: "COMBAT" | "RANKED_PVP" = "COMBAT") => processUsersForBattle({} as DrizzleClient, {
  users: [caster], battleType, leftSideUserIds: ["caster"], hide: false, isSummon: false,
  width: 10, height: 10, settings: [], relations: [], wars: [], villages: [], defaultProfile: { id: "default" } as AiProfile,
});

const packet = (effects: UserEffect[], element: "Wind" | "Fire" | "None", battleRound = 1) => computeDamagePacket({
  rawDamage: 1000,
  damageEffect: { ...DamageTag.parse({ elements: [element] }), id: "damage", creatorId: "caster", targetId: "target", level: 50, isNew: false, castThisRound: false, createdRound: 1, longitude: 0, latitude: 0, barrierAbsorb: 0 } as UserEffect,
  usersEffects: effects, attackerId: "caster", defenderId: "target", battleRound,
  preBattleGearModifiers: { caster: emptyPreBattleGearModifiers(), target: emptyPreBattleGearModifiers() },
}).damage;

describe("elemental mastery battle integration", () => {
  it("preloads a passive that increases only matching damage by exactly 15%", async () => {
    const result = await preload(user());
    const effects = result.userEffects.filter(effect => effect.fromType === "elementalMastery");
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({ elements: ["Wind"], power: 15, targetId: "caster" });
    expect(packet(effects, "Wind")).toBeCloseTo(packet([], "Wind") * 1.15);
    expect(packet(effects, "Fire")).toBeCloseTo(packet([], "Fire"));
    expect(packet(effects, "None")).toBeCloseTo(packet([], "None"));
  });

  it("does not boost inactive or incomplete elements and preserves ranked equalization", async () => {
    for (const caster of [user({ activeTrainedElement: null }), user({ elementalMastery: { Wind: ELEMENTAL_MASTERY_CAP - 1 } }), user({ primaryElement: "Wind" })]) {
      expect((await preload(caster)).userEffects.filter(effect => effect.fromType === "elementalMastery")).toHaveLength(0);
    }
    expect((await preload(user(), "RANKED_PVP")).userEffects.filter(effect => effect.fromType === "elementalMastery")).toHaveLength(0);
  });

  it("clear preserves the preloaded elemental passive while removing a temporary buff", async () => {
    const result = await preload(user());
    const passive = result.userEffects.find(effect => effect.fromType === "elementalMastery");
    expect(passive).toBeDefined();
    const temporaryBuff = makeEffect("increasedamagegiven", { power: 25, rounds: 10 }, {
      creatorId: "caster", targetId: "caster", fromType: "jutsu",
    });
    const effects = [...result.userEffects, temporaryBuff];
    const passiveDamage = packet(result.userEffects, "Wind");
    expect(packet(effects, "Wind")).toBeGreaterThan(passiveDamage);

    clear(makeEffect("clear", { power: 100 }, { targetId: "caster" }), effects, result.usersState[0]!);

    expect(temporaryBuff.rounds).toBe(0);
    expect(isEffectActive(passive!)).toBe(true);
    expect(passive!.rounds).toBeUndefined();
    expect(packet(effects, "Wind")).toBeCloseTo(passiveDamage);
    expect(packet(effects, "Wind")).toBeCloseTo(packet([], "Wind") * (1 + ELEMENTAL_MASTERY_BOOST / 100));
    expect(packet(effects, "Fire")).toBeCloseTo(packet([], "Fire"));
    expect(packet(effects, "None")).toBeCloseTo(packet([], "None"));
  });

  it("copy transfers temporary jutsu buffs without granting the target's elemental mastery", async () => {
    const target = await preload(user({ userId: "target" }));
    const caster = await preload(user({ primaryElement: "Wind", elementalMastery: {}, activeTrainedElement: null }));
    const temporaryBuff = makeEffect("shield", { power: 100, rounds: 5 }, {
      id: "temporary-shield", creatorId: "target", targetId: "target", targetType: "user", fromType: "jutsu", createdRound: 1,
    });
    const copyEffect = makeEffect("copy", { power: 100, rounds: 3 }, {
      creatorId: "caster", targetId: "target", fromType: "jutsu", createdRound: 1, isNew: true, castThisRound: true,
    });
    const battle = makeCompleteBattle({
      usersState: [...caster.usersState, ...target.usersState],
      usersEffects: [...caster.userEffects, ...target.userEffects, temporaryBuff],
      extraState: target.extraState,
    });

    copy(copyEffect, battle.usersEffects, caster.usersState[0]!, target.usersState[0]!);
    const { newBattle } = applyEffects(battle, "caster");
    const copied = newBattle.usersEffects.filter(effect => effect.targetId === "caster" && effect.fromEffectId);
    expect(copied.map(effect => effect.fromEffectId)).toEqual([temporaryBuff.id]);
    expect(newBattle.usersEffects.filter(effect => effect.fromType === "elementalMastery")).toHaveLength(1);
    expect(packet(newBattle.usersEffects, "Wind", 2)).toBeCloseTo(packet([], "Wind", 2));
  });

  it("does not expose progress until capped, and exposes at most one trained element", () => {
    const caster = user();
    expect(getUserElements(caster as never)).toEqual(["Fire", "Water", "Wind", "None"]);
    expect(getUserElements(user({ elementalMastery: { Wind: ELEMENTAL_MASTERY_CAP - 1 } }) as never)).toEqual(["Fire", "Water", "None"]);
    expect(elementalGainRoom(caster, "Earth")).toBe(0);
    expect(elementalGainRoom(caster, "Lightning")).toBe(ELEMENTAL_MASTERY_CAP);
    expect(activeTrainedElement(caster)).toBe("Wind");
  });
});
