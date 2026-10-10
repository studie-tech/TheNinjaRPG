import { describe, expect, it } from "bun:test";
import { ELEMENTAL_MASTERY_CAP } from "@/drizzle/constants";
import type { AiProfile } from "@/drizzle/schema";
import { computeDamagePacket, emptyPreBattleGearModifiers } from "@/libs/combat/process";
import type { CombatQueryUser, UserEffect } from "@/libs/combat/types";
import { activeTrainedElement, elementalGainRoom } from "@/libs/elementalMastery";
import { processUsersForBattle } from "@/server/api/routers/combat";
import type { DrizzleClient } from "@/server/db";
import { DamageTag } from "@/validators/combat";
import { getUserElements } from "@/validators/user";

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

const packet = (effects: UserEffect[], element: "Wind" | "Fire" | "None") => computeDamagePacket({
  rawDamage: 1000,
  damageEffect: { ...DamageTag.parse({ elements: [element] }), id: "damage", creatorId: "caster", targetId: "target", level: 50, isNew: false, castThisRound: false, createdRound: 1, longitude: 0, latitude: 0, barrierAbsorb: 0 } as UserEffect,
  usersEffects: effects, attackerId: "caster", defenderId: "target", battleRound: 1,
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

  it("does not expose progress until capped, and exposes at most one trained element", () => {
    const caster = user();
    expect(getUserElements(caster as never)).toEqual(["Fire", "Water", "Wind", "None"]);
    expect(getUserElements(user({ elementalMastery: { Wind: ELEMENTAL_MASTERY_CAP - 1 } }) as never)).toEqual(["Fire", "Water", "None"]);
    expect(elementalGainRoom(caster, "Earth")).toBe(0);
    expect(elementalGainRoom(caster, "Lightning")).toBe(ELEMENTAL_MASTERY_CAP);
    expect(activeTrainedElement(caster)).toBe("Wind");
  });
});
