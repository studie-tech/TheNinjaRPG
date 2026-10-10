import { describe, expect, it } from "bun:test";
import { MAX_DAILY_TRAININGS } from "@/drizzle/constants";
import type { Jutsu, UserData } from "@/drizzle/schema";
import {
  getTrainingMultiplierBoost,
  jutsuRequirementWarning,
  masteryTrainingBlockMessage,
  statTrainingBlockMessage,
  trainingEnergyMessage,
  trainingMultiplier,
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

  it("Energy spending has no daily limit, while mastery retains its own limit", () => {
    const capped = {...trainee, dailyTrainings: MAX_DAILY_TRAININGS};
    expect(statTrainingBlockMessage(capped)).toBeNull();
    expect(masteryTrainingBlockMessage(capped)).toContain("24 hours");
  });

  it("names the slot that is already running", () => {
    const rested = { ...trainee, dailyTrainings: 0 };
    expect(
      masteryTrainingBlockMessage({ ...rested, currentlyTrainingMastery: "sageMastery" }),
    ).toBe("You are already training a mastery");
  });
});


describe("player training modifiers", () => {
  const trainee = {
    rank: "GENIN",
    senseiId: null,
    joinedVillageAt: new Date("2020-01-01"),
    trainingSpeed: "15min",
  } as UserData;

  it("preserves the sensei bonus independently of the mastery interval", () => {
    const student = { ...trainee, senseiId: "sensei" };
    expect(getTrainingMultiplierBoost(student)).toBeCloseTo(1.05);
    expect(trainingMultiplier(student)).toBeCloseTo(0.0105);
    expect(getTrainingMultiplierBoost({ ...student, trainingSpeed: "24hrs" })).toBeCloseTo(1.05);
    expect(trainingMultiplier({ ...student, trainingSpeed: "24hrs" })).toBeCloseTo(1.008);
  });

  it("retains reduced training gains after joining a village", () => {
    const joined = { ...trainee, rank: "JONIN" as const, joinedVillageAt: new Date() };
    expect(getTrainingMultiplierBoost(joined)).toBe(0.5);
    expect(trainingMultiplier(joined)).toBe(0.005);
    expect(getTrainingMultiplierBoost({ ...joined, joinedVillageAt: trainee.joinedVillageAt })).toBe(1);
  });
});

describe("trainingEnergyMessage", () => {
  it("explains empty Energy before the requested amount", () => {
    expect(trainingEnergyMessage(0, 0)).toBe(
      "No Energy available. Wait for Energy to recover before training.",
    );
    expect(trainingEnergyMessage(10, 0)).toBe(
      "No Energy available. Wait for Energy to recover before training.",
    );
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects a requested amount of %p",
    (requested) => {
      expect(trainingEnergyMessage(requested, 50)).toBe(
        "Enter an Energy amount greater than zero to train.",
      );
    },
  );

  it("allows a positive amount while Energy is available", () => {
    expect(trainingEnergyMessage(0.5, 50)).toBeNull();
    expect(trainingEnergyMessage(50, 50)).toBeNull();
  });
});
