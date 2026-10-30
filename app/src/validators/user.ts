import { z } from "zod";
import type { BasicElement, LetterRank, QuestType } from "@/drizzle/constants";
import {
  BasicElementName,
  ELEMENTAL_MASTERY_CAP,
  GeneralTypes,
  MAX_MASTERY_CAP,
  MAX_MUTED_CONVERSATIONS,
  SEICHI_SILVER_ADJUST_LIMIT,
  TavernColorPresets,
  UserRanks,
  UserRoles,
} from "@/drizzle/constants";

export { getBloodlineElements, isBloodlineEffectBeneficial } from "@/libs/userElements";

import {
  activeTrainedElement,
  elementalGainRoom,
  providedElements,
} from "@/libs/elementalMastery";
import { masteryGainRoom } from "@/libs/masteryProgression";
import type { UserWithRelations } from "@/routers/profile";
import { createStatSchema } from "@/validators/combat";
import { dashboardContentPrioritySchema } from "@/validators/dashboard";
import { genders, usernameSchema } from "@/validators/register";

export const assignableMasteryNames = [
  "ninjutsuMastery",
  "genjutsuMastery",
  "taijutsuMastery",
  "bukijutsuMastery",
] as const;

export const createAssignedExperienceSchema = (
  user?: NonNullable<UserWithRelations>,
) => {
  const { schema, maxValues } = createStatSchema(0, 0, user);
  const additionalRoom = Object.fromEntries([
    ...assignableMasteryNames.map((name) => [
      name,
      user ? masteryGainRoom(user, name) : MAX_MASTERY_CAP,
    ]),
    ...BasicElementName.map((element) => [
      element,
      user ? Math.ceil(elementalGainRoom(user, element)) : ELEMENTAL_MASTERY_CAP,
    ]),
  ]) as Record<(typeof assignableMasteryNames)[number] | BasicElement, number>;
  const additionalFields = Object.fromEntries(
    Object.entries(additionalRoom).map(([name, room]) => [
      name,
      z.coerce.number().min(0).max(room).prefault(0),
    ]),
  ) as Record<keyof typeof additionalRoom, z.ZodPrefault<z.ZodCoercedNumber>>;
  return {
    schema: schema.extend(additionalFields),
    maxValues: { ...maxValues, ...additionalRoom },
  };
};

export const updateUserSchema = z.object({
  username: usernameSchema,
  bloodlineId: z.string().nullable(),
  bloodlineReskinId: z.string().nullable().optional(),
  /** Staff-assigned equipped mode. Empty / "None" become null (unequip). */
  sageModeId: z.preprocess(
    (val) => (val === "" || val === "None" ? null : val),
    z.string().nullable(),
  ),
  villageId: z.string().nullable(),
  role: z.enum(UserRoles),
  rank: z.enum(UserRanks),
  jutsus: z.array(z.string()).optional(),
  items: z.array(z.string()).optional(),
  reason: z.string().min(10),
  staffAccount: z.boolean().optional(),
  rankedLp: z.coerce.number().int().min(0).optional(),
});

export type UpdateUserSchema = z.output<typeof updateUserSchema>;
export type UpdateUserInput = z.input<typeof updateUserSchema>;

export const getQuestCounterFieldName = (
  type: QuestType | undefined,
  rank: LetterRank | undefined,
) => {
  if (type === undefined || rank === undefined) return undefined;
  switch (type) {
    case "errand":
      return "errands";
    case "mission":
      return `missions${rank}` as const;
    case "crime":
      return `crimes${rank}` as const;
    default:
      return undefined;
  }
};
export type QuestCounterFieldName = ReturnType<typeof getQuestCounterFieldName>;

/** Returns usable elements, including an optional active trained element and "None". */
export const getUserElements = (user: UserWithRelations) => {
  const finalElements = user ? providedElements(user) : [];
  const trained = user && activeTrainedElement(user);
  if (trained) finalElements.push(trained);
  finalElements.push("None");
  // A bloodline may already supply "None"; neutral access stays available only once.
  return Array.from(new Set(finalElements));
};

export const getPublicUsersSchema = z.object({
  cursor: z.number().nullish(),
  limit: z.number().min(1).max(100),
  isAi: z.boolean().prefault(false),
  orderBy: z.enum([
    "Online",
    "Strongest",
    "Crafting",
    "Farming",
    "Medical",
    "Weakest",
    "PvP",
    "Ranked",
    "Staff",
    "Outlaws",
    "Community",
    "Dailies",
    "Recruiters",
  ]),
  username: z.string().optional(),
  ip: z.string().optional(),
  village: z.string().optional(),
  bloodline: z.string().optional(),
  recruiterId: z.string().optional(),
  inArena: z.boolean().optional(),
  isEvent: z.boolean().optional(),
  isWarCamp: z.boolean().optional(),
  isSummon: z.boolean().optional(),
  inShrines: z.boolean().optional(),
});
export type GetPublicUsersSchema = z.infer<typeof getPublicUsersSchema>;

// For updating highest preferences
export const updateUserPreferencesSchema = z
  .object({
    preferredGeneral1: z.enum(GeneralTypes).nullable().optional(),
    preferredGeneral2: z.enum(GeneralTypes).nullable().optional(),
    preferredDamageElement: z.enum(BasicElementName).nullable().optional(),
    dashboardContentPriority: dashboardContentPrioritySchema.optional(),
    rememberProfileTab: z.boolean().optional(),
    // Audio preferences
    musicOn: z.boolean().optional(),
    sfxOn: z.boolean().optional(),
    buttonSfxOn: z.boolean().optional(),
    iframesMuted: z.boolean().optional(),
    // Chat notification mutes
    chatMuted: z.boolean().optional(),
    mutedConversationIds: z
      .array(z.string().max(191))
      .max(MAX_MUTED_CONVERSATIONS)
      .optional(),
    tutorialOn: z.boolean().optional(),
    defaultAutoCombat: z.boolean().optional(),
    showPvpRecord: z.boolean().optional(),
  })
  .refine(
    (data) => {
      if (
        data.preferredGeneral1 !== undefined &&
        data.preferredGeneral2 !== undefined &&
        data.preferredGeneral1 !== null &&
        data.preferredGeneral2 !== null
      ) {
        return data.preferredGeneral1 !== data.preferredGeneral2;
      }
      return true;
    },
    {
      error: "General preferences must be different",
    },
  );

export type UpdateUserPreferencesSchema = z.infer<typeof updateUserPreferencesSchema>;

// Profile edit schemas
export const genderChangeSchema = z.object({ gender: z.enum(genders) });
export type GenderChangeSchema = z.infer<typeof genderChangeSchema>;

export const tavernColorChangeSchema = z.object({
  target: z.enum(["username", "title"]),
  color: z.enum(TavernColorPresets),
  currentColor: z.enum(TavernColorPresets),
});
export type TavernColorChangeSchema = z.infer<typeof tavernColorChangeSchema>;

export const adjustSeichiSilverSchema = z.object({
  userId: z.string(),
  delta: z.coerce
    .number()
    .int()
    .min(-SEICHI_SILVER_ADJUST_LIMIT)
    .max(SEICHI_SILVER_ADJUST_LIMIT)
    .refine((d) => d !== 0, { message: "Delta cannot be zero" }),
  reason: z.string().trim().min(10).max(500),
});
export type AdjustSeichiSilverSchema = z.infer<typeof adjustSeichiSilverSchema>;

/** Identify the owner's companion and require an auditable reason for restoring attempts. */
export const resetPetImageGenerationSchema = z.object({
  userId: z.string().min(1),
  petId: z.string().min(1),
  reason: z.string().trim().min(10).max(500),
});
