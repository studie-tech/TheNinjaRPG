import { describe, expect, it } from "bun:test";
import type { SkillTree } from "@/drizzle/schema";
import type { CombatQueryUser } from "@/libs/combat/types";
import { IncreaseDamageGivenTag, PoisonTag } from "@/validators/combat";
import { flatCombatStats, makeJutsu } from "../../setup/combat";
import { makeCombatQueryUser, preloadBattle } from "./helpers/preload";

const skill = (
  id: string,
  target: SkillTree["target"],
  pathType: SkillTree["pathType"] = "SKILL",
) =>
  ({
    id,
    target,
    pathType,
    effects: [
      target === "ENEMIES" ? PoisonTag.parse({}) : IncreaseDamageGivenTag.parse({}),
    ],
  }) as SkillTree;

const user = (id: string): CombatQueryUser =>
  makeCombatQueryUser(id, {
    ...flatCombatStats(100),
    villageId: "village",
    level: 50,
    longitude: 0,
    latitude: 0,
    curHealth: 1000,
    maxHealth: 1000,
    curChakra: 1000,
    maxChakra: 1000,
    curStamina: 1000,
    maxStamina: 1000,
  });

const preload = (
  users: CombatQueryUser[],
  battleType: "COMBAT" | "RANKED_PVP" = "COMBAT",
) => preloadBattle(users, { battleType, leftSideUserIds: ["caster", "ally"] });

describe("skill targeting at battle initiation", () => {
  it("preloads enemy skill and purchased bloodright without applying them at initiation", async () => {
    const caster = user("caster");
    const enemySkill = skill("enemy-skill", "ENEMIES");
    const bloodright = skill("bloodright", "ENEMIES", "BLOODRIGHT");
    caster.userSkills = [
      {
        id: "owned",
        userId: caster.userId,
        skillId: enemySkill.id,
        activated: true,
        purchasedAt: new Date(),
        skill: enemySkill,
      },
    ];
    caster.bloodline = {
      id: "line",
      effects: [],
      bloodrightTiers: [bloodright],
    } as unknown as CombatQueryUser["bloodline"];
    caster.bloodright = [{ skillId: bloodright.id, cost: 10 }];
    const result = await preload([caster, user("enemy")]);
    expect(result.usersState[0]!.enemySkillIds).toEqual([enemySkill.id, bloodright.id]);
    expect(result.extraState.enemySkills).toEqual({
      [enemySkill.id]: enemySkill.effects,
      [bloodright.id]: bloodright.effects,
    });
    expect(result.userEffects.filter((e) => e.fromType === "skill")).toHaveLength(0);
  });

  it("keeps self passives on their owner and ally passives on the owner's team", async () => {
    const caster = user("caster");
    caster.userSkills = [skill("self", "SELF"), skill("allies", "ALLIES")].map(
      (entry) => ({
        id: entry.id,
        userId: caster.userId,
        skillId: entry.id,
        activated: true,
        purchasedAt: new Date(),
        skill: entry,
      }),
    );
    const result = await preload([caster, user("ally"), user("enemy")]);
    expect(
      result.userEffects.filter((e) => e.actionId === "self").map((e) => e.targetId),
    ).toEqual(["caster"]);
    expect(
      result.userEffects.filter((e) => e.actionId === "allies").map((e) => e.targetId),
    ).toEqual(["caster", "ally"]);
  });

  it("does not preload enemy skills in ranked battles or retain stale source IDs", async () => {
    const caster = user("caster");
    caster.userSkills = [
      {
        id: "owned",
        userId: caster.userId,
        skillId: "enemy-skill",
        activated: true,
        purchasedAt: new Date(),
        skill: skill("enemy-skill", "ENEMIES"),
      },
    ];
    Object.assign(caster, { enemySkillIds: ["stale"] });
    const result = await preload([caster, user("enemy")], "RANKED_PVP");
    expect(result.usersState[0]!.enemySkillIds).toEqual([]);
    expect(result.extraState.enemySkills).toEqual({});
    expect(result.userEffects.filter((e) => e.fromType === "skill")).toHaveLength(0);
  });
});

describe("skill-gated content at battle initiation", () => {
  it.each(["COMBAT", "RANKED_PVP"] as const)(
    "filters stale equipped content in %s and restores it after activation",
    async (battleType) => {
      const caster = user("caster");
      Object.assign(caster, { rank: "JONIN", bloodlineId: null, isAi: false });
      caster.userSkills = [
        {
          id: "owned",
          userId: caster.userId,
          skillId: "required",
          activated: true,
          purchasedAt: new Date(),
          skill: { ...skill("required", "SELF"), effects: [] },
        },
      ];
      caster.jutsus = [
        {
          id: "owned-jutsu",
          jutsuId: "gated",
          equipped: true,
          level: 1,
          experience: 0,
          jutsu: makeJutsu({ id: "gated", requiredSkillId: "required" }),
        },
      ] as unknown as CombatQueryUser["jutsus"];
      caster.items = [
        {
          id: "owned-item",
          itemId: "gear",
          equipped: "HAND_1",
          level: 1,
          quantity: 1,
          durability: 100,
          imbuements: [],
          item: {
            id: "gear",
            itemType: "WEAPON",
            effects: [],
            battleUsageType: "BOTH",
            cooldown: 0,
            requiredSkillId: "required",
          },
        },
      ] as unknown as CombatQueryUser["items"];
      const active = await preload([caster], battleType);
      expect(active.usersState[0]!.activeSkillIds).toEqual(["required"]);
      expect(active.usersState[0]!.jutsus.map((j) => j.jutsuId)).toContain("gated");
      expect(active.usersState[0]!.items.map((i) => i.itemId)).toContain("gear");
      caster.userSkills[0]!.activated = false;
      const inactive = await preload([caster], battleType);
      expect(inactive.usersState[0]!.jutsus).toEqual([]);
      expect(inactive.usersState[0]!.items).toEqual([]);
    },
  );
});
