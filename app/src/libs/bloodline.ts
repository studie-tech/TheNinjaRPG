import type { FederalStatus, LetterRank } from "@/drizzle/constants";
import {
  BLOODLINE_SWAP_FREE,
  DIAMOND_BLOODLINE_RANKS,
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
export const filterRollableBloodlines = <
  T extends Pick<Bloodline, "id" | "rank" | "villageId">,
>(info: {
  bloodlines: T[];
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

/** Released D–A bloodlines open to the player's village, as Diamond support may pick. */
export const isDiamondSwapBloodline = (
  line: Pick<Bloodline, "rank" | "hidden" | "villageId">,
  user: Pick<UserData, "villageId">,
) =>
  !line.hidden &&
  (DIAMOND_BLOODLINE_RANKS as readonly LetterRank[]).includes(line.rank) &&
  (!line.villageId || line.villageId === user.villageId);

/**
 * Whether a Diamond swap should remember the current bloodline as the one to restore.
 * The first Diamond swap always does; later ones only when the player has since moved back
 * to an owned bloodline (or none), so a Diamond pick is never remembered as owned.
 */
export const shouldRememberPreDiamondBloodline = (info: {
  diamondBloodlineActive: boolean;
  currentBloodlineId: string | null;
  ownedBloodlineIds: readonly string[];
}) =>
  !info.diamondBloodlineActive ||
  info.currentBloodlineId === null ||
  info.ownedBloodlineIds.includes(info.currentBloodlineId);

/**
 * The bloodline to restore when Diamond support ends, or `undefined` to keep the current
 * one. A bloodline the player owns (or having none) was chosen outside Diamond and stays;
 * a Diamond pick returns to the remembered bloodline, or none if that no longer exists.
 */
export const resolveDiamondBloodlineRevert = (info: {
  currentBloodlineId: string | null;
  preDiamondBloodlineId: string | null;
  preDiamondBloodlineExists: boolean;
  ownedBloodlineIds: readonly string[];
}): { restoreBloodlineId: string | null } | undefined => {
  const { currentBloodlineId, preDiamondBloodlineId } = info;
  if (currentBloodlineId === null) return undefined;
  if (info.ownedBloodlineIds.includes(currentBloodlineId)) return undefined;
  if (currentBloodlineId === preDiamondBloodlineId) return undefined;
  return {
    restoreBloodlineId: info.preDiamondBloodlineExists ? preDiamondBloodlineId : null,
  };
};

/** Diamond swaps follow the effective tier, so staff (who count as Gold) never get them. */
export const hasDiamondBloodlineSwaps = (
  user: Pick<UserData, "staffAccount" | "federalStatus">,
) => getUserFederalStatus(user) === "DIAMOND";

/** The bloodline a Diamond supporter would end up with if Diamond support ended now. */
export const getDiamondRestoreBloodlineId = (
  user: Pick<
    UserData,
    "bloodlineId" | "diamondBloodlineActive" | "preDiamondBloodlineId"
  >,
  ownedBloodlineIds: readonly string[],
) => {
  if (!user.diamondBloodlineActive) return user.bloodlineId;
  const revert = resolveDiamondBloodlineRevert({
    currentBloodlineId: user.bloodlineId,
    preDiamondBloodlineId: user.preDiamondBloodlineId,
    preDiamondBloodlineExists: true,
    ownedBloodlineIds,
  });
  return revert ? revert.restoreBloodlineId : user.bloodlineId;
};
