import {
  MASTERY_RANK_CAPS,
  MASTERY_RANKS,
  type MasteryName,
  MasteryNames,
  type MasteryRank,
  TOTAL_MASTERY_CAP,
} from "@/drizzle/constants";
import type { MasteryStatSource } from "@/libs/mastery";

export type MasteryProgressionSource = Partial<MasteryStatSource> & {
  masteryRanks?: Partial<Record<MasteryName, MasteryRank>>;
};

export const getMasteryRank = (
  user: MasteryProgressionSource,
  stat: MasteryName,
): MasteryRank => user.masteryRanks?.[stat] ?? "NONE";

export const masteryTotal = (user: Partial<MasteryStatSource>) =>
  MasteryNames.reduce((sum, stat) => sum + (user[stat] ?? 0), 0);

export const masteryGainRoom = (user: MasteryProgressionSource, stat: MasteryName) =>
  Math.max(
    0,
    Math.min(
      MASTERY_RANK_CAPS[getMasteryRank(user, stat)] - (user[stat] ?? 0),
      TOTAL_MASTERY_CAP - masteryTotal(user),
    ),
  );

/** Allocate one grant deterministically across disciplines, preserving existing values. */
export const allocateMasteryGains = (
  user: MasteryProgressionSource,
  requested: Partial<Record<MasteryName, number>>,
) => {
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

/** Earned mastery requirements belong to the quest's configurable minimum fields. */
export const canPromoteMastery = (
  user: MasteryProgressionSource,
  stat: MasteryName,
  rank: MasteryRank,
) =>
  MASTERY_RANKS.indexOf(rank) === MASTERY_RANKS.indexOf(getMasteryRank(user, stat)) + 1;
