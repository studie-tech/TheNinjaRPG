import { describe, expect, it } from "bun:test";
import type { z } from "zod";
import { registerRouter } from "@/server/api/routers/register";

const registration = {
  username: "NewNinja",
  gender: "Other",
  hair_color: "Black",
  eye_color: "Brown",
  skin_color: "Light",
  attribute_1: "Soft features",
  attribute_2: "Glasses",
  attribute_3: "Short Hair",
  read_tos: true,
  read_privacy: true,
  read_earlyaccess: true,
  bloodlineId: "starter",
};
const input = registerRouter.createCharacter._def.inputs[0] as z.ZodType;

describe("registration input compatibility", () => {
  it.each([undefined, "reddit"])(
    "accepts a registration form with campaign hint %s",
    (utm_source) => {
      expect(input.parse({ ...registration, utm_source })).toMatchObject(registration);
    },
  );

  it("keeps unrelated keys and incompatible character traits invalid", () => {
    expect(() => input.parse({ ...registration, isAi: true })).toThrow();
    expect(() =>
      input.parse({
        ...registration,
        utm_source: "reddit",
        attribute_2: "Hard features",
      }),
    ).toThrow();
  });
});
