import { z } from "zod";
import { FederalStatuses, UserRanks } from "@/drizzle/constants";

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
export const colors = [
  "Blonde",
  "Black",
  "Brown",
  "Blue",
  "Red",
  "White",
  "Gray",
] as const;
export const skin_colors = ["Light", "Dark", "Olive", "Alibino"] as const;
export const genders = ["Male", "Female", "Other"] as const;
export type Gender = (typeof genders)[number];

export const usernameSchema = z
  .string()
  .trim()
  .regex(new RegExp("^[a-zA-Z0-9_]+$"), {
    message: "Alphanumeric, no spaces",
  })
  .min(2)
  .max(12);

export const registrationSchema = z
  .object({
    username: usernameSchema,
    gender: z.enum(genders),
    hair_color: z.enum(colors),
    eye_color: z.enum(colors),
    skin_color: z.enum(skin_colors),
    attribute_1: z.enum(attributes),
    attribute_2: z.enum(attributes),
    attribute_3: z.enum(attributes),
    read_tos: z.literal(true),
    read_privacy: z.literal(true),
    read_earlyaccess: z.literal(true),
    recruiter_userid: z.string().optional().nullish(),
    bloodlineId: z.string().min(1, "Bloodline selection is required"),
  })
  .strict()
  .required()
  .refine(
    (data) =>
      data.attribute_1 !== data.attribute_2 && data.attribute_1 !== data.attribute_3,
    {
      message: "Attributes can only be chosen once",
      path: ["attribute_1"],
    },
  )
  .refine(
    (data) =>
      data.attribute_2 !== data.attribute_1 && data.attribute_2 !== data.attribute_3,
    {
      message: "Attributes can only be chosen once",
      path: ["attribute_2"],
    },
  )
  .refine(
    (data) =>
      data.attribute_3 !== data.attribute_1 && data.attribute_3 !== data.attribute_2,
    {
      message: "Attributes can only be chosen once",
      path: ["attribute_3"],
    },
  );
export type RegistrationSchema = z.infer<typeof registrationSchema>;

export const userSearchSchema = z.object({
  username: usernameSchema,
});
export type UserSearchSchema = z.infer<typeof userSearchSchema>;

export const getSearchValidator = (props: { max: number }) => {
  return z.object({
    username: usernameSchema,
    users: z
      .array(
        z.object({
          userId: z.string(),
          username: usernameSchema,
          avatar: z.string().url().optional().nullish(),
          rank: z.enum(UserRanks),
          level: z.number(),
          federalStatus: z.enum(FederalStatuses),
        }),
      )
      .min(1)
      .max(props.max),
  });
};
