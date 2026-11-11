import { describe, expect, it } from "bun:test";
import {
  firstInvalidRegistrationStep,
  REGISTRATION_FIELD_STEPS,
  registrationStepReadiness,
} from "@/libs/registration";
import { registrationSchema } from "@/validators/register";

describe("firstInvalidRegistrationStep", () => {
  it("returns the earliest step with an error and its player-facing field names", () => {
    expect(firstInvalidRegistrationStep(["read_tos", "bloodlineId"])).toEqual({
      step: 2,
      labels: ["Bloodline"],
    });
    expect(firstInvalidRegistrationStep(["read_tos", "read_privacy"])).toEqual({
      step: 3,
      labels: ["Terms of Service", "Privacy Policy"],
    });
  });

  it("ignores unknown keys and returns undefined without known errors", () => {
    expect(firstInvalidRegistrationStep([])).toBeUndefined();
    expect(firstInvalidRegistrationStep(["root"])).toBeUndefined();
  });

  it("maps every registration field to a step", () => {
    expect(Object.keys(REGISTRATION_FIELD_STEPS).sort()).toEqual(
      Object.keys(registrationSchema.shape).sort(),
    );
  });
});

describe("registrationStepReadiness", () => {
  const appearance = {
    hair_color: "Black",
    eye_color: "Blue",
    skin_color: "Light",
    attribute_1: "a",
    attribute_2: "b",
    attribute_3: "c",
  };

  it("gates each step on its own filled, valid fields", () => {
    expect(
      registrationStepReadiness(
        { username: "Naru", gender: "Male", ...appearance, bloodlineId: "bl" },
        [],
      ),
    ).toEqual([true, true, true, false]);
  });

  it("blocks a step with a missing or invalid field", () => {
    const readiness = registrationStepReadiness(
      { username: "N", gender: "Male", ...appearance },
      ["attribute_2"],
    );
    expect(readiness).toEqual([false, false, false, false]);
  });
});
