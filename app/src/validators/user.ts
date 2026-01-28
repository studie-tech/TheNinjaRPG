import { z } from "zod";
import { UserRoles, UserRanks } from "@/drizzle/constants";
import { GeneralTypes, StatTypes } from "@/drizzle/constants";
import { usernameSchema } from "@/validators/register";
import type { LetterRank, QuestType } from "@/drizzle/constants";
import type { UserWithRelations } from "@/routers/profile";
import type { ElementName } from "@/drizzle/constants";
import type { ZodAllTags } from "@/validators/combat";

export const updateUserSchema = z.object({
  username: usernameSchema,
  customTitle: z.string().min(0).max(199).optional(),
  bloodlineId: z.string().nullable(),
  bloodlineReskinId: z.string().nullable().optional(),
  villageId: z.string().nullable(),
  role: z.enum(UserRoles),
  rank: z.enum(UserRanks),
  jutsus: z.array(z.string()).optional(),
  items: z.array(z.string()).optional(),
  reason: z.string().min(10),
  staffAccount: z.boolean().optional(),
  rankedLp: z.coerce.number().int().min(0).optional(),
});

export type UpdateUserSchema = z.infer<typeof updateUserSchema>;

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

export const getUserElements = (user: UserWithRelations) => {
  // Natural elements
  const userElements: ElementName[] = [];
  if (user?.primaryElement) userElements.push(user.primaryElement);
  if (user?.secondaryElement) userElements.push(user.secondaryElement);
  // Bloodline elements
  const bloodlineElements = getBloodlineElements(user);
  // Create final list of elements
  let finalElements: ElementName[] = [];

  if (bloodlineElements.length === 1 && userElements.length === 2) {
    const bloodlineElement = bloodlineElements[0]!;
    const primaryElement = userElements[0]!;
    const secondaryElement = userElements[1]!;

    if (secondaryElement === bloodlineElement) {
      // Secondary matches bloodline, keep primary and bloodline
      finalElements = [primaryElement, bloodlineElement];
    } else {
      // Secondary doesn't match bloodline, replace primary with bloodline
      finalElements = [bloodlineElement, secondaryElement];
    }
  } else if (bloodlineElements.length > 0) {
    // Multiple bloodline elements or no secondary element
    finalElements = bloodlineElements;
  } else {
    // No bloodline elements
    finalElements = userElements;
  }

  finalElements.push("None");
  return Array.from(new Set(finalElements));
};

export const getBloodlineElements = (user: UserWithRelations) => {
  const bloodlineElements: ElementName[] = [];
  user?.bloodline?.effects.map((effect) => {
    if ("elements" in effect && effect.elements) {
      if (isBloodlineEffectBeneficial(effect)) {
        bloodlineElements.push(...effect.elements);
      }
    }
  });
  return bloodlineElements;
};

export const isBloodlineEffectBeneficial = (effect: ZodAllTags) => {
  // Default to beneficial, as should be true for most bloodline effects
  let isStrength = true;
  // Certains tags are negative in a bloodline context
  if (
    [
      "decreasedamagegiven",
      "increasedamagetaken",
      "decreaseheal",
      "decreasestat",
      "damage",
    ].includes(effect.type)
  )
    isStrength = false;
  return isStrength;
};

export const getPublicUsersSchema = z.object({
  cursor: z.number().nullish(),
  limit: z.number().min(1).max(100),
  isAi: z.boolean().default(false),
  orderBy: z.enum([
    "Online",
    "Strongest",
    "Crafting",
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
  isSummon: z.boolean().optional(),
  inShrines: z.boolean().optional(),
});
export type GetPublicUsersSchema = z.infer<typeof getPublicUsersSchema>;

// For updating highest preferences
export const updateUserPreferencesSchema = z
  .object({
    preferredStat: z.enum(StatTypes).nullable().optional(),
    preferredGeneral1: z.enum(GeneralTypes).nullable().optional(),
    preferredGeneral2: z.enum(GeneralTypes).nullable().optional(),
    // Audio preferences
    musicOn: z.boolean().optional(),
    sfxOn: z.boolean().optional(),
    iframesMuted: z.boolean().optional(),
    tutorialOn: z.boolean().optional(),
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
      message: "General preferences must be different",
    },
  );

export type UpdateUserPreferencesSchema = z.infer<typeof updateUserPreferencesSchema>;
