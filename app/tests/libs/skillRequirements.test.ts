import { describe, expect, it } from "bun:test";
import type { Jutsu, UserItemWithRelations } from "@/drizzle/schema";
import { computeAutoEquipAssignments, computeLoadoutAssignments } from "@/libs/item";
import { canTrainJutsu, jutsuRequirementWarning } from "@/libs/jutsuRequirements";
import { effectiveMasteries } from "@/libs/mastery";
import { getRepairKits } from "@/libs/repair";
import { hasRequiredSkill } from "@/libs/skillRequirements";
import type { UserWithRelations } from "@/routers/profile";

const user = {
  level: 50,
  rank: "JONIN" as const,
  bloodlineId: null,
  villageId: null,
  bloodline: null,
  items: [],
  userQuests: [],
  completedQuests: [],
  ninjutsuMastery: 100,
  genjutsuMastery: 100,
  taijutsuMastery: 100,
  bukijutsuMastery: 100,
  bloodlineMastery: 100,
  sageMastery: 100,
  userSkills: [
    {
      skillId: "required",
      activated: false,
      skill: { target: "SELF" as const, effects: [] },
    },
  ],
};
const activeUser = {
  ...user,
  userSkills: user.userSkills.map((skill) => ({ ...skill, activated: true })),
};
const gear = {
  id: "owned",
  itemId: "gear",
  equipped: "NONE",
  quantity: 3,
  level: 1,
  durability: 100,
  storedAtHome: false,
  isInAuction: false,
  craftingFinishedAt: null,
  imbuements: [],
  item: {
    id: "gear",
    name: "Skill gear",
    requiredSkillId: "required",
    requiredLevel: 1,
    slot: "HEAD",
    itemType: "ARMOR",
    maxEquips: 1,
    bloodlineId: null,
    cost: 100,
    maxDurability: 100,
    hidden: false,
    canBeImbued: false,
    effects: [],
  },
} as unknown as UserItemWithRelations;
const jutsu = {
  id: "jutsu",
  jutsuRank: "D",
  jutsuType: "NORMAL",
  jutsuWeapon: "NONE",
  requiredRank: "STUDENT",
  requiredLevel: 1,
  bloodlineId: null,
  villageId: null,
  requiredSkillId: "required",
  parentJutsuId: null,
  effects: [],
} as unknown as Jutsu;

describe("activated skill use requirements", () => {
  it("requires the matching activated skill and fails closed without skills", () => {
    expect(hasRequiredSkill({}, {})).toBe(true);
    expect(hasRequiredSkill(gear.item, {})).toBe(false);
    expect(hasRequiredSkill(gear.item, user)).toBe(false);
    expect(
      hasRequiredSkill(gear.item, {
        userSkills: [{ skillId: "other", activated: true }],
      }),
    ).toBe(false);
    expect(hasRequiredSkill(gear.item, activeUser)).toBe(true);
    expect(hasRequiredSkill(gear.item, { activeSkillIds: ["required"] })).toBe(true);
  });

  it("allows training but warns about use until activation", () => {
    const trainee = user as unknown as NonNullable<UserWithRelations>;
    expect(canTrainJutsu(jutsu, trainee)).toBe(true);
    expect(jutsuRequirementWarning(jutsu, trainee)).toContain(
      "Activate the required skill",
    );
    expect(
      jutsuRequirementWarning(
        jutsu,
        activeUser as unknown as NonNullable<UserWithRelations>,
      ),
    ).toBe("");
  });

  it("allows evolution acquisition without activation while retaining other requirements", () => {
    const trainee = user as unknown as NonNullable<UserWithRelations>;
    expect(jutsuRequirementWarning(jutsu, trainee, undefined, undefined, true)).toBe(
      "",
    );
    for (const [requirements, warning] of [
      [{ requiredRank: "ELDER" }, "rank"],
      [{ requiredLevel: 51 }, "level"],
      [{ villageId: "other" }, "village"],
      [{ bloodlineId: "other" }, "bloodline"],
      [{ requiredNinjutsuMastery: 101 }, "mastery"],
      [{ elementClassification: "Fire" }, "elements"],
      [{ requiredBloodlineItemId: "other" }, "bloodline item"],
    ] as const) {
      expect(
        jutsuRequirementWarning(
          { ...jutsu, ...requirements },
          trainee,
          undefined,
          undefined,
          true,
        ),
      ).toContain(warning);
    }
    expect(
      jutsuRequirementWarning(
        { ...jutsu, jutsuRank: "C" },
        { ...trainee, rank: "STUDENT" },
        undefined,
        undefined,
        true,
      ),
    ).toContain("rank");
  });

  it("filters locked gear from both loadouts and optimal auto-equipping", () => {
    const loadout = [{ itemId: "gear", slot: "HEAD" as const }];
    expect(computeLoadoutAssignments(loadout, [gear], user).assignments).toEqual([]);
    expect(
      computeLoadoutAssignments(loadout, [gear], activeUser).assignments,
    ).toHaveLength(1);
    expect(computeAutoEquipAssignments([gear], user).assignments).toEqual([]);
    expect(computeAutoEquipAssignments([gear], activeUser).assignments).toHaveLength(1);
  });

  it("removes passive mastery buffs after deactivation", () => {
    const worn = {
      ...gear,
      equipped: "HEAD" as const,
      item: {
        ...gear.item,
        effects: [
          {
            type: "increasemastery" as const,
            masteryTypes: ["Ninjutsu" as const],
            power: 200,
            powerPerLevel: 0,
            calculation: "static" as const,
          },
        ],
      },
    } as UserItemWithRelations;
    expect(effectiveMasteries({ ...user, items: [worn] }).ninjutsuMastery).toBe(100);
    expect(effectiveMasteries({ ...activeUser, items: [worn] }).ninjutsuMastery).toBe(
      300,
    );
  });

  it("excludes locked repair kits from bulk consumption planning", () => {
    const kit = {
      ...gear,
      item: { ...gear.item, effects: [{ type: "repair", power: 50 }] },
    } as UserItemWithRelations;
    expect(getRepairKits([kit], user)).toEqual([]);
    expect(getRepairKits([kit], activeUser)).toHaveLength(1);
  });
});
