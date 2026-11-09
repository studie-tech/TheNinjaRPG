import type { FederalStatus, LetterRank } from "@/drizzle/constants";
import {
  BLOODLINE_SWAP_FREE,
  LetterRanks,
  PITY_BLOODLINE_ROLLS,
} from "@/drizzle/constants";
import type {
  Bloodline,
  BloodlineReskin,
  BloodlineRolls,
  UserData,
} from "@/drizzle/schema";
import { getUserFederalStatus } from "@/utils/paypal";
import { isStaffMember } from "@/utils/permissions";

export type BloodlineCollectionProgress = {
  rank: LetterRank;
  collected: number;
  total: number;
}[];

/** Count distinct visible ownership for each rank so objectives can select any combination. */
export const buildBloodlineCollectionProgress = (
  bloodlines: readonly Pick<Bloodline, "id" | "rank" | "hidden">[],
  ownedIds: readonly string[],
): BloodlineCollectionProgress => {
  const owned = new Set(ownedIds);
  const visible = bloodlines.filter((line) => !line.hidden);
  return LetterRanks.map((rank) => {
    const eligible = new Set(
      visible.filter((line) => line.rank === rank).map((line) => line.id),
    );
    return {
      rank,
      collected: [...eligible].filter((id) => owned.has(id)).length,
      total: eligible.size,
    };
  });
};

/**
 * Filters and sorts a list of bloodlines based on the specified rank, user data, and previous rolls.
 *
 * @param bloodlines - The array of bloodlines to filter.
 * @param rank - The rank to filter bloodlines by.
 * @param user - The user data containing village information.
 * @param previousRolls - The array of previous bloodline rolls.
 *
 * @returns A filtered and sorted array of bloodlines that match the specified criteria.
 */
export const filterRollableBloodlines = (info: {
  bloodlines: Bloodline[];
  rank: LetterRank | null | undefined;
  user: UserData;
  previousRolls: BloodlineRolls[];
}) => {
  const { bloodlines, rank, user, previousRolls } = info;
  const bloodlinePool = bloodlines
    .filter((b) => b.rank === rank)
    .filter((b) => !b.villageId || b.villageId === user.villageId)
    .map((b) => ({
      ...b,
      prevRolls: previousRolls.find((r) => r.bloodlineId === b.id)?.used || 0,
    }))
    .sort((a, b) => a.prevRolls - b.prevRolls)
    .filter((b, _, all) => {
      const minRolls = all?.[0]?.prevRolls || 0;
      return b.prevRolls <= minRolls;
    });
  return bloodlinePool;
};

/**
 * Calculates the number of pity rolls based on the provided BloodlineRolls object.
 *
 * @param roll - The BloodlineRolls object with the number of used rolls and pity rolls.
 * @returns The number of pity rolls calculated from the unused rolls.
 */
export const getPityRolls = (roll: Pick<BloodlineRolls, "used" | "pityRolls">) => {
  const unusedRolls = roll.used - PITY_BLOODLINE_ROLLS * roll.pityRolls;
  return Math.floor(unusedRolls / PITY_BLOODLINE_ROLLS);
};

/**
 * Get the reskinned bloodline, generic version
 * @param bloodline  Bloodline to reskin
 * @param reskin  Reskin to apply to the bloodline
 * @returns Reskinned bloodline
 */
export const getReskinnedBloodline = <T extends Bloodline>(
  bloodline: T,
  reskin: BloodlineReskin,
): T => {
  return {
    ...bloodline,
    ...(reskin.name && { name: reskin.name }),
    ...(reskin.image && { image: reskin.image }),
    ...(reskin.description && { description: reskin.description }),
  };
};

/**
 * Get the number of free bloodline swaps based on the federal status
 * @param federalStatus
 * @returns
 */
export const getFreeBloodlineSwaps = (federalStatus: FederalStatus) =>
  BLOODLINE_SWAP_FREE[federalStatus];

/** Resolve a user's free-swap allowance from the swaps logged this month. */
export const getBloodlineSwapAllowance = (
  user: Pick<UserData, "staffAccount" | "federalStatus">,
  freeSwapsUsed: number,
) => {
  const federalStatus = getUserFederalStatus(user);
  const freeSwapsRemaining = Math.max(
    0,
    getFreeBloodlineSwaps(federalStatus) - freeSwapsUsed,
  );
  const hasFreeSwapAvailable = freeSwapsRemaining > 0;
  const isStaffFree = isStaffMember(user);
  return {
    federalStatus,
    freeSwapsUsed,
    freeSwapsRemaining,
    hasFreeSwapAvailable,
    isStaffFree,
    isFree: hasFreeSwapAvailable || isStaffFree,
  };
};
