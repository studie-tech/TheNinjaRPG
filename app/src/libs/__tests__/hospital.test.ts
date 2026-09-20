import { describe, expect, it } from "vitest";
import {
  MEDNIN_EXP_CAP,
  MEDNIN_HEAL_TO_EXP,
  MEDNIN_REQUIRED_EXP,
} from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import {
  calcHospitalHealExperience,
  calcHospitalHealPools,
  calcHowMuchToHeal,
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
    expect(calcHowMuchToHeal(legendary, target, 100).toHeal).toBe(4000);
    expect(
      calcHowMuchToHeal(legendary, target, 100, calcHospitalHealPools(legendary, true))
        .toHeal,
    ).toBe(0);
  });
});
