import { sql } from "drizzle-orm";
import type { SHRINE_BOOST_TYPE } from "@/drizzle/constants";
import { village } from "@/drizzle/schema";

/**
 * JSON_SET expression that sets a single $.activeBoosts.<type> key on
 * village.shrineSettings without touching sibling keys, so concurrent writers
 * (e.g. cron template activations vs Kage manual activation) cannot clobber
 * each other's boosts.
 */
export function setActiveBoostExpression(
  boostType: SHRINE_BOOST_TYPE,
  newEndAt: string,
): ReturnType<typeof sql> {
  return sql`JSON_SET(
    JSON_SET(
      COALESCE(${village.shrineSettings}, JSON_OBJECT()),
      '$.activeBoosts',
      COALESCE(JSON_EXTRACT(${village.shrineSettings}, '$.activeBoosts'), JSON_OBJECT())
    ),
    ${`$.activeBoosts.${boostType}`},
    ${newEndAt}
  )`;
}
