import { describe, expect, it } from "bun:test";
import { CombatStatNames, getCombatStatCap, getUserCaps, PET_BASE_STAT, PET_POTENTIAL_TIERS, PET_RANKS } from "@/drizzle/constants";
import { createPetFromSpecies } from "@/libs/pets/creation";
import { getPetPotentialOdds, getPetPotentialTier, getPetTransferStats, rollPetPotential } from "@/libs/pets/potential";
import { getPetStatCaps } from "@/libs/pets/progression";
import { calcLevelRequirements } from "@/libs/profile";
import { PetSpeciesValidator } from "@/validators/petSpecies";
import { petSpeciesFixture } from "./helpers/species";

describe("companion potential", () => {
  it("normalizes authored weights only within the configured range", () => {
    const species = petSpeciesFixture({ potentialMode: "RANDOM", potentialMin: 3, potentialMax: 5 });
    const odds = getPetPotentialOdds(species);
    expect(odds.map((tier) => tier.chance)).toEqual([0, 0, 20 / 32, 10 / 32, 2 / 32]);
    expect(rollPetPotential(species, 0)).toBe(3);
    expect(rollPetPotential(species, 20 / 32)).toBe(4);
    expect(rollPetPotential(species, 0.999999)).toBe(5);
    expect(PetSpeciesValidator.safeParse({ ...species, potentialMin: 5, potentialMax: 1 }).success).toBe(false);
    expect(PetSpeciesValidator.safeParse({ ...species, potentialWeights: [1, 1, 0, 0, 0] }).success).toBe(false);
    expect(PetSpeciesValidator.safeParse({ ...species, potentialValue: 6 }).success).toBe(false);
  });
  it("persists fixed and hidden random potential at acquisition", () => {
    const args = { user: { userId: "owner", rank: "GENIN" as const }, jutsus: [] };
    expect(createPetFromSpecies({ ...args, species: petSpeciesFixture({ potentialValue: 4 }) })).toMatchObject({ potentialValue: 4, potentialRevealed: true });
    expect(createPetFromSpecies({ ...args, species: petSpeciesFixture({ potentialMode: "RANDOM", potentialMin: 5, potentialMax: 5 }) })).toMatchObject({ potentialValue: 5, potentialRevealed: false });
  });
  it.each(PET_RANKS)("keeps every stat at rank $rank between baseline and fifty percent extra", ({ rank, minUserRank }) => {
    const baseline = getUserCaps(minUserRank);
    for (const tier of PET_POTENTIAL_TIERS) {
      const caps = getPetStatCaps({ rank, potentialValue: tier.value, potentialRevealed: true });
      for (const stat of CombatStatNames) {
        const baseCap = getCombatStatCap(baseline, stat);
        expect(caps[stat]).toBe(Math.floor(baseCap * tier.capMultiplier));
        expect(caps[stat]).toBeGreaterThanOrEqual(baseCap);
        expect(caps[stat]).toBeLessThanOrEqual(baseCap * 1.5);
      }
      expect(caps.offence / caps.strength).toBeCloseTo(baseline.stats_cap / baseline.gens_cap, 4);
    }
  });
  it("cannot leak hidden rolls through training caps and falls back safely for invalid tiers", () => {
    for (const potentialValue of [0, 1, 2, 3, 4, 5, 6, NaN, Infinity]) {
      expect(getPetStatCaps({ rank: 10, potentialValue, potentialRevealed: false })).toEqual(getPetStatCaps({ rank: 10 }));
    }
    expect(getPetPotentialTier(100).capMultiplier).toBe(1);
  });
  it("lets baseline potential reach every evolution and the final level through trainable XP", () => {
    for (const rank of PET_RANKS) {
      const caps = getPetStatCaps({ rank: rank.rank, potentialValue: 1, potentialRevealed: true });
      const trainableExperience = CombatStatNames.reduce((sum, stat) => sum + caps[stat] - PET_BASE_STAT, 0);
      const next = PET_RANKS.find((entry) => entry.rank === rank.rank + 1);
      expect(trainableExperience).toBeGreaterThanOrEqual(next?.experienceRequired ?? calcLevelRequirements(rank.levelCap - 1));
    }
  });
  it("reduces trained gains proportionally while preserving innate stats", () => {
    const stats = getPetTransferStats({ experience: 1000, offence: 610, defence: 110, strength: 310, speed: 10, intelligence: 10, willpower: 10 }, 700);
    expect(stats).toEqual({ offence: 190, defence: 40, strength: 100, speed: 10, intelligence: 10, willpower: 10 });
  });
});
