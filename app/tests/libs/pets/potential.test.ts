import { describe, expect, it } from "bun:test";
import { PET_POTENTIAL_BASE_CAP, PET_POTENTIAL_STAT_BONUS } from "@/drizzle/constants";
import { createPetFromSpecies } from "@/libs/pets/creation";
import { getPetPotentialCaps, getPetPotentialOdds, getPetPotentialTier, getPetTransferStats, rollPetPotential } from "@/libs/pets/potential";
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
  it("stacks points on an individual stat independently of rank and limits tier HP", () => {
    const caps = getPetPotentialCaps({ potentialAllocations: { offence: 3, speed: 2 } });
    expect(caps.offence).toBe(PET_POTENTIAL_BASE_CAP + 3 * PET_POTENTIAL_STAT_BONUS);
    expect(caps.speed).toBe(PET_POTENTIAL_BASE_CAP + 2 * PET_POTENTIAL_STAT_BONUS);
    expect(caps.defence).toBe(PET_POTENTIAL_BASE_CAP);
    expect([1, 2, 3, 4, 5].map((value) => getPetPotentialTier(value).hpCap)).toEqual([4000, 5000, 6000, 7000, 8000]);
  });
  it("reduces trained gains proportionally while preserving innate stats", () => {
    const stats = getPetTransferStats({ experience: 1000, offence: 610, defence: 110, strength: 310, speed: 10, intelligence: 10, willpower: 10 }, 700);
    expect(stats).toEqual({ offence: 190, defence: 40, strength: 100, speed: 10, intelligence: 10, willpower: 10 });
  });
});
