import { describe, expect, it } from "bun:test";
import type { AiProfile, SkillTree } from "@/drizzle/schema";
import type { CombatQueryUser } from "@/libs/combat/types";
import { processUsersForBattle } from "@/server/api/routers/combat";
import type { DrizzleClient } from "@/server/db";
import { PoisonTag, IncreaseDamageGivenTag } from "@/validators/combat";

const skill = (id: string, target: SkillTree["target"], pathType: SkillTree["pathType"] = "SKILL") =>
  ({ id, target, pathType, effects: [target === "ENEMIES" ? PoisonTag.parse({}) : IncreaseDamageGivenTag.parse({})] }) as SkillTree;

const user = (id: string): CombatQueryUser => ({
  userId: id, username: id, villageId: "village", level: 50, experience: 0,
  regenAt: new Date(), regeneration: 0, money: 0, longitude: 0, latitude: 0,
  curHealth: 1000, maxHealth: 1000, curChakra: 1000, maxChakra: 1000,
  curStamina: 1000, maxStamina: 1000, strength: 100, speed: 100, intelligence: 100, willpower: 100,
  offence: 100, defence: 100,
  ninjutsuMastery: 100, genjutsuMastery: 100, taijutsuMastery: 100,
  bukijutsuMastery: 100, bloodlineMastery: 100, sageMastery: 100,
  items: [], jutsus: [], effects: [], bloodright: [], userSkills: [],
}) as unknown as CombatQueryUser;

const preload = (users: CombatQueryUser[], battleType: "COMBAT" | "RANKED_PVP" = "COMBAT") =>
  processUsersForBattle({} as DrizzleClient, {
    users, battleType, leftSideUserIds: ["caster", "ally"], hide: false, isSummon: false,
    width: 10, height: 10, settings: [], relations: [], wars: [], villages: [],
    defaultProfile: { id: "default" } as AiProfile,
  });

describe("skill targeting at battle initiation", () => {
  it("preloads enemy skill and purchased bloodright without applying them at initiation", async () => {
    const caster = user("caster");
    const enemySkill = skill("enemy-skill", "ENEMIES");
    const bloodright = skill("bloodright", "ENEMIES", "BLOODRIGHT");
    caster.userSkills = [{ id: "owned", userId: caster.userId, skillId: enemySkill.id, activated: true, purchasedAt: new Date(), skill: enemySkill }];
    caster.bloodline = { id: "line", effects: [], bloodrightTiers: [bloodright] } as unknown as CombatQueryUser["bloodline"];
    caster.bloodright = [{ skillId: bloodright.id, cost: 10 }];
    const result = await preload([caster, user("enemy")]);
    expect(result.usersState[0]!.enemySkillIds).toEqual([enemySkill.id, bloodright.id]);
    expect(result.extraState.enemySkills).toEqual({ [enemySkill.id]: enemySkill.effects, [bloodright.id]: bloodright.effects });
    expect(result.userEffects.filter((e) => e.fromType === "skill")).toHaveLength(0);
  });

  it("keeps self passives on their owner and ally passives on the owner's team", async () => {
    const caster = user("caster");
    caster.userSkills = [skill("self", "SELF"), skill("allies", "ALLIES")].map((entry) => ({ id: entry.id, userId: caster.userId, skillId: entry.id, activated: true, purchasedAt: new Date(), skill: entry }));
    const result = await preload([caster, user("ally"), user("enemy")]);
    expect(result.userEffects.filter((e) => e.actionId === "self").map((e) => e.targetId)).toEqual(["caster"]);
    expect(result.userEffects.filter((e) => e.actionId === "allies").map((e) => e.targetId)).toEqual(["caster", "ally"]);
  });

  it("does not preload enemy skills in ranked battles or retain stale source IDs", async () => {
    const caster = user("caster");
    caster.userSkills = [{ id: "owned", userId: caster.userId, skillId: "enemy-skill", activated: true, purchasedAt: new Date(), skill: skill("enemy-skill", "ENEMIES") }];
    Object.assign(caster, { enemySkillIds: ["stale"] });
    const result = await preload([caster, user("enemy")], "RANKED_PVP");
    expect(result.usersState[0]!.enemySkillIds).toEqual([]);
    expect(result.extraState.enemySkills).toEqual({});
    expect(result.userEffects.filter((e) => e.fromType === "skill")).toHaveLength(0);
  });
});
