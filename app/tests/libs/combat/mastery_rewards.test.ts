import { describe, expect, it } from "bun:test";
import { combatMasteryGains, recordMasteryUsage } from "@/libs/combat/mastery";
import { getEfficiencyRatio } from "@/libs/combat/tags";
import { getTagSchema } from "@/validators/combat";
import type { CombatAction, UserEffect } from "@/libs/combat/types";
import { makeUser, makeEffect, makeDamageEffect } from "./helpers/battleScenario";

const user = () => makeUser({ rank: "JONIN", masteryRanks: { ninjutsuMastery: "MASTER", taijutsuMastery: "MASTER", sageMastery: "NOVICE" }, ninjutsuMastery: 100, taijutsuMastery: 100, usedMasteries: { ninjutsuMastery: 1, taijutsuMastery: 1 } });
const opponent = makeUser({ userId: "enemy", isAi: false });

describe("combat mastery rewards", () => {
  it("splits the fixed PvP win/loss budget by used disciplines without XP", () => {
    expect(combatMasteryGains({ battleType: "COMBAT", rewardScaling: 1 }, user(), [opponent], "Won", 9999)).toMatchObject({ ninjutsuMastery: 100, taijutsuMastery: 100 });
    expect(combatMasteryGains({ battleType: "COMBAT", rewardScaling: 1 }, user(), [opponent], "Lost", 9999)).toMatchObject({ ninjutsuMastery: 50, taijutsuMastery: 50 });
    expect(user().experience).toBe(0);
  });
  it("uses the existing PvE growth budget instead of the fixed PvP budget", () => {
    expect(combatMasteryGains({ battleType: "ARENA", rewardScaling: 1 }, user(), [makeUser({ isAi: true })], "Won", 20)).toMatchObject({ ninjutsuMastery: 10, taijutsuMastery: 10 });
  });
  it.each(["RANKED_PVP", "RANKED_SPARRING", "SPARRING", "TRAINING"] as const)("gives no growth in %s", (battleType) => {
    expect(combatMasteryGains({ battleType, rewardScaling: 1 }, user(), [opponent], "Won", 20)).toEqual({});
  });
  it("does not award unused disciplines, AI, summons or fleeing", () => {
    const empty = user(); empty.usedMasteries = {};
    expect(combatMasteryGains({ battleType: "COMBAT", rewardScaling: 1 }, empty, [opponent], "Won", 20)).toEqual({});
    for (const u of [makeUser({ isAi: true }), makeUser({ isSummon: true })]) expect(combatMasteryGains({ battleType: "COMBAT", rewardScaling: 1 }, u, [opponent], "Won", 20)).toEqual({});
    expect(combatMasteryGains({ battleType: "COMBAT", rewardScaling: 1 }, user(), [opponent], "Fled", 20)).toEqual({});
  });
  it("uses unbuffed mastery bases for cap room and never lowers over-cap bases", () => {
    const u = user(); u.ninjutsuMastery = 1800000;
    u.baseStatsForModifiers = { ninjutsuMastery: 1499995, taijutsuMastery: 1600000, genjutsuMastery: 0, bukijutsuMastery: 0, bloodlineMastery: 0, sageMastery: 0 };
    expect(combatMasteryGains({ battleType: "COMBAT", rewardScaling: 1 }, u, [opponent], "Won", 20)).toMatchObject({ ninjutsuMastery: 5, taijutsuMastery: 0 });
  });
  it("records classification, required disciplines and bloodline once per action", () => {
    const u=user(); u.usedMasteries = {};
    recordMasteryUsage(u, { data: { statClassification: "Ninjutsu", requiredNinjutsuMastery: 100, requiredTaijutsuMastery: 50, bloodlineId: "bloodline" } } as CombatAction);
    expect(u.usedMasteries).toEqual({ ninjutsuMastery: 1, taijutsuMastery: 1, bloodlineMastery: 1 });
  });
  it("credits Sage usage without counting temporary mastery buffs as growth", () => {
    const u=user(); u.usedMasteries = {}; u.sageModeUsedThisBattle = true;
    expect(combatMasteryGains({ battleType: "ARENA", rewardScaling: 1 }, u, [makeUser({ isAi: true })], "Won", 20)).toMatchObject({ sageMastery: 20 });
  });
});

describe("damage modifier selectors", () => {
  it.each(["increasedamagegiven", "decreasedamagegiven", "increasedamagetaken", "decreasedamagetaken"] as const)("%s preserves elements and ignores stat and general selectors", (type) => {
    const old = { ...makeEffect(type), statTypes: ["Taijutsu"], generalTypes: ["Speed"], elements: ["Wind"] } as UserEffect;
    const schema = getTagSchema(type);
    expect(schema.parse(old)).not.toHaveProperty("statTypes");
    expect(schema.parse(old)).not.toHaveProperty("generalTypes");
    expect(schema.parse(old)).toHaveProperty("elements", ["Wind"]);
    expect(getEfficiencyRatio(makeDamageEffect({ statTypes: ["Ninjutsu"], elements: ["Fire"] }), old)).toBe(0);
    expect(getEfficiencyRatio(makeDamageEffect({ statTypes: ["Ninjutsu"], elements: ["Wind"] }), old)).toBe(1);
    expect(getEfficiencyRatio(makeDamageEffect({ elements: ["Fire"] }), makeEffect(type))).toBe(1);
  });
});
