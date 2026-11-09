/** Permanent potential and proportional progression rules shared by UI and server. */
import {
  CombatStatNames,
  PET_BASE_STAT,
  PET_POTENTIAL_TIERS,
} from "@/drizzle/constants";
import type { PetSpecies, UserPet } from "@/drizzle/schema";

/** Resolve the public title and bounded cap multiplier for a saved potential. */
export const getPetPotentialTier = (value: number) =>
  PET_POTENTIAL_TIERS.find((tier) => tier.value === value) ?? PET_POTENTIAL_TIERS[0];

/** Normalize the authored weights only within the species' enabled range. */
export const getPetPotentialOdds = (
  species: Pick<
    PetSpecies,
    | "potentialMode"
    | "potentialValue"
    | "potentialMin"
    | "potentialMax"
    | "potentialWeights"
  >,
) => {
  const weights = PET_POTENTIAL_TIERS.map((tier, index) =>
    species.potentialMode === "FIXED"
      ? Number(tier.value === species.potentialValue)
      : tier.value >= species.potentialMin && tier.value <= species.potentialMax
        ? (species.potentialWeights[index] ?? 0)
        : 0,
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return PET_POTENTIAL_TIERS.map((tier, index) => ({
    ...tier,
    chance: total > 0 ? (weights[index] ?? 0) / total : 0,
  }));
};

/** Resolve the roll once before a retried acquisition; revealing never rolls again. */
export const rollPetPotential = (
  species: Parameters<typeof getPetPotentialOdds>[0],
  roll = Math.random(),
) => {
  let remaining = roll;
  const odds = getPetPotentialOdds(species).filter((tier) => tier.chance > 0);
  for (const tier of odds) {
    remaining -= tier.chance;
    if (remaining < 0) return tier.value;
  }
  return odds.at(-1)?.value ?? 1;
};

/** Unrevealed rolls use baseline caps so training and battles cannot reveal the saved result. */
export const getPetPotentialMultiplier = (pet: {
  potentialValue?: number | null;
  potentialRevealed?: boolean;
}) =>
  getPetPotentialTier(pet.potentialRevealed === false ? 1 : (pet.potentialValue ?? 1))
    .capMultiplier;

/** Preserve the source's stat proportions above innate starting stats when moving assigned XP. */
export const getPetTransferStats = (
  pet: Pick<UserPet, (typeof CombatStatNames)[number] | "experience">,
  amount: number,
) => {
  const ratio = pet.experience > 0 ? (pet.experience - amount) / pet.experience : 0;
  return Object.fromEntries(
    CombatStatNames.map((stat) => [
      stat,
      PET_BASE_STAT + Math.max(0, pet[stat] - PET_BASE_STAT) * ratio,
    ]),
  ) as Pick<UserPet, (typeof CombatStatNames)[number]>;
};
