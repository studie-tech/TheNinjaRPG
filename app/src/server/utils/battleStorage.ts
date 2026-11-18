import { gunzipSync, gzipSync } from "node:zlib";
import type { ExtraState } from "@/libs/combat/types";

/*
 * Every action and poll reads the whole battle row, and most of its bytes are catalogs
 * frozen at initiation. The row keeps them gzipped in `Battle.catalogs`, which shrinks each
 * read several times over while combat still loads its complete state in one query.
 * Turn updates rewrite only `revealedActions`, `dungeon` and `encounter` with JSON_SET, so
 * those, and every key not listed below, stay in the `extraState` JSON column. Rows without
 * catalogs hold their whole state as JSON and read unchanged. SQL reaches only the JSON
 * columns: a data migration that reshapes content inside live battles' catalogs has to
 * decode `Battle.catalogs` in code.
 */

/** The stored catalog keys; only a full extraState write may change them. */
const STORED_CATALOG_KEYS = [
  "jutsus",
  "jutsuReskins",
  "items",
  "bloodlines",
  "enemySkills",
  "sageModes",
  "villages",
  "anbuSquads",
  "keystoneItems",
  "wars",
  "aiProfiles",
  "relations",
  "clans",
  "userQuests",
  "completedQuests",
  "questData",
  "bounties",
  "bountySignups",
  "settings",
  "profileCacheSnapshots",
  "sectorExclusiveRaids",
] as const satisfies readonly (keyof ExtraState)[];

type StoredCatalogKey = (typeof STORED_CATALOG_KEYS)[number];
type StoredExtraState = Omit<ExtraState, StoredCatalogKey> &
  Partial<Pick<ExtraState, StoredCatalogKey>>;

/** Split a battle's extraState into its JSON column and the compressed catalogs column. */
export const packBattleExtraState = (state: ExtraState) => {
  const extraState: StoredExtraState = { ...state };
  const catalogs: Partial<ExtraState> = {};
  for (const key of STORED_CATALOG_KEYS) {
    if (state[key] === undefined) continue;
    Object.assign(catalogs, { [key]: state[key] });
    delete extraState[key];
  }
  // The column keeps its in-memory type; fetchBattle restores the omitted catalogs.
  return {
    extraState: extraState as ExtraState,
    catalogs: gzipSync(JSON.stringify(catalogs)),
  };
};

/** Rebuild the complete extraState from both columns; rows without catalogs are already complete. */
export const unpackBattleExtraState = (
  extraState: ExtraState,
  catalogs: Uint8Array | null,
): ExtraState =>
  catalogs
    ? {
        ...(JSON.parse(gunzipSync(catalogs).toString("utf8")) as Partial<ExtraState>),
        ...extraState,
      }
    : extraState;
