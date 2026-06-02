import { sql } from "drizzle-orm";
import type { SHRINE_BOOST_TYPE } from "@/drizzle/constants";
import { village } from "@/drizzle/schema";

/**
 * Builds a JSON expression that surgically updates village.shrineSettings.$.activeBoosts
 * without touching sibling keys. Removes the listed keys, then upserts the given entries.
 * Sibling keys (e.g. set concurrently by the cron template tick or Kage manual activation)
 * are preserved because we never write the full $.activeBoosts blob.
 *
 * Removes are applied before upserts so a same-tick upsert wins over a same-tick expiry.
 * If both arrays are empty the input shrineSettings is returned unchanged.
 */
export function mergeActiveBoostsExpression(params: {
  removeKeys: SHRINE_BOOST_TYPE[];
  upserts: { boostType: SHRINE_BOOST_TYPE; endAt: string }[];
}): ReturnType<typeof sql> {
  const { removeKeys, upserts } = params;

  // Ensure $.activeBoosts exists as an object before we touch keys under it.
  let expr = sql`JSON_SET(
    COALESCE(${village.shrineSettings}, JSON_OBJECT()),
    '$.activeBoosts',
    COALESCE(JSON_EXTRACT(${village.shrineSettings}, '$.activeBoosts'), JSON_OBJECT())
  )`;

  if (removeKeys.length > 0) {
    const paths = removeKeys.map((k) => sql`${`$.activeBoosts.${k}`}`);
    expr = sql`JSON_REMOVE(${expr}, ${sql.join(paths, sql`, `)})`;
  }

  if (upserts.length > 0) {
    const pairs = upserts.map(
      ({ boostType, endAt }) => sql`${`$.activeBoosts.${boostType}`}, ${endAt}`,
    );
    expr = sql`JSON_SET(${expr}, ${sql.join(pairs, sql`, `)})`;
  }

  return expr;
}

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
  return mergeActiveBoostsExpression({
    removeKeys: [],
    upserts: [{ boostType, endAt: newEndAt }],
  });
}

/**
 * JSON_SET expression that overwrites a single top-level shrineSettings key
 * (e.g. $.unlockedAiIds, $.activeAiIds) with `value`, leaving sibling keys —
 * including $.activeBoosts and $.boostTemplate written by the cron template tick
 * and Kage activateBoost — untouched. Use when a settings key's whole value is
 * replaced but neighbouring keys must survive concurrent writers. Mirrors the
 * inline JSON_SET pattern used by setBoostTemplate.
 */
export function setShrineSettingsKeyExpression(
  key: "unlockedAiIds" | "activeAiIds",
  value: string[],
): ReturnType<typeof sql> {
  return sql`JSON_SET(
    COALESCE(${village.shrineSettings}, JSON_OBJECT()),
    ${`$.${key}`},
    CAST(${JSON.stringify(value)} AS JSON)
  )`;
}

/**
 * CAS predicate that is TRUE iff village.shrineSettings.$.activeBoosts.<boostType>
 * is missing or already expired at `nowIso`. Used inside UPDATE WHERE clauses to
 * make boost activation idempotent — concurrent writers (cron template tick vs
 * Kage manual activateBoost, or any retried cron) cannot double-deduct tokens
 * or overwrite a still-live boost. Uses `<=` so a boost whose endAt exactly
 * equals nowIso is treated as expired — matches the JS "still active iff
 * expiry > now" convention used elsewhere (e.g. cron template tick).
 */
export function boostInactivePredicate(
  boostType: SHRINE_BOOST_TYPE,
  nowIso: string,
): ReturnType<typeof sql> {
  const path = `$.activeBoosts.${boostType}`;
  return sql`(JSON_EXTRACT(${village.shrineSettings}, ${path}) IS NULL OR JSON_UNQUOTE(JSON_EXTRACT(${village.shrineSettings}, ${path})) <= ${nowIso})`;
}
