import { z } from "zod";
import { CoreVillages, ClanBoostTypes } from "@/drizzle/constants";
import type { Clan } from "@/drizzle/schema";

export const clanBoostTypeSchema = z.enum(ClanBoostTypes);

const bannedNames = ["Freedom State", "Horizon", ...CoreVillages];

export const clanCreateSchema = z.object({
  villageId: z.string(),
  name: z
    .string()
    .trim()
    .min(3)
    .max(88)
    .regex(new RegExp("^[a-zA-Z0-9_]+$"), {
      message: "Alphanumeric, no spaces",
    })
    .refine(
      (name) =>
        !bannedNames.some((banned) => banned.toLowerCase() === name.toLowerCase()),
      { message: "This clan name is not allowed." },
    ),
});

export type ClanCreateSchema = z.infer<typeof clanCreateSchema>;

export const factionEditSchema = z.object({
  clanId: z.string(),
  name: z
    .string()
    .trim()
    .min(3)
    .max(88)
    .refine(
      (name) =>
        !bannedNames.some((banned) => banned.toLowerCase() === name.toLowerCase()),
      { message: "This clan name is not allowed." },
    ),
  image: z.string(),
});

export type FactionEditSchema = z.infer<typeof factionEditSchema>;

export const factionColorEditSchema = z.object({
  clanId: z.string(),
  color: z.string().regex(/^#[0-9A-F]{6}$/i, {
    message: "Must be a valid hex color code",
  }),
});

export type FactionColorEditSchema = z.infer<typeof factionColorEditSchema>;

/**
 * Checks if a user is a clan leader.
 * @param userId - The ID of the user to check.
 * @param clan - The clan object to check against.
 * @returns A boolean indicating whether the user is a clan leader.
 */
export const checkCoLeader = (userId: string, clanData?: Clan | null) => {
  return [clanData?.coLeader1, clanData?.coLeader2, clanData?.coLeader3].includes(
    userId,
  );
};

/**
 * Checks if a user is an assassin in a faction.
 * @param userId - The ID of the user to check.
 * @param clanData - The clan object to check against.
 * @returns A boolean indicating whether the user is an assassin.
 */
export const checkAssassin = (userId: string, clanData?: Clan | null) => {
  return [
    clanData?.assassin1,
    clanData?.assassin2,
    clanData?.assassin3,
    clanData?.assassin4,
    clanData?.assassin5,
    clanData?.assassin6,
    clanData?.assassin7,
    clanData?.assassin8,
    clanData?.assassin9,
    clanData?.assassin10,
  ].includes(userId);
};
