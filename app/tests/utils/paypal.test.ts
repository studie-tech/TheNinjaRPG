import { describe, it, expect } from "vitest";
import { reps2dollars, dollars2reps } from "@/utils/paypal";

describe("reps2dollars / dollars2reps round-trip", () => {
  it("reps2dollars and dollars2reps functions", () => {
    const testRepsValues = [1, 5, 10, 50, 100, 500, 1000];

    testRepsValues.forEach((reps) => {
      const dollars = reps2dollars(reps);
      const calculatedReps = dollars2reps(dollars);
      expect(calculatedReps).toBe(reps);
    });
  });
});
