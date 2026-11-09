import { describe, expect, it } from "bun:test";
import { PET_RANKS } from "@/drizzle/constants";
import {
  canChoosePetAppearance,
  canUsePet,
  getMaxPetRank,
  getPetLevel,
  getPetPaymentOption,
  petRankUpBlockMessage,
} from "@/libs/pets/progression";
import { calcLevelRequirements } from "@/libs/profile";

describe("companion progression", () => {
  it("lets only an imageless founder choose its appearance", () => {
    const founder = { rank: 1, artRank: 0, avatar: null };
    expect(canChoosePetAppearance(founder)).toBe(true);
    expect(canChoosePetAppearance({ ...founder, rank: 2 })).toBe(false);
    expect(canChoosePetAppearance({ ...founder, artRank: 1 })).toBe(false);
    expect(canChoosePetAppearance({ ...founder, avatar: "avatar.webp" })).toBe(false);
  });

  it("describes a purchase in the chosen currency", () => {
    const user = { reputationPoints: 7, seichiSilver: 3 };
    const costs = { reputation: 20, silver: 50 };
    expect(getPetPaymentOption("REPUTATION", user, costs)).toEqual({
      cost: 20,
      balance: 7,
      label: "reputation",
    });
    expect(getPetPaymentOption("SEICHI_SILVER", user, costs)).toEqual({
      cost: 50,
      balance: 3,
      label: "Seichi Silver",
    });
    expect(getPetPaymentOption("SEICHI_SILVER", undefined, costs).balance).toBe(0);
  });

  const ready = {
    rank: 1,
    experience: 7500,
    generationStatus: "READY" as const,
    generationStartedAt: null,
    artRank: 1,
    avatar: "/accepted-pet.webp",
    battleEnabled: true,
  };

  it("enforces the exact owner rank hierarchy and accepted current art", () => {
    expect(
      ["STUDENT", "GENIN", "CHUNIN", "JONIN", "ELITE JONIN", "ELDER", "NONE"].map(
        (rank) => getMaxPetRank(rank as Parameters<typeof getMaxPetRank>[0]),
      ),
    ).toEqual([1, 3, 5, 7, 10, 7, 0]);
    expect(PET_RANKS.some((entry) => (entry.minUserRank as string) === "ELDER")).toBe(
      false,
    );
    expect(PET_RANKS.at(-1)?.minUserRank).toBe("ELITE JONIN");
    expect(
      petRankUpBlockMessage(
        { ...ready, rank: 7, artRank: 7, experience: 637500 },
        { rank: "ELDER" },
      ),
    ).toContain("ELITE JONIN");
    expect(
      petRankUpBlockMessage(
        { ...ready, rank: 9, artRank: 9, experience: 1620000 },
        { rank: "ELITE JONIN" },
      ),
    ).toBeNull();
    expect(canUsePet(ready, { rank: "STUDENT" })).toBe(true);
    expect(canUsePet({ ...ready, rank: 2, artRank: 2 }, { rank: "STUDENT" })).toBe(
      false,
    );
    expect(
      canUsePet({ ...ready, generationStatus: "GENERATING" }, { rank: "GENIN" }),
    ).toBe(true);
    expect(
      canUsePet(
        { ...ready, generationStatus: "GENERATING", artRank: 0 },
        { rank: "GENIN" },
      ),
    ).toBe(false);
    expect(canUsePet({ ...ready, artRank: 0 }, { rank: "GENIN" })).toBe(false);
    expect(canUsePet({ ...ready, battleEnabled: false }, { rank: "GENIN" })).toBe(
      false,
    );
    expect(canUsePet({ ...ready, avatar: null }, { rank: "GENIN" })).toBe(false);
  });

  it("shares the level curve and requires a finished form before another rank", () => {
    expect(getPetLevel({ rank: 1, experience: 0 })).toBe(1);
    expect(getPetLevel({ rank: 1, experience: calcLevelRequirements(1) })).toBe(2);
    expect(getPetLevel({ rank: 1, experience: 1_000_000 })).toBe(5);
    for (let index = 1; index < PET_RANKS.length; index++)
      expect(Number(PET_RANKS[index]!.experienceRequired)).toBe(
        calcLevelRequirements(PET_RANKS[index - 1]!.levelCap),
      );
    expect(petRankUpBlockMessage(ready, { rank: "STUDENT" })).toContain("GENIN");
    expect(petRankUpBlockMessage(ready, { rank: "GENIN" })).toBeNull();
    expect(
      petRankUpBlockMessage({ ...ready, experience: 7499 }, { rank: "GENIN" }),
    ).toContain("experience");
    expect(
      petRankUpBlockMessage({ ...ready, artRank: 0 }, { rank: "GENIN" }),
    ).toContain("appearance");
    expect(
      petRankUpBlockMessage(
        { ...ready, generationStatus: "GENERATING", generationStartedAt: new Date() },
        { rank: "GENIN" },
      ),
    ).toContain("appearance");
  });
});
