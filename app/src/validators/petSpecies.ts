import { z } from "zod";
import {
  BasicElementName,
  PET_ABILITY_SLOTS_BY_RARITY,
  PET_MAX_ABILITY_SLOTS,
  PET_POTENTIAL_TIERS,
  PET_RANKS,
  PetPotentialModes,
  PetRarities,
  PetRoles,
  PetSkillTargets,
} from "@/drizzle/constants";
import {
  AllTags,
  rejectActivityBonuses,
  SuperRefineEffects,
  SuperRefinePassiveEffects,
} from "@/validators/combat";
import { petAiProfileSchema } from "@/validators/pets";

/**
 * Each innate passive chooses its recipients independently of the other tags.
 * Omitted recipients resolve to SELF in the editor and during battle initiation.
 */
export const PetSpeciesEffect = AllTags.and(
  z.object({ skillTarget: z.enum(PetSkillTargets).optional() }),
);
export type ZodPetSpeciesEffect = z.infer<typeof PetSpeciesEffect>;

/** Authored species identity, acquisition rarity and owner-editable starting behavior. */
export const PetSpeciesValidator = z
  .object({
    name: z.string().trim().min(1).max(191),
    description: z.string().trim().min(1).max(1000),
    artDirection: z
      .string()
      .trim()
      .max(1000)
      .nullable()
      .default(null)
      .transform((value) => value || null),
    rankConcepts: z
      // Sparse form arrays send unfilled ranks as undefined/null; treat them as blank.
      .array(
        z
          .string()
          .trim()
          .max(1000)
          .nullish()
          .transform((concept) => concept ?? ""),
      )
      .max(PET_RANKS.length)
      // Trailing blank ranks fall back to the defaults, so they are not stored.
      .transform((concepts) => {
        const kept = [...concepts];
        while (kept.length && !kept[kept.length - 1]) kept.pop();
        return kept;
      })
      .default([]),
    potentialMode: z.enum(PetPotentialModes).default("FIXED"),
    potentialValue: z.coerce.number().int().min(1).max(5).default(1),
    potentialMin: z.coerce.number().int().min(1).max(5).default(1),
    potentialMax: z.coerce.number().int().min(1).max(5).default(5),
    potentialWeights: z
      .array(z.coerce.number().min(0).max(1_000_000))
      .length(5)
      .default(PET_POTENTIAL_TIERS.map((tier) => tier.weight)),
    rarity: z.enum(PetRarities),
    role: z.enum(PetRoles).default("ASSAULT"),
    preferredDamageElement: z.enum(BasicElementName).nullable().default(null),
    isActive: z.boolean(),
    defaultJutsuIds: z
      .array(z.string().min(1).max(191))
      .max(PET_MAX_ABILITY_SLOTS)
      .default([]),
    aiRules: petAiProfileSchema.shape.rules.default([]),
    includeDefaultRules: petAiProfileSchema.shape.includeDefaultRules.default(true),
    effects: z
      .array(PetSpeciesEffect)
      .superRefine(SuperRefineEffects)
      .superRefine(SuperRefinePassiveEffects)
      .superRefine(rejectActivityBonuses)
      .superRefine((effects, ctx) => {
        // Innate skills have no selected empty-ground destination.
        effects.forEach((effect, index) => {
          if (effect.type === "barrier" || effect.type === "move") {
            ctx.addIssue({
              code: "custom",
              path: [index, "type"],
              message: `${effect.type === "barrier" ? "Barrier" : "Move"} tags require an empty-ground combat action.`,
            });
          }
        });
      })
      .default([]),
  })
  .superRefine((species, ctx) => {
    if (
      species.potentialMode === "RANDOM" &&
      (species.potentialMin > species.potentialMax ||
        !species.potentialWeights.some(
          (weight, index) =>
            weight > 0 &&
            index + 1 >= species.potentialMin &&
            index + 1 <= species.potentialMax,
        ))
    )
      ctx.addIssue({
        code: "custom",
        path: ["potentialMin"],
        message:
          "Choose an ordered potential range with at least one positive roll weight.",
      });
    if (new Set(species.defaultJutsuIds).size !== species.defaultJutsuIds.length) {
      ctx.addIssue({
        code: "custom",
        path: ["defaultJutsuIds"],
        message: "Choose each default pet jutsu only once.",
      });
    }
    if (species.defaultJutsuIds.length > PET_ABILITY_SLOTS_BY_RARITY[species.rarity]) {
      ctx.addIssue({
        code: "custom",
        path: ["defaultJutsuIds"],
        message: "The default loadout exceeds this rarity's jutsu slots.",
      });
    }
  });

export type ZodPetSpeciesType = z.infer<typeof PetSpeciesValidator>;
export type ZodPetSpeciesInput = z.input<typeof PetSpeciesValidator>;
