import { describe, expect, it } from "vitest";
import type { MasteryName } from "@/drizzle/constants";
import { getUserCaps, MasteryNames } from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import { hasMasteryRequirements } from "@/libs/mastery";
import { getSoftCappedExperience } from "@/libs/profile";

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

describe("getSoftCappedExperience", () => {
  it("counts only offence, defence, and the four generals", () => {
    const { stats_cap, gens_cap } = getUserCaps("JONIN");
    expect(getSoftCappedExperience({ rank: "JONIN" } as UserData)).toBe(
      2 * stats_cap + 4 * gens_cap,
    );
  });

  it("does not include mastery caps in the experience ceiling", () => {
    const { stats_cap, gens_cap, mastery_cap } = getUserCaps("JONIN");
    const softCap = getSoftCappedExperience({ rank: "JONIN" } as UserData);
    expect(softCap).toBeLessThan(2 * stats_cap + 4 * gens_cap + mastery_cap);
  });
});
