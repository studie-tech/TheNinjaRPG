/** Atomic SQL counterparts to the earned-mastery calculations in libs/masteryProgression. */
import { type SQL, sql } from "drizzle-orm";
import {
  MASTERY_RANK_CAPS,
  MASTERY_RANKS,
  type MasteryName,
  MasteryNames,
  type MasteryRank,
  TOTAL_MASTERY_CAP,
} from "@/drizzle/constants";
import { userData } from "@/drizzle/schema";

/**
 * Build positive mastery increments for a single UserData update using live row values.
 * MySQL evaluates assignments in order; Drizzle emits them in schema column order.
 * Keep the UserData mastery columns aligned with MasteryNames so later disciplines
 * see shared capacity consumed by earlier ones, matching allocateMasteryGains.
 * Over-cap stored values remain intact, and nonpositive grants are omitted.
 * This enforces caps, not reward ownership; callers still need their claim/CAS guard.
 * @param gains - Requested earned deltas; the row may have less capacity at write time.
 * @returns SQL assignments to spread into the caller's guarded UserData update.
 */
export const masteryGainUpdates = (
  gains: Partial<Record<MasteryName, number>>,
): Partial<Record<MasteryName, SQL>> =>
  Object.fromEntries(
    MasteryNames.filter((stat) => (gains[stat] ?? 0) > 0).map((stat) => {
      const rank = sql`COALESCE(JSON_UNQUOTE(JSON_EXTRACT(${userData.masteryRanks}, ${`$.${stat}`})), 'NONE')`;
      const cap = sql`CASE ${rank} ${sql.join(
        MASTERY_RANKS.map((r) => sql`WHEN ${r} THEN ${MASTERY_RANK_CAPS[r]}`),
        sql` `,
      )} ELSE ${MASTERY_RANK_CAPS.NONE} END`;
      const total = sql.join(
        MasteryNames.map((name) => sql`${userData[name]}`),
        sql` + `,
      );
      return [
        stat,
        sql`${userData[stat]} + GREATEST(0, LEAST(${gains[stat] ?? 0}, ${cap} - ${userData[stat]}, ${TOTAL_MASTERY_CAP} - (${total})))`,
      ];
    }),
  );

/**
 * Replace one rank only when the live row still has its immediately preceding rank.
 * Concurrent or repeated promotions cannot skip ranks or overwrite unrelated ranks.
 * Quest eligibility checks earned minimums, and the reward claim prevents duplicate
 * payouts; this expression supplies only the rank transition guard.
 */
export const masteryRankUpdate = (stat: MasteryName, rank: MasteryRank): SQL => {
  const previous = MASTERY_RANKS[MASTERY_RANKS.indexOf(rank) - 1];
  return sql`CASE WHEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(${userData.masteryRanks}, ${`$.${stat}`})), 'NONE') = ${previous ?? "NONE"} THEN JSON_SET(${userData.masteryRanks}, ${`$.${stat}`}, ${rank}) ELSE ${userData.masteryRanks} END`;
};
