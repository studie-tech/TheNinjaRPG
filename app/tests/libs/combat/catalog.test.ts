import { describe, expect, it } from "bun:test";
import type { Item, Jutsu, VillageStructure } from "@/drizzle/schema";
import { type BattleJutsu, compactBattleCatalogs } from "@/libs/combat/catalog";
import type { CombatQueryUser, ExtraState } from "@/libs/combat/types";
import { applyLinkedJutsuReskin } from "@/libs/jutsu/reskins";
import {
  battleJutsuGateFailure,
  checkJutsuBloodlineItem,
} from "@/libs/jutsuRequirements";
import { hasMasteryRequirements, MASTERY_REQUIREMENT_FIELDS } from "@/libs/mastery";
import { hasRequiredSkill } from "@/libs/skillRequirements";
import { getStrucBoost, type StructureAttribute } from "@/utils/village";

const jutsu = (overrides: Partial<Jutsu> = {}) =>
  ({
    id: "jutsu",
    name: "Jutsu",
    description: "Long authored text",
    battleDescription: "%user strikes",
    image: "jutsu.webp",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    effects: [],
    bloodlineId: null,
    villageId: null,
    parentJutsuId: null,
    reskinParentJutsuId: null,
    bloodlineReskinId: null,
    requiredRank: "STUDENT",
    requiredLevel: 1,
    requiredSkillId: null,
    requiredBloodlineItemId: null,
    requiredPetSpeciesId: null,
    requiredNinjutsuMastery: 0,
    requiredGenjutsuMastery: 0,
    requiredTaijutsuMastery: 0,
    requiredBukijutsuMastery: 0,
    requiredBloodlineMastery: 0,
    requiredSageMastery: 0,
    requiredStrength: 0,
    requiredSpeed: 0,
    requiredIntelligence: 0,
    requiredWillpower: 0,
    jutsuRank: "D",
    jutsuType: "NORMAL",
    jutsuWeapon: "NONE",
    hidden: false,
    injectableInBattle: false,
    battleUsageType: "BOTH",
    ...overrides,
  }) as Jutsu;

const item = (overrides: Partial<Item> = {}) =>
  ({
    id: "item",
    name: "Item",
    description: "Long authored text",
    image: "item.webp",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    effects: [],
    itemType: "WEAPON",
    weaponType: "SWORD",
    maxDurability: 50,
    canBeImbued: true,
    xpToLevel: 900,
    preventBattleUsage: false,
    battleUsageType: "BOTH",
    bloodlineId: null,
    requiredSkillId: null,
    requiredNinjutsuMastery: 0,
    cost: 100,
    farmYieldItemId: "seed",
    cookingTimeSeconds: 30,
    canBeTraded: true,
    ...overrides,
  }) as Item;

const compact = (state: Partial<ExtraState>) =>
  compactBattleCatalogs(state as ExtraState);
const compactJutsu = (row: Jutsu) =>
  compact({ jutsus: { [row.id]: row } }).jutsus[row.id]!;
const compactItem = (row: Item) => compact({ items: { [row.id]: row } }).items[row.id]!;

const BOOSTS: StructureAttribute[] = [
  "anbuSquadsPerLvl",
  "arenaRewardPerLvl",
  "bankInterestPerLvl",
  "blackDiscountPerLvl",
  "clansPerLvl",
  "hospitalSpeedupPerLvl",
  "itemDiscountPerLvl",
  "missionRewardPerLvl",
  "patrolsPerLvl",
  "ramenDiscountPerLvl",
  "regenIncreasePerLvl",
  "sleepRegenPerLvl",
  "structureDiscountPerLvl",
  "trainBoostPerLvl",
  "villageDefencePerLvl",
];
const structure = (boost?: StructureAttribute) =>
  ({
    id: "structure",
    name: "Structure",
    image: "structure.webp",
    route: "/structure",
    level: 3,
    temporaryLevelBonus: 2,
    temporaryLevelBonusExpiresAt: new Date(Date.now() + 60_000),
    raidBoostExpiresAt: new Date(Date.now() + 60_000),
    ...Object.fromEntries(BOOSTS.map((key) => [key, key === boost ? 4 : 0])),
  }) as VillageStructure;

describe("battle catalog compaction", () => {
  it("removes authored text, timestamps and unset requirements", () => {
    const row = compactJutsu(jutsu());
    for (const key of [
      "description",
      "createdAt",
      "updatedAt",
      "requiredSkillId",
      "requiredNinjutsuMastery",
      "villageId",
      "parentJutsuId",
    ])
      expect(key in row).toBe(false);
  });

  it("keeps every value that is set, other than the omitted columns", () => {
    const full = jutsu({
      villageId: "village",
      parentJutsuId: "parent",
      reskinParentJutsuId: "base",
      bloodlineReskinId: "reskin",
      requiredSkillId: "skill",
      requiredBloodlineItemId: "blood-item",
      requiredPetSpeciesId: "pet",
      requiredNinjutsuMastery: 40,
      requiredStrength: 70,
      hidden: true,
    });
    const { description, createdAt, updatedAt, ...kept } = full;
    expect(compactJutsu(full)).toMatchObject(
      Object.fromEntries(Object.entries(kept).filter(([, value]) => !!value)),
    );
  });

  it("keeps the fields gear processing and settlement read from items", () => {
    expect(compactItem(item())).toMatchObject({
      canBeImbued: true,
      xpToLevel: 900,
      maxDurability: 50,
      weaponType: "SWORD",
      preventBattleUsage: false,
    });
  });

  it("removes shop and profession columns from items", () => {
    const row = compactItem(item());
    for (const key of ["cost", "farmYieldItemId", "cookingTimeSeconds", "canBeTraded"])
      expect(key in row).toBe(false);
  });

  it("leaves keystones whole, since their popover displays the row", () => {
    const keystone = item({ id: "keystone" });
    const state = compact({ keystoneItems: { keystone } });
    expect(state.keystoneItems.keystone).toBe(keystone);
  });

  it("does not change the rows other battle setup still reads", () => {
    const full = jutsu();
    const snapshot = structuredClone(full);
    compactJutsu(full);
    expect(full).toEqual(snapshot);
  });

  it("is stable when a stored catalog passes through again", () => {
    const once = compactJutsu(jutsu({ requiredSkillId: "skill" }));
    expect(compactJutsu(once as Jutsu)).toEqual(once);
  });
});

describe("requirements on compact catalogs", () => {
  const gates = {
    masteries: { ninjutsuMastery: 10 },
    skills: { userSkills: [] },
    items: [{ itemId: "blood-item", equipped: "NONE" }] as never,
  };

  it.each(MASTERY_REQUIREMENT_FIELDS.map(([field, stat]) => [field, stat] as const))(
    "still enforces %s when set",
    (field, stat) => {
      const row = compactJutsu(jutsu({ [field]: 50 }));
      expect(hasMasteryRequirements({ [stat]: 10 }, row)).toBe(false);
      expect(hasMasteryRequirements({ [stat]: 50 }, row)).toBe(true);
    },
  );

  it("treats an omitted requirement as no requirement", () => {
    expect(hasMasteryRequirements(gates.masteries, compactJutsu(jutsu()))).toBe(true);
    expect(hasRequiredSkill(compactJutsu(jutsu()), gates.skills)).toBe(true);
    expect(checkJutsuBloodlineItem(compactJutsu(jutsu()) as Jutsu, gates.items)).toBe(
      true,
    );
  });

  it("still enforces skill and bloodline item requirements", () => {
    const row = jutsu({
      requiredSkillId: "skill",
      requiredBloodlineItemId: "blood-item",
    });
    expect(hasRequiredSkill(compactJutsu(row), gates.skills)).toBe(false);
    expect(checkJutsuBloodlineItem(compactJutsu(row) as Jutsu, gates.items)).toBe(
      false,
    );
  });

  it.each([
    ["no requirements", {}],
    ["a bloodline", { bloodlineId: "other" }],
    ["a skill", { requiredSkillId: "skill" }],
    ["a mastery", { requiredTaijutsuMastery: 500 }],
    ["a weapon", { jutsuWeapon: "SWORD" }],
    ["a bloodline item", { requiredBloodlineItemId: "blood-item" }],
    ["a level", { requiredLevel: 90 }],
  ] as [string, Partial<Jutsu>][])(
    "gives the lobby gate's answer for %s on full and compact rows",
    (_, overrides) => {
      const user = {
        userId: "user",
        isAi: false,
        level: 1,
        rank: "STUDENT",
        bloodlineId: null,
        items: [],
        userSkills: [],
        questData: [],
      } as unknown as CombatQueryUser;
      const masteries = { taijutsuMastery: 10 } as never;
      const row = jutsu(overrides);
      expect(
        battleJutsuGateFailure(compactJutsu(row) as Jutsu, user, "COMBAT", masteries),
      ).toBe(battleJutsuGateFailure(row, user, "COMBAT", masteries));
    },
  );
});

describe("village structures in battle catalogs", () => {
  const compactStructures = (structures: VillageStructure[]) =>
    compact({ villages: { village: { id: "village", structures } as never } }).villages
      .village?.structures;

  it.each(BOOSTS)("keeps %s for the boosts settlement and the lobby read", (boost) => {
    const structures = [structure(boost)];
    expect(getStrucBoost(boost, compactStructures(structures))).toBe(
      getStrucBoost(boost, structures),
    );
    expect(getStrucBoost(boost, structures)).toBeGreaterThan(0);
  });

  it("removes structures with no boost and their map presentation", () => {
    const stored = compactStructures([structure(), structure("arenaRewardPerLvl")]);
    expect(stored).toHaveLength(1);
    expect(stored?.[0]).not.toHaveProperty("image");
    expect(stored?.[0]).not.toHaveProperty("route");
  });
});

describe("linked reskins on compact catalogs", () => {
  it("applies cosmetics without a description to inherit", () => {
    const base = compactJutsu(jutsu({ id: "base" })) as BattleJutsu;
    const reskin = compactJutsu(
      jutsu({ id: "skin", name: "Skin", reskinParentJutsuId: "base" }),
    );
    expect(applyLinkedJutsuReskin(base, reskin)).toMatchObject({
      id: "base",
      name: "Skin",
    });
  });

  it("does not apply to a reskin of something else", () => {
    const base = compactJutsu(jutsu({ id: "base" }));
    const unrelated = compactJutsu(jutsu({ id: "skin", name: "Skin" }));
    expect(applyLinkedJutsuReskin(base, unrelated)).toBe(base);
  });
});
