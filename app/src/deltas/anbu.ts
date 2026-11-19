import { ANBU_ESPIONAGE_POINTS_COST } from "@/drizzle/constants";
import type { fetchSquad } from "@/queries/anbu";
import { mergeQueryChanges } from "@/utils/queryCache";
import type { AnbuSquadDelta } from "@/validators/anbu";

/** Debit a committed espionage charge only against the squad balance its write confirmed. */
export const getEspionageSquadUpdate = (squad: { id: string; points: number }) => ({
  squadDelta: { id: squad.id, points: -ANBU_ESPIONAGE_POINTS_COST },
  squadExpected: { id: squad.id, points: squad.points },
});

/** Project a purchased level and its cost against the balance and level the write confirmed. */
export const getSquadUpgradeUpdate = (
  squad: { id: string; points: number; espionageLevel: number; stealthLevel: number },
  upgrade: { levelColumn: "espionageLevel" | "stealthLevel"; cost: number },
) => ({
  squadDelta: { id: squad.id, points: -upgrade.cost, [upgrade.levelColumn]: 1 },
  squadExpected: {
    id: squad.id,
    points: squad.points,
    [upgrade.levelColumn]: squad[upgrade.levelColumn],
  },
});

/** Apply a squad delta only to its confirmed baseline; missing or stale data refetches. */
export const applyAnbuSquadDelta = (
  current: CachedSquad | null | undefined,
  delta: AnbuSquadDelta,
  expected: AnbuSquadDelta | undefined,
): CachedSquad | undefined => {
  if (
    !current ||
    !expected ||
    Object.entries(expected).some(
      ([field, value]) =>
        value !== undefined && current[field as keyof CachedSquad] !== value,
    )
  )
    return undefined;
  return mergeQueryChanges(current, {}, delta);
};

type CachedSquad = NonNullable<Awaited<ReturnType<typeof fetchSquad>>>;
