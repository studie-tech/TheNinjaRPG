/** One initialization path keeps sanctuary and reward companions individually owned and configurable. */
import { nanoid } from "nanoid";
import type { PetGender } from "@/drizzle/constants";
import type { Jutsu, PetSpecies, UserData, UserPetInsert } from "@/drizzle/schema";
import { selectPetBattleAbilities } from "@/libs/pets/abilities";
import { PET_AURAS, PET_CHARACTERISTICS, PET_PALETTES } from "@/libs/pets/catalogue";
import { getPetPotentialOdds, rollPetPotential } from "@/libs/pets/potential";
import { randomInt } from "@/utils/math";
import { petNameSchema } from "@/validators/pets";

/** Freeze identity, cosmetics and usable Content defaults once before a retried grant. */
export const createPetFromSpecies = ({
  species,
  user,
  jutsus,
  name,
  gender,
  appearance,
}: {
  species: PetSpecies;
  user: Pick<UserData, "userId" | "rank">;
  jutsus: Jutsu[];
  name?: string;
  gender?: PetGender | null;
  appearance?: { paletteIndex: number; characteristicIndex: number; auraIndex: number };
}): UserPetInsert => {
  const defaults = selectPetBattleAbilities({
    pet: {
      rank: 1,
      experience: 0,
      species,
      jutsuIds: species.defaultJutsuIds,
      skillIds: [],
    },
    owner: user,
    jutsus,
    skills: [],
  });
  // Species names may exceed the player's shorter, editable companion-name limit.
  const parsedName = petNameSchema.safeParse(name ?? species.name);
  return {
    id: nanoid(),
    userId: user.userId,
    speciesId: species.id,
    potentialValue: rollPetPotential(species),
    potentialChances: getPetPotentialOdds(species).map((tier) => tier.chance),
    potentialRevealed: species.potentialMode !== "RANDOM",
    name: parsedName.success ? parsedName.data : "Companion",
    paletteIndex: appearance?.paletteIndex ?? randomInt(0, PET_PALETTES.length - 1),
    characteristicIndex:
      appearance?.characteristicIndex ?? randomInt(0, PET_CHARACTERISTICS.length - 1),
    auraIndex: appearance?.auraIndex ?? randomInt(0, PET_AURAS.length - 1),
    gender: gender ?? null,
    jutsuIds: defaults.jutsus.map((entry) => entry.id),
    aiRules: structuredClone(species.aiRules),
    includeDefaultRules: species.includeDefaultRules,
  };
};
