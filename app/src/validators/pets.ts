/** Shared pet request contracts and structured image-review output; routers enforce live ownership. */
import { z } from "zod";
import {
  AI_PROFILE_MAX_RULES,
  AvatarFacings,
  PET_MAX_ABILITY_SLOTS,
  PetGenders,
  PetPaymentCurrencies,
  PetSpawnPositions,
} from "@/drizzle/constants";
import { PET_AURAS, PET_CHARACTERISTICS, PET_PALETTES } from "@/libs/pets/catalogue";
import { AiRule } from "@/validators/ai";
import { createStatSchema } from "@/validators/combat";

/** Address a saved companion; authorization is resolved from the authenticated owner. */
export const petSelectionSchema = z.object({ petId: z.string().min(1).max(191) });
/** Purchases debit only the chosen balance; existing callers default to reputation. */
export const petPaymentSchema = z.object({
  currency: z.enum(PetPaymentCurrencies).default("REPUTATION"),
});
/** Include the displayed stack quantity so a changed meal stack must be refreshed before consumption. */
export const feedPetSchema = petSelectionSchema.extend({
  userItemId: z.string().min(1).max(191),
  expectedQuantity: z.number().int().positive(),
});
/** Bound request size; owner access, duplicates and the combined budget are validated against live content. */
export const updatePetAbilitiesSchema = petSelectionSchema.extend({
  jutsuIds: z.array(z.string().min(1).max(191)).max(PET_MAX_ABILITY_SLOTS),
  skillIds: z.array(z.string().min(1).max(191)).max(PET_MAX_ABILITY_SLOTS),
});

/** Player-visible name only; controls and invisible formatting characters are rejected. */
export const petNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .refine(
    (name) => !/[\p{Cc}\p{Cf}]/u.test(name),
    "Pet names cannot contain control characters.",
  );

/** Catalogue bounds are structural; the router also verifies the UTC day and its offered choices. */
export const acquirePetSchema = petPaymentSchema.extend({
  name: petNameSchema,
  gender: z.enum(PetGenders, {
    message: "Choose whether your companion is male or female.",
  }),
  dayKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  speciesId: z.string().min(1).max(191),
  paletteIndex: z
    .number()
    .int()
    .min(0)
    .max(PET_PALETTES.length - 1),
  characteristicIndex: z
    .number()
    .int()
    .min(0)
    .max(PET_CHARACTERISTICS.length - 1),
  auraIndex: z
    .number()
    .int()
    .min(0)
    .max(PET_AURAS.length - 1),
});

/** Only founders without accepted artwork can choose daily cosmetics. */
export const generatePetAppearanceSchema = petSelectionSchema.extend({
  appearance: acquirePetSchema
    .pick({
      dayKey: true,
      paletteIndex: true,
      characteristicIndex: true,
      auraIndex: true,
    })
    .optional(),
});

/** Partial settings update that must supply at least one field besides the companion ID. */
export const updatePetSchema = z
  .object({
    petId: petSelectionSchema.shape.petId,
    name: petNameSchema.optional(),
    battleEnabled: z.boolean().optional(),
    spawnPosition: z.enum(PetSpawnPositions).optional(),
    // Temporary: the router rejects this after PET_GENDER_EDIT_UNTIL.
    gender: z.enum(PetGenders).optional(),
  })
  .refine((input) => Object.keys(input).length > 1, "Choose a setting to update.");

/** Reuse the player form's six combat stats; the router checks the pet's live caps and XP bank. */
export const assignPetExperienceSchema = createStatSchema(0, 0).schema.extend(
  petSelectionSchema.shape,
);

/** Visual quality is separate from content safety; domain acceptance requires every check to pass. */
export const petAppearanceQualitySchema = z.object({
  singleAnimal: z.boolean(),
  anatomyCorrect: z.boolean(),
  speciesMatches: z.boolean(),
  completeBody: z.boolean(),
  noGroundOrScene: z.boolean(),
  identityPreserved: z.boolean(),
  evolutionStronger: z.boolean(),
  avatarFacing: z.enum(AvatarFacings),
  reason: z.string().min(1).max(600),
});

/** Supported subset of the shared AI editor/executor for independently acting pets. */
export const PET_AI_ACTION_TYPES = [
  "move_towards_opponent",
  "end_turn",
  "use_highest_power_action",
] as const;
/** Effects a pet may request through the highest-power action selector. */
export const PET_AI_EFFECT_TYPES = [
  "damage",
  "heal",
  "shield",
  "increasestat",
  "decreasestat",
  "increasedamagegiven",
  "decreasedamagegiven",
  "increasedamagetaken",
  "decreasedamagetaken",
  "cleanse",
  "clear",
  "move",
] as const;

/** Content defaults and owner instructions share the same supported combat behavior. */
export const petAiProfileSchema = z.object({
  rules: z
    .array(AiRule)
    .max(AI_PROFILE_MAX_RULES)
    .superRefine((rules, ctx) => {
      rules.forEach((rule, index) => {
        const action = rule.action;
        if (!PET_AI_ACTION_TYPES.some((type) => type === action.type)) {
          ctx.addIssue({
            code: "custom",
            path: [index, "action"],
            message: "Choose a supported pet AI action.",
          });
        }
        if (
          action.type === "use_highest_power_action" &&
          !PET_AI_EFFECT_TYPES.some((effect) => effect === action.effect)
        ) {
          ctx.addIssue({
            code: "custom",
            path: [index, "action", "effect"],
            message: "Choose an effect available to pets.",
          });
        }
      });
    }),
  includeDefaultRules: z.boolean(),
});

/** Owner authorization is resolved separately from the shared instruction contract. */
export const updatePetAiSchema = petAiProfileSchema.extend(petSelectionSchema.shape);
