import { describe, expect, it } from "bun:test";
import type { UserData } from "@/drizzle/schema";
import { getReducedGainsDays } from "@/libs/train";

const DAY = 86_400_000;

const makeUser = (rank: UserData["rank"], createdAgoMs: number, joinedAgoMs: number) =>
  ({
    rank,
    createdAt: new Date(Date.now() - createdAgoMs),
    joinedVillageAt: new Date(Date.now() - joinedAgoMs),
  }) as UserData;

describe("getReducedGainsDays", () => {
  it("does not slow a new chunin who never changed village", () => {
    expect(getReducedGainsDays(makeUser("CHUNIN", DAY, DAY))).toBe(0);
  });

  it("slows a chunin who switched village recently", () => {
    const days = getReducedGainsDays(makeUser("CHUNIN", 30 * DAY, DAY));
    expect(days).toBeGreaterThan(5);
    expect(days).toBeLessThan(7);
  });

  it("does not slow ranks below the leave-village rank", () => {
    expect(getReducedGainsDays(makeUser("GENIN", 30 * DAY, DAY))).toBe(0);
  });

  it("keeps the penalty when createdAt is not loaded", () => {
    const user = {
      rank: "CHUNIN",
      joinedVillageAt: new Date(Date.now() - DAY),
    } as UserData;
    expect(getReducedGainsDays(user)).toBeGreaterThan(0);
  });
});
