import { describe, expect, it } from "bun:test";
import {
  MEDNIN_EXP_CAP,
  MEDNIN_HEAL_TO_EXP,
  MEDNIN_REQUIRED_EXP,
} from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import {
  calcCombatHealPercentage,
  calcHospitalHealExperience,
  calcHospitalHealPools,
  calcHowMuchToHeal,
  calcMedninHealablePool,
  calcUserHealFactor,
} from "@/libs/hospital";

describe("calcHospitalHealExperience", () => {
  const baseInput = {
    healerId: "healer",
    targetId: "target",
    toHeal: 200,
    medicalExperience: 0,
  };

  it("awards the usual medical experience when healing another user", () => {
    expect(calcHospitalHealExperience(baseInput)).toBe(
      MEDNIN_HEAL_TO_EXP * baseInput.toHeal,
    );
  });

  it("awards half the usual medical experience when healing oneself", () => {
    expect(
      calcHospitalHealExperience({ ...baseInput, targetId: baseInput.healerId }),
    ).toBe((MEDNIN_HEAL_TO_EXP * baseInput.toHeal) / 2);
  });

  it("caps both normal and self-healing awards at the remaining experience capacity", () => {
    const medicalExperience = MEDNIN_EXP_CAP - 5;

    expect(calcHospitalHealExperience({ ...baseInput, medicalExperience })).toBe(5);
    expect(
      calcHospitalHealExperience({
        ...baseInput,
        targetId: baseInput.healerId,
        medicalExperience,
      }),
    ).toBe(5);
  });

  it("never awards experience above the cap", () => {
    expect(
      calcHospitalHealExperience({ ...baseInput, medicalExperience: MEDNIN_EXP_CAP }),
    ).toBe(0);
  });

  it("awards whole experience points only", () => {
    expect(calcHospitalHealExperience({ ...baseInput, toHeal: 225 })).toBe(22);
    expect(
      calcHospitalHealExperience({
        ...baseInput,
        targetId: baseInput.healerId,
        toHeal: 225,
      }),
    ).toBe(11);
  });
});

describe("calcHospitalHealPools", () => {
  const legendary = {
    rank: "JONIN",
    medicalExperience: MEDNIN_REQUIRED_EXP.LEGENDARY,
  } as const;

  it("lets a legendary healer restore every pool of another user", () => {
    expect(calcHospitalHealPools(legendary, false)).toEqual([
      "Health",
      "Chakra",
      "Stamina",
    ]);
  });

  it("never lets a heal restore the chakra that pays for it", () => {
    expect(calcHospitalHealPools(legendary, true)).toEqual(["Health", "Stamina"]);
  });

  it("sizes a self-heal without the chakra deficit", () => {
    const target = {
      curHealth: 1000,
      maxHealth: 1000,
      curChakra: 4000,
      maxChakra: 8000,
      curStamina: 100,
      maxStamina: 100,
    } as UserData;
    expect(calcHowMuchToHeal(target, 100, calcMedninHealablePool(legendary))).toBe(
      4000,
    );
    expect(calcHowMuchToHeal(target, 100, calcHospitalHealPools(legendary, true))).toBe(
      0,
    );
  });
});

describe("mednin rank tables", () => {
  const healer = (rank: keyof typeof MEDNIN_REQUIRED_EXP) =>
    ({
      rank: rank === "NONE" ? "STUDENT" : "GENIN",
      medicalExperience: MEDNIN_REQUIRED_EXP[rank],
    }) as Parameters<typeof calcMedninHealablePool>[0];

  it.each([
    ["NONE", 30, ["Health"]],
    ["NOVICE", 30, ["Health"]],
    ["APPRENTICE", 40, ["Health"]],
    ["MASTER", 50, ["Health"]],
    ["LEGENDARY", 60, ["Health", "Chakra", "Stamina"]],
  ] as const)("gives a %s healer %d%% and its pools", (rank, percentage, pools) => {
    expect(calcCombatHealPercentage(healer(rank))).toBe(percentage);
    expect(calcMedninHealablePool(healer(rank))).toEqual([...pools]);
  });

  it("treats a missing healer as unranked", () => {
    expect(calcCombatHealPercentage(undefined)).toBe(30);
    expect(calcMedninHealablePool(undefined)).toEqual(["Health"]);
  });

  it.each([
    ["NONE", 0],
    ["NOVICE", 0.5 - 0.05],
    ["APPRENTICE", 0.5 - 0.1],
    ["MASTER", 0.5 - 0.25],
    ["LEGENDARY", 0.5 - 0.35],
  ] as const)("gives a %s healer the exact chakra factor %d", (rank, factor) => {
    expect(
      calcUserHealFactor(healer(rank) as Parameters<typeof calcUserHealFactor>[0]),
    ).toBe(factor);
  });
});
