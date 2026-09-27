import { describe, expect, it } from "vitest";
import type { Jutsu } from "@/drizzle/schema";
import { effectiveMasteries } from "@/libs/mastery";
import { canTrainJutsu } from "@/libs/train";
import type { UserWithRelations } from "@/routers/profile";
import type { ZodAllTags } from "@/validators/combat";

const jutsu = {
  id: "gated",
  jutsuType: "NORMAL",
  jutsuRank: "D",
  jutsuWeapon: "NONE",
  requiredRank: "STUDENT",
  requiredLevel: 1,
  villageId: null,
  bloodlineId: null,
  parentJutsuId: null,
  effects: [],
  requiredNinjutsuMastery: 500,
} as unknown as Jutsu;

const user = {
  userId: "trainee",
  rank: "GENIN",
  level: 20,
  villageId: null,
  bloodlineId: null,
  bloodline: null,
  items: [],
  ninjutsuMastery: 400,
  genjutsuMastery: 10,
  taijutsuMastery: 10,
  bukijutsuMastery: 10,
  bloodlineMastery: 10,
  sageMastery: 10,
} as unknown as NonNullable<UserWithRelations>;

const ninjutsuBuff = {
  type: "increasemastery",
  masteryTypes: ["Ninjutsu"],
  power: 200,
  powerPerLevel: 0,
  calculation: "static",
} as unknown as ZodAllTags;

describe("canTrainJutsu mastery gate", () => {
  it("rejects a jutsu whose mastery requirement the stored value misses", () => {
    expect(canTrainJutsu(jutsu, user)).toBe(false);
  });

  it("counts skill and gear buffs when the caller passes effective masteries", () => {
    const masteries = effectiveMasteries({
      ...user,
      items: [],
      userSkills: [{ skill: { target: "SELF", effects: [ninjutsuBuff] } }],
    });
    expect(canTrainJutsu(jutsu, user, masteries)).toBe(true);
  });
});
