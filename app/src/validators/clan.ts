import { z } from "zod";
import { ClanBoostTypes } from "@/drizzle/constants";
import type { Clan } from "@/drizzle/schema";
import {
  createReservedNameField,
  looseFactionNameField,
  RESERVED_FACTION_NAMES,
} from "@/validators/reservedName";

export const clanBoostTypeSchema = z.enum(ClanBoostTypes);

export const strictClanNameField = createReservedNameField({
  reserved: RESERVED_FACTION_NAMES,
  errorMessage: "This clan name is not allowed.",
});

export const clanCreateSchema = z.object({
  villageId: z.string(),
  name: strictClanNameField,
});

export type ClanCreateSchema = z.infer<typeof clanCreateSchema>;

export const factionEditSchema = z.object({
  clanId: z.string(),
  name: looseFactionNameField,
  image: z.string(),
});

export type FactionEditSchema = z.infer<typeof factionEditSchema>;

export const factionColorEditSchema = z.object({
  clanId: z.string(),
  color: z.string().regex(/^#[0-9A-F]{6}$/i, {
    error: "Must be a valid hex color code",
  }),
});

export type FactionColorEditSchema = z.infer<typeof factionColorEditSchema>;

export const clanGetRequestSchema = z.object({
  clanLeaderId: z.string(),
});

export type ClanGetRequestSchema = z.infer<typeof clanGetRequestSchema>;

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

// Clan search schema (used in Clan.tsx for searching clans)
export const getClanSearchSchema = (maxClans: number) =>
  z.object({
    name: z.string(),
    clans: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          image: z.string().url().optional().nullish(),
        }),
      )
      .min(1)
      .max(maxClans),
  });
export type ClanSearchSchema = z.infer<ReturnType<typeof getClanSearchSchema>>;
