import type { RouterInputs } from "@/app/_trpc/client";
import type { BattleAction } from "@/drizzle/schema";

/** Reuse a complete action delta; gaps or missing history fall back to a query. */
export const mergeBattleEntries = (
  previous: BattleAction[] | undefined,
  incoming: BattleAction[],
  input: RouterInputs["combat"]["getBattleEntries"],
  nextVersion: number,
): BattleAction[] | undefined => {
  const version = input.refreshKey;
  const limit = input.limit ?? 30;
  const ordered = [...incoming].sort((a, b) => a.battleVersion - b.battleVersion);
  if (
    !previous ||
    version === undefined ||
    version < 1 ||
    (input.userFilter !== undefined && input.userFilter !== "all") ||
    input.showBasicActions === false ||
    input.offset ||
    !ordered.length ||
    nextVersion - version !== ordered.length ||
    ordered.some(
      (entry, i) =>
        entry.battleId !== input.battleId || entry.battleVersion !== version + i,
    ) ||
    // Battle state is committed before logs. Only a complete, unfiltered page
    // proves that a racing fetch did not miss an insert; otherwise refetch.
    previous.length !== Math.min(version - 1, limit) ||
    previous.some(
      (entry, i) =>
        entry.battleId !== input.battleId || entry.battleVersion !== version - 1 - i,
    )
  )
    return undefined;

  return [...ordered.reverse(), ...previous].slice(0, limit);
};
