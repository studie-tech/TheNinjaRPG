import { describe, expect, it } from "bun:test";
import {
  CRAFTING_RANKS,
  CRAFTING_REQUIRED_EXP,
  GATHERING_RANKS,
  GATHERING_REQUIRED_EXP,
} from "@/drizzle/constants";
import {
  getNextRank,
  getNextRankExperience,
  getRankForExperience,
  getRankProgress,
} from "@/libs/occupationRank";

describe("occupation rank ladder", () => {
  it("returns the highest rank whose threshold is met", () => {
    expect(getRankForExperience(GATHERING_RANKS, GATHERING_REQUIRED_EXP, 0)).toBe(
      "D RANK",
    );
    expect(
      getRankForExperience(
        GATHERING_RANKS,
        GATHERING_REQUIRED_EXP,
        GATHERING_REQUIRED_EXP["C RANK"],
      ),
    ).toBe("C RANK");
    expect(
      getRankForExperience(
        CRAFTING_RANKS,
        CRAFTING_REQUIRED_EXP,
        CRAFTING_REQUIRED_EXP.FORGEMASTER + 1,
      ),
    ).toBe("FORGEMASTER");
  });

  it("falls back to the lowest rank below every threshold", () => {
    expect(getRankForExperience(GATHERING_RANKS, GATHERING_REQUIRED_EXP, -1)).toBe(
      "NONE",
    );
    expect(getRankForExperience(CRAFTING_RANKS, CRAFTING_REQUIRED_EXP, -1)).toBe(
      "NOVICE",
    );
  });

  it("stops at the top of the ladder", () => {
    expect(getNextRank(CRAFTING_RANKS, "NOVICE")).toBe("APPRENTICE");
    expect(getNextRank(CRAFTING_RANKS, "FORGEMASTER")).toBeNull();
    expect(getNextRankExperience(CRAFTING_RANKS, CRAFTING_REQUIRED_EXP, "MASTER")).toBe(
      CRAFTING_REQUIRED_EXP.FORGEMASTER,
    );
    expect(
      getNextRankExperience(CRAFTING_RANKS, CRAFTING_REQUIRED_EXP, "FORGEMASTER"),
    ).toBeNull();
  });

  it("reports progress between thresholds with the next rank's name", () => {
    const halfway =
      (GATHERING_REQUIRED_EXP["C RANK"] + GATHERING_REQUIRED_EXP["B RANK"]) / 2;
    expect(getRankProgress(GATHERING_RANKS, GATHERING_REQUIRED_EXP, halfway)).toEqual({
      progress: 50,
      nextRank: "B RANK",
      nextRankExperience: GATHERING_REQUIRED_EXP["B RANK"],
    });
    expect(
      getRankProgress(
        GATHERING_RANKS,
        GATHERING_REQUIRED_EXP,
        GATHERING_REQUIRED_EXP["S RANK"],
      ),
    ).toEqual({ progress: 100, nextRank: null, nextRankExperience: null });
  });
});
