import { z } from "zod";
import { CLAN_ASSASSIN_SLOTS } from "@/drizzle/constants";
import type { Clan } from "@/drizzle/schema";
import {
  createReservedNameField,
  looseFactionNameField,
  RESERVED_FACTION_NAMES,
} from "@/validators/reservedName";

/** Whole, positive points within the signed SQL integer range stored by the clan. */
export const clanPointConversionSchema = z.object({
  clanId: z.string(),
  points: z.number().int().positive().max(2147483647),
});

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

/**
 * Checks if a user is a clan co-leader.
 * @param userId - The ID of the user to check.
 * @param clanData - The clan object to check against.
 * @returns A boolean indicating whether the user is a clan co-leader.
 */
export const checkCoLeader = (userId: string, clanData?: Clan | null) => {
  return [clanData?.coLeader1, clanData?.coLeader2, clanData?.coLeader3].includes(
    userId,
  );
};

/** Whether the user holds the leader or a co-leader seat. */
export const checkClanLeadership = (userId: string, clanData?: Clan | null) =>
  clanData?.leaderId === userId || checkCoLeader(userId, clanData);

/**
 * Checks if a user is an assassin in a faction.
 * @param userId - The ID of the user to check.
 * @param clanData - The clan object to check against.
 * @returns A boolean indicating whether the user is an assassin.
 */
export const checkAssassin = (userId: string, clanData?: Clan | null) => {
  return CLAN_ASSASSIN_SLOTS.some((slot) => clanData?.[slot] === userId);
};

/** Validate a named selection of clans within the caller's configured selection limit. */
export const getClanSearchSchema = (maxClans: number) =>
  z.object({
    name: z.string(),
    clans: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          image: z.url().nullish(),
        }),
      )
      .min(1)
      .max(maxClans),
  });
export type ClanSearchSchema = z.infer<ReturnType<typeof getClanSearchSchema>>;
