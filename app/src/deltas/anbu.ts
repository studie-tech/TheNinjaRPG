import { ANBU_ESPIONAGE_POINTS_COST } from "@/drizzle/constants";
import type { fetchSquad } from "@/queries/anbu";
import { mergeQueryChanges } from "@/utils/queryCache";
import type { AnbuSquadDelta } from "@/validators/anbu";

/** Debit the squad points one committed espionage charge spent, whatever the mission's outcome. */
export const getEspionageSquadDelta = (squadId: string): AnbuSquadDelta => ({
  id: squadId,
  points: -ANBU_ESPIONAGE_POINTS_COST,
});

/** Raise the purchased squad level by one and debit the points the guarded upgrade spent. */
export const getSquadUpgradeDelta = (
  squadId: string,
  upgrade: { levelColumn: "espionageLevel" | "stealthLevel"; cost: number },
): AnbuSquadDelta => ({
  id: squadId,
  points: -upgrade.cost,
  [upgrade.levelColumn]: 1,
});

/** Apply a confirmed squad delta to the cached squad; a different or missing squad refetches. */
export const applyAnbuSquadDelta = (
  current: CachedSquad | null | undefined,
  delta: AnbuSquadDelta,
): CachedSquad | undefined => {
  if (!current) return undefined;
  return mergeQueryChanges(current, {}, delta);
};

type CachedSquad = NonNullable<Awaited<ReturnType<typeof fetchSquad>>>;
