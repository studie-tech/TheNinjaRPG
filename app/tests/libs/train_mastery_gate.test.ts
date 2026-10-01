import { describe, expect, it } from "vitest";
import { MAX_DAILY_TRAININGS } from "@/drizzle/constants";
import type { Jutsu } from "@/drizzle/schema";
import {
  jutsuRequirementWarning,
  masteryTrainingBlockMessage,
  statTrainingBlockMessage,
} from "@/libs/train";
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

describe("training start preconditions", () => {
  const trainee = {
    status: "AWAKE" as const,
    isOutlaw: true,
    sector: 1,
    longitude: 0,
    latitude: 0,
    trainingSpeed: "8hrs" as const,
    isBanned: false,
    rank: "GENIN" as const,
    dailyTrainings: MAX_DAILY_TRAININGS - 1,
    currentlyTraining: null,
    currentlyTrainingMastery: null,
    offence: 10,
    defence: 10,
    strength: 10,
    speed: 10,
    intelligence: 10,
    willpower: 10,
    ninjutsuMastery: 10,
    genjutsuMastery: 10,
    taijutsuMastery: 10,
    bukijutsuMastery: 10,
    bloodlineMastery: 10,
    sageMastery: 10,
  };

  it("lets either slot start with one training left", () => {
    expect(statTrainingBlockMessage(trainee)).toBeNull();
    expect(masteryTrainingBlockMessage(trainee)).toBeNull();
  });

  it("counts the other slot's running session toward the daily limit", () => {
    expect(
      statTrainingBlockMessage({ ...trainee, currentlyTrainingMastery: "ninjutsuMastery" }),
    ).toContain("24 hours");
    expect(
      masteryTrainingBlockMessage({ ...trainee, currentlyTraining: "offence" }),
    ).toContain("24 hours");
  });

  it("names the slot that is already running", () => {
    const rested = { ...trainee, dailyTrainings: 0 };
    expect(statTrainingBlockMessage({ ...rested, currentlyTraining: "offence" })).toBe(
      "You are already training a combat stat",
    );
    expect(
      masteryTrainingBlockMessage({ ...rested, currentlyTrainingMastery: "sageMastery" }),
    ).toBe("You are already training a mastery");
  });
});
