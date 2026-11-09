import { describe, expect, it } from "bun:test";
import { PET_AURAS, PET_CHARACTERISTICS, PET_PALETTES } from "@/libs/pets/catalogue";
import { createPetFromSpecies } from "@/libs/pets/creation";
import { AiRule } from "@/validators/ai";
import { petJutsuFixture } from "./helpers/abilities";
import { petSpeciesFixture } from "./helpers/species";

const user = { userId: "companion-owner", rank: "GENIN" as const };

describe("companion initialization from authored species", () => {
  it("creates distinct owned identities and bounded cosmetic traits without cloning an avatar", () => {
    const species = petSpeciesFixture();
    const first = createPetFromSpecies({ species, user, jutsus: [] });
    const second = createPetFromSpecies({ species, user, jutsus: [] });
    expect(first.id).not.toBe(second.id);
    expect(first).toMatchObject({
      userId: user.userId,
      speciesId: species.id,
      name: species.name,
    });
    for (const pet of [first, second]) {
      expect(pet.paletteIndex).toBeGreaterThanOrEqual(0);
      expect(pet.paletteIndex).toBeLessThan(PET_PALETTES.length);
      expect(pet.characteristicIndex).toBeGreaterThanOrEqual(0);
      expect(pet.characteristicIndex).toBeLessThan(PET_CHARACTERISTICS.length);
      expect(pet.auraIndex).toBeGreaterThanOrEqual(0);
      expect(pet.auraIndex).toBeLessThan(PET_AURAS.length);
      expect(pet.avatar).toBeUndefined();
    }
  });

  it("copies staff AI and only usable published defaults within initial rank and budget", () => {
    const rules = [AiRule.parse({ conditions: [], action: { type: "end_turn" } })];
    const jutsus = [
      petJutsuFixture(),
      petJutsuFixture({ id: "pvp", battleUsageType: "PVP" }),
      petJutsuFixture({ id: "hidden", hidden: true }),
      petJutsuFixture({ id: "human", jutsuType: "NORMAL" }),
      petJutsuFixture({ id: "advanced", requiredLevel: 2 }),
    ];
    const species = petSpeciesFixture({
      defaultJutsuIds: jutsus.map((entry) => entry.id),
      aiRules: rules,
      includeDefaultRules: false,
    });
    const appearance = { paletteIndex: 1, characteristicIndex: 2, auraIndex: 3 };
    const pet = createPetFromSpecies({
      species,
      user,
      jutsus,
      name: "Nami",
      appearance,
    });
    expect(pet).toMatchObject({
      ...appearance,
      name: "Nami",
      jutsuIds: ["pet-strike"],
      aiRules: rules,
      includeDefaultRules: false,
    });
    species.aiRules[0]!.conditions.push({
      type: "health_below",
      value: 50,
      description: "Low health",
    });
    expect(pet.aiRules?.[0]?.conditions).toEqual([]);
  });

  it("uses a valid editable fallback when an authored species name exceeds player name limits", () => {
    const pet = createPetFromSpecies({
      species: petSpeciesFixture({ name: "Long ".repeat(20) }),
      user,
      jutsus: [],
    });
    expect(pet.name).toBe("Companion");
  });
});
