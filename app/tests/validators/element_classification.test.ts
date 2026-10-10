import { describe, expect, it } from "bun:test";
import { ElementNames } from "@/drizzle/constants";
import { SAGE_MODE_ACTIVATION_JUTSU } from "@/libs/sageMode";
import { JutsuValidatorRawSchema } from "@/validators/combat";

describe("jutsu element classification", () => {
  it.each([...ElementNames])("accepts %s", (elementClassification) => {
    const parsed = JutsuValidatorRawSchema.parse({
      ...SAGE_MODE_ACTIVATION_JUTSU,
      effects: [],
      elementClassification,
    });
    expect(parsed.elementClassification).toBe(elementClassification);
  });

  it.each([null, undefined])("normalizes %s to None", (elementClassification) => {
    expect(
      JutsuValidatorRawSchema.parse({
        ...SAGE_MODE_ACTIVATION_JUTSU,
        effects: [],
        elementClassification,
      }).elementClassification,
    ).toBe("None");
  });

  it.each(["", "fire", "Unknown", 1, ["Fire"]].map((value) => ({ value })))(
    "rejects $value",
    ({ value }) => {
      expect(
        JutsuValidatorRawSchema.shape.elementClassification.safeParse(value).success,
      ).toBe(false);
    },
  );
});
