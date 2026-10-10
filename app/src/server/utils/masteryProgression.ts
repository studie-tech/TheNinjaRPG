import { sql } from "drizzle-orm";
import {
  MASTERY_RANK_CAPS,
  MASTERY_RANKS,
  type MasteryName,
  MasteryNames,
  type MasteryRank,
  TOTAL_MASTERY_CAP,
} from "@/drizzle/constants";
import { userData } from "@/drizzle/schema";

/** Live row arithmetic keeps simultaneous grants inside both caps. MySQL evaluates
 * assignments in order, so later disciplines see the space consumed by earlier ones. */
export const masteryGainUpdates = (gains: Partial<Record<MasteryName, number>>) =>
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

/** Quest eligibility enforces configured mastery minimums; claims prevent replays.
 * The live rank guard keeps concurrent rewards from skipping or downgrading ranks. */
export const masteryRankUpdate = (stat: MasteryName, rank: MasteryRank) => {
  const previous = MASTERY_RANKS[MASTERY_RANKS.indexOf(rank) - 1];
  return sql`CASE WHEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(${userData.masteryRanks}, ${`$.${stat}`})), 'NONE') = ${previous ?? "NONE"} THEN JSON_SET(${userData.masteryRanks}, ${`$.${stat}`}, ${rank}) ELSE ${userData.masteryRanks} END`;
};
