import { z } from "zod";
import {
  CoreVillages,
  FederalStatuses,
  LegacyVillageNames,
  TavernColorPresets,
  UserRanks,
  UserRoles,
} from "@/drizzle/constants";
import { lpcBodyStyles } from "@/validators/lpc";
import { createReservedNameField } from "@/validators/reservedName";

// List of possible attributes
export const attributes = [
  "Soft features",
  "Hard features",
  "Sharp features",
  "Tattoo",
  "Scar",
  "Piercing",
  "Glasses",
  "Hat",
  "Long Hair",
  "Short Hair",
  "Bald",
  "Long Beard",
  "Full Beard",
  "Stubble",
] as const;
export type Attribute = (typeof attributes)[number];

export const colors = [
  "Blonde",
  "Black",
  "Brown",
  "Blue",
  "Red",
  "White",
  "Gray",
] as const;
export type Color = (typeof colors)[number];

export const skin_colors = ["Light", "Dark", "Olive", "Alibino"] as const;
export type SkinColor = (typeof skin_colors)[number];
export const genders = ["Male", "Female", "Other"] as const;
export type Gender = (typeof genders)[number];

const characterColorGroups: Record<"Hair" | "Eyes" | "Skin", readonly string[]> = {
  Hair: [...colors, "Green", "Yellow"].map((color) => `${color} Hair`),
  Eyes: [...colors, "Green", "Yellow"].map((color) => `${color} Eyes`),
  Skin: [...skin_colors, "Albino"].map((color) => `${color} Skin`),
};

// Group order defines the visible choice when older accounts contain conflicting traits.
const characterAttributeGroups: readonly (readonly string[])[] = [
  ["Bald", "Long Hair", "Short Hair"],
  ["Sharp features", "Hard features", "Soft features"],
  ["Long Beard", "Full Beard", "Stubble"],
  ...Object.values(characterColorGroups),
];

/** Return mutually exclusive choices, including case-insensitive legacy color rows. */
export const getAttributeGroup = (attribute: string): readonly string[] =>
  characterAttributeGroups.find((group) =>
    group.some((choice) => choice.toLowerCase() === attribute.toLowerCase()),
  ) ?? [attribute];

/** Separate saved palettes from effective traits using the renderer's stable legacy priorities. */
export const getCharacterAttributes = (values: readonly string[]) => {
  const selected = new Set(values.map((value) => value.toLowerCase()));
  const color = (suffix: "Hair" | "Eyes" | "Skin", fallback: string) => {
    return (
      characterColorGroups[suffix]
        .filter((choice) => selected.has(choice.toLowerCase()))
        .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))[0]
        ?.split(" ")[0] ?? fallback
    );
  };
  const traits = new Map<string, string>();
  for (const value of values) {
    const group = getAttributeGroup(value);
    if (Object.values(characterColorGroups).includes(group)) continue;
    const chosen = group.find((choice) => selected.has(choice.toLowerCase())) ?? value;
    traits.set(group[0]!.toLowerCase(), chosen);
  }
  return {
    traits: [...traits.values()],
    Hair: color("Hair", "Black"),
    Eyes: color("Eyes", "Blue"),
    Skin: color("Skin", "Light"),
  };
};

const reservedUsernames = [...LegacyVillageNames, ...CoreVillages];

// Format-only validator (no reserved-name refine). Used for username inputs
// and result parsing on search/lookup paths so that legacy players who
// registered with a now-reserved name remain searchable and parseable.
export const usernameFormatSchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9_]+$/, {
    error: "Alphanumeric and underscores only",
  })
  .min(2)
  .max(12);

// Strict registration validator: rejects reserved names for new sign-ups.
export const usernameSchema = createReservedNameField({
  reserved: reservedUsernames,
  minLength: 2,
  maxLength: 12,
  errorMessage: "This name is reserved.",
});

export const utmSourceSchema = z
  .string()
  .trim()
  .max(64, "UTM source too long")
  .regex(/^[a-zA-Z0-9_\-.]+$/, {
    error:
      "UTM source can only contain letters, numbers, dashes, underscores, and dots",
  })
  .nullish()
  .catch(() => "");

export const registrationSchema = z
  .strictObject({
    username: usernameSchema,
    gender: z.enum(genders),
    spriteBodyStyle: z.enum(lpcBodyStyles).optional(),
    hair_color: z.enum(colors),
    eye_color: z.enum(colors),
    skin_color: z.enum(skin_colors),
    attribute_1: z.enum(attributes),
    attribute_2: z.enum(attributes),
    attribute_3: z.enum(attributes),
    read_tos: z.literal(true),
    read_privacy: z.literal(true),
    read_earlyaccess: z.literal(true),
    recruiter_userid: z.string().nullish(),
    utm_source: utmSourceSchema,
    bloodlineId: z.string().min(1, "Bloodline selection is required"),
    musicOn: z.boolean().optional(),
    sfxOn: z.boolean().optional(),
    buttonSfxOn: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    const fields = ["attribute_1", "attribute_2", "attribute_3"] as const;
    for (const field of fields) {
      if (
        fields.some(
          (other) =>
            other !== field && getAttributeGroup(data[field]).includes(data[other]),
        )
      ) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: "Choose different, compatible traits",
        });
      }
    }
  });
export type RegistrationSchema = z.infer<typeof registrationSchema>;

export const userSearchSchema = z.object({
  username: usernameFormatSchema,
});
export type UserSearchSchema = z.infer<typeof userSearchSchema>;

const searchUserResultSchema = z.object({
  userId: z.string(),
  username: usernameFormatSchema,
  avatar: z.url().optional().nullish(),
  rank: z.enum(UserRanks),
  level: z.number(),
  federalStatus: z.enum(FederalStatuses),
  role: z.enum(UserRoles).optional(),
  isOutlaw: z.boolean().optional(),
  displayTitle: z.string().optional(),
  nRecruited: z.number().optional().nullish(),
  tavernMessages: z.number().optional().nullish(),
  tavernUsernameColor: z.enum(TavernColorPresets).optional(),
  tavernTitleColor: z.enum(TavernColorPresets).optional(),
  village: z
    .object({
      name: z.string(),
      hexColor: z.string(),
      kageId: z.string().nullish(),
    })
    .optional()
    .nullish(),
});
export type UserSearchResult = z.infer<typeof searchUserResultSchema>;

export const getSearchValidator = (props: { max: number }) => {
  return z.object({
    username: usernameFormatSchema,
    users: z.array(searchUserResultSchema).min(1).max(props.max),
  });
};
