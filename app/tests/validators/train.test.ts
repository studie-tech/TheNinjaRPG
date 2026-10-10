import { describe, expect, it } from "bun:test";
import { startTrainingInputSchema } from "@/validators/train";

describe("startTrainingInputSchema", () => {
  // train.startTraining answers these with trainingEnergyMessage instead.
  it.each([0, -1, 12.5])("lets %p Energy reach the procedure", (energy) => {
    expect(startTrainingInputSchema.safeParse({ stat: "offence", energy }).success).toBe(
      true,
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])("rejects %p Energy", (energy) => {
    expect(startTrainingInputSchema.safeParse({ stat: "offence", energy }).success).toBe(
      false,
    );
  });
});
