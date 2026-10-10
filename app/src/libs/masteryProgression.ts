/**
 * Earned mastery progression shared by training, combat, rewards and player displays.
 * Callers must supply stored values, before equipment, bloodline or combat modifiers.
 * Existing values above a cap are preserved; caps restrict further gains only.
 */
import {
  MASTERY_RANK_CAPS,
  MASTERY_RANKS,
  type MasteryName,
  MasteryNames,
  type MasteryRank,
  TOTAL_MASTERY_CAP,
} from "@/drizzle/constants";
import type { MasteryStatSource } from "@/libs/mastery";

/** Read a discipline's persisted rank; missing entries start at NONE. */
export const getMasteryRank = (
  user: MasteryProgressionSource,
  stat: MasteryName,
): MasteryRank => user.masteryRanks?.[stat] ?? "NONE";

/** Sum earned values across all disciplines, treating omitted values as zero. */
export const masteryTotal = (user: Partial<MasteryStatSource>): number =>
  MasteryNames.reduce((sum, stat) => sum + (user[stat] ?? 0), 0);

/**
 * Remaining gain capacity under both the discipline's rank cap and the shared total cap.
 * Returns zero for over-cap values without lowering their stored entitlement.
 * @param user - Earned values across all disciplines and their persisted ranks.
 * @param stat - Discipline receiving a prospective gain.
 */
export const masteryGainRoom = (
  user: MasteryProgressionSource,
  stat: MasteryName,
): number =>
  Math.max(
    0,
    Math.min(
      MASTERY_RANK_CAPS[getMasteryRank(user, stat)] - (user[stat] ?? 0),
      TOTAL_MASTERY_CAP - masteryTotal(user),
    ),
  );

/**
 * Clamp a grant in MasteryNames order, consuming shared capacity as each discipline is added.
 * The source is not mutated. Fractional gains are retained; whole-point XP callers must
 * floor requested and allocated gains before debiting their integer balance.
 * Persistence must enforce live row caps through masteryGainUpdates or guard the
 * complete source snapshot.
 * @param user - Earned values and ranks before the grant, excluding temporary modifiers.
 * @param requested - Nonnegative requested gains; omitted disciplines receive zero.
 * @returns Granted deltas, with each discipline included and the source left unchanged.
 */
export const allocateMasteryGains = (
  user: MasteryProgressionSource,
  requested: Partial<Record<MasteryName, number>>,
): Partial<Record<MasteryName, number>> => {
  const next = { ...user };
  const gains: Partial<Record<MasteryName, number>> = {};
  for (const stat of MasteryNames) {
    const gain = Math.max(
      0,
      Math.min(requested[stat] ?? 0, masteryGainRoom(next, stat)),
    );
    gains[stat] = gain;
    next[stat] = (next[stat] ?? 0) + gain;
  }
  return gains;
};

/**
 * Whether the requested rank is immediately after the discipline's current rank.
 * Earned mastery thresholds belong to the quest's configurable minimum fields;
 * this check prevents skipped ranks, repeated promotions and downgrades only.
 * @param rank - Proposed reward rank, rather than the user's current rank.
 */
export const canPromoteMastery = (
  user: MasteryProgressionSource,
  stat: MasteryName,
  rank: MasteryRank,
): boolean =>
  MASTERY_RANKS.indexOf(rank) === MASTERY_RANKS.indexOf(getMasteryRank(user, stat)) + 1;

/** Stored mastery values and ranks; omitted disciplines contribute zero to the total. */
export type MasteryProgressionSource = Partial<MasteryStatSource> & {
  masteryRanks?: Partial<Record<MasteryName, MasteryRank>>;
};
