import { describe, expect, it } from "vitest";
import type { Jutsu } from "@/drizzle/schema";
import { jutsuRequirementWarning } from "@/libs/train";
import type { UserWithRelations } from "@/routers/profile";
import type { ZodAllTags } from "@/validators/combat";

// Goes through jutsuRequirementWarning, not canUseJutsu: tests/libs/jutsu.test.ts stubs
// canUseJutsu for the whole bun run.

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

describe("jutsu mastery gate", () => {
  it("rejects a jutsu whose mastery requirement the stored value misses", () => {
    expect(jutsuRequirementWarning(jutsu, user)).toContain("mastery");
  });

  it("counts activated skill buffs toward the requirement", () => {
    const skills = [{ skill: { target: "SELF" as const, effects: [ninjutsuBuff] } }];
    expect(jutsuRequirementWarning(jutsu, user, [], skills)).toBe("");
  });
});
