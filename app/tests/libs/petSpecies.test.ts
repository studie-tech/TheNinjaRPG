import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { PET_ABILITY_SLOTS_BY_RARITY, PetRarities } from "@/drizzle/constants";
import { ActionEndTurn } from "@/validators/ai";
import {
  AllTags,
  BarrierTag,
  IncreaseStatTag,
  isActivityBonus,
  MoveTag,
  SummonTag,
  SuperRefineEffects,
  SuperRefinePassiveEffects,
} from "@/validators/combat";
import { PetSpeciesValidator } from "@/validators/petSpecies";
import {
  assignPetExperienceSchema,
  petAiProfileSchema,
  petNameSchema,
  updatePetAiSchema,
} from "@/validators/pets";

const species = {
  name: "Mist fox",
  description: "A fox with silver ears.",
  rarity: "COMMON" as const,
  isActive: true,
};

describe("authored companion species contracts", () => {
  it("defaults optional behavior without changing the author's species identity", () => {
    expect(PetSpeciesValidator.parse(species)).toEqual({
      ...species,
      potentialMode: "FIXED",
      potentialValue: 1,
      potentialMin: 1,
      potentialMax: 5,
      potentialWeights: [70, 50, 20, 10, 2],
      artDirection: null,
      rankConcepts: [],
      preferredDamageElement: null,
      role: "ASSAULT",
      defaultJutsuIds: [],
      aiRules: [],
      includeDefaultRules: true,
      effects: [],
    });
  });

  it("bounds art direction and per-rank concepts, storing blanks as defaults", () => {
    const concepts = [
      "A slim white kit ",
      "",
      "A fox with three flame-tipped tails",
      "",
      "",
    ];
    expect(
      PetSpeciesValidator.parse({
        ...species,
        artDirection: "  A white fox. ",
        rankConcepts: concepts,
      }),
    ).toMatchObject({
      artDirection: "A white fox.",
      rankConcepts: ["A slim white kit", "", "A fox with three flame-tipped tails"],
    });
    expect(
      PetSpeciesValidator.parse({
        ...species,
        artDirection: "   ",
        rankConcepts: ["", " "],
      }),
    ).toMatchObject({
      potentialMode: "FIXED",
      potentialValue: 1,
      potentialMin: 1,
      potentialMax: 5,
      potentialWeights: [70, 50, 20, 10, 2],
      artDirection: null,
      rankConcepts: [],
    });
    expect(
      PetSpeciesValidator.parse({
        ...species,
        rankConcepts: [undefined, null, "A gold neck ornament"],
      }).rankConcepts,
    ).toEqual(["", "", "A gold neck ornament"]);
    expect(
      PetSpeciesValidator.safeParse({
        ...species,
        artDirection: "a".repeat(1000),
        rankConcepts: Array(10).fill("b".repeat(1000)),
      }).success,
    ).toBe(true);
    expect(
      PetSpeciesValidator.safeParse({ ...species, artDirection: "a".repeat(1001) })
        .success,
    ).toBe(false);
    expect(
      PetSpeciesValidator.safeParse({ ...species, rankConcepts: ["b".repeat(1001)] })
        .success,
    ).toBe(false);
    expect(
      PetSpeciesValidator.safeParse({
        ...species,
        rankConcepts: Array(11).fill("concept"),
      }).success,
    ).toBe(false);
  });

  it.each([...PetRarities])(
    "bounds default moves by %s rarity and rejects duplicate selections",
    (rarity) => {
      const defaultJutsuIds = Array.from(
        { length: PET_ABILITY_SLOTS_BY_RARITY[rarity] },
        (_, index) => `pet-jutsu-${index}`,
      );
      expect(
        PetSpeciesValidator.safeParse({ ...species, rarity, defaultJutsuIds }).success,
      ).toBe(true);
      expect(
        PetSpeciesValidator.safeParse({
          ...species,
          rarity,
          defaultJutsuIds: [...defaultJutsuIds, "extra"],
        }).success,
      ).toBe(false);
      expect(
        PetSpeciesValidator.safeParse({
          ...species,
          rarity,
          defaultJutsuIds: ["same", "same"],
        }).success,
      ).toBe(false);
    },
  );

  it("shares supported AI behavior with owner configuration", () => {
    for (const [action, expected] of [
      [ActionEndTurn.parse({}), true],
      [
        { type: "use_highest_power_action", effect: "heal", target: "CLOSEST_ALLY" },
        true,
      ],
      [{ type: "use_specific_item", itemId: "foreign" }, false],
      [{ type: "use_highest_power_action", effect: "summon" }, false],
    ] as const) {
      const profile = {
        rules: [{ conditions: [], action }],
        includeDefaultRules: false,
      };
      expect(petAiProfileSchema.safeParse(profile).success).toBe(expected);
      expect(
        PetSpeciesValidator.safeParse({
          ...species,
          aiRules: profile.rules,
          includeDefaultRules: false,
        }).success,
      ).toBe(expected);
      expect(updatePetAiSchema.safeParse({ ...profile, petId: "owned" }).success).toBe(
        expected,
      );
    }
  });

  it("validates game tags with standard passive targeting and empty-ground requirements", () => {
    const standardEffects = z
      .array(AllTags)
      .superRefine(SuperRefineEffects)
      .superRefine(SuperRefinePassiveEffects);
    for (const schema of AllTags.options) {
      const effect = schema.parse({});
      expect(
        PetSpeciesValidator.safeParse({ ...species, effects: [effect] }).success,
      ).toBe(
        effect.type !== "move" &&
          !isActivityBonus(effect) &&
          standardEffects.safeParse([effect]).success,
      );
    }
    for (const effect of [
      SummonTag.parse({ aiId: "external-ai" }),
      IncreaseStatTag.parse({ elements: ["Fire"], power: 150 }),
    ]) {
      expect(
        PetSpeciesValidator.safeParse({ ...species, effects: [effect] }).success,
      ).toBe(true);
    }
    expect(
      PetSpeciesValidator.safeParse({
        ...species,
        effects: [IncreaseStatTag.parse({ target: "COORDINATES" })],
      }).success,
    ).toBe(false);
    expect(
      PetSpeciesValidator.safeParse({
        ...species,
        effects: [{ ...IncreaseStatTag.parse({}), skillTarget: "ALLIES" }],
      }).success,
    ).toBe(false);
  });

  it("keeps independently selected targets through validation", () => {
    const effects = [
      { ...IncreaseStatTag.parse({}), skillTarget: "SELF" as const },
      { ...IncreaseStatTag.parse({}), skillTarget: "ENEMIES" as const },
    ];
    expect(PetSpeciesValidator.parse({ ...species, effects }).effects).toEqual(effects);
  });

  it.each(["SELF", "ENEMIES"] as const)(
    "rejects barriers and movement without an empty-ground destination in %s species skills",
    (skillTarget) => {
      for (const effect of [
        BarrierTag.parse({ staticAssetPath: "barrier" }),
        MoveTag.parse({}),
      ]) {
        const parsed = PetSpeciesValidator.safeParse({
          ...species,
          effects: [{ ...effect, skillTarget }],
        });
        expect(parsed.success).toBe(false);
        if (!parsed.success)
          expect(parsed.error.issues).toContainEqual(
            expect.objectContaining({
              path: ["effects", 0, "type"],
              message: `${effect.type === "barrier" ? "Barrier" : "Move"} tags require an empty-ground combat action.`,
            }),
          );
      }
    },
  );
});

describe("companion owner input contracts", () => {
  it("restricts names and stat allocations without accepting free-form art prompts", () => {
    expect(petNameSchema.parse("  Kumo  ")).toBe("Kumo");
    expect(petNameSchema.safeParse("Kumo\u202e").success).toBe(false);
    expect(petNameSchema.safeParse("Kumo\n").success).toBe(true);
    expect(petNameSchema.safeParse("Ku\nmo").success).toBe(false);
    expect(
      assignPetExperienceSchema.safeParse({ offence: Number.POSITIVE_INFINITY })
        .success,
    ).toBe(false);
    expect(assignPetExperienceSchema.safeParse({ strength: -1 }).success).toBe(false);
  });

  it("only accepts AI actions and effects supplied by the pet's basic loadout", () => {
    const config = {
      petId: "owned-pet",
      includeDefaultRules: true,
      rules: [
        {
          conditions: [],
          action: { type: "use_highest_power_action", effect: "damage" },
        },
      ],
    };
    expect(updatePetAiSchema.safeParse(config).success).toBe(true);
    expect(
      updatePetAiSchema.safeParse({
        ...config,
        rules: [
          {
            conditions: [],
            action: { type: "use_highest_power_action", effect: "shield" },
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      updatePetAiSchema.safeParse({
        ...config,
        rules: [
          {
            conditions: [],
            action: { type: "use_specific_jutsu", jutsuId: "unowned-jutsu" },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      updatePetAiSchema.safeParse({
        ...config,
        rules: [
          {
            conditions: [],
            action: { type: "use_highest_power_action", effect: "summon" },
          },
        ],
      }).success,
    ).toBe(false);
  });
});
