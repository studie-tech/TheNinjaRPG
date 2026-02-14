import type { FederalStatus, LetterRank } from "@/drizzle/constants";
import {
  BLOODLINE_SWAP_FREE_AMOUNT,
  BLOODLINE_SWAP_FREE_GOLD,
  BLOODLINE_SWAP_FREE_NORMAL,
  BLOODLINE_SWAP_FREE_SILVER,
  PITY_BLOODLINE_ROLLS,
} from "@/drizzle/constants";
import type {
  Bloodline,
  BloodlineReskin,
  BloodlineRolls,
  UserData,
} from "@/drizzle/schema";

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
 * @param roll - An optional BloodlineRolls object containing the number of used rolls and pity rolls.
 * @returns The number of pity rolls calculated from the unused rolls.
 */
export const getPityRolls = (roll: BloodlineRolls) => {
  const nNormalRolls = roll?.used ?? 0;
  const nPityRolls = roll?.pityRolls ?? 0;
  const unusedRolls = nNormalRolls - PITY_BLOODLINE_ROLLS * nPityRolls;
  const availablePityRolls = Math.floor(unusedRolls / PITY_BLOODLINE_ROLLS);
  return availablePityRolls;
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
export const getFreeBloodlineSwaps = (federalStatus: FederalStatus) => {
  switch (federalStatus) {
    case "GOLD":
      return BLOODLINE_SWAP_FREE_GOLD;
    case "SILVER":
      return BLOODLINE_SWAP_FREE_SILVER;
    case "NORMAL":
      return BLOODLINE_SWAP_FREE_NORMAL;
    default:
      return BLOODLINE_SWAP_FREE_AMOUNT;
  }
};
