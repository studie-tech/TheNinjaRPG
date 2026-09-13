import type { RouterInputs } from "@/app/_trpc/client";
import { AdjustableBasicActions } from "@/drizzle/constants";
import type { BattleAction } from "@/drizzle/schema";

/** Reuse a complete action delta; gaps or missing history fall back to a query. */
export const mergeBattleEntries = (
  previous: BattleAction[] | undefined,
  incoming: BattleAction[],
  input: RouterInputs["combat"]["getBattleEntries"],
  nextVersion: number,
  userId: string,
): BattleAction[] | undefined => {
  const version = input.refreshKey;
  const ordered = [...incoming].sort((a, b) => a.battleVersion - b.battleVersion);
  if (
    !previous ||
    version === undefined ||
    input.offset ||
    !ordered.length ||
    nextVersion - version !== ordered.length ||
    ordered.some(
      (entry, i) =>
        entry.battleId !== input.battleId || entry.battleVersion !== version + i,
    ) ||
    previous.some((entry) => entry.battleVersion >= version)
  )
    return undefined;

  const basicActions: string[] = [...AdjustableBasicActions, "flee", "wait"];
  const additions = ordered
    .reverse()
    .filter(
      (entry) =>
        (input.userFilter !== "user" || entry.userId === userId) &&
        (input.userFilter !== "opponents" || entry.userId !== userId) &&
        (input.showBasicActions !== false || !basicActions.includes(entry.actionId)),
    );
  return [...additions, ...previous].slice(0, input.limit ?? 30);
};
