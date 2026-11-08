import { z } from "zod";
import type { BasicElement } from "@/drizzle/constants";
import {
  BasicElementName,
  ELEMENTAL_MASTERY_CAP,
  GeneralTypes,
  MAX_MASTERY_CAP,
  MAX_MUTED_CONVERSATIONS,
  TavernColorPresets,
  UserRanks,
  UserRoles,
} from "@/drizzle/constants";

import { elementalGainRoom } from "@/libs/elementalMastery";
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
  minLevel: z.number().int().optional(),
  maxLevel: z.number().int().optional(),
  /** Only players active within this many minutes. */
  activeWithinMinutes: z.number().int().min(1).optional(),
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
    autoWakeUp: z.boolean().optional(),
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
    unmutedTavernIds: z
      .array(z.string().max(191))
      .max(MAX_MUTED_CONVERSATIONS)
      .optional(),
    tutorialOn: z.boolean().optional(),
    defaultAutoCombat: z.boolean().optional(),
    showPvpRecord: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.preferredGeneral1 == null ||
      data.preferredGeneral1 !== data.preferredGeneral2,
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
