import { describe, expect, it } from "vitest";
import type { MasteryName } from "@/drizzle/constants";
import { MasteryNames } from "@/drizzle/constants";
import { hasMasteryRequirements, missingMasteryRequirement } from "@/libs/mastery";

const emptyMasteries = (value = 0): Record<MasteryName, number> =>
  Object.fromEntries(MasteryNames.map((name) => [name, value])) as Record<
    MasteryName,
    number
  >;

describe("hasMasteryRequirements", () => {
  it("allows use when no mastery requirements are set", () => {
    expect(hasMasteryRequirements(emptyMasteries(10), {})).toBe(true);
    expect(hasMasteryRequirements(emptyMasteries(10), null)).toBe(true);
  });

  it("allows use when the user meets every required mastery", () => {
    const user = {
      ...emptyMasteries(10),
      ninjutsuMastery: 500,
      sageMastery: 200,
    };
    expect(
      hasMasteryRequirements(user, {
        requiredNinjutsuMastery: 500,
        requiredSageMastery: 200,
      }),
    ).toBe(true);
  });

  it("blocks use when any required mastery is below the threshold", () => {
    const user = {
      ...emptyMasteries(10),
      ninjutsuMastery: 499,
    };
    expect(
      hasMasteryRequirements(user, {
        requiredNinjutsuMastery: 500,
      }),
    ).toBe(false);
  });

  it("treats missing masteries as met so masked opponent state does not hide actions", () => {
    expect(
      hasMasteryRequirements(
        {},
        {
          requiredNinjutsuMastery: 500,
        },
      ),
    ).toBe(true);
  });
});

describe("missingMasteryRequirement", () => {
  it("names the unmet mastery so equip errors can quote it", () => {
    const user = { ...emptyMasteries(10), bukijutsuMastery: 100 };
    expect(missingMasteryRequirement(user, { requiredBukijutsuMastery: 500 })).toEqual({
      label: "Bukijutsu Mastery",
      required: 500,
      current: 100,
    });
  });

  it("returns null when every requirement is met", () => {
    expect(
      missingMasteryRequirement(emptyMasteries(500), { requiredSageMastery: 500 }),
    ).toBeNull();
  });

  it("agrees with hasMasteryRequirements", () => {
    const user = { ...emptyMasteries(10), ninjutsuMastery: 499 };
    const reqs = { requiredNinjutsuMastery: 500 };
    expect(hasMasteryRequirements(user, reqs)).toBe(
      missingMasteryRequirement(user, reqs) === null,
    );
  });
});
