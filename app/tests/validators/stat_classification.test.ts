import { describe, expect, it } from "vitest";
import { BloodlineValidator, JutsuValidatorRawSchema } from "@/validators/combat";

// THENINJARPG-2P1: statClassification is nullable in the schema, so freshly
// created content - and anything saved before the field existed - reaches
// jutsu.update as null and used to fail input validation outright.
describe("statClassification", () => {
  const jutsuField = JutsuValidatorRawSchema.shape.statClassification;
  const bloodlineField = BloodlineValidator.shape.statClassification;

  it.each([
    ["jutsu", jutsuField],
    ["bloodline", bloodlineField],
  ])("%s falls back to Highest for null and undefined", (_name, field) => {
    expect(field.parse(null)).toBe("Highest");
    expect(field.parse(undefined)).toBe("Highest");
  });

  it.each([
    ["jutsu", jutsuField],
    ["bloodline", bloodlineField],
  ])("%s keeps an explicit classification", (_name, field) => {
    expect(field.parse("Ninjutsu")).toBe("Ninjutsu");
  });

  it.each([
    ["jutsu", jutsuField],
    ["bloodline", bloodlineField],
  ])("%s still rejects values outside the enum", (_name, field) => {
    expect(() => field.parse("Speed")).toThrow();
    expect(() => field.parse("")).toThrow();
  });
});
