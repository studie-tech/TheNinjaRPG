import { describe, expect, it } from "bun:test";
import {
  type FederalStatus,
  FederalStatuses,
  PET_OPTION_COUNTS,
  PET_SPECIES_RARITY_WEIGHTS,
  PetRarities,
} from "@/drizzle/constants";
import {
  getDailyPetOptions,
  isAvailablePetAppearance,
  PET_AURAS,
  PET_CHARACTERISTICS,
  PET_PALETTES,
} from "@/libs/pets/catalogue";
import { getUtcDayKey } from "@/utils/time";
import { acquirePetSchema } from "@/validators/pets";
import { initialPetSpecies } from "./helpers/species";

describe("companion species rarity", () => {
  it("keeps daily offerings stable when database results arrive in another order", () => {
    const expected = getDailyPetOptions(
      "catalogue-owner",
      "GOLD",
      initialPetSpecies,
      "2026-10-16",
    );
    expect(
      getDailyPetOptions(
        "catalogue-owner",
        "GOLD",
        [...initialPetSpecies].reverse(),
        "2026-10-16",
      ),
    ).toEqual(expected);
  });

  it("offers newly authored species, retires them without deleting identities and supports reactivation", () => {
    const authored = [
      {
        id: "new-fox",
        name: "Spirit fox",
        description: "A fox with translucent ears",
        rarity: "RARE" as const,
        isActive: true,
      },
      {
        id: "new-owl",
        name: "Moon owl",
        description: "An owl with silver plumage",
        rarity: "LEGENDARY" as const,
        isActive: true,
      },
    ];
    const roll = (catalogue: typeof authored) =>
      getDailyPetOptions("catalogue-owner", "GOLD", catalogue, "2026-10-16");
    expect(
      roll(authored)
        .species.map(({ id }) => id)
        .sort(),
    ).toEqual(["new-fox", "new-owl"]);
    expect(
      roll(
        authored.map((species) =>
          species.id === "new-owl" ? { ...species, isActive: false } : species,
        ),
      ).species,
    ).toEqual([authored[0]!]);
    expect(roll(authored).species).toHaveLength(2);
    expect(roll([]).species).toEqual([]);
  });

  it("keeps every tier's complete species menu when a subscription upgrades", () => {
    let previous = getDailyPetOptions(
      "rarity-contract-player",
      "NONE",
      initialPetSpecies,
      "2026-10-16",
    );
    for (const tier of FederalStatuses) {
      const current = getDailyPetOptions(
        "rarity-contract-player",
        tier,
        initialPetSpecies,
        "2026-10-16",
      );
      expect(current.species).toHaveLength(PET_OPTION_COUNTS[tier]);
      expect(current.species.slice(0, previous.species.length)).toEqual(
        previous.species,
      );
      expect(new Set(current.species.map(({ id }) => id)).size).toBe(
        current.species.length,
      );
      previous = current;
    }
  });

  it("defines valid basis-point odds for every selectable rarity", () => {
    for (const tier of FederalStatuses) {
      const weights = PET_SPECIES_RARITY_WEIGHTS[tier];
      expect(Object.values(weights).reduce((sum, weight) => sum + weight, 0)).toBe(
        10_000,
      );
      expect(
        PetRarities.every(
          (rarity) => Number.isInteger(weights[rarity]) && weights[rarity] > 0,
        ),
      ).toBe(true);
    }
  });

  it("continues offering unique animals after a rarity bucket is exhausted", () => {
    // Two legendary choices exercise exhaustion before the eight-choice menu is full.
    const catalogue = initialPetSpecies.filter(({ name }) => name !== "Phoenix");
    const { species } = getDailyPetOptions(
      "rarity-cohort-759",
      "GOLD",
      catalogue,
      "2026-10-16",
    );
    expect(
      species.slice(0, 7).filter(({ rarity }) => rarity === "LEGENDARY"),
    ).toHaveLength(2);
    expect(species).toHaveLength(PET_OPTION_COUNTS.GOLD);
    expect(new Set(species.map(({ id }) => id)).size).toBe(species.length);
    expect(species[7]?.rarity).not.toBe("LEGENDARY");
  });

  it("leaves palette, characteristic and aura daily ordering unchanged", () => {
    const choices = getDailyPetOptions(
      "rarity-contract-player",
      "GOLD",
      initialPetSpecies,
      "2026-10-16",
    );
    expect(choices.palettes.map(({ index }) => index)).toEqual([
      14, 12, 30, 5, 19, 10, 17, 2,
    ]);
    expect(choices.characteristics.map(({ index }) => index)).toEqual([
      11, 3, 4, 10, 5, 14, 6, 13,
    ]);
    expect(choices.auras.map(({ index }) => index)).toEqual([2, 4, 1, 7, 6, 3, 0, 5]);
    expect(
      [...choices.palettes, ...choices.characteristics, ...choices.auras].some(
        (option) => "rarity" in option,
      ),
    ).toBe(false);
  });

  it("uses UTC-day/account seeds without accepting a catalogue species outside today's menu", () => {
    const choices = getDailyPetOptions(
      "rarity-contract-player",
      "GOLD",
      initialPetSpecies,
      "2026-10-16",
    );
    expect(choices).toEqual(
      getDailyPetOptions(
        "rarity-contract-player",
        "GOLD",
        initialPetSpecies,
        "2026-10-16",
      ),
    );
    expect(choices.species).not.toEqual(
      getDailyPetOptions("another-player", "GOLD", initialPetSpecies, "2026-10-16")
        .species,
    );
    expect(choices.species).not.toEqual(
      getDailyPetOptions(
        "rarity-contract-player",
        "GOLD",
        initialPetSpecies,
        "2026-10-17",
      ).species,
    );
    const unavailable = initialPetSpecies.find(
      ({ id }) => !choices.species.some((option) => option.id === id),
    );
    if (!unavailable) throw new Error("Expected an unoffered species");
    expect(
      isAvailablePetAppearance(
        {
          speciesId: unavailable.id,
          paletteIndex: choices.palettes[0]!.index,
          characteristicIndex: choices.characteristics[0]!.index,
          auraIndex: choices.auras[0]!.index,
        },
        choices,
      ),
    ).toBe(false);
  });

  it("weights rarity buckets and gives subscriber bonus slots better odds across fixed daily rolls", () => {
    const samples = 2500;
    const firstBonusSlot: Record<FederalStatus, number> = {
      NONE: 0,
      NORMAL: 3,
      SILVER: 5,
      GOLD: 6,
    };
    const commonCounts = { NONE: 0, NORMAL: 0, SILVER: 0, GOLD: 0 };
    const rareMenuCounts = { NONE: 0, NORMAL: 0, SILVER: 0, GOLD: 0 };
    const observedRarities = new Set<string>();
    for (let sample = 0; sample < samples; sample++) {
      const gold = getDailyPetOptions(
        `rarity-cohort-${sample}`,
        "GOLD",
        initialPetSpecies,
        "2026-10-16",
      );
      expect(new Set(gold.species.map(({ id }) => id)).size).toBe(
        PET_OPTION_COUNTS.GOLD,
      );
      for (const option of gold.species) observedRarities.add(option.rarity);
      for (const tier of FederalStatuses) {
        const bonus = gold.species[firstBonusSlot[tier]];
        if (bonus?.rarity === "COMMON") commonCounts[tier]++;
        if (
          gold.species
            .slice(0, PET_OPTION_COUNTS[tier])
            .some(({ rarity }) => ["RARE", "EPIC", "LEGENDARY"].includes(rarity))
        )
          rareMenuCounts[tier]++;
      }
    }
    expect(observedRarities.size).toBe(PetRarities.length);
    for (const tier of FederalStatuses) {
      const weights = PET_SPECIES_RARITY_WEIGHTS[tier];
      const expectedCommonRate =
        weights.COMMON /
        Object.values(weights).reduce((sum, weight) => sum + weight, 0);
      // A fixed cohort checks configured bucket odds, rather than weighting by species count.
      expect(Math.abs(commonCounts[tier] / samples - expectedCommonRate)).toBeLessThan(
        0.04,
      );
    }
    for (let index = 1; index < FederalStatuses.length; index++) {
      const current = FederalStatuses[index]!;
      const previous = FederalStatuses[index - 1]!;
      expect(commonCounts[current]).toBeLessThan(commonCounts[previous]);
      expect(rareMenuCounts[current]).toBeGreaterThan(rareMenuCounts[previous]);
    }
  });
});

describe("companion appearance choices", () => {
  it("offers stable subscriber supersets from an explicit species catalogue", () => {
    expect([PET_PALETTES.length, PET_CHARACTERISTICS.length, PET_AURAS.length]).toEqual(
      [32, 16, 8],
    );
    for (const catalogue of [PET_PALETTES, PET_CHARACTERISTICS, PET_AURAS])
      expect(new Set(catalogue.map(({ name }) => name)).size).toBe(catalogue.length);
    const normal = getDailyPetOptions(
      "one-player",
      "NONE",
      initialPetSpecies,
      "2026-10-11",
    );
    for (const status of ["NONE", "NORMAL", "SILVER", "GOLD"] as const) {
      const choices = getDailyPetOptions(
        "one-player",
        status,
        initialPetSpecies,
        "2026-10-11",
      );
      expect(choices).toEqual(
        getDailyPetOptions("one-player", status, initialPetSpecies, "2026-10-11"),
      );
      for (const key of ["species", "palettes", "characteristics", "auras"] as const) {
        expect(choices[key]).toHaveLength(PET_OPTION_COUNTS[status]);
        expect(choices[key].slice(0, 3)).toEqual(normal[key]);
        expect(
          new Set(
            choices[key].map((option) => ("id" in option ? option.id : option.index)),
          ).size,
        ).toBe(choices[key].length);
      }
    }
    expect(
      getDailyPetOptions("another-player", "NONE", initialPetSpecies, "2026-10-11"),
    ).not.toEqual(normal);
    expect(
      getDailyPetOptions("one-player", "NONE", initialPetSpecies, "2026-10-12"),
    ).not.toEqual(normal);
  });

  it("uses UTC days and rejects an unavailable trait", () => {
    expect(getUtcDayKey(new Date("2026-10-11T23:30:00-05:00"))).toBe("2026-10-12");
    const choices = getDailyPetOptions(
      "player",
      "NONE",
      initialPetSpecies,
      "2026-10-11",
    );
    const selection = {
      speciesId: choices.species[0]!.id,
      paletteIndex: choices.palettes[0]!.index,
      characteristicIndex: choices.characteristics[0]!.index,
      auraIndex: choices.auras[0]!.index,
    };
    expect(isAvailablePetAppearance(selection, choices)).toBe(true);
    const unavailable = initialPetSpecies.find(
      ({ id }) => !choices.species.some((option) => option.id === id),
    )!;
    expect(
      isAvailablePetAppearance({ ...selection, speciesId: unavailable.id }, choices),
    ).toBe(false);
    expect(
      acquirePetSchema.safeParse({
        name: "Kumo",
        dayKey: "2026-10-11",
        ...selection,
        auraIndex: 8,
      }).success,
    ).toBe(false);
  });

  it("removes claimed species without rolling replacements or changing other daily traits", () => {
    const dayKey = "2026-10-18";
    const original = getDailyPetOptions("player", "GOLD", initialPetSpecies, dayKey);
    const speciesIds = [original.species[0]!.id, original.species[3]!.id];
    const remaining = getDailyPetOptions("player", "GOLD", initialPetSpecies, dayKey, {
      dayKey,
      speciesIds,
    });
    expect(remaining).toEqual({
      ...original,
      species: original.species.filter(({ id }) => !speciesIds.includes(id)),
    });
    expect(
      getDailyPetOptions("player", "GOLD", initialPetSpecies, dayKey, {
        dayKey: "2026-10-17",
        speciesIds,
      }),
    ).toEqual(original);
  });
});
