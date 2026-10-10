import { describe, expect, it } from "bun:test";
import type { MasteryName } from "@/drizzle/constants";
import { getUserCaps, MasteryNames } from "@/drizzle/constants";
import type { MasteryBuffUser, MasteryGear } from "@/libs/mastery";
import {
  effectiveMasteries,
  gearMissingMastery,
  hasMasteryRequirements,
  isWornGearDisabled,
  missingMasteryRequirement,
} from "@/libs/mastery";
import type { ZodAllTags } from "@/validators/combat";
import { calcEnergy, calcMaxEnergy } from "@/libs/profile";

const emptyMasteries = (value = 0): Record<MasteryName, number> =>
  Object.fromEntries(MasteryNames.map((name) => [name, value])) as Record<
    MasteryName,
    number
  >;

describe("hasMasteryRequirements", () => {
  it("allows use when no mastery requirements are set", () => {
    expect(hasMasteryRequirements(emptyMasteries(10), {})).toBe(true);
    expect(hasMasteryRequirements(emptyMasteries(10), null)).toBe(true);
    // Unset requirement columns come back from the database as null, not absent
    expect(
      hasMasteryRequirements(emptyMasteries(10), { requiredNinjutsuMastery: null }),
    ).toBe(true);
  });

  it("allows use when the user meets every required mastery", () => {
    const user = {
      ...emptyMasteries(10),
      ninjutsuMastery: 500,
      sageMastery: 200,
    };
    expect(
      hasMasteryRequirements(user, {
        requiredNinjutsuMastery: 500,
        requiredSageMastery: 200,
      }),
    ).toBe(true);
  });

  it("blocks use when any required mastery is below the threshold", () => {
    const user = {
      ...emptyMasteries(10),
      ninjutsuMastery: 499,
    };
    expect(
      hasMasteryRequirements(user, {
        requiredNinjutsuMastery: 500,
      }),
    ).toBe(false);
  });

  it("treats missing masteries as met so masked opponent state does not hide actions", () => {
    expect(
      hasMasteryRequirements(
        {},
        {
          requiredNinjutsuMastery: 500,
        },
      ),
    ).toBe(true);
  });
});

describe("missingMasteryRequirement", () => {
  it("names the unmet mastery so equip errors can quote it", () => {
    const user = { ...emptyMasteries(10), bukijutsuMastery: 100 };
    expect(missingMasteryRequirement(user, { requiredBukijutsuMastery: 500 })).toEqual({
      label: "Bukijutsu Mastery",
      required: 500,
      current: 100,
    });
  });

  it("returns null when every requirement is met", () => {
    expect(
      missingMasteryRequirement(emptyMasteries(500), { requiredSageMastery: 500 }),
    ).toBeNull();
  });

  it("agrees with hasMasteryRequirements", () => {
    const user = { ...emptyMasteries(10), ninjutsuMastery: 499 };
    const reqs = { requiredNinjutsuMastery: 500 };
    expect(hasMasteryRequirements(user, reqs)).toBe(
      missingMasteryRequirement(user, reqs) === null,
    );
  });
});

/** A mastery tag as content authors configure it on a bloodline, skill or item. */
const masteryTag = (
  over: {
    type?: "increasemastery" | "decreasemastery";
    power?: number;
    powerPerLevel?: number;
    calculation?: "static" | "percentage";
    rounds?: number;
    friendlyFire?: "ALL" | "FRIENDLY" | "ENEMIES";
  } = {},
): ZodAllTags =>
  ({
    type: "increasemastery",
    masteryTypes: ["Ninjutsu"],
    power: 100,
    powerPerLevel: 0,
    calculation: "static",
    ...over,
  }) as ZodAllTags;

const gear = (
  id: string,
  effects: ZodAllTags[],
  over: {
    equipped?: string;
    durability?: number;
    level?: number;
    itemType?: string;
    bloodlineId?: string | null;
    requiredNinjutsuMastery?: number;
  } = {},
): MasteryGear => ({
  id,
  equipped: over.equipped ?? "CHEST",
  durability: over.durability ?? 100,
  level: over.level ?? 1,
  item: {
    itemType: over.itemType ?? "ARMOR",
    maxDurability: 100,
    bloodlineId: over.bloodlineId ?? null,
    canBeImbued: false,
    effects,
    requiredNinjutsuMastery: over.requiredNinjutsuMastery ?? null,
  },
});

const wearer = (over: Partial<MasteryBuffUser> = {}): MasteryBuffUser & { isAi: boolean } => ({
  ...emptyMasteries(1000),
  level: 10,
  bloodlineId: "bl",
  isAi: false,
  ...over,
});

describe("Energy capacity", () => {
  const energyTag = (power = 100): Extract<ZodAllTags, {type: "increasemaxpools" | "decreasemaxpools"}> => ({
    ...masteryTag(),
    type: "increasemaxpools",
    poolsAffected: ["Energy"],
    power,
  }) as Extract<ZodAllTags, {type: "increasemaxpools" | "decreasemaxpools"}>;

  it("grows by 50 per level and includes owner bloodline and skill bonuses", () => {
    expect(calcEnergy(1)).toBe(100);
    expect(calcEnergy(10)).toBe(550);
    expect(calcMaxEnergy(wearer({
      bloodline: { effects: [energyTag()] },
      userSkills: [
        { skill: { target: "SELF", effects: [energyTag(50)] } },
        { skill: { target: "ENEMIES", effects: [{ ...energyTag(500), friendlyFire: "ENEMIES" }] } },
      ],
    }))).toBe(700);
  });

  it("includes completed imbuements but excludes unavailable gear", () => {
    const armor = gear("usable", [energyTag()], { level: 2 });
    armor.item.canBeImbued = true;
    armor.imbuements = [
      { craftingFinishedAt: new Date(0), item: { effects: [energyTag(25)] } },
      { craftingFinishedAt: new Date(Date.now() + 60_000), item: { effects: [energyTag(500)] } },
    ];
    expect(calcMaxEnergy(wearer({ items: [
      armor,
      gear("broken", [energyTag(500)], { durability: 0 }),
      gear("unequipped", [energyTag(500)], { equipped: "NONE" }),
      gear("locked", [energyTag(500)], { requiredNinjutsuMastery: 2000 }),
      gear("wrong-bloodline", [energyTag(500)], { bloodlineId: "other" }),
    ] }))).toBe(675);
  });

  it("scales percentages from base capacity and keeps the pool positive", () => {
    expect(calcMaxEnergy(wearer({ bloodline: { effects: [
      { ...energyTag(20), calculation: "percentage" },
      { ...energyTag(100), type: "decreasemaxpools" },
    ] } }))).toBe(560);
    expect(calcMaxEnergy(wearer({ bloodline: { effects: [
      { ...energyTag(1000), type: "decreasemaxpools" },
    ] } }))).toBe(1);
  });
});

describe("effectiveMasteries", () => {
  it("returns the stored masteries when nothing carries a mastery tag", () => {
    expect(effectiveMasteries(wearer())).toEqual(emptyMasteries(1000));
  });

  it("caps stored masteries at the rank cap, as battle does, before adding buffs", () => {
    const { mastery_cap } = getUserCaps("GENIN");
    const user = wearer({
      ...emptyMasteries(mastery_cap + 5000),
      rank: "GENIN",
      bloodline: { effects: [masteryTag({ power: 100 })] },
    });
    expect(effectiveMasteries(user).ninjutsuMastery).toBe(mastery_cap + 100);
    expect(effectiveMasteries(user).genjutsuMastery).toBe(mastery_cap);
  });

  it("adds static tags scaled by level and percentages of the stored value", () => {
    const user = wearer({
      bloodline: {
        effects: [
          masteryTag({ power: 100, powerPerLevel: 1 }),
          masteryTag({ power: 10, calculation: "percentage" }),
        ],
      },
    });
    // 100 + level 10 * 1, plus 10% of the stored 1000
    expect(effectiveMasteries(user).ninjutsuMastery).toBe(1210);
    expect(effectiveMasteries(user).genjutsuMastery).toBe(1000);
  });

  it("caps percentage tags at 100% and subtracts decreasemastery", () => {
    const user = wearer({
      bloodline: {
        effects: [
          masteryTag({ power: 150, calculation: "percentage" }),
          masteryTag({ type: "decreasemastery", power: 300 }),
        ],
      },
    });
    expect(effectiveMasteries(user).ninjutsuMastery).toBe(1700);
  });

  it("ignores tags that have no rounds left", () => {
    const user = wearer({ bloodline: { effects: [masteryTag({ rounds: 0 })] } });
    expect(effectiveMasteries(user).ninjutsuMastery).toBe(1000);
  });

  it("counts skills whose effects reach their owner in battle", () => {
    const user = wearer({
      userSkills: [
        { skill: { target: "SELF", effects: [masteryTag({ friendlyFire: "ENEMIES" })] } },
        { skill: { target: "ALLIES", effects: [masteryTag({ power: 10 })] } },
        {
          skill: {
            target: "ENEMIES",
            effects: [masteryTag({ power: 1, friendlyFire: "ENEMIES" })],
          },
        },
      ],
    });
    expect(effectiveMasteries(user).ninjutsuMastery).toBe(1110);
  });

  it("counts equipped worn gear above the durability floor on the wearer's bloodline", () => {
    const user = wearer({
      items: [
        gear("worn", [masteryTag({ power: 100 })]),
        gear("stored", [masteryTag({ power: 1 })], { equipped: "NONE" }),
        gear("broken", [masteryTag({ power: 2 })], { durability: 0 }),
        gear("weapon", [masteryTag({ power: 4 })], { itemType: "WEAPON" }),
        gear("foreign", [masteryTag({ power: 8 })], { bloodlineId: "other" }),
      ],
    });
    expect(effectiveMasteries(user).ninjutsuMastery).toBe(1100);
  });

  it("scales player gear with its item level and AI gear with the wearer's level", () => {
    const items = [gear("worn", [masteryTag({ power: 0, powerPerLevel: 1 })], { level: 3 })];
    expect(effectiveMasteries(wearer({ items })).ninjutsuMastery).toBe(1003);
    expect(effectiveMasteries(wearer({ items, isAi: true })).ninjutsuMastery).toBe(1010);
  });

  it("leaves out the gear being gated so it cannot unlock itself", () => {
    const user = wearer({ items: [gear("armor", [masteryTag({ power: 600 })])] });
    expect(effectiveMasteries(user).ninjutsuMastery).toBe(1600);
    expect(effectiveMasteries(user, "armor").ninjutsuMastery).toBe(1000);
  });

  it("does not let two gated pieces unlock each other", () => {
    const gated = { requiredNinjutsuMastery: 1500 };
    const user = wearer({
      items: [
        gear("chest", [masteryTag({ power: 600 })], gated),
        gear("helm", [masteryTag({ power: 600 })], { ...gated, equipped: "HEAD" }),
      ],
    });
    expect(effectiveMasteries(user, "chest").ninjutsuMastery).toBe(1000);
    expect(isWornGearDisabled(gear("chest", [], gated), user)).toBe(true);
  });

  it.each([false, true])("counts an anchored gear chain regardless of inventory order (%s)", (reverse) => {
    const items = [
      gear("helm", [masteryTag()], { equipped: "HEAD" }),
      gear("chest", [masteryTag()], { requiredNinjutsuMastery: 200 }),
      gear("accessory", [masteryTag()], { requiredNinjutsuMastery: 300, equipped: "ITEM_1" }),
    ];
    const user = wearer({ ninjutsuMastery: 100, items: reverse ? items.reverse() : items });
    expect(effectiveMasteries(user).ninjutsuMastery).toBe(400);
    expect(hasMasteryRequirements(effectiveMasteries(user), { requiredNinjutsuMastery: 400 })).toBe(true);
    for (const piece of items) expect(gearMissingMastery(piece, user)).toBeNull();
    expect(effectiveMasteries(user, "helm").ninjutsuMastery).toBe(100);
  });

  it("does not count a piece's own buff toward its requirement", () => {
    const armor = gear("chest", [masteryTag()], { requiredNinjutsuMastery: 200 });
    const user = wearer({ ninjutsuMastery: 100, items: [armor] });
    expect(effectiveMasteries(user).ninjutsuMastery).toBe(100);
    expect(gearMissingMastery(armor, user)?.current).toBe(100);
  });

  it("applies independently usable penalties before admitting positive chains", () => {
    const penalty = gear("penalty", [masteryTag({ type: "decreasemastery", power: 50 })]);
    const helm = gear("helm", [masteryTag()], { equipped: "HEAD" });
    const chest = gear("chest", [masteryTag()], { requiredNinjutsuMastery: 200 });
    const user = wearer({ ninjutsuMastery: 100, items: [chest, helm, penalty] });
    expect(effectiveMasteries(user).ninjutsuMastery).toBe(150);
    expect(gearMissingMastery(chest, user)?.current).toBe(150);
    expect(gearMissingMastery(helm, user)).toBeNull();
    expect(gearMissingMastery(penalty, user)).toBeNull();
  });

  it("keeps penalty gear anchored in non-gear sources instead of disabling its support", () => {
    const helm = gear("helm", [masteryTag()], { equipped: "HEAD", requiredNinjutsuMastery: 100 });
    const chest = gear("chest", [masteryTag({ type: "decreasemastery", power: 150 })], { requiredNinjutsuMastery: 200 });
    const user = wearer({ ninjutsuMastery: 100, items: [helm, chest] });
    expect(effectiveMasteries(user).ninjutsuMastery).toBe(200);
    expect(gearMissingMastery(helm, user)).toBeNull();
    expect(gearMissingMastery(chest, user)).toEqual({ label: "Ninjutsu Mastery", required: 200, current: 100 });
    expect(isWornGearDisabled(chest, user)).toBe(true);
  });

  it("lets the bloodline unlock gear, which then counts", () => {
    const user = wearer({
      bloodline: { effects: [masteryTag({ power: 500 })] },
      items: [gear("chest", [masteryTag({ power: 600 })], { requiredNinjutsuMastery: 1500 })],
    });
    expect(effectiveMasteries(user).ninjutsuMastery).toBe(2100);
  });
});


describe("isWornGearDisabled", () => {
  const gated = gear("chest", [], { requiredNinjutsuMastery: 1500 });

  it("disables gear at the durability floor, for AI too", () => {
    const broken = gear("chest", [], { durability: 0 });
    expect(isWornGearDisabled(broken, wearer())).toBe(true);
    expect(isWornGearDisabled(broken, wearer({ isAi: true }))).toBe(true);
  });

  it("disables gear whose mastery gate the player misses", () => {
    expect(isWornGearDisabled(gated, wearer())).toBe(true);
    expect(isWornGearDisabled(gated, wearer({ ninjutsuMastery: 1500 }))).toBe(false);
  });

  it("exempts AI from mastery gates", () => {
    expect(isWornGearDisabled(gated, wearer({ isAi: true }))).toBe(false);
  });

  it("keeps gear another source unlocks", () => {
    const user = wearer({ items: [gear("helm", [masteryTag({ power: 500 })])] });
    expect(isWornGearDisabled(gated, user)).toBe(false);
  });
});

describe("gearMissingMastery", () => {
  it("reports the gate against every other source", () => {
    const user = wearer({ items: [gear("helm", [masteryTag({ power: 200 })])] });
    const blade = gear("blade", [], {
      itemType: "WEAPON",
      equipped: "HAND_1",
      requiredNinjutsuMastery: 1500,
    });
    expect(gearMissingMastery(blade, user)).toEqual({
      label: "Ninjutsu Mastery",
      required: 1500,
      current: 1200,
    });
  });
});
