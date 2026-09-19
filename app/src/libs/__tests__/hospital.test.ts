import { describe, expect, it } from "vitest";
import { MEDNIN_EXP_CAP, MEDNIN_HEAL_TO_EXP } from "@/drizzle/constants";
import { calcHospitalHealExperience } from "@/libs/hospital";

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
});
